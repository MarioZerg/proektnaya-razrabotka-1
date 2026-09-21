-- Запоминаем грузоместа, которые попросили снять с OZON.
--
-- ЗАЧЕМ. Снятие грузоместа у OZON только НА ВИД мгновенное: статус операции
-- отвечает SUCCESS почти сразу, а место исчезает с заявки заметно позже —
-- по замерам от 45 секунд и дольше.
--
-- Кладовщик переоткрывает короб и через 5-10 секунд закрывает его снова.
-- К этому моменту старое место ЕЩЁ ЖИВО, создаётся новое — и на заявке
-- висят два одинаковых короба с разными штрихкодами. Ровно те «осиротевшие
-- дубли», которые не удавалось поймать: журнал честно писал «снято»,
-- потому что площадка так и ответила.
--
-- Решение: помним всё, что попросили снять, и при каждом следующем обращении
-- добиваем эти места повторным запросом (операция идемпотентная). Запись
-- закрывается, только когда место действительно пропало с заявки.
CREATE TABLE IF NOT EXISTS ozon_cargo_removals (
    id BIGSERIAL PRIMARY KEY,
    supply_id BIGINT NOT NULL,
    cargo_id BIGINT NOT NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMP,
    attempts INT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ozon_cargo_removals_cargo_uniq
    ON ozon_cargo_removals (cargo_id);

CREATE INDEX IF NOT EXISTS ozon_cargo_removals_pending
    ON ozon_cargo_removals (supply_id)
    WHERE confirmed_at IS NULL;

COMMENT ON TABLE ozon_cargo_removals IS
    'Грузоместа, снятые с OZON. Площадка подтверждает снятие раньше, чем применяет его, поэтому недоснятые места добиваются повторно.';
