-- Откат проверочных действий по механизму «брак не найден».
-- DF-000042 и DF-000044 помечались пропавшими при проверке — возвращаем их
-- в очередь приёмки, чтобы кладовщик принял куски штатно.
UPDATE material_defects
SET missing_at = NULL, missing_by = NULL, missing_by_name = NULL,
    resolution = NULL, resolved_at = NULL, resolved_by = NULL,
    resolved_by_name = NULL, resolution_comment = NULL
WHERE barcode IN ('DF-000042', 'DF-000044');

-- Тестовое удержание обнуляем: сотрудница ничего не должна.
UPDATE salary_accruals
SET amount = 0,
    description = 'Аннулировано: проверка механизма пропавшего брака'
WHERE description LIKE 'Пропал брак DF-000042%';

-- Тестовые уведомления на панели админа убираем с глаз.
UPDATE admin_notifications
SET hidden_at = now()
WHERE kind = 'defect_missing' AND message LIKE '%DF-00004%';