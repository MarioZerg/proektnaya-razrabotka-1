# Авторизация через MAX + множественные роли — техническая карта проекта

Статус: часть функциональности реализована и задеплоена, часть — в процессе.
Документ описывает что уже сделано (с точными путями к файлам) и что осталось,
чтобы можно было дополнить логику новыми пунктами.

---

## 1. Идея целиком

1. Пользователь на сайте жмёт **«Войти через MAX»** — открывается бот в мессенджере MAX.
2. В боте пользователь жмёт кнопку **«Поделиться номером»**.
3. Бот ищет номер телефона в базе:
   - если сотрудник уже существует — привязывает его MAX-аккаунт (`max_user_id`) и присылает код;
   - если номера нет — создаёт нового пользователя без роли и тоже присылает код.
4. Пользователь вводит код на сайте.
5. Дальше ветвление:
   - **ролей нет вообще** → экран выбора желаемой должности → должность уходит на утверждение админом → экран ожидания;
   - **есть роли, но ни одна не утверждена** → экран ожидания;
   - **утверждена ровно одна роль** → сразу вход в неё;
   - **утверждено несколько ролей** → экран выбора, в какой роли работать сейчас.
6. После входа в сайдбаре есть переключатель должностей (если их несколько утверждённых) —
   позволяет переключаться без повторного входа через MAX.
7. Администратор в карточке сотрудника видит все его должности, может утверждать/добавлять/убирать.

---

## 2. База данных

Миграции: `db_migrations/V0089__add_max_messenger_auth_support.sql`,
`V0092__max_only_auth_multi_role_support.sql` (плюс более ранняя, неотслеженная
миграцией часть — таблица `user_roles` и поля `registered_via_max`,
`max_pending_token` в `users`, они уже были в БД до текущей сессии).

### Таблица `users` (ключевые поля, помимо существовавших)
- `max_user_id VARCHAR(50)` — ID пользователя в MAX, уникален (`idx_users_max_user_id_unique`)
- `phone VARCHAR(30)` — номер телефона, уникален (`idx_users_phone_unique`)
- `registered_via_max BOOLEAN` — true, если человек сам зарегистрировался через бота
- `role` — оставлено для обратной совместимости (роль по умолчанию/последняя активная),
  реальный источник правды — таблица `user_roles`

### Таблица `user_roles` (уже существовала, доработана уникальным индексом)
```sql
id, user_id → users(id), role VARCHAR(30), is_approved BOOLEAN, created_at
UNIQUE (user_id, role) — idx_user_roles_user_role_unique
```
У существующих сотрудников (созданных вручную до этой фичи) уже проставлена
одна запись с `is_approved = true` — миграция назад не требовалась, это было
сделано раньре в текущей сессии работы.

### Таблица `max_auth_sessions` (новая, для кода входа)
```sql
id, max_user_id, code VARCHAR(10), phone, full_name,
created_at, expires_at, used BOOLEAN
```
Код живёт 5 минут (`CODE_TTL_MINUTES` в backend), одноразовый (`used`).

### Таблица `max_login_codes` (старая, от первой версии интеграции по логину — уже не используется в новом флоу, но не удалена)

---

## 3. Backend

### `backend/max_bot/index.py` — приём webhook от MAX
URL: см. `func2url.json` → `max_bot`.
Обрабатывает:
- `update_type = 'bot_started'` — шлёт приветствие с кнопкой `request_contact`
  («Поделиться номером и войти»).
- `update_type = 'message_created'` — достаёт номер телефона из вложения-контакта
  (или из текста как fallback), нормализует к `+7XXXXXXXXXX`
  (`normalize_phone`), ищет пользователя по `max_user_id` → по `phone`,
  если не находит — создаёт нового (`registered_via_max=true`, без роли),
  создаёт запись в `max_auth_sessions` со случайным 6-значным кодом,
  отправляет код сообщением.
- `action = 'register_webhook'` — служебное действие (уже вызвано один раз),
  регистрирует URL этой функции как webhook в MAX Bot API
  (`POST /subscriptions`, update_types: `bot_started`, `message_created`).

Особенность: сайт `platform-api2.max.ru` использует сертификат российского
УЦ (Минцифры), которого нет в стандартном `certifi` bundle — сертификат
встроен в код константой `RUSSIAN_TRUSTED_CA` и подмешивается к `certifi`
через временный файл (см. `_get_ca_bundle()`). Тот же приём продублирован
в `backend/auth/index.py`, хотя там он сейчас не используется (auth больше
не делает исходящих HTTP-запросов) — можно почистить при следующей правке.

Токен бота передаётся в заголовке `Authorization`, не в query-параметре —
чтобы не светился в логах/URL.

### `backend/auth/index.py` — вся логика входа
Actions:
- `bot_info` → `{ botUrl }`, ссылка на бота (`https://max.ru/{MAX_BOT_USERNAME}`)
- `max_verify_code { code }` → ищет сессию в `max_auth_sessions`, помечает
  использованной, возвращает `{ id, name, phone, roles: [{role, isApproved}] }`
- `select_role { userId, role }` → создаёт запись в `user_roles` с
  `is_approved=false` (только если у пользователя ещё нет ни одной роли)
- `enter_role { userId, role }` → проверяет `is_active` и `is_approved`,
  возвращает полные данные сессии `{ id, name, role, workshopId, workshopName, shiftNumber }`
- `test_accounts` → для демо-входа (кнопки на странице логина), без проверки кода

### `backend/users/index.py` — управление сотрудниками и их ролями
GET теперь возвращает у каждого сотрудника доп. поля: `maxUserId`, `phone`,
`registeredViaMax`, `roles: [{role, isApproved}]`.

Новые actions:
- `add_role { id, role, approved? }` — добавить/обновить роль (upsert по `(user_id, role)`)
- `approve_role { id, role }` — утвердить существующую роль
- `remove_role { id, role }` — убрать роль

При `action='create'` (админ создаёт сотрудника вручную) автоматически
создаётся запись в `user_roles` с `is_approved=true` для указанной роли.

---

## 4. Frontend

### `src/context/AuthContext.tsx`
`User` дополнен полем `availableRoles: Role[]` — утверждённые должности
пользователя, для переключателя. Добавлен метод `switchRole(role)` —
меняет активную `role` в контексте и localStorage без повторного похода
на backend (просто переключение внутри уже полученных прав).

### `src/lib/authApi.ts`
Новые функции: `fetchMaxBotUrl`, `verifyMaxCode`, `selectDesiredRole`, `enterRole`.
Старые `sendMaxLoginCode`/`verifyMaxLoginCode` (по логину) удалены вместе со
старым флоу.

### `src/lib/usersApi.ts`
`Employee` дополнен `phone`, `registeredViaMax`, `roles: UserRoleEntry[]`.
Новые функции: `addEmployeeRole`, `approveEmployeeRole`, `removeEmployeeRole`.

### `src/pages/Index.tsx` — страница входа, полностью переписана
Шаги (`Step`): `start → code → pickDesiredRole | pendingApproval | pickActiveRole`.
- `start` — кнопка «Войти через MAX» (открывает `botUrl` в новой вкладке) + демо-вход
- `code` — ввод 6-значного кода
- `pickDesiredRole` — для новых пользователей без единой роли
- `pendingApproval` — ожидание решения администратора
- `pickActiveRole` — выбор роли, если утверждено несколько

Логин/пароль с этой страницы убран полностью.

### `src/components/auth/RoleSelectScreen.tsx` (новый)
Переиспользуемая сетка кнопок-должностей с иконками — используется и для
выбора желаемой роли, и для выбора активной роли при входе.

### `src/components/auth/PendingApprovalScreen.tsx` (новый)
Экран «Ждём подтверждения администратора» с кнопкой «Выйти».

### `src/components/crm/CrmLayout.tsx`
Добавлен переключатель должностей в футере сайдбара (иконка `Repeat`,
рядом с уже существующим демо-переключателем аккаунтов) — виден только
если `availableRoles.length > 1`. Вызывает `switchRole` + переход на `/crm`.

### `src/components/crm/users/EmployeeCardDialog.tsx`
Добавлен блок «Должности»: список ролей сотрудника с бейджами
«Утверждена» / «Ждёт утверждения», кнопки «Утвердить» и убрать (крестик),
выпадающий список «Добавить должность...» с ролями, которых у сотрудника
ещё нет. Поле MAX ID подписано пояснением, что оно заполняется автоматически
через бота (осталась возможность поправить вручную).

### `src/pages/settings/UsersSettings.tsx`
Добавлены обработчики `handleApproveRole/handleAddRole/handleRemoveRole`,
после каждого действия — перезагрузка списка сотрудников и обновление
открытой карточки.

---

## 5. Что ЕЩЁ НЕ сделано (осталось на следующий заход)

1. **Ограничение доступа для неутверждённых пользователей.**
   Сейчас `src/pages/Crm.tsx` показывает урезанный дашборд только по признаку
   `role !== 'admin'`. Нужно добавить отдельную проверку: если у пользователя
   вообще нет ни одной утверждённой роли (`availableRoles.length === 0`),
   доступны только дашборд/страница ожидания — остальные разделы CRM должны
   быть недоступны (сейчас маршруты в `src/App.tsx` не защищены вообще, см.
   `<Route path="/crm/..." element={...} />` без обёртки). Нужен компонент
   вроде `ProtectedRoute`/проверка в `CrmLayout`, который редиректит на
   заглушку, если `user.availableRoles.length === 0`.

2. **Очистка старого кода логина по паролю.**
   В БД остались поля `password_hash`, `password_salt`, `login` как
   `NOT NULL` (снять `NOT NULL` через ALTER не удалось — заблокировано
   инструментом миграций как потенциально опасная операция). Сейчас при
   регистрации через MAX (`backend/max_bot/index.py`) генерируется
   случайный логин и фиктивный хеш пароля, чтобы вставка в `users` прошла.
   Это рабочий, но не самый чистый костыль — можно оставить как есть.

3. **`backend/auth/index.py`** всё ещё содержит неиспользуемую константу
   `RUSSIAN_TRUSTED_CA` и импорт `certifi`/`requests` в `requirements.txt` —
   можно убрать, поскольку исходящих HTTP-запросов в auth больше нет
   (переехали в `max_bot`). Не критично, но для чистоты стоит проверить
   `backend/auth/requirements.txt`.

4. **Таблица `max_login_codes`** (старая, от первой версии по логину) не
   используется новым флоу — можно оставить как историческую или удалить
   отдельной миграцией, если она мешает.

5. **Тесты **backend/max_bot/tests.json** покрывают только базовые кейсы**
   (OPTIONS, неизвестный update_type, GET не разрешён, register_webhook без
   url). Полноценный сценарий bot_started/message_created не протестирован
   автотестами (требует реальных данных от MAX, тестировался вручную curl-ом
   частично).

6. Визуальная проверка нового флоу входа (`Index.tsx`) через скриншот ещё
   не делалась в этой сессии — сделана только для базовой структуры
   страницы до переписывания.

---

## 6. Список изменённых/новых файлов за сессию

**Backend:**
- `backend/max_bot/index.py`, `requirements.txt`, `tests.json` (новые)
- `backend/auth/index.py`, `tests.json` — переписаны
- `backend/users/index.py`, `tests.json` — дополнены

**DB:**
- `db_migrations/V0089__add_max_messenger_auth_support.sql`
- `db_migrations/V0092__max_only_auth_multi_role_support.sql`

**Frontend:**
- `src/context/AuthContext.tsx` — дополнен
- `src/lib/authApi.ts` — переписан
- `src/lib/usersApi.ts` — дополнен
- `src/pages/Index.tsx` — переписан полностью
- `src/components/auth/RoleSelectScreen.tsx` (новый)
- `src/components/auth/PendingApprovalScreen.tsx` (новый)
- `src/components/crm/CrmLayout.tsx` — переключатель ролей
- `src/components/crm/users/EmployeeCardDialog.tsx` — блок должностей
- `src/pages/settings/UsersSettings.tsx` — обработчики ролей

**Секреты:**
- `MAX_BOT_TOKEN` — токен бота (уже задан)
- `MAX_BOT_USERNAME` — юзернейм бота для ссылки (уже задан)
