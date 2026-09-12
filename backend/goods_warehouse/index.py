"""Склад готового товара — точка входа облачной функции.

Модуль разбит на четыре файла: в одном было 4693 строки, и любая правка
требовала листать его целиком.
  shared.py            — константы, справочники причин, общие проверки и
                          подбор полки, сведение заказов с остатком
  exports.py           — выгрузки остатков в Excel (универсальная книга,
                          шаблоны OZON и WB)
  warehouse_read.py    — чтение: списки, карточка, виджеты дашборда
  warehouse_actions.py — действия: приёмка, полки, подбор, возвраты, списание

Логика не менялась: код перенесён как есть.
"""

import json
import os

from warehouse_read import handle_get
from warehouse_actions import handle_post


def handler(event: dict, context) -> dict:
    """Склад готового товара: изделия, сшитые и упакованные (статус заказа "Готовые"),
    попадают на склад товара на конкретную полку под уникальным штрихкодом хранения
    (storage_barcode), откуда далее уходят в поставку на маркетплейс.

    Статусы (status):
      - awaiting_shelf — отстикерован, ждёт, пока кладовщик отсканирует его на полку
      - in_stock  — на хранении (лежит на полке, ничего с ним не происходит)
      - picking   — на сборке (кладовщик отобрал его как нужный для будущей поставки FBS,
                     ещё не привязан к конкретной поставке)
      - reserved  — зарезервирован в конкретной поставке (marketplace_supply_items)
      - shipped   — отгружен на маркетплейс
      - lost      — утерян (с указанием причины), выбывает из активных статусов

    GET  /                          - список товаров (можно ?status=in_stock и т.д.)
        доп. фильтры: ?material=Вуаль, ?width=200, ?height=250, ?shelf_id=1
    GET  /?barcode=GW-000001         - найти товар по штрихкоду хранения (для сканера подбора
                                        и сканирования в поставку)
    GET  /?export_stock=1[&marketplace=OZON|WB]
        - товарный состав склада «На хранении» файлом Excel для загрузки FBO-поставки.
          Книга универсальна: лист «Товарный состав» (свод с артикулами обеих площадок и
          количеством), листы «OZON» и «WB» — готовые пары «артикул + количество» под
          шаблон площадки, лист «Позиции» — расшифровка по вещам со стикером и полкой.
          Считается ТОЛЬКО статус in_stock — свободный остаток на полках; вещи в сборке,
          резерве и поставках не попадают, иначе заявленное не сойдётся с фактическим.
          marketplace — оставить лист только одной площадки (по умолчанию оба)
    GET  /?export_stock=1&format=ozon
        - файл СТРОГО по шаблону OZON (products-import-template): один лист «Sheet1»,
          шапка «артикул | имя (необязательно) | количество». Артикул — наш sku
          продавца («vyal2_250»), а не числовой ozon_sku. Грузится в кабинет как
          есть — любое отличие в шапке площадка отклоняет
    GET  /?export_stock=1&format=wb
        - файл СТРОГО по шаблону Wildberries: лист «Sheet1», шапка «Баркод | Количество».
          Баркод — wb_sku (13 цифр), отдаётся текстом, иначе Excel превратит его в
          2,03865E+12. Товары без баркода не попадают: заявить их нельзя
    POST /  { action: 'export_stock', ids: [1,2,3], marketplace?, format? }
        - тот же файл, но только по вещам, отмеченным менеджером галочками: он набирает
          на складе нужные размеры и выгружает ровно то, что забирает в поставку.
          Список id идёт телом запроса — в адресной строке сотни номеров не помещаются
    POST /  { action: 'admin_receive', marketplaceItemId, shelfId? }
        - ручной приём администратором: вещь без заказа с маркетплейса (излишек производства,
          найденный товар). Под неё создаётся служебный заказ WH-00001 и запись склада с
          receive_reason='admin' — в списке видно, что товар принял админ вручную
    POST /  { action: 'place_on_shelf', barcode, shelfId }
        - кладовщик у себя на компьютере сканирует стикер хранения вещи, отменённой клиентом
          (статус awaiting_shelf), и кладёт её на конкретную полку → in_stock
    GET  /?pending_shelf=1
        - список отменённых вещей, отстикерованных упаковщиком, но ещё не положенных на полку
          (виджет на дашборде кладовщика)
    POST /  { action: 'receive_return', orderNumber }
        - приём возврата ЛЮБОЙ площадки: orderNumber — это наш номер заказа, номер
          отправления OZON, код стикера WB (*DWto4dQG, со звёздочкой или без),
          номер сборочного задания WB цифрами или номер заказа Яндекс Маркета.
          Для связки Яндекса (несколько вещей под одним номером) каждый скан
          принимает следующую ещё не принятую вещь.
          Полка НЕ выбирается: вещь встаёт в статус awaiting_shelf и попадает на полку только
          сканированием стикера хранения (place_on_shelf) — так товар не окажется «не на месте».
          Если заказ уже был на складе, старый storage_barcode сохраняется
    POST /  { action: 'move_shelf_by_barcode', barcode, shelfId }
        - то же самое, но по штрихкоду хранения (для диалога "Смена полки" со сканером)
    POST /  { action: 'return_to_workshop', id }
        - возвращает товар в цех (например, брак при выходном контроле), статус заказа
          сбрасывается на "В работе", запись удаляется со склада
    POST /  { action: 'start_picking', barcode }
        - сканер подбора: находит товар по storage_barcode (должен быть in_stock),
          переводит в статус picking — отмечает "то, что нужно для будущей поставки FBS"
    POST /  { action: 'cancel_picking', id }
        - отмена подбора: возвращает товар из picking обратно в in_stock
    POST /  { action: 'mark_lost', id, reason }
        - отмечает товар утерянным (с любого активного статуса, кроме shipped/lost)

    Args:
        event: dict с httpMethod, queryStringParameters, body
        context: объект с request_id

    Returns:
        dict: HTTP-ответ со списком/результатом операции над складом товара
    """
    method = event.get('httpMethod', 'GET')
    method = event.get('httpMethod', 'GET')

    if method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    dsn = os.environ['DATABASE_URL']

    if method == 'GET':
        return handle_get(event, headers, dsn)

    if method == 'POST':
        return handle_post(event, headers, dsn)

    return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}
