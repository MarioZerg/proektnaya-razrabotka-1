"""Действия по поставке: сборка, короба, статусы и отгрузка.

Вынесено из index.py без изменений — те же действия, тот же порядок проверок.
Здесь всё, что МЕНЯЕТ поставку, поэтому предохранители (блокировка сборки, запрет
FBS менеджеру, проверка ЭТрН перед отгрузкой) собраны в одном месте.
"""

import json
import re
import time

import psycopg2

from shared import (
    OZON_DEAD_STATUSES,
    OZON_SHIP_BATCH,
    OZON_SHIP_WINDOW_SEC,
    VALID_STATUSES,
    cancelled_item_info,
    check_fbo_underfilled,
    check_incomplete_groups,
    check_unlabeled_bundles,
    deny_if_locked_by_other,
    deny_manager_fbs,
    ensure_ozon_assembled,
    find_cancelled_items,
    get_supply_lock,
    log_action,
    ozon_posting_status_live,
    ozon_ship_postings,
    release_stale_supply_locks,
    resolve_ozon_barcode,
    return_wb_order_to_accumulator,
    upload_pass_sticker,
)


def handle_post(event: dict, headers: dict, dsn: str) -> dict:
    """Обрабатывает POST-запросы модуля поставок."""
    body_data = json.loads(event.get('body') or '{}')
    action = body_data.get('action')
    actor_role = (body_data.get('actorRole') or '').strip()
    actor_id = body_data.get('actorId')

    # Действия, меняющие FBS-поставку. Менеджеру они закрыты: FBS собирает кладовщик,
    # сканируя товар со своих полок, а менеджер только наблюдает за ходом сборки.
    FBS_WRITE_ACTIONS = (
        'scan_order', 'remove_item', 'create_box', 'delete_box', 'close_box',
        'add_order_to_box', 'remove_box_item', 'move_status', 'force_complete',
        'update', 'delete', 'add_sewing_orders', 'scan_bundle_label',
    )

    # Действия сборки: пока поставку держит один кладовщик, второй их выполнить
    # не может. 'move_status'/'force_complete'/'delete' сюда НЕ входят намеренно —
    # это решения по поставке целиком, их принимает администратор.
    ASSEMBLY_ACTIONS = (
        'scan_order', 'remove_item', 'create_box', 'delete_box', 'close_box',
        'add_order_to_box', 'remove_box_item', 'cancelled_to_shelf', 'add_sewing_orders',
        'scan_bundle_label',
    )

    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        if actor_role == 'manager' and action in FBS_WRITE_ACTIONS:
            target_supply = (
                body_data.get('supplyId') or body_data.get('id')
            )
            if not target_supply and body_data.get('boxId'):
                cur.execute(
                    "SELECT supply_id FROM marketplace_supply_boxes WHERE id = %s",
                    (int(body_data['boxId']),),
                )
                b_row = cur.fetchone()
                target_supply = b_row[0] if b_row else None
            if not target_supply and body_data.get('itemId'):
                cur.execute(
                    "SELECT supply_id FROM marketplace_supply_items WHERE id = %s",
                    (int(body_data['itemId']),),
                )
                i_row = cur.fetchone()
                target_supply = i_row[0] if i_row else None
            denied = deny_manager_fbs(cur, supply_id=target_supply, actor_role=actor_role)
            if denied:
                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': denied}, ensure_ascii=False)}

        # Поставку собирает кто-то другой — любое изменение её состава отклоняем.
        # Проверяем на сервере, а не только на экране: два планшета могли открыть
        # страницу одновременно, до того как блокировка появилась.
        if action in ASSEMBLY_ACTIONS and actor_id:
            lock_supply = body_data.get('supplyId') or body_data.get('id')
            if not lock_supply and body_data.get('boxId'):
                cur.execute(
                    "SELECT supply_id FROM marketplace_supply_boxes WHERE id = %s",
                    (int(body_data['boxId']),),
                )
                lb = cur.fetchone()
                lock_supply = lb[0] if lb else None
            if not lock_supply and body_data.get('itemId'):
                cur.execute(
                    "SELECT supply_id FROM marketplace_supply_items WHERE id = %s",
                    (int(body_data['itemId']),),
                )
                li = cur.fetchone()
                lock_supply = li[0] if li else None
            if lock_supply:
                lock_err = deny_if_locked_by_other(cur, lock_supply, actor_id)
                conn.commit()
                if lock_err:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({'error': lock_err}, ensure_ascii=False),
                    }

        # Захват поставки: кладовщик открыл экран сборки. Кто первый — тот и собирает.
        # Страница повторяет запрос раз в минуту, продлевая блокировку (heartbeat).
        if action == 'lock_supply':
            lock_supply_id = body_data.get('supplyId')
            if not lock_supply_id or not actor_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку и сотрудника'})}
            release_stale_supply_locks(cur)
            # Ставим блокировку одним запросом: условие в WHERE не даст двум
            # одновременным нажатиям перехватить поставку друг у друга.
            cur.execute(
                "UPDATE marketplace_supplies SET locked_by = %s, locked_at = now() "
                "WHERE id = %s AND (locked_by IS NULL OR locked_by = %s) "
                "RETURNING locked_by",
                (int(actor_id), int(lock_supply_id), int(actor_id)),
            )
            got = cur.fetchone()
            conn.commit()
            if not got:
                _, holder_name = get_supply_lock(cur, lock_supply_id)
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': f'Поставку уже собирает {holder_name or "другой сотрудник"}',
                         'lockedByName': holder_name},
                        ensure_ascii=False,
                    ),
                }
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'locked': True})}

        # Освобождение: кладовщик ушёл со страницы сборки.
        if action == 'unlock_supply':
            unlock_id = body_data.get('supplyId')
            if not unlock_id or not actor_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку и сотрудника'})}
            # Снять блокировку может только тот, кто её поставил, — иначе один
            # кладовщик мог бы «выбить» другого прямо во время сборки.
            cur.execute(
                "UPDATE marketplace_supplies SET locked_by = NULL, locked_at = NULL "
                "WHERE id = %s AND locked_by = %s",
                (int(unlock_id), int(actor_id)),
            )
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'unlocked': True})}

        if action == 'create':
            marketplace = (body_data.get('marketplace') or '').strip()
            supply_type = (body_data.get('type') or 'FBS').strip()
            comment = (body_data.get('comment') or '').strip()
            created_by = body_data.get('createdBy')
            ozon_delivery_method = (body_data.get('ozonDeliveryMethod') or '').strip()

            if not marketplace:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите маркетплейс'})}
            denied = deny_manager_fbs(cur, supply_type=supply_type, actor_role=actor_role)
            if denied:
                return {'statusCode': 403, 'headers': headers, 'body': json.dumps({'error': denied}, ensure_ascii=False)}
            if supply_type not in ('FBO', 'FBS'):
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Тип поставки должен быть FBO или FBS'})}
            if marketplace == 'OZON' and supply_type == 'FBO' and ozon_delivery_method not in ('direct', 'cross_docking'):
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите способ поставки: прямая или кросс-докинг'})}

            marketplace_esc = marketplace.replace("'", "''")

            # Сборка FBS может быть только одна на маркетплейс. Две открытые сборки
            # означают, что вещи из одного контейнера расходятся по разным коробам —
            # на маркетплейсе это разные поставки, и часть заказов уедет не туда.
            if supply_type == 'FBS' and marketplace in ('WB', 'OZON'):
                cur.execute(
                    "SELECT id FROM marketplace_supplies "
                    f"WHERE marketplace = '{marketplace_esc}' AND type = 'FBS' "
                    "AND COALESCE(is_accumulator, false) = false "
                    "AND status IN ('Открытая', 'На сборке') LIMIT 1"
                )
                active = cur.fetchone()
                if active:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Сборка #{active[0]} ещё не завершена. Передайте её '
                                     f'в доставку — потом создавайте новую',
                            'activeSupplyId': active[0],
                        }, ensure_ascii=False),
                    }

            type_esc = supply_type.replace("'", "''")
            comment_esc = comment.replace("'", "''")
            created_by_sql = int(created_by) if created_by not in (None, '') else 'NULL'
            ozon_delivery_method_sql = f"'{ozon_delivery_method}'" if ozon_delivery_method else 'NULL'
            ozon_status_sql = "'Заполнение данных'" if (marketplace == 'OZON' and supply_type == 'FBO') else 'NULL'

            cur.execute(
                f"INSERT INTO marketplace_supplies (marketplace, type, status, comment, created_by, "
                f"ozon_delivery_method, ozon_status) "
                f"VALUES ('{marketplace_esc}', '{type_esc}', 'Открытая', '{comment_esc}', {created_by_sql}, "
                f"{ozon_delivery_method_sql}, {ozon_status_sql}) RETURNING id"
            )
            supply_id = cur.fetchone()[0]

            # ПОСТАВКА FBS ПОПАДАЕТ В ЗАДАНИЯ СМЕНЫ КЛАДОВЩИКА.
            #
            # Пока она не отгружена, смену закрыть нельзя: собранная поставка
            # останется до завтра, а маркетплейс ждёт её сегодня. Привязываем
            # именно к смене, а не к дате — чужие и вчерашние поставки человека
            # держать не должны.
            #
            # FBO сюда не берём: их собирают неделями и закрывают по графику
            # маркетплейса, к концу смены они не привязаны.
            if supply_type == 'FBS' and created_by not in (None, ''):
                cur.execute(
                    "SELECT id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                    "ORDER BY opened_at DESC LIMIT 1",
                    (int(created_by),),
                )
                sess_row = cur.fetchone()
                if sess_row:
                    cur.execute(
                        "INSERT INTO storekeeper_shift_supplies (shift_session_id, supply_id) "
                        "VALUES (%s, %s) ON CONFLICT (shift_session_id, supply_id) DO NOTHING",
                        (int(sess_row[0]), int(supply_id)),
                    )

            goods_ids = body_data.get('goodsWarehouseIds') or []
            for gid in goods_ids:
                cur.execute("SELECT status FROM goods_warehouse WHERE id = %s", (int(gid),))
                row = cur.fetchone()
                if not row:
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар #{gid} не найден на складе'})}
                if row[0] != 'in_stock':
                    return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': f'Товар #{gid} недоступен'})}
                cur.execute(
                    f"INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id) VALUES ({supply_id}, {int(gid)})"
                )
                cur.execute(f"UPDATE goods_warehouse SET status = 'reserved' WHERE id = {int(gid)}")

            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'id': supply_id})}

        if action == 'scan_bundle_label':
            # ВТОРОЙ ШАГ сборки связки: общий ярлык маркетплейса на коробку.
            #
            # Порядок у кладовщика такой:
            #   1. сканирует стикеры YM-… — по одному на каждую вещь заказа;
            #   2. когда собрались все, подтверждает общий ярлык — тот самый,
            #      который Яндекс выдал один на весь заказ;
            #   3. клеит этот ярлык на коробку со связкой.
            #
            # Шаг нужен как физическая отметка: ярлык существует в единственном
            # экземпляре, и без него коробка уедет неопознанной. «Вещи собраны»
            # и «ярлык наклеен» — разные вещи, и знать надо обе.
            supply_id = body_data.get('supplyId')
            group_key = (body_data.get('groupKey') or '').strip()
            code = (body_data.get('code') or '').strip()
            if not supply_id or not group_key:
                return {'statusCode': 400, 'headers': headers,
                        'body': json.dumps({'error': 'Укажите поставку и связку'},
                                           ensure_ascii=False)}

            cur.execute(
                "SELECT status FROM marketplace_supplies WHERE id = %s", (int(supply_id),)
            )
            s_row = cur.fetchone()
            if not s_row:
                return {'statusCode': 404, 'headers': headers,
                        'body': json.dumps({'error': 'Поставка не найдена'},
                                           ensure_ascii=False)}
            if s_row[0] not in ('Открытая', 'На сборке'):
                return {'statusCode': 409, 'headers': headers,
                        'body': json.dumps({'error': 'Поставка уже закрыта'},
                                           ensure_ascii=False)}

            # Ярлык подтверждаем ТОЛЬКО когда связка собрана целиком. Иначе
            # коробку заклеят с неполным заказом: ярлык наклеен, а вещи внутри
            # не все — на приёмке это уже не разобрать.
            cur.execute(
                "SELECT max(o.group_size), "
                "count(*) FILTER (WHERE msi.supply_id = %s) "
                "FROM orders o "
                "LEFT JOIN goods_warehouse gw "
                "  ON gw.order_id = o.id OR gw.reserved_order_id = o.id "
                "LEFT JOIN marketplace_supply_items msi "
                "  ON msi.goods_warehouse_id = gw.id "
                "WHERE o.group_key = %s",
                (int(supply_id), group_key),
            )
            g_row = cur.fetchone()
            total = int(g_row[0] or 0) if g_row else 0
            in_supply = int(g_row[1] or 0) if g_row else 0
            if not total:
                return {'statusCode': 404, 'headers': headers,
                        'body': json.dumps({'error': 'Связка не найдена'},
                                           ensure_ascii=False)}
            if in_supply < total:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Связка собрана не целиком: {in_supply} из {total}. '
                                 f'Отсканируйте оставшиеся вещи по стикерам YM, '
                                 f'потом клейте общий ярлык'
                    }, ensure_ascii=False),
                }

            # Сверяем, что отсканирован ярлык ИМЕННО этой связки: на нём напечатан
            # номер заказа. Иначе на коробку уедет ярлык от соседнего заказа —
            # и обе посылки придут не туда.
            if code:
                digits = ''.join(ch for ch in code if ch.isdigit())
                key_digits = ''.join(ch for ch in group_key if ch.isdigit())
                if key_digits and key_digits not in digits:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Это ярлык другого заказа. Нужен ярлык связки '
                                     f'{group_key}'
                        }, ensure_ascii=False),
                    }

            cur.execute(
                "INSERT INTO supply_bundle_labels (supply_id, group_key, scanned_code, "
                "  scanned_by, scanned_by_name) VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT (supply_id, group_key) DO UPDATE SET "
                "  scanned_code = EXCLUDED.scanned_code, scanned_at = now(), "
                "  scanned_by = EXCLUDED.scanned_by, scanned_by_name = EXCLUDED.scanned_by_name",
                (int(supply_id), group_key, code or None,
                 int(actor_id) if actor_id else None, body_data.get('actorName')),
            )
            conn.commit()
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'success': True, 'groupKey': group_key},
                                       ensure_ascii=False)}

        if action == 'scan_order':
            # Сканируется ЯРЛЫК МАРКЕТПЛЕЙСА (номер отправления) на собранной вещи,
            # а не номер заказа маркетплейса — кладовщик заранее отбирает товары к подбору
            # на складе (action 'start_picking' в backend/goods_warehouse, статус picking),
            # а здесь только подтверждает добавление конкретного отобранного товара в
            # конкретную поставку. Параметр называется orderNumber для обратной
            # совместимости фронтенда, но по факту принимает номер отправления.
            supply_id = body_data.get('supplyId')
            storage_barcode = (body_data.get('orderNumber') or '').strip()
            if not supply_id or not storage_barcode:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку и штрихкод хранения товара'})}

            cur.execute("SELECT status FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
            if row[0] not in ('Открытая', 'На сборке'):
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В эту поставку уже нельзя добавлять заказы'})}

            barcode_esc = storage_barcode.replace("'", "''")

            # Обычно в поставку сканируется стикер маркетплейса: у каждой вещи
            # свой ярлык, по нему её и опознают на приёмке.
            #
            # ИСКЛЮЧЕНИЕ — связка Яндекса. Покупатель заказал несколько вещей,
            # и ярлык на них ОДИН общий: на всех наклейках напечатан один и тот
            # же номер грузоместа и «1/1». Отсканировать таким ярлыком четыре
            # разные вещи невозможно — система каждый раз находила бы первую.
            #
            # Поэтому у каждой вещи связки есть свой стикер YM-… (выдаётся при
            # стикеровке). Кладовщик пикает вещи по одной, система видит, что
            # связка собрана целиком, и только после этого поставку можно
            # отгружать. Ярлык маркетплейса остаётся на общей упаковке заказа.
            bundle_hit = None
            cur.execute(
                "SELECT gw.id FROM goods_warehouse gw "
                f"WHERE gw.bundle_barcode = '{barcode_esc}'"
            )
            bundle_hit = cur.fetchone()

            # Складской стикер хранения в поставку не принимаем: он означает
            # «вещь лежит на полке», а не «едет в поставку». Связка собирается
            # своим стикером YM — их специально сделали разными, чтобы кладовщик
            # не путал два одинаковых на вид кода.
            if not bundle_hit:
                cur.execute(
                    "SELECT gw.id FROM goods_warehouse gw "
                    f"WHERE gw.storage_barcode = '{barcode_esc}'"
                )
                if cur.fetchone():
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'Это складской стикер хранения. В поставку '
                                     'сканируйте стикер маркетплейса, а для связки '
                                     'Яндекса — её стикер YM-…'
                        }, ensure_ascii=False),
                    }

            # Ищем вещь по номеру отправления маркетплейса: именно он напечатан на
            # ярлыке, который кладовщик клеит при сборке с полок.
            # Вещь могла попасть сюда двумя путями: сшита в цехе и застикерована
            # (gw.order_id, статус «на поставку») либо взята с полки под новый заказ
            # (fulfilled_from_stock_id). Ищем оба варианта.
            # Ищем и по НОМЕРУ ОТПРАВЛЕНИЯ (ozon_posting_number), а не только по номеру
            # заказа. В одном отправлении OZON может ехать несколько вещей: мы дробим
            # его на заказы с суффиксом («…-0530-1-1», «…-0530-1-2»), а на ярлыке
            # напечатан общий номер «…-0530-1». По нему поиск не находил ничего, и
            # кладовщика разворачивали на склад с уже собранной вещью в руках.
            #
            # Вещи одного отправления кладовщик сканирует по одной — каждая в своём
            # пакете со своим ярлыком. Поэтому берём первую подходящую: отстикерованную
            # и ещё не лежащую ни в одной поставке.
            # Связь вещи с заказом бывает трёх видов, и учитывать надо все:
            #   gw.reserved_order_id — вещь ПОДОБРАНА под заказ с полки (главный случай
            #     для сборки: именно так работает автоподбор);
            #   o.fulfilled_from_stock_id — обратная ссылка, её проставляют не всегда;
            #   gw.order_id — вещь сшили в цехе именно под этот заказ.
            # Раньше резерв не проверялся, и собранная с полки вещь в поставку не
            # сканировалась: система находила ВТОРУЮ вещь того же отправления и
            # говорила «на неё не наклеен ярлык», хотя в руках была первая.
            find_sql = (
                "SELECT gw.id, gw.status, o.order_number, gw.shipping_labeled_at "
                "FROM orders o "
                "JOIN goods_warehouse gw "
                "  ON gw.reserved_order_id = o.id "
                "  OR gw.id = o.fulfilled_from_stock_id "
                "  OR gw.order_id = o.id "
                "LEFT JOIN marketplace_supply_items msi ON msi.goods_warehouse_id = gw.id "
                "WHERE (o.order_number = '{code}' OR o.ozon_posting_number = '{code}') "
                # Сначала берём вещь, готовую ехать: свободна от поставок и с ярлыком.
                "ORDER BY (msi.id IS NULL) DESC, (gw.shipping_labeled_at IS NOT NULL) DESC, "
                "         (gw.status = 'awaiting_supply') DESC, "
                "         (gw.reserved_order_id = o.id) DESC LIMIT 1"
            )
            # Стикер связки YM-…: вещь найдена прямо по нему.
            if bundle_hit:
                cur.execute(
                    "SELECT gw.id, gw.status, o.order_number, gw.shipping_labeled_at "
                    "FROM goods_warehouse gw "
                    "JOIN orders o ON o.id = COALESCE(gw.reserved_order_id, gw.order_id) "
                    "WHERE gw.id = %s",
                    (bundle_hit[0],),
                )
                gw_row = cur.fetchone()
            else:
                cur.execute(find_sql.format(code=barcode_esc))
                gw_row = cur.fetchone()

            # Не нашли по номеру — возможно, это ярлык ЯНДЕКСА.
            #
            # Яндекс печатает на ярлыке номер грузоместа «60603398529-1», а у нас
            # тот же заказ хранится как «YM-60603398529-1»: префикс мы добавляем
            # сами при загрузке. Из-за одного этого префикса ни один ярлык Яндекса
            # не сканировался — кладовщика разворачивали с готовой вещью в руках.
            #
            # Принимаем оба вида: и номер грузоместа, и номер заказа целиком
            # («60603398529» — он тоже напечатан на ярлыке крупно, и кладовщик
            # вполне может отсканировать именно его).
            if not gw_row:
                digits = storage_barcode.strip()
                # Номер грузоместа: цифры, дефис, позиция в заказе.
                ym_match = re.fullmatch(r'(\d{6,})-(\d{1,3})', digits)
                if ym_match:
                    candidate = f'YM-{digits}'
                    cur.execute(find_sql.format(code=candidate.replace("'", "''")))
                    gw_row = cur.fetchone()
                elif re.fullmatch(r'\d{6,}', digits):
                    # Отсканирован номер заказа без позиции: в заказе может быть
                    # несколько вещей (связка). Берём первую, которая ещё не в
                    # поставке и уже отстикерована — остальные кладовщик отсканирует
                    # следующими, каждая в своём пакете со своим ярлыком.
                    cur.execute(
                        "SELECT gw.id, gw.status, o.order_number, gw.shipping_labeled_at "
                        "FROM orders o "
                        "JOIN goods_warehouse gw "
                        "  ON gw.reserved_order_id = o.id "
                        "  OR gw.id = o.fulfilled_from_stock_id "
                        "  OR gw.order_id = o.id "
                        "LEFT JOIN marketplace_supply_items msi "
                        "  ON msi.goods_warehouse_id = gw.id "
                        "WHERE o.group_key = %s AND msi.id IS NULL "
                        "ORDER BY (gw.shipping_labeled_at IS NOT NULL) DESC, "
                        "         (gw.status = 'awaiting_supply') DESC, "
                        "         o.group_position LIMIT 1",
                        (f'YM-{digits}',),
                    )
                    gw_row = cur.fetchone()

            # Всё ещё не нашли — возможно, отсканирован ШТРИХКОД с ярлыка OZON
            # (на ярлыке печатается он, а не номер отправления). Спрашиваем номер
            # у OZON и ищем повторно.
            if not gw_row:
                resolved = resolve_ozon_barcode(cur, storage_barcode)
                if resolved:
                    cur.execute(find_sql.format(code=resolved.replace("'", "''")))
                    gw_row = cur.fetchone()
            if not gw_row:
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Отправление {storage_barcode} не найдено среди собранных '
                                 f'с полок. Соберите и отстикеруйте вещь в разделе '
                                 f'«Сборка товара с полок»'
                    }, ensure_ascii=False),
                }
            goods_id, goods_status, order_number, labeled_at = gw_row

            # ОТМЕНУ ПРОВЕРЯЕМ ПЕРВОЙ — раньше ярлыка.
            #
            # Порядок здесь важен. Раньше вещь без ярлыка получала ответ «сначала
            # отстикеруйте», даже если заказ уже отменён: кладовщик шёл клеить
            # ярлык на вещь, которую всё равно никуда не повезут, и только на
            # втором скане узнавал про отмену. Отмена — более важная новость,
            # поэтому она идёт первой и звучит голосом.
            #
            # СМОТРИМ ЗАКАЗ, ПОД КОТОРЫЙ ВЕЩЬ ЕДЕТ СЕЙЧАС (reserved_order_id), а
            # не тот, для которого её когда-то сшили (order_id).
            #
            # У вещи два заказа, и это нормальный ход жизни на складе: сшили под
            # один заказ, его отменили, вещь легла на полку и потом ушла в подбор
            # под НОВОГО покупателя. Исходный заказ так и остаётся отменённым
            # навсегда — по нему судить нельзя. Иначе каждая вещь, однажды
            # побывавшая в отмене, до конца дней считалась бы отменённой и её
            # больше никогда не удалось бы отгрузить.
            cur.execute(
                "SELECT o.status, o.ozon_status, o.ym_status "
                "FROM goods_warehouse gw "
                "JOIN orders o ON o.id = COALESCE(gw.reserved_order_id, gw.order_id) "
                "WHERE gw.id = %s",
                (goods_id,),
            )
            st_row = cur.fetchone()
            if st_row and (
                (st_row[0] or '') == 'Отменён'
                or 'cancel' in (st_row[1] or '').lower()
                or 'cancel' in (st_row[2] or '').lower()
            ):
                payload = {
                    'error': f'Заказ {order_number} ОТМЕНЁН — в поставку его класть '
                             f'нельзя. Отложите вещь в сторону и передайте кладовщику '
                             f'на разбор возвратов',
                    'cancelled': True,
                    'orderNumber': order_number,
                }
                payload.update(cancelled_item_info(cur, goods_id))
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(payload, ensure_ascii=False),
                }

            # Ярлык маркетплейса ещё не наклеен: вещь лежит на полке, в короб её
            # класть нельзя — на приёмке маркетплейса её не опознают.
            if not labeled_at:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'На вещь {order_number} ещё не наклеен ярлык маркетплейса. '
                                 f'Соберите её с полки и отстикеруйте в разделе '
                                 f'«Сборка товара с полок»'
                    }, ensure_ascii=False),
                }

            # СВЕРКА С МАРКЕТПЛЕЙСОМ в момент сканирования.
            #
            # Наш статус заказа обновляется синхронизацией и отстаёт: покупатель мог
            # отменить отправление полчаса назад, а у нас оно ещё «ждёт отгрузки».
            # Кладовщик кладёт такую вещь в короб и увозит — на приёмке её не берут,
            # вещь едет обратно, а по заказу капает просрочка.
            #
            # Поэтому спрашиваем OZON напрямую прямо сейчас. Если площадка не
            # ответила (нет ключей, сеть) — сканирование НЕ блокируем: остановить
            # сборку поставки хуже, чем увезти одну спорную вещь.
            cur.execute(
                "SELECT COALESCE(ro.ozon_posting_number, o.ozon_posting_number), "
                "       COALESCE(ro.marketplace, o.marketplace) "
                "FROM goods_warehouse gw "
                "LEFT JOIN orders o ON o.id = gw.order_id "
                "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                "WHERE gw.id = %s",
                (goods_id,),
            )
            pn_row = cur.fetchone()
            if pn_row and pn_row[0] and (pn_row[1] or '').upper() == 'OZON':
                live_status = ozon_posting_status_live(cur, pn_row[0])
                if live_status in OZON_DEAD_STATUSES:
                    conn.commit()
                    # ОТМЕНУ помечаем отдельным признаком 'cancelled'.
                    #
                    # По нему терминал играет голос «заказ отменён» и показывает
                    # карточку вещи вместо обычной красной ошибки. Кладовщик
                    # сканирует поставку подряд, глядя на вещи, а не в экран:
                    # на слух он сразу понимает, что эту вещь надо отложить в
                    # сторону, а не класть в общую кучу, где её потом завалят.
                    #
                    # Остальные «мёртвые» статусы (уже едет, доставлено) — не
                    # отмена: там обычная ошибка, вещь не откладывают на полку.
                    cancelled = live_status == 'cancelled'
                    payload = {
                        'error': f'{order_number}: {OZON_DEAD_STATUSES[live_status]}. '
                                 f'Отложите вещь и передайте её кладовщику на разбор — '
                                 f'в этот короб она не едет',
                        'ozonStatus': live_status,
                    }
                    if cancelled:
                        payload['cancelled'] = True
                        payload['orderNumber'] = order_number
                        payload.update(cancelled_item_info(cur, goods_id))
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps(payload, ensure_ascii=False),
                    }

            # Сначала смотрим, не лежит ли товар УЖЕ в поставке. Добавленный товар
            # становится 'reserved', и проверка статуса ниже принимала его за
            # неотобранный — кладовщик видел «сначала отсканируйте на складе»,
            # хотя вещь была у него в руках и давно в этой же поставке.
            #
            # Смотрим ТОЛЬКО живые поставки. Завершённые в расчёт не идут: вещь могла
            # вернуться к нам (возврат, отказ покупателя, вынули из короба перед
            # отправкой) и снова попасть в подбор под новый заказ.
            #
            # Из-за старой записи о поездке кладовщик упирался в тупик: вещь заново
            # подобрана, ярлык напечатан, а сканер в короб отвечал «уже в поставке
            # #1210 (Выполнена) — уберите её оттуда». Убрать было нельзя: из
            # завершённой поставки товар не вынимается. Вещь с ярлыком оставалась
            # лежать на складе и ни в одну новую поставку не попадала.
            cur.execute(
                "SELECT si.id, si.supply_id, s.status FROM marketplace_supply_items si "
                "JOIN marketplace_supplies s ON s.id = si.supply_id "
                "WHERE si.goods_warehouse_id = %s "
                "  AND COALESCE(s.status, '') NOT IN ('Выполнена', 'Отменена') "
                "ORDER BY si.id DESC LIMIT 1",
                (goods_id,),
            )
            exists = cur.fetchone()
            if exists:
                if exists[1] == int(supply_id):
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Товар {order_number or ""} уже добавлен в эту поставку'
                        }, ensure_ascii=False),
                    }
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Товар {order_number or ""} уже в поставке #{exists[1]} '
                                 f'({exists[2]}) — уберите его оттуда, если он нужен здесь'
                    }, ensure_ascii=False),
                }

            # Статус вещи на складе роли не играет: главное, что ярлык маркетплейса
            # на неё наклеен (проверено выше) и она не в другой поставке. Вещь могла
            # остаться 'in_stock' — например, её вернули из поставки и отстикеровали
            # заново. Раньше на этом кладовщика разворачивали на склад, хотя вещь
            # была у него в руках.
            if goods_status == 'shipped':
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Товар {order_number or ""} уже отгружен'
                    }, ensure_ascii=False),
                }
            if goods_status == 'awaiting_shelf':
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Товар {order_number or ""} ещё не положен на полку'
                    }, ensure_ascii=False),
                }

            cur.execute(
                f"INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id) VALUES ({int(supply_id)}, {goods_id})"
            )
            cur.execute(f"UPDATE goods_warehouse SET status = 'reserved' WHERE id = {goods_id}")

            # Если товар из заказа с общим ярлыком (Яндекс) — сразу подсказываем, сколько
            # вещей этого заказа ещё нужно отсканировать. Лучше сказать об этом здесь, чем
            # заблокировать всю поставку в конце сборки.
            cur.execute(
                "SELECT o.group_key, o.group_size FROM goods_warehouse gw "
                "JOIN orders o ON o.id = gw.order_id WHERE gw.id = %s",
                (goods_id,),
            )
            g_row = cur.fetchone()
            group_hint = None
            if g_row and g_row[0] and (g_row[1] or 0) > 1:
                cur.execute(
                    "SELECT count(*) FROM marketplace_supply_items msi "
                    "JOIN goods_warehouse gw2 ON gw2.id = msi.goods_warehouse_id "
                    "JOIN orders o2 ON o2.id = gw2.order_id "
                    "WHERE msi.supply_id = %s AND o2.group_key = %s",
                    (int(supply_id), g_row[0]),
                )
                in_supply = int(cur.fetchone()[0])
                group_hint = {
                    'groupKey': g_row[0],
                    'inSupply': in_supply,
                    'total': int(g_row[1]),
                    'remaining': max(0, int(g_row[1]) - in_supply),
                }

            conn.commit()

            # ВОЗВРАЩАЕМ ГОТОВУЮ СТРОКУ ТАБЛИЦЫ.
            #
            # Раньше после каждого скана фронт перезагружал ВСЮ карточку поставки:
            # позиции, ожидающие отгрузки, группы, заказы на пошив, сверку с OZON.
            # На поставке в 250 вещей это секунды ожидания и полная перерисовка
            # таблицы после каждого пика — кладовщик пикал быстрее, чем страница
            # успевала обновиться, список прыгал под руками, а место в прокрутке
            # терялось.
            #
            # Теперь отдаём ровно ту строку, которую нужно дорисовать: фронт
            # добавляет её в конец таблицы и ничего не перезагружает. Поля — те же,
            # что в списке items у get_detail, иначе новая строка отличалась бы от
            # соседних (пустой размер, нет фамилии стикеровщика).
            cur.execute(
                "SELECT msi.id, msi.goods_warehouse_id, "
                "COALESCE(ro.order_number, o.order_number), "
                "COALESCE(ro.product, o.product), COALESCE(ro.material, o.material), "
                "COALESCE(ro.width, o.width), COALESCE(ro.height, o.height), "
                "gw.status, gw.shipped_at, msi.box_id, "
                "COALESCE(ro.group_key, o.group_key), "
                "COALESCE(ro.group_size, o.group_size), "
                "COALESCE(ro.group_position, o.group_position), "
                "COALESCE(ro.status, o.status), "
                "COALESCE(ro.ozon_status, o.ozon_status), "
                "COALESCE(ro.ym_status, o.ym_status), gw.storage_barcode, gw.shelf_id, "
                "COALESCE(ro.marketplace, o.marketplace), gw.shipping_labeled_by_name "
                "FROM marketplace_supply_items msi "
                "LEFT JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                "LEFT JOIN orders o ON o.id = gw.order_id "
                "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                "WHERE msi.supply_id = %s AND msi.goods_warehouse_id = %s "
                "ORDER BY msi.id DESC LIMIT 1",
                (int(supply_id), goods_id),
            )
            nr = cur.fetchone()
            new_item = None
            if nr:
                new_item = {
                    'id': nr[0],
                    'goodsWarehouseId': nr[1],
                    'orderNumber': nr[2],
                    'product': nr[3],
                    'material': nr[4],
                    'width': nr[5],
                    'height': nr[6],
                    'goodsStatus': nr[7],
                    'shippedAt': (nr[8].isoformat() + 'Z') if nr[8] else None,
                    'boxId': nr[9],
                    'groupKey': nr[10],
                    'groupSize': nr[11],
                    'groupPosition': nr[12],
                    'isCancelled': (
                        nr[13] == 'Отменён'
                        or 'cancel' in (nr[14] or '').lower()
                        or 'cancel' in (nr[15] or '').lower()
                    ),
                    'storageBarcode': nr[16],
                    'shelfId': nr[17],
                    'marketplace': nr[18],
                    'mpStatus': nr[14] or nr[15],
                    'labeledByName': nr[19],
                }

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'success': True,
                    'goodsWarehouseId': goods_id,
                    'orderNumber': order_number,
                    'group': group_hint,
                    # Готовая строка для дорисовки в таблице без перезагрузки.
                    'item': new_item,
                }, ensure_ascii=False),
            }

        if action == 'cancelled_to_shelf':
            # Отменённый заказ уезжает не на маркетплейс, а на полку хранения: вещь
            # физически готова, но покупателя у неё больше нет. Убираем её из поставки и
            # кладём на выбранную полку — оттуда её потом подберут под новый заказ.
            # Для связки Яндекса отправляем на полку ВСЮ связку: ярлык на неё общий,
            # поэтому неполный заказ отгружать нельзя.
            item_id = body_data.get('itemId')
            shelf_id = body_data.get('shelfId')
            if not item_id or not shelf_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите позицию и полку'})}

            cur.execute(
                "SELECT msi.supply_id, msi.goods_warehouse_id, s.status, o.group_key "
                "FROM marketplace_supply_items msi "
                "JOIN marketplace_supplies s ON s.id = msi.supply_id "
                "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                "JOIN orders o ON o.id = gw.order_id "
                "WHERE msi.id = %s",
                (int(item_id),),
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Позиция не найдена'})}
            supply_id_of_item, goods_id, supply_status, group_key = row
            if supply_status not in ('Открытая', 'На сборке'):
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': 'Поставка уже закрыта — товар из неё убрать нельзя'}, ensure_ascii=False),
                }

            targets = [(int(item_id), goods_id)]
            if group_key:
                cur.execute(
                    "SELECT msi.id, msi.goods_warehouse_id FROM marketplace_supply_items msi "
                    "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                    "JOIN orders o ON o.id = gw.order_id "
                    "WHERE msi.supply_id = %s AND o.group_key = %s",
                    (int(supply_id_of_item), group_key),
                )
                targets = [(r[0], r[1]) for r in cur.fetchall()] or targets

            for t_item_id, t_goods_id in targets:
                cur.execute(f"DELETE FROM marketplace_supply_items WHERE id = {int(t_item_id)}")
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'in_stock', shelf_id = %s, "
                    "reserved_order_id = NULL WHERE id = %s",
                    (int(shelf_id), int(t_goods_id)),
                )

            cur.execute("SELECT name FROM shelves WHERE id = %s", (int(shelf_id),))
            sh_row = cur.fetchone()
            shelf_name = sh_row[0] if sh_row else str(shelf_id)

            log_action(
                cur, body_data.get('actorId'), body_data.get('actorName'),
                'cancelled_to_shelf', 'marketplace_supply', supply_id_of_item,
                f'Отменённый заказ убран из поставки на полку {shelf_name}: {len(targets)} шт.'
                + (f' (связка {group_key})' if group_key else ''),
            )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'success': True,
                    'movedCount': len(targets),
                    'shelfName': shelf_name,
                    'groupKey': group_key,
                }, ensure_ascii=False),
            }

        if action == 'remove_item':
            item_id = body_data.get('itemId')
            if not item_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите itemId'})}

            cur.execute(
                "SELECT msi.goods_warehouse_id, s.status, s.type, gw.storage_barcode, "
                "o.order_number, gw.shelf_id, sh.name, src.product, gw.receive_reason "
                "FROM marketplace_supply_items msi "
                "JOIN marketplace_supplies s ON s.id = msi.supply_id "
                "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                "LEFT JOIN orders o ON o.id = gw.reserved_order_id "
                "LEFT JOIN orders src ON src.id = gw.order_id "
                "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                "WHERE msi.id = %s",
                (int(item_id),),
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Позиция не найдена'})}
            (goods_id, supply_status, supply_type, storage_barcode, reserved_order_number,
             shelf_id, shelf_name, product, receive_reason) = row
            if supply_status not in ('Открытая', 'На сборке'):
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Из этой поставки уже нельзя убрать товар'})}

            cur.execute(f"DELETE FROM marketplace_supply_items WHERE id = {int(item_id)}")

            # Вещь, сшитая в цехе под FBS-заказ, при удалении из поставки НЕ едет на
            # полку: она остаётся застикерованной и ждёт следующей поставки в статусе
            # «на поставку». Ярлык маркетплейса на ней действует, покупатель её ждёт —
            # отправлять её на хранение и рвать связь с заказом нельзя. Кладовщик
            # просто убрал позицию из короба, и она снова доступна к сканированию.
            back_to_supply = supply_type == 'FBS' and receive_reason == 'fbs_ready'

            if back_to_supply:
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'awaiting_supply' "
                    f"WHERE id = {int(goods_id)}"
                )
                # Возвращаем вещь в резервную поставку, иначе она пропадёт из
                # счётчика «Ожидают отгрузки»: позиция удалена, а новой связи нет.
                return_wb_order_to_accumulator(cur, goods_id)
            else:
                # Вещь брали с полки склада — возвращаем её туда. Ярлык маркетплейса
                # аннулируем: он выписан под конкретное отправление.
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'in_stock', "
                    "shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL, reserved_order_id = NULL, matched_at = NULL "
                    f"WHERE id = {int(goods_id)}"
                )
                # Заказ, под который вещь резервировали, снова ждёт подбора: система
                # подберёт под него другую вещь или отправит его в пошив.
                cur.execute(
                    "UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый' "
                    "WHERE fulfilled_from_stock_id = %s",
                    (int(goods_id),),
                )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'success': True,
                    # Вещь вернулась в «на поставку» — стикер хранения не печатаем,
                    # она никуда не уезжает и ждёт следующей поставки.
                    'backToSupply': back_to_supply,
                    'storageBarcode': None if back_to_supply else storage_barcode,
                    'orderNumber': reserved_order_number,
                    'product': product,
                    'shelfName': shelf_name,
                }, ensure_ascii=False),
            }

        if action == 'create_box':
            supply_id = body_data.get('supplyId')
            if not supply_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите supplyId'})}

            cur.execute("SELECT status, type FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
            if row[1] != 'FBO':
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Короба доступны только для FBO'})}
            if row[0] not in ('Открытая', 'На сборке'):
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В эту поставку уже нельзя добавлять короба'})}

            cur.execute(
                "SELECT COALESCE(MAX(box_number), 0) FROM marketplace_supply_boxes WHERE supply_id = %s",
                (int(supply_id),),
            )
            next_number = cur.fetchone()[0] + 1
            barcode = f"SUPPLY{supply_id}-BOX{next_number:03d}"

            cur.execute(
                f"INSERT INTO marketplace_supply_boxes (supply_id, box_number, barcode) "
                f"VALUES ({int(supply_id)}, {next_number}, '{barcode}') RETURNING id, created_at"
            )
            box_id, created_at = cur.fetchone()
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'id': box_id,
                    'boxNumber': next_number,
                    'barcode': barcode,
                    'createdAt': created_at.isoformat() + 'Z',
                }),
            }

        if action == 'delete_box':
            box_id = body_data.get('boxId')
            if not box_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите boxId'})}

            cur.execute(
                "SELECT COUNT(*) FROM marketplace_supply_items WHERE box_id = %s", (int(box_id),)
            )
            if cur.fetchone()[0] > 0:
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В коробе есть товары — сначала уберите их'})}

            cur.execute("DELETE FROM marketplace_supply_boxes WHERE id = %s", (int(box_id),))
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

        if action == 'close_box':
            # Закрытие короба внутри нашей системы (для WB FBO): фиксируем факт закрытия,
            # после чего кладовщик печатает стикер короба. Короб должен быть непустым.
            box_id = body_data.get('boxId')
            if not box_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите boxId'})}

            cur.execute(
                "SELECT COUNT(*) FROM marketplace_supply_items WHERE box_id = %s", (int(box_id),)
            )
            if cur.fetchone()[0] == 0:
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Короб пустой — сначала добавьте товары'})}

            cur.execute(
                "UPDATE marketplace_supply_boxes SET closed_at = NOW() "
                "WHERE id = %s AND closed_at IS NULL RETURNING closed_at",
                (int(box_id),),
            )
            row = cur.fetchone()
            conn.commit()
            closed_at = (row[0].isoformat() + 'Z') if row and row[0] else None
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True, 'closedAt': closed_at})}

        if action == 'add_order_to_box':
            box_id = body_data.get('boxId')
            order_number = (body_data.get('orderNumber') or '').strip()
            if not box_id or not order_number:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите короб и отсканируйте стикер хранения'})}

            cur.execute(
                "SELECT mb.supply_id, s.status FROM marketplace_supply_boxes mb "
                "JOIN marketplace_supplies s ON s.id = mb.supply_id WHERE mb.id = %s",
                (int(box_id),),
            )
            box_row = cur.fetchone()
            if not box_row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Короб не найден'})}
            supply_id, supply_status = box_row
            if supply_status not in ('Открытая', 'На сборке'):
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'В эту поставку уже нельзя добавлять товары'})}

            # В короб товар кладётся ТОЛЬКО сканированием стикера хранения (GW-XXXXXX).
            # Номер заказа маркетплейса руками не вводится: так в поставку не попадёт
            # вещь, которую кладовщик физически не держал в руках.
            scan_esc = order_number.replace("'", "''")

            # В короб кладётся вещь с ЯРЛЫКОМ МАРКЕТПЛЕЙСА — именно он поедет на
            # приёмку. Складской стикер хранения здесь не работает: по нему вещь
            # только находят на полке и стикеруют.
            cur.execute(
                "SELECT gw.id FROM goods_warehouse gw "
                f"WHERE gw.storage_barcode = '{scan_esc}'"
            )
            if cur.fetchone():
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Это складской стикер хранения. В короб сканируйте '
                                 'ярлык маркетплейса, наклеенный на вещь при сборке с полок'
                    }, ensure_ascii=False),
                }

            # Как и при добавлении в поставку, ищем по номеру заказа И по номеру
            # отправления: на ярлыке напечатан общий номер отправления, а одно
            # отправление у нас может быть разбито на несколько заказов-вещей.
            box_find_sql = (
                # Тянем и статус заказа: отменённую вещь в короб класть нельзя,
                # кладовщик должен узнать об этом на скане, а не на приёмке.
                "SELECT gw.id, gw.status, o.order_number, gw.shipping_labeled_at, "
                "       o.status, o.ozon_status, o.ym_status, o.marketplace, "
                "       o.material, o.width, o.height, gw.storage_barcode "
                "FROM orders o "
                "JOIN goods_warehouse gw "
                "  ON gw.reserved_order_id = o.id "
                "  OR gw.id = o.fulfilled_from_stock_id "
                "  OR gw.order_id = o.id "
                "LEFT JOIN marketplace_supply_items msi ON msi.goods_warehouse_id = gw.id "
                "WHERE (o.order_number = '{code}' OR o.ozon_posting_number = '{code}') "
                "ORDER BY (msi.id IS NULL) DESC, (gw.shipping_labeled_at IS NOT NULL) DESC, "
                "         (gw.status = 'awaiting_supply') DESC, "
                "         (gw.reserved_order_id = o.id) DESC LIMIT 1"
            )
            cur.execute(box_find_sql.format(code=scan_esc))
            gw_row = cur.fetchone()

            # Отсканирован штрихкод с ярлыка OZON — узнаём номер отправления у OZON.
            if not gw_row:
                resolved = resolve_ozon_barcode(cur, order_number)
                if resolved:
                    cur.execute(box_find_sql.format(code=resolved.replace("'", "''")))
                    gw_row = cur.fetchone()
            if not gw_row:
                return {
                    'statusCode': 404,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Отправление {order_number} не найдено среди собранных '
                                 f'с полок. Соберите и отстикеруйте вещь в разделе '
                                 f'«Сборка товара с полок»'
                    }, ensure_ascii=False),
                }
            (goods_id, goods_status, goods_order_number, labeled_at,
             ord_status, ord_ozon_status, ord_ym_status, ord_mp,
             ord_material, ord_width, ord_height, ord_gw_barcode) = gw_row
            order_number = goods_order_number or order_number

            # ЗАКАЗ ОТМЕНЁН ПОКУПАТЕЛЕМ.
            #
            # Раньше такую вещь кладовщик просто клал в короб: отмену никто не
            # показывал, и она уезжала на площадку. Там её не принимали, и вещь
            # возвращалась назад через возвратный цикл — недели пути и потери.
            #
            # Теперь отвечаем отдельным признаком: терминал играет звук отмены и
            # показывает, что вещь идёт НЕ в короб, а на полку хранения.
            cancelled = (
                (ord_status or '') == 'Отменён'
                or 'cancel' in (ord_ozon_status or '').lower()
                or 'cancel' in (ord_ym_status or '').lower()
            )
            if cancelled:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Заказ {order_number} ОТМЕНЁН покупателем — '
                                 f'в поставку его класть нельзя',
                        'cancelled': True,
                        'orderNumber': order_number,
                        'material': ord_material,
                        'width': ord_width,
                        'height': ord_height,
                        'storageBarcode': ord_gw_barcode,
                        'marketplace': ord_mp,
                    }, ensure_ascii=False),
                }

            # Ярлык маркетплейса ещё не наклеен: вещь лежит на полке, в короб её
            # класть нельзя — на приёмке маркетплейса её не опознают.
            if not labeled_at:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'На вещь {order_number} ещё не наклеен ярлык маркетплейса. '
                                 f'Соберите её с полки и отстикеруйте в разделе '
                                 f'«Сборка товара с полок»'
                    }, ensure_ascii=False),
                }

            # «Уже в поставке» проверяем ПЕРЕД статусом: добавленный товар становится
            # 'reserved', и иначе кладовщик получал невнятное «уже зарезервирован»
            # вместо понятного «этот товар уже в коробе».
            cur.execute(
                "SELECT si.id, si.supply_id FROM marketplace_supply_items si "
                "WHERE si.goods_warehouse_id = %s",
                (goods_id,),
            )
            exists = cur.fetchone()
            if exists:
                if exists[1] == supply_id:
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Товар {order_number or ""} уже добавлен в эту поставку'
                        }, ensure_ascii=False),
                    }
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': f'Товар {order_number or ""} уже в поставке #{exists[1]}'
                    }, ensure_ascii=False),
                }

            if goods_status == 'awaiting_shelf':
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': f'Товар {goods_order_number or ""} ещё не положен на полку'}),
                }
            if goods_status not in ('in_stock', 'picking'):
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': f'Товар {goods_order_number or ""} уже зарезервирован или отгружен'}),
                }

            cur.execute(
                f"INSERT INTO marketplace_supply_items (supply_id, goods_warehouse_id, box_id) "
                f"VALUES ({supply_id}, {goods_id}, {int(box_id)}) RETURNING id"
            )
            item_id = cur.fetchone()[0]
            cur.execute(f"UPDATE goods_warehouse SET status = 'reserved' WHERE id = {goods_id}")

            # Вещь физически в коробе — значит, на OZON отправление должно быть
            # собрано и ждать отгрузки. Часть заказов остаётся в «ожидает сборки»
            # (например, ярлык печатали не через нас) — дособираем их здесь, иначе
            # площадка не даст передать поставку в доставку.
            ozon_assembled = ensure_ozon_assembled(cur, goods_id)

            conn.commit()
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'success': True, 'itemId': item_id,
                                        'goodsWarehouseId': goods_id,
                                        'ozonAssembled': ozon_assembled}, ensure_ascii=False)}

        if action == 'remove_box_item':
            item_id = body_data.get('itemId')
            if not item_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите itemId'})}

            cur.execute(
                "SELECT msi.goods_warehouse_id, s.status, s.type, gw.storage_barcode, "
                "o.order_number, sh.name, src.product, gw.receive_reason "
                "FROM marketplace_supply_items msi "
                "JOIN marketplace_supplies s ON s.id = msi.supply_id "
                "JOIN goods_warehouse gw ON gw.id = msi.goods_warehouse_id "
                "LEFT JOIN orders o ON o.id = gw.reserved_order_id "
                "LEFT JOIN orders src ON src.id = gw.order_id "
                "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                "WHERE msi.id = %s",
                (int(item_id),),
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Позиция не найдена'})}
            (goods_id, supply_status, supply_type, storage_barcode, reserved_order_number,
             shelf_name, product, receive_reason) = row
            if supply_status not in ('Открытая', 'На сборке'):
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Из этой поставки уже нельзя убрать товар'})}

            cur.execute(f"DELETE FROM marketplace_supply_items WHERE id = {int(item_id)}")

            # Вещь, сшитая под FBS-заказ, возвращается в «на поставку»: ярлык на ней
            # действует, покупатель её ждёт. На полку она не едет — просто снова
            # доступна к сканированию в поставку.
            back_to_supply = supply_type == 'FBS' and receive_reason == 'fbs_ready'
            if back_to_supply:
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'awaiting_supply' "
                    f"WHERE id = {int(goods_id)}"
                )
                # Та же логика, что и при удалении позиции из поставки: вещь должна
                # вернуться в очередь на отгрузку, а не исчезнуть из счётчика.
                return_wb_order_to_accumulator(cur, goods_id)
            else:
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'in_stock', "
                    "shipping_labeled_at = NULL, shipping_labeled_by = NULL, shipping_labeled_by_name = NULL, reserved_order_id = NULL, matched_at = NULL "
                    f"WHERE id = {int(goods_id)}"
                )
                cur.execute(
                    "UPDATE orders SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый' "
                    "WHERE fulfilled_from_stock_id = %s",
                    (int(goods_id),),
                )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'success': True,
                    'backToSupply': back_to_supply,
                    'storageBarcode': None if back_to_supply else storage_barcode,
                    'orderNumber': reserved_order_number,
                    'product': product,
                    'shelfName': shelf_name,
                }, ensure_ascii=False),
            }

        if action == 'update':
            supply_id = body_data.get('supplyId')
            if not supply_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите supplyId'})}

            def sql_str_or_null(column: str, value) -> str:
                v = (value or '').strip().replace("'", "''")
                return f"{column} = NULL" if not v else f"{column} = '{v}'"

            def sql_ts_or_null(column: str, value) -> str:
                v = (value or '').strip().replace("'", "''")
                return f"{column} = NULL" if not v else f"{column} = '{v}'::timestamp"

            def sql_date_or_null(column: str, value) -> str:
                v = (value or '').strip().replace("'", "''")
                return f"{column} = NULL" if not v else f"{column} = '{v}'::date"

            fields = []
            if 'supplyNumber' in body_data:
                fields.append(sql_str_or_null('supply_number', body_data['supplyNumber']))
            if 'supplyBarcode' in body_data:
                fields.append(sql_str_or_null('supply_barcode', body_data['supplyBarcode']))
            if 'cluster' in body_data:
                fields.append(sql_str_or_null('cluster', body_data['cluster']))
            if 'gazelkaId' in body_data:
                fields.append(sql_str_or_null('gazelka_id', body_data['gazelkaId']))
            if 'comment' in body_data:
                comment_val = (body_data['comment'] or '').strip().replace("'", "''")
                fields.append(f"comment = '{comment_val}'")
            if 'shipToGazelkaAt' in body_data:
                fields.append(sql_ts_or_null('ship_to_gazelka_at', body_data['shipToGazelkaAt']))
            if 'shipToMarketplaceAt' in body_data:
                fields.append(sql_ts_or_null('ship_to_marketplace_at', body_data['shipToMarketplaceAt']))
            if 'totalQuantityMarketplace' in body_data:
                qty = body_data['totalQuantityMarketplace']
                fields.append(f"total_quantity_marketplace = {int(qty)}" if qty not in (None, '') else "total_quantity_marketplace = NULL")
            if body_data.get('passStickerBase64'):
                sticker_name = (body_data.get('passStickerName') or 'sticker.pdf').strip()
                sticker_url = upload_pass_sticker(body_data['passStickerBase64'], sticker_name)
                sticker_name_esc = sticker_name.replace("'", "''")
                fields.append(f"pass_sticker_url = '{sticker_url}'")
                fields.append(f"pass_sticker_name = '{sticker_name_esc}'")
            if 'ozonApplicationNumber' in body_data:
                fields.append(sql_str_or_null('ozon_application_number', body_data['ozonApplicationNumber']))
            if 'ozonStatus' in body_data:
                fields.append(sql_str_or_null('ozon_status', body_data['ozonStatus']))
            if 'supplyDate' in body_data:
                fields.append(sql_date_or_null('supply_date', body_data['supplyDate']))
            if 'timeslot' in body_data:
                fields.append(sql_str_or_null('timeslot', body_data['timeslot']))
            if 'shipmentType' in body_data:
                fields.append(sql_str_or_null('shipment_type', body_data['shipmentType']))
            if 'packagingType' in body_data:
                fields.append(sql_str_or_null('packaging_type', body_data['packagingType']))
            if 'packagingCount' in body_data:
                pc = body_data['packagingCount']
                fields.append(f"packaging_count = {int(pc)}" if pc not in (None, '') else "packaging_count = NULL")
            if 'gazelkaPickup' in body_data:
                fields.append(f"gazelka_pickup = {'true' if body_data['gazelkaPickup'] else 'false'}")
            if 'ozonCargoType' in body_data:
                # Тип грузоместа OZON FBO: только BOX или PALLET (защита от произвольных значений).
                ct = (body_data['ozonCargoType'] or 'BOX').strip().upper()
                if ct not in ('BOX', 'PALLET'):
                    ct = 'BOX'
                fields.append(f"ozon_cargo_type = '{ct}'")
            if 'gazelkaPlanId' in body_data:
                gp = body_data['gazelkaPlanId']
                fields.append(f"gazelka_plan_id = {int(gp)}" if gp not in (None, '') else "gazelka_plan_id = NULL")
            if 'gazelkaIds' in body_data:
                gi = body_data['gazelkaIds']
                fields.append(f"gazelka_ids = {int(gi)}" if gi not in (None, '') else "gazelka_ids = 0")
            if 'gazelkaIdm' in body_data:
                gm = body_data['gazelkaIdm']
                fields.append(f"gazelka_idm = {int(gm)}" if gm not in (None, '') else "gazelka_idm = 0")

            if not fields:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Нечего обновлять'})}

            cur.execute(f"UPDATE marketplace_supplies SET {', '.join(fields)} WHERE id = {int(supply_id)}")
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

        # Кладовщик отвечает на вопрос дашборда «поставка уехала в газельку?».
        # Да — фиксируем факт отгрузки. Нет — переносим напоминание, чтобы система
        # спросила снова: поставка могла задержаться, но забывать про неё нельзя.
        if action == 'confirm_gazelka_ship':
            supply_id = body_data.get('supplyId')
            if not supply_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку'})}
            shipped = bool(body_data.get('shipped'))

            cur.execute(
                "SELECT status FROM marketplace_supplies WHERE id = %s", (int(supply_id),)
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}

            if shipped:
                # Отмечаем факт отгрузки. Статус двигаем в «Отгрузка», если поставка
                # ещё собиралась: машина уехала — сборка закончена.
                status_sql = ", status = 'Отгрузка'" if row[0] in ('Открытая', 'На сборке') else ""
                cur.execute(
                    f"UPDATE marketplace_supplies SET gazelka_shipped_at = now(){status_sql}, "
                    f"locked_by = NULL, locked_at = NULL WHERE id = {int(supply_id)}"
                )
            else:
                # Не уехала — сдвигаем плановую дату на завтра, чтобы напоминание
                # не висело постоянно, но и не потерялось.
                cur.execute(
                    "UPDATE marketplace_supplies "
                    "SET ship_to_gazelka_at = ship_to_gazelka_at + interval '1 day' "
                    "WHERE id = %s",
                    (int(supply_id),),
                )
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

        # Досылка отправлений в OZON.
        #
        # Поставка уже закрыта — здесь только «дожать» то, что не влезло в
        # окно при закрытии. Фронт вызывает это подряд, пока ozonRemaining не
        # станет нулём. Отдельным действием, чтобы каждая порция сохранялась
        # своей транзакцией: обрыв на любой из них не откатывает предыдущие.
        if action == 'ship_ozon_postings':
            supply_id = body_data.get('supplyId')
            if not supply_id:
                return {'statusCode': 400, 'headers': headers,
                        'body': json.dumps({'error': 'Укажите supplyId'})}

            shipped, problems, remaining = ozon_ship_postings(
                cur, supply_id, limit=OZON_SHIP_BATCH,
                deadline=time.time() + OZON_SHIP_WINDOW_SEC,
            )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'success': True,
                    'ozonShipped': shipped,
                    'ozonProblems': problems,
                    'ozonRemaining': remaining,
                }, ensure_ascii=False),
            }

        if action == 'move_status':
            supply_id = body_data.get('supplyId')
            new_status = body_data.get('status')
            if not supply_id or new_status not in VALID_STATUSES:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Некорректный статус'})}

            # Тип забираем сразу: от него зависит, ставить ли отметку о
            # Газельке — она возит только FBO.
            cur.execute("SELECT status, type FROM marketplace_supplies WHERE id = %s",
                        (int(supply_id),))
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
            current_status = row[0]
            supply_type = row[1]
            current_idx = VALID_STATUSES.index(current_status) if current_status in VALID_STATUSES else -1
            new_idx = VALID_STATUSES.index(new_status)
            if new_idx != current_idx + 1:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({'error': f'Нельзя перевести поставку из статуса "{current_status}" в "{new_status}"'}),
                }

            extra_sql = ""
            ozon_shipped, ozon_problems, ozon_remaining = 0, [], 0
            if new_status == 'Отгрузка':
                # ЭТрН. С 01.09 сортировочные центры принимают только электронные
                # транспортные документы, бумажные версии не принимаются, а за
                # нарушение порядка оформления предусмотрена ответственность по
                # ст. 11.14.3 КоАП РФ. Машина без подписанной накладной уедет зря:
                # на воротах СЦ груз развернут. Поэтому отгрузку FBO не открываем,
                # пока подписанный документ от оператора не загружен в поставку.
                if supply_type == 'FBO':
                    cur.execute(
                        'SELECT status, signed_file_url FROM etrn_documents WHERE supply_id = %s',
                        (int(supply_id),),
                    )
                    etrn = cur.fetchone()
                    if not etrn:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': 'По поставке не заведена транспортная накладная (ЭТрН). '
                                         'СЦ принимает груз только с электронным документом.',
                                'etrnMissing': True,
                            }, ensure_ascii=False),
                        }
                    if etrn[0] != 'Подписана' or not etrn[1]:
                        return {
                            'statusCode': 409,
                            'headers': headers,
                            'body': json.dumps({
                                'error': f'Транспортная накладная не подписана (статус «{etrn[0]}»). '
                                         'Подпишите её в Диадоке и загрузите подписанный документ.',
                                'etrnNotSigned': True,
                            }, ensure_ascii=False),
                        }

                # Отменённые заказы отгружать нельзя: на маркетплейсе их больше нет.
                # Кладовщик должен сначала отправить такие вещи на полку хранения —
                # прямо из строки поставки, кнопкой «На полку».
                cancelled = find_cancelled_items(cur, supply_id)
                if cancelled:
                    nums = ', '.join(c['orderNumber'] or c['storageBarcode'] for c in cancelled[:10])
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'В поставке {len(cancelled)} отменённых заказов — '
                                     f'отправьте их на полку хранения: {nums}',
                            'cancelledItems': cancelled,
                        }, ensure_ascii=False),
                    }

                # Заказ Яндекса из нескольких вещей отгружается по одному общему ярлыку.
                # Отгрузить его наполовину нельзя: остаток застрянет на складе, а
                # покупателю уедет неполная посылка — маркетплейс засчитает недовоз.
                incomplete = check_incomplete_groups(cur, supply_id)
                if incomplete:
                    parts = '; '.join(
                        f"{g['groupKey']}: собрано {g['inSupply']} из {g['total']}"
                        for g in incomplete
                    )
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'В поставке есть заказы, собранные не полностью — '
                                     'у них общий ярлык, отгружать можно только целиком. '
                                     + parts,
                            'incompleteGroups': incomplete,
                        }, ensure_ascii=False),
                    }
                # Связка собрана, но общий ярлык на коробку не наклеен: вещи
                # внутри есть, а коробка не подписана — на приёмке её не опознают.
                unlabeled = check_unlabeled_bundles(cur, supply_id)
                if unlabeled:
                    parts = '; '.join(g['groupKey'] for g in unlabeled)
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': 'На коробку со связкой не наклеен общий ярлык '
                                     'маркетплейса: ' + parts + '. Отсканируйте ярлык '
                                     'в карточке поставки и наклейте его на коробку',
                            'unlabeledBundles': unlabeled,
                        }, ensure_ascii=False),
                    }

                # Поставка FBO едет по заявке: привезти меньше обещанного нельзя —
                # маркетплейс засчитает недовоз, а остаток зависнет на складе.
                underfilled = check_fbo_underfilled(cur, supply_id)
                if underfilled:
                    collected, planned = underfilled
                    return {
                        'statusCode': 409,
                        'headers': headers,
                        'body': json.dumps({
                            'error': f'Поставка собрана не полностью: {collected} из '
                                     f'{planned} шт. по заявке. Дособерите товар или '
                                     f'уменьшите количество в заявке.',
                            'collected': collected,
                            'planned': planned,
                        }, ensure_ascii=False),
                    }

                # Газелька возит ТОЛЬКО поставки FBO — на склад маркетплейса.
                #
                # FBS уезжает напрямую в пункт приёма, никакой Газельки в этом
                # пути нет. Раньше дату проставляли обеим схемам подряд, и в
                # списке у FBS-поставок висело «В Газельку 28.08» — перевозки,
                # которой не было.
                extra_sql = ''
                if (supply_type or '').upper() == 'FBO':
                    extra_sql = ", ship_to_gazelka_at = COALESCE(ship_to_gazelka_at, now())"
                cur.execute(
                    "SELECT goods_warehouse_id FROM marketplace_supply_items WHERE supply_id = %s",
                    (int(supply_id),),
                )
                goods_ids = [r[0] for r in cur.fetchall()]
                # Одним запросом на всю поставку, а не по вещи за раз: в крупной
                # поставке сотня позиций давала сотню обращений к базе, и отгрузка
                # упиралась в таймаут функции.
                if goods_ids:
                    ids_csv = ','.join(str(int(g)) for g in goods_ids)
                    cur.execute(
                        f"UPDATE goods_warehouse SET status = 'shipped', "
                        f"shipped_at = now() WHERE id IN ({ids_csv})"
                    )

                # Сами ЗАКАЗЫ тоже закрываем: вещь уехала к покупателю, ждать её
                # больше нечего. Раньше отгружалась только вещь на складе, а заказ
                # оставался «Новый» — он висел в работе у производства и мешал
                # понять, что реально осталось сшить.
                if goods_ids:
                    gids_csv = ','.join(str(int(g)) for g in goods_ids)
                    cur.execute(
                        "UPDATE orders SET status = 'Отгружен', "
                        "completed_at = COALESCE(completed_at, now()) "
                        "WHERE status <> 'Отменён' AND id IN ("
                        # И заказ покупателя, и карточку-источник вещи.
                        #
                        # Раньше стоял COALESCE(reserved_order_id, order_id): у вещи,
                        # подобранной с полки, закрывался только заказ покупателя, а
                        # служебная карточка приёмки (WH-…) висела «Новой» вечно —
                        # будто товар всё ещё ждут от цеха. Кладовщик видел «вещь
                        # отгружена» и рядом «заказ новый» и не понимал, где товар.
                        f"  SELECT reserved_order_id FROM goods_warehouse "
                        f"  WHERE id IN ({gids_csv}) AND reserved_order_id IS NOT NULL "
                        "  UNION "
                        f"  SELECT order_id FROM goods_warehouse "
                        f"  WHERE id IN ({gids_csv}) AND order_id IS NOT NULL"
                        ")"
                    )

                # Сообщаем OZON, что короб уехал: отправления уходят из «ожидает
                # отгрузки» в «доставляется». Без этого площадка считает товар у
                # продавца и начисляет просрочку, хотя вещь уже в пути.
                #
                # Успеваем сколько успеваем. OZON принимает отправления по одному,
                # в поставке их бывает сотня — целиком в одно нажатие они не влезают.
                # Раньше пробовали слать все сразу: функция обрывалась по таймауту,
                # откатывая ВСЁ, — поставка не закрывалась вовсе, и кнопка выглядела
                # нерабочей. Теперь берём часть, а остаток (ozonRemaining) фронт
                # досылает следующими вызовами, уже при закрытой поставке.
                ozon_shipped, ozon_problems, ozon_remaining = ozon_ship_postings(
                    cur, supply_id, limit=OZON_SHIP_BATCH,
                    deadline=time.time() + OZON_SHIP_WINDOW_SEC,
                )
            elif new_status == 'Выполнена':
                extra_sql = ", completed_at = now(), ship_to_marketplace_at = COALESCE(ship_to_marketplace_at, now())"

            # Поставка ушла со сборки — снимаем блокировку, иначе она осталась бы
            # висеть на кладовщике и мешала бы вернуться к поставке при исправлении.
            if new_status in ('Отгрузка', 'Выполнена'):
                extra_sql += ", locked_by = NULL, locked_at = NULL"

            cur.execute(f"UPDATE marketplace_supplies SET status = '{new_status}'{extra_sql} WHERE id = {int(supply_id)}")

            # Кладовщик получает оклад за смену, если он открыл смену И довёл хотя бы одну
            # поставку FBS/FBO до статуса "На сборке" или "Отгрузка" (salary_rates,
            # role='storekeeper'). Разово за смену — привязывается к его открытой shift_session.
            if new_status in ('На сборке', 'Отгрузка'):
                cur.execute("SELECT created_by FROM marketplace_supplies WHERE id = %s", (int(supply_id),))
                creator_row = cur.fetchone()
                creator_id = creator_row[0] if creator_row else None
                if creator_id:
                    cur.execute("SELECT role, workshop FROM users WHERE id = %s", (creator_id,))
                    user_row = cur.fetchone()
                    if user_row and user_row[0] in ('storekeeper', 'senior_storekeeper'):
                        cur.execute(
                            "SELECT id, workshop_id FROM shift_sessions WHERE user_id = %s AND closed_at IS NULL "
                            "ORDER BY opened_at DESC LIMIT 1",
                            (creator_id,),
                        )
                        session_row = cur.fetchone()
                        if session_row:
                            session_id, session_workshop_id = session_row
                            # Ставка берётся из тарифов цеха этой смены (workshop_id смены);
                            # если у смены цех не указан — из цеха профиля кладовщика.
                            rate_workshop_id = session_workshop_id
                            if not rate_workshop_id and user_row[1]:
                                cur.execute("SELECT id FROM workshops WHERE name = %s", (user_row[1],))
                                w_row = cur.fetchone()
                                rate_workshop_id = w_row[0] if w_row else None
                            if rate_workshop_id:
                                cur.execute(
                                    "SELECT rate FROM salary_rates WHERE role = %s AND workshop_id = %s",
                                    (user_row[0], rate_workshop_id),
                                )
                                rate_row = cur.fetchone()
                                rate = float(rate_row[0]) if rate_row else 0
                                if rate > 0:
                                    # Оклад за смену — один раз в день. Две смены за день
                                    # (своя и гостевая в другом цехе) — это разные записи
                                    # смен, защита по смене их не ловит. От задвоения
                                    # спасает дневной уникальный индекс, но он бьёт
                                    # ошибкой и рвёт сборку поставки, поэтому проверяем
                                    # день заранее.
                                    cur.execute(
                                        "SELECT 1 FROM salary_accruals WHERE user_id = %s "
                                        "AND type = 'storekeeper_shift' "
                                        "AND accrued_for = (now() + interval '3 hours')::date",
                                        (int(creator_id),),
                                    )
                                    if not cur.fetchone():
                                        cur.execute(
                                            f"INSERT INTO salary_accruals (user_id, type, amount, shift_session_id, description) "
                                            f"VALUES ({creator_id}, 'storekeeper_shift', {rate}, {session_id}, "
                                            f"'Оклад за смену (сборка поставки #{supply_id})') "
                                            f"ON CONFLICT (shift_session_id, type) WHERE shift_session_id IS NOT NULL DO NOTHING"
                                        )

            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'success': True,
                    # Сколько отправлений ушло в доставку на OZON и что не получилось —
                    # кладовщик должен видеть, если площадка часть не приняла.
                    'ozonShipped': ozon_shipped,
                    'ozonProblems': ozon_problems,
                    # Сколько отправлений ещё не передано — фронт досылает их
                    # отдельными вызовами ship_ozon_postings.
                    'ozonRemaining': ozon_remaining,
                }, ensure_ascii=False),
            }

        if action == 'force_complete':
            supply_id = body_data.get('supplyId')
            if not supply_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите supplyId'})}

            # Тип нужен ниже: отметку о Газельке ставим только FBO.
            cur.execute("SELECT status, type FROM marketplace_supplies WHERE id = %s",
                        (int(supply_id),))
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
            supply_type = row[1]
            if row[0] == 'Выполнена':
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Поставка уже выполнена'})}

            # Принудительное закрытие — аварийный инструмент, поэтому неполный заказ с общим
            # ярлыком он не запрещает наглухо, но требует осознанного подтверждения: иначе
            # половина заказа молча уедет как отгруженная, а вторая зависнет на складе.
            incomplete = check_incomplete_groups(cur, supply_id)
            if incomplete and not body_data.get('confirmIncomplete'):
                parts = '; '.join(
                    f"{g['groupKey']}: собрано {g['inSupply']} из {g['total']}"
                    for g in incomplete
                )
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'В поставке есть заказы, собранные не полностью (общий ярлык): '
                                 + parts + '. Подтвердите закрытие, если поставка реально уехала.',
                        'incompleteGroups': incomplete,
                        'needsConfirm': True,
                    }, ensure_ascii=False),
                }

            cur.execute(
                "SELECT goods_warehouse_id FROM marketplace_supply_items WHERE supply_id = %s",
                (int(supply_id),),
            )
            goods_ids = [r[0] for r in cur.fetchall()]
            # Одним запросом — см. пояснение выше.
            if goods_ids:
                ids_csv = ','.join(str(int(g)) for g in goods_ids)
                cur.execute(
                    f"UPDATE goods_warehouse SET status = 'shipped', "
                    f"shipped_at = COALESCE(shipped_at, now()) WHERE id IN ({ids_csv})"
                )

            # Заказы тоже закрываем — вещь уехала, производству она больше не нужна.
            if goods_ids:
                gids_csv = ','.join(str(int(g)) for g in goods_ids)
                cur.execute(
                    "UPDATE orders SET status = 'Отгружен', "
                    "completed_at = COALESCE(completed_at, now()) "
                    "WHERE status <> 'Отменён' AND id IN ("
                    # Закрываем и заказ покупателя, и карточку-источник — иначе
                    # служебная приёмка WH-… остаётся «Новой» после отгрузки.
                    f"  SELECT reserved_order_id FROM goods_warehouse "
                    f"  WHERE id IN ({gids_csv}) AND reserved_order_id IS NOT NULL "
                    "  UNION "
                    f"  SELECT order_id FROM goods_warehouse "
                    f"  WHERE id IN ({gids_csv}) AND order_id IS NOT NULL"
                    ")"
                )

            # Отметку о Газельке ставим только поставкам FBO: FBS едет в
            # пункт приёма напрямую, перевозчика в этом пути нет.
            gazelka_sql = ''
            if (supply_type or '').upper() == 'FBO':
                gazelka_sql = "ship_to_gazelka_at = COALESCE(ship_to_gazelka_at, now()), "
            cur.execute(
                f"UPDATE marketplace_supplies SET status = 'Выполнена', "
                f"{gazelka_sql}"
                f"completed_at = now(), "
                f"locked_by = NULL, locked_at = NULL, "
                f"ship_to_marketplace_at = COALESCE(ship_to_marketplace_at, now()) "
                f"WHERE id = {int(supply_id)}"
            )
            conn.commit()
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'success': True})}

        if action == 'add_sewing_orders':
            # Догрузка товаров на пошив в уже существующую поставку. Нужна, когда состав
            # заявки на маркетплейсе дополнили, или менеджер решил довезти ещё товара.
            # Каждая штука — отдельный заказ на конвейере (1 заказ = 1 изделие).
            target_supply = body_data.get('supplyId')
            lines = body_data.get('items') or []
            if not target_supply:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите поставку'})}
            if not lines:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Выберите товары'})}

            cur.execute(
                "SELECT status, marketplace, type, cluster FROM marketplace_supplies WHERE id = %s",
                (int(target_supply),),
            )
            s_row = cur.fetchone()
            if not s_row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
            s_status, s_marketplace, s_type, s_cluster = s_row
            if s_status in ('Отгрузка', 'Выполнена'):
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': 'Поставка уже уехала — догрузить товар в неё нельзя'},
                        ensure_ascii=False,
                    ),
                }

            # Номера ручных заказов идут сквозным счётчиком 00000-01, 00000-02 — тем же,
            # что и при добавлении заказа вручную, чтобы нумерация в системе была единой.
            cur.execute(
                "SELECT order_number FROM orders WHERE order_number ~ '^00000-[0-9]+$' "
                "ORDER BY (split_part(order_number, '-', 2))::int DESC LIMIT 1"
            )
            last_row = cur.fetchone()
            next_seq = (int(last_row[0].split('-')[1]) + 1) if last_row else 1

            created = 0
            from_stock = 0
            for line in lines:
                mp_item_id = line.get('marketplaceItemId')
                qty = int(line.get('quantity') or 1)
                if not mp_item_id or qty < 1:
                    continue
                cur.execute(
                    "SELECT name, material, width, height, barcode, ozon_sku "
                    "FROM marketplace_items WHERE id = %s",
                    (int(mp_item_id),),
                )
                i_row = cur.fetchone()
                if not i_row:
                    continue
                i_name, i_material, i_width, i_height, i_barcode, i_ozon_sku = i_row
                product = (
                    f"{i_material} {i_width}x{i_height}"
                    if i_material and i_width and i_height else i_name
                )

                # Сначала смотрим на полки: если такая вещь уже лежит готовой, шить её
                # заново не нужно — резервируем со склада. Берём те, что дольше всех лежат
                # (FIFO), и не больше, чем нужно в поставку.
                # SKIP LOCKED — вещь, которую параллельно резервирует подбор FBS,
                # пропускаем, чтобы одна вещь не ушла в два места.
                cur.execute(
                    "SELECT gw.id FROM goods_warehouse gw "
                    "JOIN orders src ON src.id = gw.order_id "
                    "WHERE gw.status = 'in_stock' AND gw.reserved_order_id IS NULL "
                    "AND src.marketplace_item_id = %s "
                    "ORDER BY gw.received_at ASC LIMIT %s "
                    "FOR UPDATE OF gw SKIP LOCKED",
                    (int(mp_item_id), qty),
                )
                stock_ids = [r[0] for r in cur.fetchall()]

                for gw_pick in stock_ids:
                    cur.execute(
                        "INSERT INTO orders (order_number, marketplace, order_type, status, "
                        "cluster, product, quantity, source, material, width, height, "
                        "marketplace_item_id, product_barcode, product_ozon_sku, supply_id, "
                        "fulfilled_from_stock_id, sewing_status) "
                        "VALUES (%s, %s, %s, 'Новый', %s, %s, 1, 'manual', %s, %s, %s, %s, %s, %s, %s, "
                        "%s, 'Со склада') "
                        "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                        (
                            f"00000-{next_seq:02d}", s_marketplace, s_type or 'FBO',
                            s_cluster or '', product, i_material,
                            int(i_width) if i_width else None,
                            int(i_height) if i_height else None,
                            int(mp_item_id), i_barcode or None, i_ozon_sku or None,
                            int(target_supply), int(gw_pick),
                        ),
                    )
                    new_row = cur.fetchone()
                    next_seq += 1
                    if not new_row:
                        continue
                    cur.execute(
                        "UPDATE goods_warehouse SET reserved_order_id = %s, matched_at = now() "
                        "WHERE id = %s",
                        (int(new_row[0]), int(gw_pick)),
                    )
                    created += 1
                    from_stock += 1

                # Остаток, которого не хватило на складе, уходит в пошив.
                qty -= len(stock_ids)
                for _ in range(max(0, qty)):
                    cur.execute(
                        "INSERT INTO orders (order_number, marketplace, order_type, status, "
                        "cluster, product, quantity, source, material, width, height, "
                        "marketplace_item_id, product_barcode, product_ozon_sku, supply_id) "
                        "VALUES (%s, %s, %s, 'Новый', %s, %s, 1, 'manual', %s, %s, %s, %s, %s, %s, %s) "
                        "ON CONFLICT (order_number) DO NOTHING RETURNING id",
                        (
                            f"00000-{next_seq:02d}", s_marketplace, s_type or 'FBO',
                            s_cluster or '', product, i_material,
                            int(i_width) if i_width else None,
                            int(i_height) if i_height else None,
                            int(mp_item_id), i_barcode or None, i_ozon_sku or None,
                            int(target_supply),
                        ),
                    )
                    if cur.fetchone():
                        created += 1
                    next_seq += 1

            log_action(
                cur, body_data.get('actorId'), body_data.get('actorName'),
                'supply_add_orders', 'supply', int(target_supply),
                f'Догрузил в поставку #{target_supply}: всего {created}, '
                f'из них со склада {from_stock}, в пошив {created - from_stock}',
            )
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'created': created,
                    'fromStock': from_stock,
                    'toSewing': created - from_stock,
                }),
            }

        if action == 'delete':
            item_id = body_data.get('id')
            if not item_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Укажите id'})}

            cur.execute("SELECT status FROM marketplace_supplies WHERE id = %s", (int(item_id),))
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Поставка не найдена'})}
            if row[0] != 'Открытая':
                return {'statusCode': 409, 'headers': headers, 'body': json.dumps({'error': 'Удалить можно только открытую поставку'})}

            # Подписанная транспортная накладная — юридический документ перевозки, и он
            # должен храниться независимо от того, что стало с поставкой в системе.
            # Черновик удалить можно: перевозки не было, подтверждать нечего.
            cur.execute(
                "SELECT status FROM etrn_documents "
                "WHERE supply_id = %s AND signed_file_url IS NOT NULL",
                (int(item_id),),
            )
            signed_etrn = cur.fetchone()
            if signed_etrn:
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'По поставке есть подписанная транспортная накладная — '
                                 'удалить такую поставку нельзя.'
                    }, ensure_ascii=False),
                }

            # Заказы на пошив по этой поставке. Удалять поставку можно, только пока их не
            # начали шить: если по заказу уже кроили или шили, значит потрачены ткань и
            # труд — такую поставку убирать нельзя, иначе работа пропадёт из учёта.
            cur.execute(
                "SELECT sewing_status, count(*) FROM orders WHERE supply_id = %s "
                "GROUP BY sewing_status",
                (int(item_id),),
            )
            by_status = {r[0]: int(r[1]) for r in cur.fetchall()}
            # «Со склада» — заказ закрыт готовой вещью с полки, в цехе по нему не работали.
            # Такой заказ удалению не мешает: вещь просто вернётся на полку свободной.
            started = {st: n for st, n in by_status.items() if st not in ('Новый', 'Со склада')}
            if started:
                parts = ', '.join(f'{st.lower()} — {n}' for st, n in started.items())
                return {
                    'statusCode': 409,
                    'headers': headers,
                    'body': json.dumps(
                        {'error': f'По поставке уже начали шить ({parts}). Удалить нельзя — '
                                  f'сначала отмените или доработайте эти заказы'},
                        ensure_ascii=False,
                    ),
                }

            cur.execute(
                "SELECT goods_warehouse_id FROM marketplace_supply_items WHERE supply_id = %s", (int(item_id),)
            )
            goods_ids = [r[0] for r in cur.fetchall()]
            for gid in goods_ids:
                # Вместе со статусом снимаем и резерв: вещь, вернувшаяся «На хранение»
                # с чужим заказом на борту, пропадает из подбора и мешает работе
                # сканера — он находит её, но застикеровать её нельзя.
                cur.execute(
                    "UPDATE goods_warehouse SET status = 'in_stock', "
                    "reserved_order_id = NULL, matched_at = NULL, "
                    f"shipping_labeled_at = NULL WHERE id = {gid}"
                )

            # Вещи, зарезервированные с полок под заказы этой поставки, возвращаем в
            # свободные — иначе они навсегда остались бы занятыми под удалённый заказ.
            cur.execute(
                "UPDATE goods_warehouse SET reserved_order_id = NULL, matched_at = NULL, "
                "shipping_labeled_at = NULL "
                "WHERE reserved_order_id IN (SELECT id FROM orders WHERE supply_id = %s) "
                "RETURNING id",
                (int(item_id),),
            )
            freed_stock = len(cur.fetchall())

            # Несшитые заказы этой поставки удаляем вместе с ней: они существуют только
            # ради неё и без поставки повисли бы в конвейере мусором. Заказы «Со склада»
            # тоже удаляем — вещь уже освобождена выше и снова доступна другим заказам.
            cur.execute(
                f"DELETE FROM orders WHERE supply_id = {int(item_id)} "
                f"AND sewing_status IN ('Новый', 'Со склада')"
            )
            # rowcount может прийти -1, если удалять было нечего — приводим к нулю,
            # иначе в интерфейсе покажется «удалено -1 заказов».
            deleted_orders = max(0, cur.rowcount)

            cur.execute(f"DELETE FROM marketplace_supply_items WHERE supply_id = {int(item_id)}")
            cur.execute(f"DELETE FROM marketplace_supply_boxes WHERE supply_id = {int(item_id)}")
            # Отсканированные ярлыки связок Яндекса: живут только внутри своей поставки
            # и без неё смысла не имеют. Раньше их не убирали, и удаление поставки со
            # связками падало с ошибкой связей в базе.
            cur.execute(f"DELETE FROM supply_bundle_labels WHERE supply_id = {int(item_id)}")
            # Транспортная накладная поставки. Черновик неподписанной ЭТрН удаляем
            # вместе с поставкой: перевозки не было, документ ничего не подтверждает.
            # Подписанную накладную удалить нельзя — проверка стоит выше, до всей
            # очистки, чтобы юридический документ не пропал вместе с поставкой.
            cur.execute(f"DELETE FROM etrn_documents WHERE supply_id = {int(item_id)}")

            # ЗАКАЗЫ WB ВОЗВРАЩАЕМ В НАКОПИТЕЛЬ, А НЕ ТЕРЯЕМ ВМЕСТЕ С ПОСТАВКОЙ.
            #
            # У WB застикерованный заказ живёт не вещью на складе, а строкой в
            # поставке. Раньше связь удалялась вместе с поставкой — и заказ пропадал
            # изо всех списков разом: в счётчик кладовщика он не попадал (там считают
            # накопитель), в новой поставке не показывался. Вещь при этом лежала
            # застикерованная на складе, и найти её можно было только руками.
            #
            # Переставляем такие заказы в накопительный буфер — очередь на отгрузку.
            # Если живого буфера нет, заводим его прямо здесь: обращаться к WB не
            # нужно, номер поставки на его стороне подставится при сканировании.
            cur.execute(
                "SELECT id FROM marketplace_supplies "
                "WHERE marketplace = 'WB' AND type = 'FBS' AND is_accumulator = true "
                "AND status IN ('Открытая', 'На сборке') ORDER BY id DESC LIMIT 1"
            )
            acc_row = cur.fetchone()
            cur.execute(
                f"SELECT COUNT(*) FROM wb_supply_orders WHERE supply_id = {int(item_id)}"
            )
            wb_orders_left = int(cur.fetchone()[0] or 0)

            if wb_orders_left:
                acc_id = acc_row[0] if acc_row else None
                if not acc_id:
                    cur.execute(
                        "INSERT INTO marketplace_supplies "
                        "(marketplace, type, status, comment, is_accumulator) "
                        "VALUES ('WB', 'FBS', 'Открытая', %s, true) RETURNING id",
                        ('Накопительная поставка: заказы добавляются при стикеровке',),
                    )
                    acc_id = cur.fetchone()[0]
                cur.execute(
                    f"UPDATE wb_supply_orders SET supply_id = {int(acc_id)} "
                    f"WHERE supply_id = {int(item_id)}"
                )

            cur.execute(f"DELETE FROM wb_supply_orders WHERE supply_id = {int(item_id)}")
            cur.execute(f"DELETE FROM marketplace_supplies WHERE id = {int(item_id)}")
            conn.commit()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'success': True,
                    'deletedOrders': deleted_orders,
                    'freedFromStock': freed_stock,
                }),
            }

        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Неизвестное действие'})}
    finally:
        conn.close()