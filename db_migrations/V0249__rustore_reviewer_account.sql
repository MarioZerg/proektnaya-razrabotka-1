-- Учётная запись для проверяющего RuStore.
-- Роль «packer» — самая безопасная: видно работу системы, но нет доступа
-- к финансам, зарплатам и настройкам. Аккаунт можно отключить после модерации:
-- UPDATE users SET is_active = false WHERE login = 'rustore';
INSERT INTO t_p86119184_proektnaya_razrabotk.users
  (login, password_hash, password_salt, full_name, role, is_active, salary, privacy_accepted_at)
VALUES
  ('rustore',
   'de610aacb7a82460f216815d33c929f7dfd7392e770b0f52632a052715dbf038',
   '248efe8f3d392da537de5d2754d345dd',
   'Проверка RuStore',
   'packer',
   true,
   0,
   now())
ON CONFLICT DO NOTHING;
