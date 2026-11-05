"""Перенос файлов с cdn.poehali.dev на свой сервер.

    python migrate_files.py [файл_со_ссылками ...]

Ищет ссылки https://cdn.poehali.dev/projects/<проект>/<вид>/<путь> во всех
текстовых колонках базы (и в переданных файлах — например, список картинок
из кода сайта), скачивает каждую и кладёт:
  /bucket/<ключ>  →  /opt/yarplan/files/files/<ключ>   (загруженное функциями)
  /files/<имя>    →  /opt/yarplan/files/static/<имя>   (картинки инструкций)
Уже скачанное пропускает — можно запускать сколько угодно раз, например
повторно в ночь переезда, чтобы забрать новые файлы.
"""

import os
import re
import sys
import urllib.request
from urllib.parse import unquote

import psycopg2

S = os.environ.get('MAIN_DB_SCHEMA', 't_p86119184_proektnaya_razrabotk')
ROOT = '/opt/yarplan/files'
URL_RE = re.compile(r'https://cdn\.poehali\.dev/projects/[^/\s"\'<>]+/(bucket|files)/[^\s"\'<>\\)]+')


def collect_from_db():
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    cur.execute(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = %s "
        "AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')",
        (S,),
    )
    urls = set()
    for tbl, col in cur.fetchall():
        cur.execute(
            f'SELECT "{col}"::text FROM {S}."{tbl}" WHERE "{col}"::text LIKE %s',
            ('%cdn.poehali.dev%',),
        )
        for (value,) in cur.fetchall():
            urls.update(m.group(0) for m in URL_RE.finditer(value or ''))
    conn.close()
    return urls


def target(url):
    m = re.match(r'https://cdn\.poehali\.dev/projects/[^/]+/(bucket|files)/(.+)$', url)
    kind, rest = m.group(1), unquote(m.group(2).split('?')[0])
    if '..' in rest.split('/'):
        return None
    return os.path.join(ROOT, 'files' if kind == 'bucket' else 'static', *rest.split('/'))


def main(extra_files):
    urls = collect_from_db()
    for path in extra_files:
        urls.update(m.group(0) for m in URL_RE.finditer(open(path, encoding='utf-8').read()))
    print(f'ссылок найдено: {len(urls)}')
    done = skipped = 0
    failed = []
    for url in sorted(urls):
        dest = target(url)
        if not dest:
            failed.append(f'{url}: подозрительный путь')
            continue
        if os.path.exists(dest):
            skipped += 1
            continue
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'yarplan-migration'})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                ctype = r.headers.get('Content-Type')
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest + '.tmp', 'wb') as f:
                f.write(data)
            os.replace(dest + '.tmp', dest)
            if ctype:
                with open(dest + '.ctype', 'w') as f:
                    f.write(ctype)
            done += 1
        except Exception as e:  # noqa: BLE001 — отчёт по каждому файлу, а не падение на первом
            failed.append(f'{url}: {e}')
    print(f'скачано: {done}, уже было: {skipped}, ошибок: {len(failed)}')
    for line in failed:
        print('  ' + line)


if __name__ == '__main__':
    main(sys.argv[1:])
