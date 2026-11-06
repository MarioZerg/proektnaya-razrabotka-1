-- Одновременно может быть только одна незавершённая инвентаризация склада:
-- идёт, возвращена на пересчёт или ждёт решения администратора. Проверка в
-- функции stocktakes это уже требует, а индекс закрывает гонку, когда двое
-- нажимают «Начать» в одну секунду.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stocktakes_one_open
  ON t_p86119184_proektnaya_razrabotk.stocktakes ((true))
  WHERE status IN ('in_progress', 'rejected', 'pending_approval');
