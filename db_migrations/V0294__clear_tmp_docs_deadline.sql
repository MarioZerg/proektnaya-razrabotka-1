-- Снимаем проверочный срок: сотрудник действующий, документы с него
-- собираются вручную, счётчик к нему не относится.
UPDATE users
SET docs_deadline = NULL,
    docs_blocked = false,
    docs_submitted_at = NULL,
    docs_rejected_reason = NULL,
    docs_rejected_at = NULL
WHERE id = 7;
