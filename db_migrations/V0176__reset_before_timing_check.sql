-- Сброс перед замером времени раскроя связки.
UPDATE orders SET sewing_status = 'На раскрое', cut_at = NULL WHERE group_key = 'YM-444444';
UPDATE rolls SET remaining_quantity = 120 WHERE id = 17;
