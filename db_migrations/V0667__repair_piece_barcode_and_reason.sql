-- НОМЕР СТИКЕРА И ПРИЧИНА ПЕРЕШИВА У КУСКА ТКАНИ.
--
-- Упаковщица отправляла вещь в перешив молча: кусок появлялся в цехе как
-- «Вуаль 300x255», и закройщица не знала ни что с ним не так, ни где он
-- физически лежит. Приходилось разворачивать каждый отрез и искать брак
-- глазами — а брак может быть в углу, который как раз уйдёт в обрезки.
--
-- Теперь у куска есть СВОЙ номер (RS-XXXXXX), напечатанный на наклейке,
-- и причина перешива. Закройщица видит номер и причину в карточке заказа
-- и берёт со стеллажа нужный отрез сразу, зная, какой участок вырезать.

CREATE SEQUENCE IF NOT EXISTS repair_piece_barcode_seq START 1;

ALTER TABLE repair_fabric_pieces
    ADD COLUMN IF NOT EXISTS barcode VARCHAR(20),
    ADD COLUMN IF NOT EXISTS reason_code VARCHAR(40),
    ADD COLUMN IF NOT EXISTS reason_label VARCHAR(200);

-- Куски, заведённые до этой правки, тоже должны получить номер: иначе в
-- карточке заказа у старых отрезов будет прочерк, и закройщица не поймёт,
-- сломалось что-то или так и задумано.
UPDATE repair_fabric_pieces
SET barcode = 'RS-' || lpad(nextval('repair_piece_barcode_seq')::text, 6, '0')
WHERE barcode IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS repair_fabric_pieces_barcode_key
    ON repair_fabric_pieces (barcode);
