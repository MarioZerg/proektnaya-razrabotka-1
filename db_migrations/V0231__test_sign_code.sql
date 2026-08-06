-- ТЕСТ подписания договора: кладём проверочный код напрямую, чтобы не слать
-- реальное сообщение живому пользователю в MAX. Код одноразовый, живёт 15 минут.
INSERT INTO contract_sign_codes (contract_id, user_id, code, expires_at)
SELECT c.id, c.user_id, '424242', now() + INTERVAL '15 minutes'
FROM contracts c WHERE c.title = 'Тестовый договор для проверки подписи';