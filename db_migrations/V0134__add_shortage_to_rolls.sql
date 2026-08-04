-- Недостача при закрытии рулона в цехе: сколько метража не хватило в рулоне по факту
-- (рулон закрывают, даже если ткань закончилась раньше заявленного метража).
ALTER TABLE rolls ADD COLUMN IF NOT EXISTS shortage_quantity NUMERIC(10,3) NOT NULL DEFAULT 0;