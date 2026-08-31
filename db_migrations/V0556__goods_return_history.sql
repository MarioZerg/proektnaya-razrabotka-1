-- ИСТОРИЯ ВОЗВРАТОВ ВЕЩИ.
--
-- ЗАЧЕМ. Кладовщик при разборе возврата должен видеть, сколько раз эту вещь уже
-- возвращали. Вещь, приехавшая обратно в третий раз, почти наверняка с изъяном:
-- её нужно осмотреть, а не класть на полку и отправлять следующему покупателю.
-- Сейчас такой информации нет вовсе — каждый возврат выглядит как первый.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, А НЕ СЧЁТЧИК В goods_warehouse.
-- Счётчик отвечает только на «сколько раз», а кладовщику нужно «когда, из какого
-- отправления, по какой причине и чем закончилось». Плюс счётчик легко
-- рассинхронить, а история пишется один раз и остаётся навсегда.
--
-- ПОЧЕМУ НЕ ГОДИТСЯ marketplace_returns. Там строка на КАЖДУЮ позицию возврата
-- маркетплейса, и несколько разных вещей одного отправления цепляются к одной
-- записи склада: у вещи GW-723265 так «насчиталось» 5 возвратов, хотя её саму
-- возвращали меньше. История же пишется по факту приёмки конкретной вещи.

CREATE TABLE IF NOT EXISTS goods_return_history (
    id SERIAL PRIMARY KEY,

    -- Вещь, которую вернули. Это ФИЗИЧЕСКАЯ вещь на складе: у неё один
    -- storage_barcode на всю жизнь, сколько бы раз она ни уезжала и ни вернулась.
    goods_warehouse_id INTEGER NOT NULL,

    -- Какой это по счёту возврат этой вещи: 1, 2, 3…
    return_number INTEGER NOT NULL,

    -- Кому вещь принадлежала в этот раз — заказ, по которому она уезжала
    -- покупателю. Именно он «вернулся», а не карточка-источник вещи.
    order_id INTEGER,
    order_number VARCHAR(100),
    posting_number VARCHAR(100),
    marketplace VARCHAR(20),

    -- Что сказал покупатель и что решили мы.
    return_reason TEXT,
    outcome VARCHAR(20),          -- stored / repack / utilized
    marketplace_return_id INTEGER,

    returned_at TIMESTAMP NOT NULL DEFAULT now(),
    received_by INTEGER,
    received_by_name VARCHAR(200),

    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grh_goods ON goods_return_history(goods_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_grh_returned_at ON goods_return_history(returned_at DESC);

-- Один и тот же возврат маркетплейса не должен записаться в историю дважды
-- (кладовщик мог отсканировать коробку повторно).
CREATE UNIQUE INDEX IF NOT EXISTS idx_grh_unique_mp_return
    ON goods_return_history(goods_warehouse_id, marketplace_return_id)
    WHERE marketplace_return_id IS NOT NULL;

-- ПОМЕТКА «ИСТОРИЯ ПОТЕРЯНА».
--
-- Вещь, заведённую на склад руками (пересорт, находка, перенос из старой
-- системы), система не видела в пути: сколько раз её возвращали до этого —
-- неизвестно. Показывать по ней «возвратов: 0» нечестно: это не «новая вещь»,
-- а «мы не знаем». Кладовщик должен понимать разницу и осмотреть такую вещь.
ALTER TABLE goods_warehouse
    ADD COLUMN IF NOT EXISTS history_lost BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN goods_warehouse.history_lost IS
    'Вещь добавлена вручную — прежняя история возвратов неизвестна';

-- Помечаем уже заведённые вручную вещи.
UPDATE goods_warehouse
   SET history_lost = TRUE
 WHERE COALESCE(receive_reason, '') IN ('admin', 'manual', 'import');
