"""Запуск облачной функции poehali.dev на своём сервере — без переделки кода.

Каждая папка backend/<имя>/ — функция с handler(event, context) в index.py.
Этот файл превращает обычный HTTP-запрос в такой же event, какой присылает
poehali, вызывает handler и отдаёт ответ. Gunicorn запускает его отдельно
для каждой функции: у функций одинаковые имена модулей (shared.py, authz.py),
и в одном процессе они бы перепутались.

Запуск: FN_DIR=/opt/yarplan/functions/orders gunicorn runner:app
"""

import base64
import importlib.util
import json
import os
import sys
import traceback
import uuid
from http import HTTPStatus
from urllib.parse import parse_qsl

FN_DIR = os.environ['FN_DIR']
FN_NAME = os.path.basename(FN_DIR.rstrip('/'))

sys.path.insert(0, FN_DIR)
os.chdir(FN_DIR)
_spec = importlib.util.spec_from_file_location('index', os.path.join(FN_DIR, 'index.py'))
_mod = importlib.util.module_from_spec(_spec)
sys.modules['index'] = _mod
_spec.loader.exec_module(_mod)
handler = _mod.handler


class Context:
    """То немногое из context облачной функции, что может понадобиться коду."""

    def __init__(self):
        self.request_id = str(uuid.uuid4())
        self.function_name = FN_NAME
        self.memory_limit_in_mb = 512

    def get_remaining_time_in_millis(self):
        return 120000


def _headers(environ):
    out = {}
    for key, value in environ.items():
        if key.startswith('HTTP_'):
            name = '-'.join(p.capitalize() for p in key[5:].split('_'))
            out[name] = value
    if environ.get('CONTENT_TYPE'):
        out['Content-Type'] = environ['CONTENT_TYPE']
    if environ.get('CONTENT_LENGTH'):
        out['Content-Length'] = environ['CONTENT_LENGTH']
    return out


def _event(environ, ctx):
    method = environ['REQUEST_METHOD']
    headers = _headers(environ)
    length = int(environ.get('CONTENT_LENGTH') or 0)
    raw = environ['wsgi.input'].read(length) if length else b''
    try:
        body, is_b64 = raw.decode('utf-8'), False
    except UnicodeDecodeError:
        body, is_b64 = base64.b64encode(raw).decode('ascii'), True
    ip = headers.get('X-Real-Ip') or environ.get('REMOTE_ADDR') or ''
    return {
        'httpMethod': method,
        'path': environ.get('PATH_INFO') or '/',
        'headers': headers,
        'queryStringParameters': dict(parse_qsl(environ.get('QUERY_STRING', ''), keep_blank_values=True)),
        'body': body,
        'isBase64Encoded': is_b64,
        'requestContext': {
            'requestId': ctx.request_id,
            'httpMethod': method,
            'identity': {'sourceIp': ip},
        },
    }


def _status_line(code):
    try:
        return f'{code} {HTTPStatus(code).phrase}'
    except ValueError:
        return f'{code} Unknown'


def app(environ, start_response):
    ctx = Context()
    try:
        res = handler(_event(environ, ctx), ctx)
    except Exception:  # как и облако: падение функции — это 500, а не обрыв связи
        traceback.print_exc()
        start_response('500 Internal Server Error', [('Content-Type', 'application/json')])
        return [json.dumps({'error': 'Internal error'}).encode()]

    if not isinstance(res, dict):
        res = {'statusCode': 200, 'body': res}

    code = int(res.get('statusCode') or 200)
    body = res.get('body', '')
    if res.get('isBase64Encoded') and isinstance(body, str):
        data = base64.b64decode(body)
    elif isinstance(body, (bytes, bytearray)):
        data = bytes(body)
    elif isinstance(body, str):
        data = body.encode('utf-8')
    else:
        data = json.dumps(body, ensure_ascii=False, default=str).encode('utf-8')

    headers = [(str(k), str(v)) for k, v in (res.get('headers') or {}).items()]
    for k, values in (res.get('multiValueHeaders') or {}).items():
        headers.extend((str(k), str(v)) for v in values)
    if not any(k.lower() == 'content-type' for k, _ in headers):
        headers.append(('Content-Type', 'application/json'))
    start_response(_status_line(code), headers)
    return [data]
