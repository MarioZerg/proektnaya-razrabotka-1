-- Какую стадию заказа сайта ERP уже сообщила мегатюль.рф: 'work' — ушёл из
-- «Новых» в работу (покупателю убирают кнопку отмены), 'new' — вернули в
-- «Новые». Расхождение с фактической стадией находит site_stage.sweep().
ALTER TABLE orders ADD COLUMN IF NOT EXISTS site_stage_sent TEXT;
