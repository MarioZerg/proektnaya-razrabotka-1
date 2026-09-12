"""Склад готового товара — чтение: списки, карточки, виджеты дашборда.

Вынесено из index.py как есть: тело GET-ветки перенесено целиком, отступ снят
на один уровень. Логика и порядок проверок не менялись.
"""

import json

import psycopg2

from shared import RESERVE_ALIVE_SQL
from exports import export_stock_ozon_xlsx, export_stock_wb_xlsx, export_stock_xlsx


def handle_get(event: dict, headers: dict, dsn: str) -> dict:
    """Читающая часть склада: что показать кладовщику и менеджеру."""
    params = event.get('queryStringParameters') or {}
    status = params.get('status')
    barcode = params.get('barcode')
    material = params.get('material')
    width = params.get('width')
    height = params.get('height')
    shelf_id_filter = params.get('shelf_id')
    search = (params.get('search') or '').strip()


    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()

        # Выгрузка товарного состава для FBO-поставки (Excel).
        # format=ozon — файл строго по шаблону OZON, для загрузки на площадку.
        if params.get('export_stock'):
            fmt = (params.get('format') or '').lower()
            if fmt == 'ozon':
                return export_stock_ozon_xlsx(cur)
            if fmt == 'wb':
                return export_stock_wb_xlsx(cur)
            return export_stock_xlsx(cur, params.get('marketplace') or '')

        # Счётчик для кладовщика: сколько вещей на полках уже подобрано под заказы и
        # ждёт, чтобы он наклеил стикер отправления. По нему в меню горит значок.
        if params.get('stuck_cancelled'):
            # ВЕЩИ, ЗАВИСШИЕ ПОСЛЕ ОТМЕНЫ ЗАКАЗА.
            #
            # Заказ отменили на маркетплейсе уже после того, как вещь сшили и
            # застикеровали ярлыком отправления. Сам заказ мы с конвейера не
            # снимаем — он доводится до конца, это рабочее правило. А вот вещь
            # повисает: в поставку она не уедет (на приёмке ярлык отменённого
            # заказа не примут), но и свободным остатком не считается — числится
            # «в сборке». В итоге товар выпадает из оборота и находится только
            # выборочной проверкой.
            #
            # Признак зависания — вещь числится в сборке под ОТМЕНЁННЫЙ заказ и
            # при этом её не держит ни один живой заказ.
            #
            # Исключаем:
            #   * вещи, перезакреплённые за ЖИВЫМ заказом — они уже едут новому
            #     покупателю, это нормальная ситуация, а не зависание;
            #   * лежащие в живой поставке — короб уже собран;
            #   * отгруженные — они физически уехали.
            cur.execute(
                "SELECT gw.id, gw.storage_barcode, gw.status, sh.name, "
                "       so.order_number, so.product, so.material, so.width, so.height, "
                "       so.cancelled_at, so.marketplace "
                "FROM goods_warehouse gw "
                "JOIN orders so ON so.id = gw.order_id "
                "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                "WHERE gw.status IN ('picking', 'awaiting_supply', 'reserved') "
                "  AND gw.shipped_at IS NULL "
                "  AND (COALESCE(so.ozon_status, '') LIKE 'cancel%' "
                "       OR COALESCE(so.ym_status, '') ILIKE 'cancel%' "
                "       OR COALESCE(so.status, '') = 'Отменён') "
                "  AND (gw.reserved_order_id IS NULL "
                "       OR COALESCE(ro.ozon_status, '') LIKE 'cancel%' "
                "       OR COALESCE(ro.ym_status, '') ILIKE 'cancel%' "
                "       OR COALESCE(ro.status, '') = 'Отменён') "
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                "        JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                "        WHERE msi.goods_warehouse_id = gw.id "
                "          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                "ORDER BY so.cancelled_at ASC NULLS LAST, gw.id"
            )
            stuck = [
                {
                    'id': r[0],
                    'storageBarcode': r[1],
                    'status': r[2],
                    'shelfName': r[3],
                    'orderNumber': r[4],
                    'product': r[5],
                    'material': r[6],
                    'width': r[7],
                    'height': r[8],
                    'cancelledAt': (r[9].isoformat() + 'Z') if r[9] else None,
                    'marketplace': r[10],
                }
                for r in cur.fetchall()
            ]
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps(
                {'items': stuck, 'count': len(stuck)}, ensure_ascii=False)}

        if params.get('shipped_stuck'):
            # ВЕЩИ, КОТОРЫЕ УЖЕ УЕХАЛИ К КЛИЕНТУ, НО ВИСЯТ В ПОДБОРЕ.
            #
            # Отправление ушло с нашего склада: курьер забрал, оно едет или уже
            # доставлено покупателю. А у нас вещь так и числится «донести в короб» —
            # значит, кто-то забыл отсканировать её в поставку, а маркетплейс
            # тем временем увёз заказ.
            #
            # Для кладовщика это тупик: он идёт к стеллажу, вещи там нет и быть не
            # может — она уехала. Строка висит вечно и мешает видеть реальную работу.
            # Такие позиции закрывает администратор: физически вещь уже у клиента.
            cur.execute(
                "SELECT gw.id, gw.storage_barcode, gw.status, sh.name, "
                "       o.order_number, o.product, o.material, o.width, o.height, "
                "       o.marketplace, o.ozon_status, o.status, "
                "       gw.shipping_labeled_at "
                "FROM goods_warehouse gw "
                "JOIN orders o ON o.id = gw.reserved_order_id "
                "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                "WHERE gw.status IN ('picking', 'awaiting_supply') "
                "  AND gw.shipped_at IS NULL "
                # Заказ уехал от нас: доставляется, доставлен или забран курьером.
                "  AND (COALESCE(o.ozon_status, '') IN "
                "         ('delivering', 'delivered', 'driver_pickup') "
                "       OR COALESCE(o.status, '') IN ('Отгружен', 'Доставлен')) "
                # В живой поставке — значит короб ещё собирается, не трогаем.
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                "        JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                "        WHERE msi.goods_warehouse_id = gw.id "
                "          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                "ORDER BY gw.shipping_labeled_at ASC NULLS LAST, gw.id"
            )
            rows = cur.fetchall()
            items = [
                {
                    'id': r[0],
                    'storageBarcode': r[1],
                    'status': r[2],
                    'shelfName': r[3],
                    'orderNumber': r[4],
                    'product': r[5],
                    'material': r[6],
                    'width': r[7],
                    'height': r[8],
                    'marketplace': r[9],
                    'ozonStatus': r[10],
                    'orderStatus': r[11],
                    'labeledAt': (r[12].isoformat() + 'Z') if r[12] else None,
                }
                for r in rows
            ]
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps(
                {'items': items, 'count': len(items)}, ensure_ascii=False)}

        if params.get('pending_count'):
            # Этот счётчик висит в меню у каждого кладовщика весь день — самый
            # частый запрос во всей системе. Считаем оба числа ОДНИМ проходом по
            # таблице вместо двух запросов подряд: результат тот же, работы вдвое
            # меньше.
            #
            # Во втором числе — вся работа «на руках»: и отказы из цеха, ждущие
            # полки, и возвраты с маркетплейса, ждущие разбора. Значок в меню
            # показывает общий объём задач; куда именно идти, кладовщик видит
            # на самой странице склада — там это две разные плитки.
            #
            # Третьим числом отдаём ТОЛЬКО отказы из цеха (awaiting_shelf), без
            # возвратов с маркетплейса. По нему звучит сигнал «отменённый заказ
            # из цеха»: вещь уже застикерована складским стикером и лежит у
            # кладовщика на руках, её нужно унести на полку. Возвраты приезжают
            # своим потоком и звучать не должны — иначе сигнал теряет смысл.
            # Отказы из цеха считаем ТОЛЬКО застикерованные (storage_labeled_at).
            #
            # Раньше вещь попадала в счётчик в момент закрытия заказа на терминале —
            # до того, как упаковщица напечатала стикер. Кладовщик видел «6 штук»,
            # шёл в цех, а вещей там не было: печать могла не сработать, и вещь ещё
            # лежала у упаковщицы. Возвраты с маркетплейса (mp_return) приезжают
            # своим потоком, стикер на них уже есть — их условие не касается.
            cur.execute(
                "SELECT "
                " count(*) FILTER (WHERE status = 'mp_return' "
                "                  OR (status = 'awaiting_shelf' AND storage_labeled_at IS NOT NULL)), "
                " count(*) FILTER (WHERE status = 'awaiting_shelf' AND storage_labeled_at IS NOT NULL) "
                "FROM goods_warehouse "
                "WHERE status IN ('awaiting_shelf', 'mp_return')"
            )
            row = cur.fetchone()
            awaiting, from_workshop = int(row[0]), int(row[1])

            # Подбор считаем ТЕМ ЖЕ запросом, что и список на странице, иначе
            # цифры расходятся. Раньше счётчик брал только вещи БЕЗ стикера и
            # показывал «2», хотя в списке лежало 8 позиций: отстикерованные, но
            # не отправленные на поставку, он не видел — а работа по ним не
            # закончена.
            #
            # Заодно разбиваем по схеме: FBS собирают поштучно с ярлыком на
            # каждую вещь, FBO складывают коробкой на склад площадки. Это разная
            # работа, и кладовщик планирует день по двум числам, а не по одному.
            cur.execute(
                "SELECT upper(coalesce(o.order_type, '')), count(*) "
                "FROM goods_warehouse gw "
                "JOIN orders o ON o.id = gw.reserved_order_id "
                # Те же статусы, что и в списке подбора: вещь с напечатанным ярлыком,
                # но ещё не уложенная в короб, остаётся работой кладовщика.
                "WHERE gw.status IN ('picking', 'awaiting_supply') "
                "  AND gw.reserved_order_id IS NOT NULL "
                "  AND gw.shipped_at IS NULL "
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                "                  JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                "                  WHERE msi.goods_warehouse_id = gw.id "
                "                    AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                # У WB состав поставки лежит в своей таблице (wb_supply_orders) и
                # связан с ЗАКАЗОМ, а не со складской вещью — без этой проверки
                # счётчик считал бы уже уехавшие вещи WB и расходился со списком.
                "  AND NOT EXISTS (SELECT 1 FROM wb_supply_orders wso "
                "                  JOIN marketplace_supplies wms ON wms.id = wso.supply_id "
                "                  WHERE wso.order_id = o.id "
                "                    AND COALESCE(wms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                f"  AND {RESERVE_ALIVE_SQL.replace('ro.', 'o.')} "
                "GROUP BY 1"
            )
            by_scheme = {r[0]: int(r[1]) for r in cur.fetchall()}
            pending_fbo = by_scheme.get('FBO', 0)
            pending_fbs = by_scheme.get('FBS', 0)
            pending = sum(by_scheme.values())
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'pendingLabel': pending,
                    # Раздельно по схемам поставки — работа у них разная.
                    'pendingFbo': pending_fbo,
                    'pendingFbs': pending_fbs,
                    'awaitingShelf': awaiting,
                    # Отказы из цеха, ждущие полки — только они дают звуковой сигнал.
                    'cancelledFromWorkshop': from_workshop,
                }),
            }

        # Заказы, пришедшие на подбор: их ещё не начали шить и под них не нашли
        # готовую вещь на складе. Кладовщик смотрит список и решает, что можно
        # закрыть остатками, а что уйдёт в цех.
        # Воронка осмотра возвратов: шесть счётчиков + список выбранного этапа.
        # Кладовщик видит, сколько вещей застряло на каждом шаге, и не теряет их
        # «где-то между цехом и складом».
        if params.get('stalled_shipments'):
            # ЗАВИСШИЕ ОТПРАВЛЕНИЯ: маркетплейс ждёт товар, а у нас по заказу
            # никто не движется.
            #
            # Так пропадали заказы OZON, закрытые вещью со склада: подбор ставил
            # резерв, но не переводил вещь в статус «в подборе». Списки кладовщика
            # показывают только 'picking' и 'awaiting_supply' — заказ не попадал
            # к нему вообще и молча висел неделями, пока его не замечали вручную.
            # Сам подбор исправлен, но подобное может случиться и по другой
            # причине (оборванная операция, ручная правка), поэтому смотрим не за
            # конкретной ошибкой, а за результатом: заказ есть, работы по нему нет.
            #
            # Считаем зависшим заказ, который ОДНОВРЕМЕННО:
            #   * маркетплейс всё ещё ждёт от нас (awaiting_packaging у OZON,
            #     пустой статус у WB и Яндекса), не отменён и не отгружен;
            #   * старше суток — свежие заказы просто ещё не разобрали, это норма;
            #   * никуда не двигается: цех за него не брался И склад не готовит.
            #
            # Заказ в работе цеха (раскроен, шьётся, стикеруется) зависшим НЕ
            # считается — он идёт своим ходом по конвейеру.
            cur.execute(
                "SELECT o.id, o.order_number, o.marketplace, o.product, "
                "       o.created_at, gw.id, gw.status, sh.name "
                "FROM orders o "
                "LEFT JOIN goods_warehouse gw ON gw.id = o.fulfilled_from_stock_id "
                "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                "WHERE COALESCE(o.status, '') NOT IN ('Отменён', 'Отгружен', 'Доставлен') "
                "  AND COALESCE(o.ozon_status, '') NOT IN "
                "      ('awaiting_deliver', 'delivering', 'delivered', 'cancelled', "
                "       'not_accepted', 'driver_pickup') "
                "  AND COALESCE(o.ym_status, '') NOT ILIKE 'cancel%' "
                "  AND o.created_at < now() - interval '1 day' "
                # Вещь подобрана со склада, но не отдана кладовщику в работу:
                # числится свободным остатком или вовсе не на складе.
                "  AND o.sewing_status = 'Со склада' "
                "  AND (gw.id IS NULL OR gw.status NOT IN ('picking', 'awaiting_supply', 'shipped')) "
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                "        JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                "        WHERE msi.goods_warehouse_id = gw.id "
                "          AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                "ORDER BY o.created_at ASC LIMIT 50"
            )
            items = [
                {
                    'orderId': r[0],
                    'orderNumber': r[1],
                    'marketplace': r[2],
                    'product': r[3],
                    'createdAt': r[4].isoformat() + 'Z' if r[4] else None,
                    'goodsId': r[5],
                    'goodsStatus': r[6],
                    'shelfName': r[7],
                }
                for r in cur.fetchall()
            ]
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'items': items, 'count': len(items)},
                                   ensure_ascii=False),
            }

        # Уведомления для панели администратора.
        if params.get('notifications'):
            cur.execute(
                "SELECT id, kind, title, message, actor_name, link, created_at, is_read "
                "FROM admin_notifications WHERE hidden_at IS NULL "
                "ORDER BY created_at DESC LIMIT 100"
            )
            rows = cur.fetchall()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'items': [
                        {
                            'id': r[0],
                            'kind': r[1],
                            'title': r[2],
                            'message': r[3],
                            'actorName': r[4],
                            'link': r[5],
                            'createdAt': (r[6].isoformat() + 'Z') if r[6] else None,
                            'isRead': r[7],
                        }
                        for r in rows
                    ],
                    'unread': sum(1 for r in rows if not r[7]),
                }, ensure_ascii=False),
            }

        if params.get('inspection'):
            stage = (params.get('stage') or '').strip()

            cur.execute(
                "SELECT "
                # Приехало с ПВЗ и лежит у кладовщика неразобранным: он ещё не решил,
                # положить вещь на полку или отдать упаковщицам на осмотр.
                "  COUNT(*) FILTER (WHERE status = 'mp_return'), "
                "  COUNT(*) FILTER (WHERE status = 'checking'), "
                "  COUNT(*) FILTER (WHERE status = 'repacking'), "
                # «Осмотрено» и «Забрано с производства» слиты в один этап: для
                # кладовщика это одна и та же работа — положить вещь на полку.
                "  COUNT(*) FILTER (WHERE status IN ('inspected', 'taken')), "
                "  COUNT(*) FILTER (WHERE status = 'taken'), "
                "  COUNT(*) FILTER (WHERE status = 'to_dispose'), "
                "  COUNT(*) FILTER (WHERE status = 'lost' AND disposed_at IS NOT NULL) "
                "FROM goods_warehouse"
            )
            c = cur.fetchone()
            counts = {
                'fromMarketplace': c[0],
                'fromReturn': c[1],
                'atPackers': c[2],
                'inspected': c[3],
                'taken': c[4],
                'toDispose': c[5],
                'disposed': c[6],
            }

            items = []
            stage_status = {
                'fromMarketplace': 'mp_return',
                'fromReturn': 'checking',
                'atPackers': 'repacking',
                'taken': 'taken',
                'toDispose': 'to_dispose',
            }.get(stage)
            if stage == 'inspected':
                # Один список: и осмотренные упаковщицей, и уже забранные из цеха —
                # кладовщик кладёт на полку и те, и другие.
                where_stage = "gw.status IN ('inspected', 'taken')"
            elif stage == 'disposed':
                where_stage = "gw.status = 'lost' AND gw.disposed_at IS NOT NULL"
            elif stage == 'readyShelf':
                # Всё, что кладовщик может прямо сейчас разложить по полкам: осмотренные
                # упаковщицей и уже забранные им из цеха. Список нужен окну приёмки, чтобы
                # проверять сканы в браузере и не дёргать сервер на каждый штрихкод.
                where_stage = "gw.status IN ('inspected', 'taken')"
            elif stage_status:
                where_stage = f"gw.status = '{stage_status}'"
            else:
                where_stage = None

            if where_stage:
                cur.execute(
                    "SELECT gw.id, gw.storage_barcode, gw.status, gw.received_at, "
                    "       gw.inspected_at, gw.taken_at, gw.dispose_reason, gw.lost_reason, "
                    "       o.order_number, o.product, o.material, o.width, o.height, "
                    "       o.marketplace, ins.full_name, tk.full_name, "
                    # Стикер возврата маркетплейса — то, что физически наклеено на
                    # пакете с ПВЗ. Кладовщик ищет вещь именно по нему: стикера
                    # хранения на возврате ещё нет, а название товара длинное и
                    # набирать его руками дольше, чем пикнуть код.
                    "       mr.return_barcode, mr.product_name, "
                    # СКОЛЬКО РАЗ ЭТУ ВЕЩЬ УЖЕ ВОЗВРАЩАЛИ.
                    #
                    # Главное, что кладовщику нужно решить при разборе: осмотреть
                    # вещь или сразу класть на полку. Вещь, приехавшая обратно
                    # третий раз, почти наверняка с изъяном — покупатели не
                    # возвращают исправный товар снова и снова. Раньше этой
                    # информации не было вовсе: каждый возврат выглядел первым.
                    "       (SELECT count(*) FROM goods_return_history h "
                    "         WHERE h.goods_warehouse_id = gw.id), "
                    # Вещь заведена руками — прошлый путь неизвестен. Это НЕ
                    # «возвратов ноль», это «мы не знаем»: такую вещь тоже стоит
                    # осмотреть.
                    "       gw.history_lost, "
                    # Кто и когда упаковал вещь в цехе, и номер отправления
                    # клиента, который от неё отказался. Кладовщик принимает
                    # тележку из цеха и должен видеть, ЧТО он принимает: раньше
                    # тут было только число, и сверить содержимое было нечем.
                    "       pk.full_name, o.packed_at, "
                    "       COALESCE(o.ozon_posting_number, o.order_number), "
                    # Откуда вещь взялась. Кладовщику важно различать:
                    # 'return' — приехала от покупателя с ПВЗ;
                    # 'cancelled_labeled' — заказ отменили ПОСЛЕ стикеровки,
                    #   вещь из нашего же цеха и к покупателю не уезжала.
                    # Действия одинаковые (на полку + стикер хранения), но
                    # осматривать вещь, которая никуда не ездила, незачем.
                    "       gw.receive_reason "
                    "FROM goods_warehouse gw "
                    "LEFT JOIN orders o ON o.id = gw.order_id "
                    # Заявка на возврат берётся ОДНА, самая свежая.
                    #
                    # Раньше здесь был обычный LEFT JOIN, и если к вещи
                    # привязано несколько заявок (в одном отправлении бывает
                    # две одинаковые вещи, а к некоторым карточкам их цеплялось
                    # до пяти), строка размножалась. В списке появлялись
                    # СТРОКИ-БЛИЗНЕЦЫ С ОДНИМ И ТЕМ ЖЕ id — и галочка отмечала
                    # их разом: кладовщик выбирал одну вещь, а выделялись две.
                    #
                    # LATERAL с LIMIT 1 даёт ровно одну строку на вещь, сколько
                    # бы заявок к ней ни было. Каждая вещь проверяется отдельно.
                    "LEFT JOIN LATERAL ("
                    "  SELECT mr.return_barcode, mr.product_name "
                    "  FROM marketplace_returns mr "
                    "  WHERE mr.goods_warehouse_id = gw.id "
                    "  ORDER BY mr.id DESC LIMIT 1"
                    ") mr ON true "
                    "LEFT JOIN users ins ON ins.id = gw.inspected_by "
                    "LEFT JOIN users tk ON tk.id = gw.taken_by "
                    "LEFT JOIN users pk ON pk.id = o.packer_user_id "
                    f"WHERE {where_stage} "
                    "ORDER BY gw.received_at ASC LIMIT 300"
                )
                items = [
                    {
                        'id': r[0],
                        'storageBarcode': r[1],
                        'status': r[2],
                        'receivedAt': (r[3].isoformat() + 'Z') if r[3] else None,
                        'inspectedAt': (r[4].isoformat() + 'Z') if r[4] else None,
                        'takenAt': (r[5].isoformat() + 'Z') if r[5] else None,
                        'disposeReason': r[6],
                        'lostReason': r[7],
                        'orderNumber': r[8],
                        'product': r[9],
                        'material': r[10],
                        'width': r[11],
                        'height': r[12],
                        'marketplace': r[13],
                        'inspectedByName': r[14],
                        'takenByName': r[15],
                        'returnBarcode': r[16],
                        'returnProductName': r[17],
                        'returnCount': int(r[18] or 0),
                        'historyLost': bool(r[19]),
                        'packerName': r[20],
                        'packedAt': (r[21].isoformat() + 'Z') if r[21] else None,
                        'clientOrderNumber': r[22],
                        'receiveReason': r[23],
                    }
                    for r in cur.fetchall()
                ]

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'counts': counts, 'items': items}, ensure_ascii=False),
            }

        # ИСТОРИЯ ВОЗВРАТОВ ОДНОЙ ВЕЩИ — кладовщик раскрывает её из списка.
        #
        # Счётчик отвечает «сколько раз», а здесь видно «когда, из какого
        # отправления, по какой причине и чем закончилось». По этому кладовщик
        # и решает: вещь возвращают за размер — можно на полку; возвращают за
        # брак — надо осматривать.
        if params.get('return_history'):
            gw_id = params.get('return_history')
            cur.execute(
                "SELECT h.return_number, h.order_number, h.posting_number, "
                "       h.marketplace, h.return_reason, h.outcome, h.returned_at, "
                "       COALESCE(h.received_by_name, u.full_name) "
                "FROM goods_return_history h "
                "LEFT JOIN users u ON u.id = h.received_by "
                "WHERE h.goods_warehouse_id = %s "
                "ORDER BY h.return_number",
                (int(gw_id),),
            )
            history = [
                {
                    'returnNumber': r[0],
                    'orderNumber': r[1],
                    'postingNumber': r[2],
                    'marketplace': r[3],
                    'returnReason': r[4],
                    'outcome': r[5],
                    'returnedAt': (r[6].isoformat() + 'Z') if r[6] else None,
                    'receivedByName': r[7],
                }
                for r in cur.fetchall()
            ]
            cur.execute(
                "SELECT history_lost, storage_barcode FROM goods_warehouse WHERE id = %s",
                (int(gw_id),),
            )
            g_row = cur.fetchone()
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'history': history,
                    'historyLost': bool(g_row[0]) if g_row else False,
                    'storageBarcode': g_row[1] if g_row else None,
                }, ensure_ascii=False),
            }

        if params.get('picking_orders'):
            # Реальная работа на сегодня: вещи, которые система уже подобрала под
            # заказы и которые лежат на полке в ожидании стикера отправления.
            # Кладовщик идёт с этим списком к стеллажу и собирает их.
            #
            # Просто «новые заказы» тут показывать нельзя: их сотни, но закрыть
            # складом можно лишь те, под которые реально лежит нужная вещь.
            cur.execute(
                "SELECT gw.id, o.order_number, o.product, o.material, o.width, o.height, "
                "       gw.matched_at, o.marketplace, gw.storage_barcode, sh.name, "
                "       gw.shipping_labeled_at, gw.status, "
                # Схема поставки и кластер: по ним кладовщик сразу видит, куда поедет
                # вещь. FBS клеится ярлык маркетплейса и едет отдельным пакетом,
                # FBO уходит коробкой на склад площадки — работа разная.
                "       o.order_type, o.cluster "
                "FROM goods_warehouse gw "
                "JOIN orders o ON o.id = gw.reserved_order_id "
                "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                # Вещь остаётся в подборе, пока её физически не положили в короб.
                #
                # 'picking'         — отобрана под заказ, лежит на полке;
                # 'awaiting_supply' — ярлык напечатан и нажато «На поставку», но в
                #                     короб вещь ещё не отсканирована.
                #
                # Второй статус раньше из списка выпадал, и это был тупик: кладовщик
                # открыл карточку, не держа вещь в руках, случайно напечатал стикер и
                # отправил на поставку — строка тут же исчезла из подбора. Вещь лежит
                # на полке среди сотен других, номера её полки на экране больше нет,
                # и найти её без сканера почти невозможно.
                #
                # Пока вещь не в коробе — работа не закончена, и строка нужна.
                # Из списка она уходит при сканировании в поставку (статус reserved).
                "WHERE gw.status IN ('picking', 'awaiting_supply') "
                "  AND gw.reserved_order_id IS NOT NULL "
                "  AND gw.shipped_at IS NULL "
                # Вещь уже лежит в живой поставке — она в коробе, искать её не надо.
                # Завершённые поставки не считаем: вещь могла вернуться и снова уйти
                # в подбор под новый заказ.
                "  AND NOT EXISTS (SELECT 1 FROM marketplace_supply_items msi "
                "                  JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
                "                  WHERE msi.goods_warehouse_id = gw.id "
                "                    AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                # У WB СВОЯ ТАБЛИЦА СОСТАВА ПОСТАВКИ — wb_supply_orders.
                #
                # OZON и Яндекс кладут вещь в marketplace_supply_items, а WB работает
                # заданиями: сканирование в поставку пишет связь «заказ ↔ поставка» в
                # wb_supply_orders, а в marketplace_supply_items не попадает ничего.
                # Из-за этого проверка выше вещи WB не видела: стикер наклеен, вещь
                # в коробе, а строка продолжала висеть в подборе. Кладовщик шёл к
                # стеллажу за вещью, которая уже уехала в поставку.
                #
                # Связь у WB идёт через ЗАКАЗ, а не через складскую вещь.
                "  AND NOT EXISTS (SELECT 1 FROM wb_supply_orders wso "
                "                  JOIN marketplace_supplies wms ON wms.id = wso.supply_id "
                "                  WHERE wso.order_id = o.id "
                "                    AND COALESCE(wms.status, '') NOT IN ('Выполнена', 'Отменена')) "
                # Отправление уже уехало от нас или отменено — ярлык для него OZON
                # больше не отдаёт, собрать такую вещь невозможно. Раньше она висела
                # в подборе вечно: кладовщик шёл к стеллажу, а на печати получал
                # «OZON готовит этикетку, нажмите ещё раз» — и так по кругу.
                # Бронь должна быть живой: заказ не отменён, не отгружен, не уехал
                # к покупателю и не ушёл на конвейер. Условие общее со сканером и
                # со сменой полки — иначе экраны опять разойдутся между собой.
                f"  AND {RESERVE_ALIVE_SQL.replace('ro.', 'o.')} "
                "ORDER BY gw.matched_at ASC NULLS LAST, gw.id ASC"
            )
            orders_rows = cur.fetchall()

            # Сколько ТАКИХ ЖЕ вещей свободно лежит на складе и на каких полках.
            #
            # Кладовщик подходит к стеллажу за конкретной вещью, а её там нет:
            # ошиблись при инвентаризации, вещь переложили, забрали и не отметили.
            # Раньше на этом работа вставала — он не знал, есть ли на складе такая
            # же вещь и где её искать, и заказ уходил в цех шиться заново.
            #
            # Теперь рядом с каждой строкой показываем свободные остатки того же
            # товара по полкам: «Лен 300x265 — ещё 2 шт: Нижняя (1), Средняя (1)».
            cur.execute(
                "SELECT src.product, sh.name, count(*) "
                "FROM goods_warehouse gw "
                "JOIN orders src ON src.id = gw.order_id "
                "JOIN shelves sh ON sh.id = gw.shelf_id "
                # Только вещи, РЕАЛЬНО лежащие на полке. Вещь без полки ещё
                # не принята кладовщиком — она в цехе, и посылать за ней к
                # стеллажу бессмысленно: раньше такие строки показывались как
                # «Полка не указана», кладовщик шёл искать и не находил.
                "WHERE gw.status = 'in_stock' AND gw.reserved_order_id IS NULL "
                "  AND src.product IS NOT NULL "
                "GROUP BY src.product, sh.name "
                "ORDER BY count(*) DESC"
            )
            stock_by_product = {}
            for prod, shelf_name, cnt in cur.fetchall():
                stock_by_product.setdefault(prod, []).append({
                    'shelfName': shelf_name,
                    'count': int(cnt),
                })

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps([
                    {
                        'id': r[0],
                        'orderNumber': r[1],
                        'product': r[2],
                        'material': r[3],
                        'width': r[4],
                        'height': r[5],
                        'createdAt': (r[6].isoformat() + 'Z') if r[6] else None,
                        'marketplace': r[7],
                        'storageBarcode': r[8],
                        'shelfName': r[9],
                        # Ярлык уже наклеен, а вещь ещё не отправлена: в списке она
                        # подсвечивается как «осталось отправить на поставку».
                        'shippingLabeledAt': (r[10].isoformat() + 'Z') if r[10] else None,
                        # Состояние работы по вещи: 'picking' — лежит на полке и
                        # ждёт стикера; 'awaiting_supply' — стикер наклеен, осталось
                        # отсканировать её в короб поставки.
                        'status': r[11],
                        'orderType': r[12],
                        'cluster': r[13],
                        # Свободные такие же вещи на складе — запасной вариант,
                        # если по своей полке вещи не оказалось.
                        'alsoOnShelves': stock_by_product.get(r[2], []),
                    }
                    for r in orders_rows
                ], ensure_ascii=False),
            }

        # Карточка одной вещи: что это, где лежит, под какой заказ и вся история
        # её движения — кто принял, кто наклеил стикер, кто отправил.
        if params.get('card_id'):
            card_id = int(params['card_id'])
            cur.execute(
                "SELECT gw.id, gw.status, gw.storage_barcode, gw.receive_reason, "
                "       gw.received_at, gw.shipped_at, gw.shipping_labeled_at, gw.matched_at, "
                "       sh.name, "
                "       src.order_number, src.product, src.material, src.width, src.height, "
                "       src.marketplace, "
                # Свой заказ вещи (её сшили прямо под него) — по нему тоже
                # печатается ярлык. Без id и типа карточка не могла напечатать
                # стикер на сшитую под заказ вещь: она смотрела только на
                # бронь, а брони у такой вещи нет.
                "       src.id, src.order_type, "
                "       res.id, res.order_number, res.marketplace, res.order_type, "
                # Причина утилизации — рядом с причиной списания: у вещи в
                # карточке должно быть видно, за что её отправили в утиль.
                "       gw.lost_reason, gw.dispose_reason "
                "FROM goods_warehouse gw "
                "LEFT JOIN shelves sh ON sh.id = gw.shelf_id "
                "LEFT JOIN orders src ON src.id = gw.order_id "
                "LEFT JOIN orders res ON res.id = gw.reserved_order_id "
                "WHERE gw.id = %s",
                (card_id,),
            )
            r = cur.fetchone()
            if not r:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'Товар не найден'})}

            # Лежит ли вещь в АКТИВНОЙ поставке? Тогда кнопку «Отправить на поставку»
            # показывать не надо — она уже едет.
            #
            # Завершённые поставки в расчёт не берём: вещь могла вернуться к нам
            # (возврат, отказ покупателя) и снова попасть в подбор под новый заказ.
            # Из-за старой записи кладовщик видел «Вещь на поставке» и не мог
            # напечатать стикер на вещь, которая прямо сейчас лежит у него в подборе.
            cur.execute(
                "SELECT s.id, s.status FROM marketplace_supply_items msi "
                "JOIN marketplace_supplies s ON s.id = msi.supply_id "
                "WHERE msi.goods_warehouse_id = %s "
                "  AND COALESCE(s.status, '') NOT IN ('Выполнена', 'Отменена') "
                "ORDER BY msi.id DESC LIMIT 1",
                (card_id,),
            )
            sup = cur.fetchone()

            # История: события и по самой вещи, и по заказам, с которыми она связана.
            # Так видно всю цепочку — от пошива до наклейки стикера.
            # r[17] — заказ, под который вещь подобрана (бронь).
            order_ids = [x for x in (r[17],) if x]
            cur.execute("SELECT order_id FROM goods_warehouse WHERE id = %s", (card_id,))
            own = cur.fetchone()
            if own and own[0]:
                order_ids.append(own[0])
            ids_csv = ','.join(str(int(i)) for i in set(order_ids)) or '0'
            cur.execute(
                "SELECT user_name, action, description, created_at FROM audit_log "
                f"WHERE (entity_type = 'goods_warehouse' AND entity_id = {card_id}) "
                f"   OR (entity_type = 'order' AND entity_id IN ({ids_csv})) "
                "ORDER BY created_at DESC LIMIT 100"
            )
            log_rows = cur.fetchall()

            # ЭТАПЫ КОНВЕЙЕРА БЕРЁМ ИЗ САМОГО ЗАКАЗА, А НЕ ИЗ ЖУРНАЛА.
            #
            # Когда вещь раскроили, сшили и упаковали — записано прямо в
            # заказе (cut_at, taken_at, sewn_at, packed_at) вместе с тем, кто
            # это сделал. Журнал те же события лишь дублировал строками, и
            # они копились десятками тысяч, нагружая базу без пользы.
            #
            # Теперь история читается из первоисточника: она никуда не
            # денется, даже когда старые записи журнала подчистятся.
            cur.execute(
                "SELECT o.order_number, o.cut_at, cu.full_name, "
                "       o.taken_at, o.sewn_at, sw.full_name, "
                "       o.packed_at, pk.full_name "
                "FROM orders o "
                "LEFT JOIN users cu ON cu.id = o.cutter_user_id "
                "LEFT JOIN users sw ON sw.id = o.sewer_user_id "
                "LEFT JOIN users pk ON pk.id = o.packer_user_id "
                f"WHERE o.id IN ({ids_csv})"
            )
            stage_events = []
            for st in cur.fetchall():
                num = st[0]
                for when, who, text in (
                    (st[1], st[2], 'Раскроен'),
                    (st[3], None, 'Взят в пошив'),
                    (st[4], st[5], 'Отшит'),
                    (st[6], st[7], 'Упакован'),
                ):
                    if when:
                        stage_events.append({
                            'userName': who,
                            'action': 'stage',
                            'description': f'{text} — заказ {num}' if num else text,
                            'createdAt': when.isoformat() + 'Z',
                        })

            # Строки конвейера из журнала отбрасываем: те же события уже
            # собраны выше из полей заказа, иначе они задвоятся в истории.
            stage_actions = ('take_order', 'cut', 'send_to_stickering', 'close_order')
            history = [
                {
                    'userName': h[0],
                    'action': h[1],
                    'description': h[2],
                    'createdAt': (h[3].isoformat() + 'Z') if h[3] else None,
                }
                for h in log_rows if h[1] not in stage_actions
            ]
            history += stage_events
            # Самое свежее сверху — как и было.
            history.sort(key=lambda x: x['createdAt'] or '', reverse=True)

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'id': r[0],
                    'status': r[1],
                    'storageBarcode': r[2],
                    'receiveReason': r[3],
                    'receivedAt': (r[4].isoformat() + 'Z') if r[4] else None,
                    'shippedAt': (r[5].isoformat() + 'Z') if r[5] else None,
                    'shippingLabeledAt': (r[6].isoformat() + 'Z') if r[6] else None,
                    'matchedAt': (r[7].isoformat() + 'Z') if r[7] else None,
                    'shelfName': r[8],
                    'sourceOrderNumber': r[9],
                    'product': r[10],
                    'material': r[11],
                    'width': r[12],
                    'height': r[13],
                    'sourceMarketplace': r[14],
                    'sourceOrderId': r[15],
                    'sourceOrderType': r[16],
                    'reservedOrderId': r[17],
                    'reservedOrderNumber': r[18],
                    'reservedMarketplace': r[19],
                    'reservedOrderType': r[20],
                    'lostReason': r[21],
                    'disposeReason': r[22],
                    'supplyId': sup[0] if sup else None,
                    'supplyStatus': sup[1] if sup else None,
                    'history': history,
                }, ensure_ascii=False),
            }

        if barcode:
            barcode_esc = barcode.strip().replace("'", "''")
            cur.execute(
                "SELECT gw.id, gw.order_id, o.order_number, o.product, o.material, o.width, o.height, "
                "gw.shelf_id, s.name, gw.status, gw.received_at, gw.shipped_at, gw.storage_barcode, "
                "gw.lost_reason, gw.lost_at, gw.receive_reason, gw.shipping_labeled_at, "
                # Резерв нужен сканеру подбора: по нему он отличает вещь, которую
                # надо забрать в контейнер, от неликвида, просто лежащего на складе.
                "gw.reserved_order_id, ro.order_number, "
                # Вещь недоступна для подбора, если её заказ:
                #   * забрали в цех (кроят или шьют) — отправление закроет то, что
                #     выйдет с конвейера, а эта вещь остаётся на складе;
                #   * отменён или уже уехал к покупателю — ярлык маркетплейс не отдаст.
                # Условие один в один повторяет фильтр списка подбора, чтобы сканер
                # и экран кладовщика никогда не расходились.
                f"NOT {RESERVE_ALIVE_SQL} "
                "FROM goods_warehouse gw "
                "LEFT JOIN orders o ON o.id = gw.order_id "
                "LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
                "LEFT JOIN shelves s ON s.id = gw.shelf_id "
                f"WHERE gw.storage_barcode = '{barcode_esc}'"
            )
            row = cur.fetchone()
            if not row:
                return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': f'Товар со штрихкодом {barcode} не найден'})}
            item = {
                'id': row[0], 'orderId': row[1], 'orderNumber': row[2], 'product': row[3],
                'material': row[4], 'width': row[5], 'height': row[6], 'shelfId': row[7],
                'shelfName': row[8], 'status': row[9], 'receivedAt': row[10].isoformat() + 'Z',
                'shippedAt': (row[11].isoformat() + 'Z') if row[11] else None, 'storageBarcode': row[12],
                'lostReason': row[13], 'lostAt': (row[14].isoformat() + 'Z') if row[14] else None,
                'receiveReason': row[15] or 'manual',
                # Стикер отправления уже наклеен — вещь собрана, в подбор не идёт.
                'shippingLabeledAt': (row[16].isoformat() + 'Z') if row[16] else None,
                'reservedOrderId': row[17],
                'reservedOrderNumber': row[18],
                'orderInProduction': bool(row[19]) if row[17] else False,
            }
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'item': item})}

        conditions = []
        if status:
            # Можно перечислить несколько статусов через запятую:
            # ?status=picking,awaiting_supply.
            #
            # Карточка поставки берёт «готовое к сборке» — это ДВА статуса:
            # снятое с полок (picking) и сшитое в цехе (awaiting_supply).
            # Раньше на это уходило два отдельных вызова функции подряд,
            # хотя запрос к базе почти одинаковый.
            status_list = [v.strip() for v in status.split(',') if v.strip()]
            if len(status_list) > 1:
                quoted = "', '".join(v.replace("'", "''") for v in status_list)
                conditions.append(f"gw.status IN ('{quoted}')")
            else:
                status_esc = status.replace("'", "''")
                conditions.append(f"gw.status = '{status_esc}'")
            # Возвраты с маркетплейса: показываем только СВЕЖИЕ (за сегодня и вчера).
            #
            # Кладовщик открывает этот фильтр, чтобы разобрать привезённое сегодня,
            # а не изучать историю за всё время. Без ограничения сюда падали сотни
            # старых записей, среди которых сегодняшние 25 коробок терялись.
            # Захочет посмотреть старое — найдёт поиском по номеру или стикеру.
            if status == 'mp_return':
                # Сутки считаем от московской даты — иначе «за сегодня» смещается на 3 часа.
                conditions.append(
                    "gw.received_at >= (now() + interval '3 hours')::date "
                    "                  - interval '1 day'"
                )
            # ОТГРУЖЕННЫЕ: только за последние трое суток.
            #
            # Их на складе десятки тысяч — вся история отправок. За месяц набегает
            # 7500 записей, и ответ перестаёт влезать в предельный размер: страница
            # отдаёт ошибку вместо списка.
            #
            # Кладовщик открывает этот фильтр с конкретной целью: вещь числится
            # уехавшей, а лежит у него на столе — вынули из короба, вернули с
            # приёмки, заказ отменили после закрытия поставки. Такие случаи всегда
            # свежие, разбираются в тот же день. Что старше — ищут поиском по
            # стикеру: он работает по всем статусам и за любой срок.
            if status == 'shipped':
                conditions.append(
                    "COALESCE(gw.shipped_at, gw.received_at) >= now() - interval '3 days'"
                )
        if material:
            material_esc = material.replace("'", "''")
            conditions.append(f"o.material = '{material_esc}'")
        if width:
            conditions.append(f"o.width = {int(width)}")
        if height:
            conditions.append(f"o.height = {int(height)}")
        if shelf_id_filter:
            conditions.append(f"gw.shelf_id = {int(shelf_id_filter)}")

        # ПОИСК ИЩЕТ В БАЗЕ, А НЕ В БРАУЗЕРЕ.
        #
        # Кладовщик пикает сканером стикер хранения и ждёт одну вещь. Раньше
        # ради этого на планшет уезжал весь склад (5292 записи, 2.5 МБ), и
        # перебор шёл уже там. Теперь ищет база — по тем же полям: стикер
        # хранения, номер заказа (свой и тот, под который вещь подобрана),
        # название и материал.
        if search:
            q = search.replace("'", "''").replace('%', r'\%').replace('_', r'\_').lower()
            conditions.append(
                "(LOWER(COALESCE(gw.storage_barcode, '')) LIKE '%%" + q + "%%' "
                " OR LOWER(COALESCE(o.order_number, '')) LIKE '%%" + q + "%%' "
                " OR LOWER(COALESCE(ro.order_number, '')) LIKE '%%" + q + "%%' "
                " OR LOWER(COALESCE(o.product, '')) LIKE '%%" + q + "%%' "
                " OR LOWER(COALESCE(o.material, '')) LIKE '%%" + q + "%%')"
            )

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        # ПОТОЛОК НА ВЫДАЧУ.
        #
        # Без фильтра и без поиска (вкладка «Все») запрос тянул весь склад
        # целиком — 6617 записей. Склад растёт каждый день, и ответ перестал
        # влезать в предельный размер: страница отдавала ошибку вместо списка.
        #
        # Отдаём последние 1500 записей — это несколько месяцев работы, дальше
        # никто глазами не листает. Нужную вещь ищут поиском по стикеру или
        # номеру заказа, а он идёт в базу и видит всю историю без ограничения.
        limit_clause = "" if (status or search) else " LIMIT 1500"

        cur.execute(
            f"SELECT gw.id, gw.order_id, o.order_number, o.product, o.material, o.width, o.height, "
            f"gw.shelf_id, s.name, gw.status, gw.received_at, gw.shipped_at, gw.storage_barcode, "
            f"gw.lost_reason, gw.lost_at, gw.receive_reason, gw.reserved_order_id, ro.order_number, "
            f"gw.shipping_labeled_at, "
            # Куда вещь поедет: площадка и схема берутся у ЗАКРЕПЛЁННОГО заказа
            # (reserved), а если его нет — у заказа, в котором вещь сшили. Без этого
            # счётчик «Готово к сборке» показывал в каждой поставке весь склад разом:
            # вещи для OZON FBS считались готовыми и для поставки WB.
            f"COALESCE(ro.marketplace, o.marketplace), "
            f"COALESCE(ro.order_type, o.order_type), "
            f"COALESCE(ro.cluster, o.cluster), "
            # Кто списал вещь и отправил её в пошив. Админ во вкладке «Утерян»
            # должен видеть не только факт, но и ответственного: за списанием
            # стоят потраченная ткань и повторная работа цеха.
            f"(SELECT a.user_name FROM audit_log a "
            f" WHERE a.entity_type = 'goods_warehouse' AND a.entity_id = gw.id "
            f"   AND a.action IN ('send_to_sewing', 'mark_lost') "
            f" ORDER BY a.created_at DESC LIMIT 1), "
            # Вещь, уже лежащая в АКТИВНОЙ поставке, второй раз никуда не поедет.
            # Без этого она считалась «готовой к сборке» и в новой поставке тоже.
            # Завершённые поставки не учитываем: вещь могла вернуться к нам и снова
            # уйти в подбор — старая запись не должна её блокировать.
            f"(SELECT msi.supply_id FROM marketplace_supply_items msi "
            f" JOIN marketplace_supplies ms ON ms.id = msi.supply_id "
            f" WHERE msi.goods_warehouse_id = gw.id "
            f"   AND COALESCE(ms.status, '') NOT IN ('Выполнена', 'Отменена') "
            f" ORDER BY msi.id DESC LIMIT 1), "
            # Заказ, под который вещь закреплена, уже забрали в цех: его кроят или
            # шьют. Стикер отправления на такую вещь не напечатать — отправление
            # закроет то, что выйдет с конвейера. Для склада вещь недоступна.
            f"COALESCE(ro.sewing_status, '') NOT IN ('Новый', 'Со склада'), "
            # Стикер хранения напечатан упаковщицей. Пока пусто — вещь ещё у неё
            # на руках, идти за ней в цех рано.
            f"gw.storage_labeled_at, "
            # ЗАКАЗ, В КОТОРОМ ВЕЩЬ СШИЛИ, ОТМЕНЁН НА ПЛОЩАДКЕ.
            #
            # Вернуть такую вещь «в цех» нельзя: возврат сбрасывает заказ обратно
            # в пошив, а шить для отменённого покупателя нечего — цех получает
            # работу, которую никто не оплатит. Кладовщику эту кнопку не
            # показываем, см. фронт.
            f"(COALESCE(o.ozon_status, '') = 'cancelled' OR o.cancelled_at IS NOT NULL) "
            f"FROM goods_warehouse gw "
            f"LEFT JOIN orders o ON o.id = gw.order_id "
            f"LEFT JOIN orders ro ON ro.id = gw.reserved_order_id "
            f"LEFT JOIN shelves s ON s.id = gw.shelf_id "
            f"{where_clause} "
            f"ORDER BY gw.received_at DESC, gw.id DESC{limit_clause}"
        )
        items = [
            {
                'id': r[0],
                'orderId': r[1],
                'orderNumber': r[2],
                'product': r[3],
                'material': r[4],
                'width': r[5],
                'height': r[6],
                'shelfId': r[7],
                'shelfName': r[8],
                'status': r[9],
                'receivedAt': r[10].isoformat() + 'Z',
                'shippedAt': (r[11].isoformat() + 'Z') if r[11] else None,
                'storageBarcode': r[12],
                'lostReason': r[13],
                'lostAt': (r[14].isoformat() + 'Z') if r[14] else None,
                'receiveReason': r[15] or 'manual',
                'reservedOrderId': r[16],
                'reservedOrderNumber': r[17],
                'shippingLabeledAt': (r[18].isoformat() + 'Z') if r[18] else None,
                # Назначение вещи: в какую поставку она должна попасть.
                'marketplace': r[19],
                'orderType': r[20],
                'cluster': r[21],
                'lostByName': r[22],
                'supplyId': r[23],
                # true — заказ ушёл на конвейер, вещь для подбора недоступна.
                'orderInProduction': r[24],
                # Стикер хранения напечатан — вещь готова к забору кладовщиком.
                'storageLabeledAt': (r[25].isoformat() + 'Z') if r[25] else None,
                # Заказ отменён покупателем: возвращать вещь в цех бессмысленно.
                # Отменённых на складе единицы, поэтому шлём поле только когда
                # оно true — иначе на 1176 вещах это лишние килобайты в цех, и
                # ответ упирается в предельный размер.
                'orderCancelled': True if r[26] else None,
            }
            for r in cur.fetchall()
        ]

        # Выбрасываем пустые поля: у вещи 23 поля, но у большинства половина пустая
        # (кластер, причина утери, привязанный заказ, полка у ещё не разложенных).
        # На 1176 вещах это сотни лишних килобайт, которые едут на планшет в цех
        # по мобильному интернету. Интерфейс везде проверяет значение на пустоту,
        # поэтому отсутствующее поле читается так же, как пустое.
        items = [
            {k: v for k, v in it.items() if v is not None and v != ''}
            for it in items
        ]
    finally:
        conn.close()

    # ensure_ascii=False обязателен. Иначе каждая русская буква уезжает как
    # «\u043e» — шесть байт вместо двух, и ответ раздувается втрое: список
    # склада перестал влезать в предельный размер и отдавал ошибку вместо
    # товаров. Остальные ветки этой функции давно отвечают именно так.
    return {
        'statusCode': 200,
        'headers': headers,
        'body': json.dumps({'items': items}, ensure_ascii=False),
    }

