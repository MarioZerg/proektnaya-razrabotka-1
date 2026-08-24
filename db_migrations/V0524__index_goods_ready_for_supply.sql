-- Ускоряем поиск вещей, готовых к сканированию в поставку.
--
-- При каждой загрузке экрана сборки считаются связки заказов: система ищет
-- вещи со статусом picking/awaiting_supply, у которых напечатан ярлык и
-- которые ещё не отгружены. Без индекса это перебор всего склада на каждый
-- скан — кладовщик ждёт лишнюю секунду после каждого пакета.
CREATE INDEX IF NOT EXISTS idx_gw_ready_for_supply
  ON goods_warehouse (status, shipping_labeled_at)
  WHERE shipped_at IS NULL AND shipping_labeled_at IS NOT NULL;
