-- ТЕСТ мобильных карточек зарплаты: временное начисление упаковщице, чтобы проверить
-- вёрстку списка «Моя зарплата» на телефоне. Будет удалено после проверки.
INSERT INTO salary_accruals (user_id, type, amount, order_id, description)
SELECT 7, 'packer_repack', 20, o.id, 'Перепаковка возврата GW-UI001 (новый пакет)'
FROM orders o WHERE o.order_number = 'UI-TEST-01'
ON CONFLICT (order_id, type) WHERE order_id IS NOT NULL DO NOTHING;