-- Уведомления о недостаче сверх нормы вели на несуществующий адрес
-- /crm/warehouse/rolls — кнопка «Открыть» показывала страницу 404.
-- Правильная страница — «Анализ недостач», где админ решает судьбу рулона.
UPDATE admin_notifications
SET link = '/crm/analytics/roll-shortage'
WHERE link LIKE '/crm/warehouse/rolls%';