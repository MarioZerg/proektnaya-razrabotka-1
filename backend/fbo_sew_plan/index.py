import json
import os
import time
import uuid

import psycopg2

from authz import AuthError, auth_error_response, require_role
import ozon_data
import plan as planner
from create import create, recover_stuck

HEADERS = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}


def _resp(status, body):
    return {'statusCode': status, 'headers': HEADERS,
            'body': json.dumps(body, ensure_ascii=False, default=str)}


def _sync(cur, conn, shop_id, deadline):
    geo = ozon_data.sync_geo(cur, conn, shop_id, deadline - 9)
    stock = ozon_data.sync_stock(cur, conn, shop_id, deadline)
    return {'geo': geo, 'stock': stock}


def handler(event: dict, context) -> dict:
    """Автопредложка поставки FBO в пошив. Пик нагрузки базы — понятный 503 вместо обрыва."""
    try:
        return _handler(event, context)
    except psycopg2.OperationalError:
        return _resp(503, {'error': 'База перегружена и не ответила. Подождите несколько секунд '
                                    'и повторите — повтор безопасен', 'serverBusy': True})


def _handler(event: dict, context) -> dict:
    """Автопредложка поставки FBO в пошив (Ozon).

    POST { action: 'state', shopId }                       — локализация, свежесть данных, история
    POST { action: 'sync', shopId }                        — догрузить заказы и остатки Ozon (порциями)
    POST { action: 'build', shopId, pieces, cluster?, removed?, added? }
                                                            — рассчитать предложку (ничего не пишет)
    POST { action: 'create', shopId, pieces, cluster, removed?, added?, requestKey }
                                                            — пересчитать и создать поставку
    POST { action: 'sync_all', cronSecret }                — планировщик: обновить данные всех магазинов
    Всё, кроме планировщика, — только администратору.
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
            'Access-Control-Max-Age': '86400'}, 'body': ''}
    if event.get('httpMethod') != 'POST':
        return _resp(405, {'error': 'Только POST'})
    started = time.time()
    body = json.loads(event.get('body') or '{}')
    action = body.get('action')

    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    try:
        cur = conn.cursor()
        if action == 'sync_all':
            secret = os.environ.get('CRON_SECRET', '')
            if not secret or body.get('cronSecret') != secret:
                return _resp(403, {'error': 'Неверный ключ планировщика'})
            cur.execute(
                "SELECT DISTINCT shop_id FROM marketplace_integrations "
                "WHERE marketplace_code = 'ozon' AND is_enabled AND shop_id IS NOT NULL"
            )
            shops = [r[0] for r in cur.fetchall()]
            out = {}
            for sid in shops:
                # Планировщик на своём сервере не ограничен 30 секундами, как на
                # poehali: даём каждому магазину по 90 с. Раньше общие 19 с
                # заканчивались на первом магазине, второй не обновлялся вовсе.
                out[sid] = _sync(cur, conn, sid, time.time() + 90)
            cur.execute(
                "INSERT INTO audit_log (user_id, user_name, category, action, entity_type, entity_id, description) "
                "VALUES (NULL, 'Планировщик', 'integration', 'fbo_sew_sync', 'ozon', NULL, %s)",
                (json.dumps(out, ensure_ascii=False)[:900],),
            )
            conn.commit()
            return _resp(200, out)

        try:
            user = require_role(cur, event, 'admin')
        except AuthError as e:
            return auth_error_response(e, HEADERS)
        conn.commit()
        shop_id = body.get('shopId')
        if not shop_id:
            return _resp(400, {'error': 'Укажите магазин'})
        shop_id = int(shop_id)

        recover_stuck(cur, conn, shop_id)

        if action == 'state':
            cur.execute(
                "SELECT p.id, p.cluster_name, p.pieces, p.from_stock, p.to_sew, p.localization_now, "
                "       p.localization_after, p.supply_id, p.created_at, p.created_by_name, ms.status "
                "FROM sew_supply_plans p LEFT JOIN marketplace_supplies ms ON ms.id = p.supply_id "
                "WHERE p.shop_id = %s AND p.supply_id IS NOT NULL ORDER BY p.id DESC LIMIT 10",
                (shop_id,),
            )
            history = [{'id': r[0], 'cluster': r[1], 'pieces': r[2], 'fromStock': r[3], 'toSew': r[4],
                        'locNow': float(r[5]) if r[5] is not None else None,
                        'locAfter': float(r[6]) if r[6] is not None else None,
                        'supplyId': r[7], 'createdAt': r[8], 'createdBy': r[9], 'supplyStatus': r[10]}
                       for r in cur.fetchall()]
            loc = planner.localization(cur, shop_id)
            return _resp(200, {
                'localization': {'now': loc['percent'], 'orders': loc['total']},
                'home': planner.home_cluster(cur, shop_id),
                'freshness': planner.data_freshness(cur, shop_id),
                'history': history,
            })

        if action == 'sync':
            return _resp(200, _sync(cur, conn, shop_id, started + 19))

        if action in ('build', 'create'):
            result = planner.build(cur, shop_id, body.get('pieces'), body.get('cluster'),
                                   body.get('removed'), body.get('added'))
            if result.get('error'):
                return _resp(409, result)
            if action == 'build':
                return _resp(200, result)
            if body.get('cluster') and result['cluster'] != body.get('cluster'):
                return _resp(409, {'error': 'Кластер изменился — пересчитайте предложку'})
            if not result['lines']:
                return _resp(409, {'error': 'В предложке нет товаров'})
            key = str(body.get('requestKey') or '')[:80] or str(uuid.uuid4())
            created = create(cur, conn, shop_id, result, key, user['id'], user.get('name'))
            if created.get('error'):
                return _resp(409, created)
            created['cluster'] = result['cluster']
            created['localization'] = result['localization']
            return _resp(200, created)

        return _resp(400, {'error': 'Неизвестное действие'})
    finally:
        conn.close()
