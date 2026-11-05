"""Простое файловое хранилище вместо bucket.poehali.dev.

Функции кладут и берут файлы через boto3 (S3): put_object и get_object в
бакет 'files'. Здесь эти два вызова (плюс HEAD и DELETE) обслуживаются как
обычные файлы в папке /opt/yarplan/files/<бакет>/<ключ>.

Слушает только 127.0.0.1 — снаружи сервера недоступно, поэтому подпись
запросов S3 не проверяется. Наружу файлы по прямой ссылке отдаёт nginx
(files.<домен>/projects/<что угодно>/bucket/<ключ>), как раньше cdn.poehali.dev.

Запуск: gunicorn files_server:app --bind 127.0.0.1:9000
"""

import hashlib
import mimetypes
import os
from urllib.parse import unquote

ROOT = os.environ.get('FILES_ROOT', '/opt/yarplan/files')


def _path(environ):
    raw = unquote(environ.get('PATH_INFO') or '/').lstrip('/')
    parts = [p for p in raw.split('/') if p]
    if len(parts) < 2 or any(p in ('.', '..') for p in parts):
        return None, None
    return parts[0], os.path.join(ROOT, *parts)


def _reply(start_response, code, body=b'', headers=None):
    status = {200: '200 OK', 204: '204 No Content', 400: '400 Bad Request',
              404: '404 Not Found', 405: '405 Method Not Allowed'}[code]
    hdrs = [('Content-Length', str(len(body)))] + (headers or [])
    start_response(status, hdrs)
    return [body]


def _read_body(environ):
    stream = environ['wsgi.input']
    length = environ.get('CONTENT_LENGTH')
    if length:
        return stream.read(int(length))
    return stream.read()  # chunked: gunicorn сам собирает тело


def app(environ, start_response):
    method = environ['REQUEST_METHOD']
    bucket, path = _path(environ)

    if method == 'GET' and (environ.get('PATH_INFO') or '/') in ('/', ''):
        return _reply(start_response, 200, b'<ListAllMyBucketsResult/>', [('Content-Type', 'application/xml')])
    if not path:
        return _reply(start_response, 400, b'bad key')

    if method == 'PUT':
        data = _read_body(environ)
        if 'aws-chunked' in (environ.get('HTTP_CONTENT_ENCODING') or ''):
            return _reply(start_response, 400, b'aws-chunked not supported: set AWS_REQUEST_CHECKSUM_CALCULATION=when_required')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.chmod(tmp, 0o640)
        os.replace(tmp, path)
        ctype = environ.get('CONTENT_TYPE')
        if ctype:
            with open(path + '.ctype', 'w') as f:
                f.write(ctype)
        etag = '"' + hashlib.md5(data).hexdigest() + '"'
        return _reply(start_response, 200, b'', [('ETag', etag)])

    if method in ('GET', 'HEAD'):
        if not os.path.isfile(path):
            return _reply(start_response, 404, b'<Error><Code>NoSuchKey</Code></Error>', [('Content-Type', 'application/xml')])
        with open(path, 'rb') as f:
            data = f.read()
        ctype = None
        if os.path.exists(path + '.ctype'):
            ctype = open(path + '.ctype').read().strip()
        ctype = ctype or mimetypes.guess_type(path)[0] or 'application/octet-stream'
        headers = [('Content-Type', ctype), ('ETag', '"' + hashlib.md5(data).hexdigest() + '"')]
        if method == 'HEAD':
            start_response('200 OK', headers + [('Content-Length', str(len(data)))])
            return [b'']
        return _reply(start_response, 200, data, headers)

    if method == 'DELETE':
        for p in (path, path + '.ctype'):
            if os.path.exists(p):
                os.remove(p)
        return _reply(start_response, 204)

    return _reply(start_response, 405)
