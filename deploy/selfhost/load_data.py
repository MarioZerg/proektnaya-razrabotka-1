"""Загрузка выгрузки из export_via_mcp.mjs в базу на своём сервере.

    python load_data.py /opt/yarplan/dbexport

Порядок: пересоздать схему без ограничений (schema_pre.sql) → залить данные →
ключи, индексы, связи (schema_post.sql) → счётчики id не ниже максимального id.
Связи между таблицами включаются только после загрузки, поэтому порядок
таблиц не важен. Значения переносятся через json_populate_recordset: база
сама превращает текст выгрузки в свои типы — даты, суммы, массивы, jsonb.

Пароль базы берётся из DATABASE_URL (файл /opt/yarplan/.env), не печатается.
"""

import json
import os
import sys

import psycopg2

S = os.environ.get('MAIN_DB_SCHEMA', 't_p86119184_proektnaya_razrabotk')


def q(name):
    return '"' + name.replace('"', '""') + '"'


def run_file(cur, path):
    with open(path, encoding='utf-8') as f:
        cur.execute(f.read())


def main(root):
    meta = json.load(open(os.path.join(root, 'meta.json'), encoding='utf-8'))
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    conn.autocommit = False
    cur = conn.cursor()

    print('схема: пересоздаю таблицы без ограничений')
    cur.execute(f'DROP SCHEMA IF EXISTS {S} CASCADE')
    cur.execute(f'CREATE SCHEMA {S}')
    run_file(cur, os.path.join(root, 'schema_pre.sql'))
    conn.commit()

    cur.execute(
        "SELECT table_name, column_name, is_generated, is_identity, identity_generation "
        "FROM information_schema.columns WHERE table_schema = %s ORDER BY table_name, ordinal_position",
        (S,),
    )
    cols, always_identity = {}, set()
    for tbl, col, gen, ident, ident_gen in cur.fetchall():
        if gen == 'ALWAYS':
            continue  # вычисляемая колонка — база посчитает сама
        cols.setdefault(tbl, []).append(col)
        if ident == 'YES' and ident_gen == 'ALWAYS':
            always_identity.add(tbl)

    data_root = os.path.join(root, 'data')
    problems = []
    for tbl in sorted(os.listdir(data_root)):
        tdir = os.path.join(data_root, tbl)
        done = os.path.join(tdir, '_done.json')
        if not os.path.exists(done):
            problems.append(f'{tbl}: выгрузка не завершена')
            continue
        expected = json.load(open(done))['rows']
        collist = ', '.join(q(c) for c in cols[tbl])
        override = ' OVERRIDING SYSTEM VALUE' if tbl in always_identity else ''
        sql = (f'INSERT INTO {S}.{q(tbl)} ({collist}){override} '
               f'SELECT {collist} FROM json_populate_recordset(NULL::{S}.{q(tbl)}, %s::json)')
        loaded = 0
        for part in sorted(p for p in os.listdir(tdir) if p != '_done.json'):
            with open(os.path.join(tdir, part), encoding='utf-8') as f:
                cur.execute(sql, (f.read(),))
                loaded += cur.rowcount
        conn.commit()
        mark = '' if loaded == expected else f'  ≠ выгружено {expected}'
        print(f'{tbl}: {loaded}{mark}')
        if loaded != expected:
            problems.append(f'{tbl}: загружено {loaded}, в выгрузке {expected}')

    print('ключи, индексы, связи')
    for stmt in open(os.path.join(root, 'schema_post.sql'), encoding='utf-8').read().splitlines():
        if not stmt.strip():
            continue
        try:
            cur.execute(stmt)
            conn.commit()
        except psycopg2.Error as e:
            conn.rollback()
            problems.append(f'{stmt[:120]}… → {str(e).strip().splitlines()[0]}')

    # Счётчик id не может отставать от данных, иначе новая запись упрётся в старую.
    cur.execute(
        "SELECT s.relname, t.relname, a.attname FROM pg_depend d "
        "JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S' "
        "JOIN pg_class t ON t.oid = d.refobjid "
        "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid "
        "JOIN pg_namespace n ON n.oid = s.relnamespace "
        "WHERE n.nspname = %s AND d.deptype IN ('a', 'i')",
        (S,),
    )
    for seq, tbl, col in cur.fetchall():
        cur.execute(
            f"SELECT setval('{S}.{q(seq)}', GREATEST((SELECT last_value FROM {S}.{q(seq)}), "
            f"COALESCE((SELECT max({q(col)}) FROM {S}.{q(tbl)}), 1)))"
        )
    conn.commit()

    skipped = [t for t in meta.get('skipped', []) if t in cols]
    print(f'\nПропущены (переносятся вручную или не нужны): {", ".join(skipped)}')
    if problems:
        print('\nПРОБЛЕМЫ:\n' + '\n'.join(problems))
    else:
        print('\nВсё загружено без расхождений.')


if __name__ == '__main__':
    main(sys.argv[1])
