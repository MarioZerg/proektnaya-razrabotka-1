-- Поставка FBS для WB: короб уже собран на стороне WB, у нас создаём для учёта.
--
-- На сам WB ничего не отправляем: поставка там уже существует, повторное создание
-- дало бы две поставки и путаницу при отгрузке. Поле wb_supply_id намеренно пустое —
-- по нему система понимает, что поставка «наша», и не пытается её синхронизировать.
INSERT INTO marketplace_supplies (marketplace, type, status, comment, supply_number, created_at)
VALUES ('WB', 'FBS', 'На сборке',
        'Короб собран на стороне WB — заведён в системе для учёта',
        'WB-GI-232733919', now());

-- Короб с вещами. Номер у нас числовой, обозначение WB кладём в штрихкод —
-- по нему кладовщик найдёт короб сканером.
INSERT INTO marketplace_supply_boxes (supply_id, box_number, barcode, created_at)
SELECT id, 1, 'WB-GI-232733919', now()
FROM marketplace_supplies
WHERE supply_number = 'WB-GI-232733919'
ORDER BY id DESC
LIMIT 1;

-- Складываем в поставку готовые заказы WB, которые ещё никуда не привязаны.
UPDATE orders
SET supply_id = (
      SELECT id FROM marketplace_supplies
      WHERE supply_number = 'WB-GI-232733919'
      ORDER BY id DESC LIMIT 1
    )
WHERE marketplace = 'WB'
  AND sewing_status = 'Готовые'
  AND supply_id IS NULL;
