"""Ссылки на файлы в базе: cdn.poehali.dev/projects/... → <api-host>/projects/...

    python rewrite_db_urls.py api.yarplan.ru

Запускать после загрузки данных (и после ручных таблиц). Повторный запуск
ничего не портит: переписывает только то, что ещё ведёт на poehali.
Журнал ошибок (app_errors) не трогает — это история.
"""

import os
import sys

import psycopg2

S = os.environ.get('MAIN_DB_SCHEMA', 't_p86119184_proektnaya_razrabotk')
OLD = 'https://cdn.poehali.dev/projects/'
SKIP_TABLES = {'app_errors', 'audit_log'}


def main(host):
    new = f'https://{host}/projects/'
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    cur.execute(
        "SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns "
        "WHERE table_schema = %s AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')",
        (S,),
    )
    total = 0
    for tbl, col, dtype, udt in cur.fetchall():
        if tbl in SKIP_TABLES:
            continue
        cast = {'jsonb': 'jsonb', 'json': 'json', 'ARRAY': f'{udt.lstrip("_")}[]'}.get(dtype)
        expr = f'replace("{col}"::text, %s, %s)' + (f'::{cast}' if cast else '')
        cur.execute(
            f'UPDATE {S}."{tbl}" SET "{col}" = {expr} WHERE "{col}"::text LIKE %s',
            (OLD, new, f'%{OLD}%'),
        )
        if cur.rowcount:
            print(f'{tbl}.{col}: {cur.rowcount}')
            total += cur.rowcount
    conn.commit()
    print(f'переписано строк: {total}')


if __name__ == '__main__':
    main(sys.argv[1])
