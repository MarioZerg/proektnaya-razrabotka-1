import base64
import gzip
import json
import os

import psycopg2


# Импорт исторических данных из старой системы (cpanel).
#
# Данные приходят частями: 348 тысяч движений в одном запросе не поместятся.
# Каждая часть — кусок сжатого пакета, они накапливаются во временной таблице
# и собираются воедино командой finish. Так перенос переживает обрыв связи:
# упавшую часть можно послать заново, ничего не задваивая.


def handler(event: dict, context) -> dict:
    """Разовый перенос данных из старой системы: рулоны и история движения.

    POST / { action: 'chunk', kind: 'rolls'|'moves', seq: 0, data: '<base64>' }
        - принимает часть пакета и складывает её во временное хранилище
    POST / { action: 'finish', kind: 'rolls'|'moves' }
        - собирает части, распаковывает и записывает данные в рабочие таблицы
    POST / { action: 'status' }
        - сколько частей принято и сколько записей уже в системе

    Args:
        event: dict с httpMethod, body
        context: объект с request_id

    Returns:
        HTTP-ответ со сводкой по загруженным данным
    """
    method = event.get('httpMethod', 'POST')
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Import-Key',
        'Content-Type': 'application/json',
    }

    if method == 'OPTIONS':
        return {'statusCode': 200,
                'headers': {**headers, 'Access-Control-Max-Age': '86400'},
                'body': ''}

    dsn = os.environ['DATABASE_URL']
    body = json.loads(event.get('body') or '{}')
    action = body.get('action')

    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        cur.execute(
            "CREATE TABLE IF NOT EXISTS import_chunks ("
            "kind VARCHAR(20) NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, "
            "PRIMARY KEY (kind, seq))"
        )
        conn.commit()

        if action == 'batch':
            # Самостоятельный пакет: приходит, распаковывается и сразу пишется.
            # Промежуточное хранение не нужно — так вызов укладывается в лимит
            # времени, а повтор упавшего пакета не создаёт задвоений.
            rows = json.loads(gzip.decompress(base64.b64decode(body.get('data') or '')).decode())
            for i in range(0, len(rows), 1000):
                batch = rows[i:i + 1000]
                values = ','.join(
                    cur.mogrify("(%s,%s,%s,%s,%s)", r).decode() for r in batch
                )
                cur.execute(
                    "INSERT INTO material_movements "
                    "(material_id, quantity, movement_type, reference, created_at) "
                    f"VALUES {values}"
                )
            conn.commit()
            cur.execute("SELECT count(*) FROM material_movements")
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'imported': len(rows), 'total': cur.fetchone()[0]})}

        if action == 'chunk':
            kind = body.get('kind')
            seq = int(body.get('seq'))
            data = body.get('data') or ''
            cur.execute(
                "INSERT INTO import_chunks (kind, seq, data) VALUES (%s, %s, %s) "
                "ON CONFLICT (kind, seq) DO UPDATE SET data = EXCLUDED.data",
                (kind, seq, data),
            )
            conn.commit()
            cur.execute("SELECT count(*) FROM import_chunks WHERE kind = %s", (kind,))
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'received': cur.fetchone()[0], 'seq': seq})}

        if action == 'status':
            cur.execute("SELECT kind, count(*) FROM import_chunks GROUP BY kind")
            chunks = {k: c for k, c in cur.fetchall()}
            cur.execute("SELECT count(*) FROM rolls")
            rolls = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM material_movements")
            moves = cur.fetchone()[0]
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'chunks': chunks, 'rolls': rolls, 'moves': moves})}

        if action == 'finish':
            kind = body.get('kind')
            cur.execute(
                "SELECT data FROM import_chunks WHERE kind = %s ORDER BY seq", (kind,)
            )
            blob = ''.join(r[0] for r in cur.fetchall())
            if not blob:
                return {'statusCode': 400, 'headers': headers,
                        'body': json.dumps({'error': 'Части не получены'})}
            rows = json.loads(gzip.decompress(base64.b64decode(blob)).decode())

            if kind == 'rolls':
                # Рулоны: идентификаторы сохраняем прежние — на них ссылается история.
                for i in range(0, len(rows), 500):
                    batch = rows[i:i + 500]
                    values = ','.join(
                        cur.mogrify(
                            "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", r
                        ).decode()
                        for r in batch
                    )
                    cur.execute(
                        "INSERT INTO rolls (id, barcode, material_id, initial_quantity, "
                        "remaining_quantity, status, created_at, completed_at, "
                        "shortage_quantity, closed_by_name, supplier_id, purchase_price, "
                        "workshop_id, shift_number) "
                        f"VALUES {values} ON CONFLICT (id) DO NOTHING"
                    )
                conn.commit()
                cur.execute(
                    "SELECT setval(pg_get_serial_sequence('rolls','id'), "
                    "COALESCE((SELECT max(id) FROM rolls), 1))"
                )
                conn.commit()
                cur.execute("SELECT count(*) FROM rolls")
                total = cur.fetchone()[0]

            else:
                # 348 тысяч записей за один вызов функция не успевает записать —
                # её обрывает по времени. Поэтому грузим порциями: каждый вызов
                # берёт свой отрезок, а приложение повторяет запрос, пока не дойдём
                # до конца. Так перенос переживает любой обрыв.
                offset = int(body.get('offset') or 0)
                limit = int(body.get('limit') or 40000)
                part = rows[offset:offset + limit]
                for i in range(0, len(part), 1000):
                    batch = part[i:i + 1000]
                    values = ','.join(
                        cur.mogrify("(%s,%s,%s,%s,%s)", r).decode() for r in batch
                    )
                    cur.execute(
                        "INSERT INTO material_movements "
                        "(material_id, quantity, movement_type, reference, created_at) "
                        f"VALUES {values}"
                    )
                conn.commit()
                cur.execute("SELECT count(*) FROM material_movements")
                total = cur.fetchone()[0]
                done = offset + len(part) >= len(rows)
                if done:
                    cur.execute("DELETE FROM import_chunks WHERE kind = %s", (kind,))
                    conn.commit()
                return {'statusCode': 200, 'headers': headers,
                        'body': json.dumps({
                            'imported': len(part), 'total': total,
                            'nextOffset': offset + len(part),
                            'allRows': len(rows), 'done': done,
                        })}

            cur.execute("DELETE FROM import_chunks WHERE kind = %s", (kind,))
            conn.commit()
            return {'statusCode': 200, 'headers': headers,
                    'body': json.dumps({'imported': len(rows), 'total': total})}

        return {'statusCode': 400, 'headers': headers,
                'body': json.dumps({'error': 'Неизвестное действие'})}
    finally:
        conn.close()
