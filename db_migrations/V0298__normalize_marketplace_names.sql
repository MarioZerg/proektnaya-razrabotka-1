-- Приводим названия маркетплейсов к единому виду.
--
-- При переносе из старой системы заказы записались как 'ozon' и 'wildberries',
-- а синхронизация с маркетплейсами создаёт их как 'OZON' и 'WB'. Из-за разнобоя
-- один и тот же маркетплейс выглядел как два разных: фильтры и печать стикеров
-- по перенесённым заказам не срабатывали.
UPDATE orders SET marketplace = 'OZON' WHERE marketplace = 'ozon';
UPDATE orders SET marketplace = 'WB' WHERE marketplace IN ('wildberries', 'wb');
UPDATE orders SET marketplace = 'YANDEX' WHERE marketplace IN ('yandex_market', 'yandex');
