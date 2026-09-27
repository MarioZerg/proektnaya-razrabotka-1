-- Заводим складскую запись заказу 0130129485-0036-1 (id 102072).
--
-- ЧТО СЛУЧИЛОСЬ. Закрытие заказа на терминале упаковщицы 25.09 в 15:31
-- оборвалось на середине. Транзакция успела списать упаковку (пакет и этикетка,
-- order_material_usage 42193/42194), проставить sewing_status = 'Готовые',
-- packed_at и packer_user_id — и дальше не дошла: складской записи нет,
-- начисление упаковщице не создано, записи close_order в журнале нет.
-- Пошив швее пришлось доначислять вручную 15:41 через «Работа без начисления».
--
-- Для склада вещи не существует. Кладовщик сканирует ярлык в короб и получает
-- «Отправление не найдено среди собранных с полок», хотя пакет с наклеенным
-- ярлыком у него в руках, а на OZON отправление числится awaiting_deliver —
-- «готово к отгрузке». Заказ молча висит до просрочки. Ровно то же было с
-- 55691968-0274-5 (V0554).
--
-- Причина закрыта в коде: повторное нажатие «Закрыть заказ» на терминале теперь
-- доводит закрытие до конца (backend/kiosk), а сканирование в поставку само
-- заводит потерянную запись (restore_missing_workshop_goods в
-- backend/marketplace_supplies/shared.py).
--
-- Здесь восстанавливаем то, что должен был создать терминал: статус
-- awaiting_supply («ждёт поставки», не на полке), причина fbs_ready, отметка о
-- наклеенном ярлыке — временем упаковки, а не сегодняшним, иначе отчёты покажут
-- вещь пролежавшей на складе ноль дней.
--
-- Условия повторяют проверку в коде: только живое отправление, которое реально
-- поедет покупателю.
INSERT INTO t_p86119184_proektnaya_razrabotk.goods_warehouse (
    order_id, reserved_order_id, status, storage_barcode,
    receive_reason, shipping_labeled_at, matched_at, received_at
)
SELECT o.id,
       o.id,
       'awaiting_supply',
       'GW-' || lpad(nextval('t_p86119184_proektnaya_razrabotk.goods_warehouse_storage_seq')::text, 6, '0'),
       'fbs_ready',
       o.packed_at,
       o.packed_at,
       o.packed_at
  FROM t_p86119184_proektnaya_razrabotk.orders o
 WHERE o.id = 102072
   AND o.sewing_status = 'Готовые'
   AND o.packed_at IS NOT NULL
   AND COALESCE(o.status, '') NOT IN ('Отменён', 'Отгружен', 'Доставлен')
   AND COALESCE(o.ozon_status, '') NOT IN
       ('delivering', 'delivered', 'cancelled', 'not_accepted', 'driver_pickup')
   AND NOT EXISTS (SELECT 1 FROM t_p86119184_proektnaya_razrabotk.goods_warehouse g
                    WHERE g.order_id = o.id);

-- Упаковщица закрыла заказ, но денег за стикеровку не получила: начисление
-- создаётся в той же оборвавшейся транзакции. Ставка — как на терминале:
-- пог.м. по ширине изделия из тарифа её цеха.
INSERT INTO t_p86119184_proektnaya_razrabotk.salary_accruals
    (user_id, type, amount, order_id, description)
SELECT o.packer_user_id,
       'packer_stickering',
       round((o.width / 100.0) * r.rate, 2),
       o.id,
       'Стикеровка заказа #' || o.order_number || ' - '
           || round(o.width / 100.0, 2) || ' п.м.'
  FROM t_p86119184_proektnaya_razrabotk.orders o
  JOIN t_p86119184_proektnaya_razrabotk.users u ON u.id = o.packer_user_id
  JOIN t_p86119184_proektnaya_razrabotk.workshops w ON w.name = u.workshop
  JOIN t_p86119184_proektnaya_razrabotk.salary_rates r
       ON r.role = 'packer' AND r.workshop_id = w.id
      AND r.material_id IS NULL AND r.width IS NULL
 WHERE o.id = 102072
   AND o.width IS NOT NULL
   AND r.rate > 0
ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING;
