-- Кто и в какой смене израсходовал материал.
--
-- Гость приходит работать в чужой цех или смену и режет тамошний материал. Раньше в
-- расходе оставался только рулон, и было не понять, чья смена реально сделала работу:
-- по рулону выходило, что заказ выполнила смена-владелец материала.
--
-- Пишем смену и цех ИСПОЛНИТЕЛЯ (той смены, в которой человек фактически работал),
-- а также отметку, что материал принадлежал другой смене. По этим данным видно,
-- что вещь сделана за другую смену, и расход не приписывается чужим людям.
ALTER TABLE t_p86119184_proektnaya_razrabotk.order_material_usage
    ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
    ADD COLUMN IF NOT EXISTS actor_workshop_id INTEGER,
    ADD COLUMN IF NOT EXISTS actor_shift_number INTEGER,
    ADD COLUMN IF NOT EXISTS is_foreign_shift BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.order_material_usage.actor_shift_number IS
    'Смена, в которой сотрудник фактически работал (у гостя — смена цеха присутствия)';
COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.order_material_usage.is_foreign_shift IS
    'Материал принадлежал другой смене — работа выполнена за чужую смену';
