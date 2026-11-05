"""Собирает карту «адрес функции → служба» для nginx из backend/func2url.json.

    python gen_nginx.py /opt/yarplan/app/backend/func2url.json > /etc/nginx/yarplan-functions.map

Адреса функций остаются прежними, меняется только домен:
https://functions.poehali.dev/<id>  →  https://api.<домен>/<id>
"""

import json
import sys

urls = json.load(open(sys.argv[1], encoding='utf-8'))
for name, url in sorted(urls.items()):
    fid = url.rstrip('/').rsplit('/', 1)[-1]
    print(f'{fid} {name};')
