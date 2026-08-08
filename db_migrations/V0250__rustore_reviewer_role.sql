-- Роль для учётки проверяющего RuStore.
-- Без записи в user_roles вход проходит, но система показывает пустой экран —
-- модератор счёл бы приложение неработающим и отклонил публикацию.
INSERT INTO t_p86119184_proektnaya_razrabotk.user_roles (user_id, role, is_approved)
SELECT id, 'packer', true
FROM t_p86119184_proektnaya_razrabotk.users
WHERE login = 'rustore'
ON CONFLICT DO NOTHING;
