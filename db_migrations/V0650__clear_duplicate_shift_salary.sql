-- Снимаем задвоенные оклады за смену (неоплаченные).
--
-- ПРИЧИНА. Оклад кладовщика пишется типом 'storekeeper_shift', старшего
-- кладовщика — 'senior_storekeeper_shift'. Проверка «уже начислен ли оклад»
-- смотрела только на СВОЙ тип, поэтому старший кладовщик получал оклад
-- дважды за одну смену: при сборке поставки одним типом и при закрытии
-- смены другим. 2400 рублей вместо 1200 в одной и той же смене (sesion id
-- у обеих записей совпадает).
--
-- Что делаем: у второй записи за день ставим сумму 0 и поясняем причину в
-- описании. Саму строку сохраняем — она нужна для истории и для сверки,
-- почему сумма изменилась.
--
-- Трогаем ТОЛЬКО невыплаченные начисления: выплаченные периоды не
-- переписываем, по ним нужно отдельное решение руководителя.
UPDATE salary_accruals a
SET amount = 0,
    description = description || ' [снят дубль: оклад за эту смену уже начислен]'
WHERE a.paid_at IS NULL
  AND a.type IN ('storekeeper_shift', 'senior_storekeeper_shift')
  AND a.amount > 0
  AND EXISTS (
      SELECT 1 FROM salary_accruals b
      WHERE b.user_id = a.user_id
        AND b.accrued_for = a.accrued_for
        AND b.type IN ('storekeeper_shift', 'senior_storekeeper_shift')
        AND b.amount > 0
        AND b.id < a.id
  );
