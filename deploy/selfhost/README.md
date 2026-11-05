# Свой сервер вместо poehali.dev

Сервер: `95.163.231.253` (reg.ru, Ubuntu 24.04), вход по ключу `~/.ssh/yarplan_server`,
короткое имя в `~/.ssh/config` — `yarplan`. Вход по паролю выключен.

| Что | Где |
|---|---|
| Сайт | `https://megatulle.ru` → `/opt/yarplan/site` |
| Функции | `https://api.megatulle.ru/<id>` — тот же id, что был на functions.poehali.dev |
| Файлы | `https://api.megatulle.ru/projects/<…>/bucket/<ключ>` → `/opt/yarplan/files` |
| База | PostgreSQL 16, только изнутри сервера, схема `t_p86119184_proektnaya_razrabotk` |
| Секреты | `/opt/yarplan/.env` (root:yarplan 640) — в git не попадают |
| Расписание | `/etc/cron.d/yarplan` (до переезда лежит выключенным в `deploy/yarplan.cron`) |
| Копии | каждую ночь в 03:40 → `/var/backups/yarplan`, 14 дней |
| Журналы | функции — `journalctl -u 'yarplan-fn@*'`, расписание — `/var/log/yarplan-jobs.log` |

## Файлы в этой папке

- `runner.py` — запускает функцию poehali (`handler(event, context)`) без переделки кода.
- `yarplan-fn@.service` — каждая функция отдельной службой: `systemctl restart yarplan-fn@orders`.
- `nginx-api.conf`, `nginx-site.conf`, `gen_nginx.py` — адреса функций, файлов и сайта.
- `files_server.py` — хранилище вместо bucket.poehali.dev (put/get файлов для функций).
- `build_release.sh <ref> [домен]` — собирает сайт и функции из версии кода, меняет
  адреса poehali на свои **только в копии для сборки** и выкладывает на сервер.
- `export_via_mcp.mjs <папка> schema|data|all` — выгрузка базы poehali через MCP (только чтение).
- `load_data.py <папка>` — загрузка выгрузки в базу сервера.
- `rewrite_db_urls.py <api-хост>` — ссылки на файлы в базе: cdn.poehali.dev → свой адрес.
- `migrate_files.py` — скачивает с cdn.poehali.dev все файлы, на которые есть ссылки.
- `run_job.sh`, `yarplan.cron` — фоновые задания вместо cron.мегатюль.рф.
- `backup.sh`, `logrotate-yarplan` — копии и чистка журналов.

## Ночь переезда — по порядку

Заранее (днём): предупредить сотрудников, скачать с poehali 4 таблицы с личными
данными, которые MCP не отдаёт: `users`, `personal_data`, `suppliers`, `salary_payouts`.

1. **Заморозка poehali.** Сотрудники не работают. В cron.мегатюль.рф выключить 13
   заданий этой системы — с этой минуты новые данные на poehali не появляются.
2. **Код.** Скачать архив кода с poehali, сравнить с прошлой выгрузкой, собрать:
   `build_release.sh <ветка> megatulle.ru`.
3. **База.** `node export_via_mcp.mjs <папка> all` (~3 мин) → на сервер →
   `load_data.py` (~15 с) → загрузить 4 ручные таблицы → `rewrite_db_urls.py api.megatulle.ru`.
   Сверить: связи (schema_post) после ручных таблиц применяются без ошибок.
4. **Файлы.** `migrate_files.py` — докачает новые с прошлого раза.
5. **Секреты.** Вписать в `/opt/yarplan/.env` ключи MAX, Газельки, Диадока;
   `CRON_SECRET` — свой; `systemctl restart 'yarplan-fn@*'`.
6. **Проверка.** Вход, заказы, склад, поставки, печать документов, фото.
7. **Включение.** `cp deploy/yarplan.cron /etc/cron.d/yarplan`. Сотрудникам — новый адрес.
8. **Внешние связи.** Вебхук бота MAX → новый адрес (`max_bot`, action `register_webhook`);
   Авито переподписывается сам при первой синхронизации чатов кандидатов (адрес в
   `users/candidate_chats.py` заменяется при сборке); проверить, не обращается ли сайт
   мегатюль.рф к `functions.poehali.dev/dbc4d229…` (site_orders) — если да, сменить адрес там; MCP в `.mcp.json` →
   `https://api.megatulle.ru/<id mcp_project>`; киоск ТВ (`kiosk.ini`) → `megatulle.ru/lider`;
   Яндекс.Метрика — добавить домен; yarplan.ru → перенаправление на megatulle.ru.

Откат: пока poehali не удалён, достаточно вернуть сотрудникам старый адрес и
включить задания в cron.мегатюль.рф обратно (данные, внесённые на новом сервере,
придётся перенести вручную — поэтому решение «остаёмся» принимается сразу, в ту же ночь).
