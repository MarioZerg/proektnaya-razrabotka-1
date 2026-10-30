UPDATE t_p86119184_proektnaya_razrabotk.goods_warehouse
SET status = 'lost', reserved_order_id = NULL, matched_at = NULL,
    lost_reason = 'Отменённый заказ 0143829723-0225-11 физически уехал на OZON в поставке #1539, в системе ошибочно положен на полку. Вернётся возвратом OZON. Заказ WB 6154493695 отправлен в пошив',
    lost_at = now()
WHERE id = 21593 AND status = 'picking';

UPDATE t_p86119184_proektnaya_razrabotk.orders
SET fulfilled_from_stock_id = NULL, sewing_status = 'Новый', assigned_user_id = NULL, workshop_id = NULL
WHERE id = 124095 AND fulfilled_from_stock_id = 21593;