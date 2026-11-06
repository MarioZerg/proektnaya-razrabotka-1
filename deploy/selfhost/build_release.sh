#!/usr/bin/env bash
# Сборка и выкладка на свой сервер из любой версии кода.
#
#   deploy/selfhost/build_release.sh <git-ref> [домен сайта]
#   пример: deploy/selfhost/build_release.sh main megatulle.ru
#   функции и файлы — на api.<домен>
#
# Код в репозитории не меняется: адреса poehali заменяются только в копии
# для сборки.
#   functions.poehali.dev/<id>      → <api-host>/<id>          (функции)
#   cdn.poehali.dev/projects/...    → <api-host>/projects/...  (файлы)
#   bucket.poehali.dev              → 127.0.0.1:9000           (хранилище, только изнутри)
# Скрипты редактора и телеметрии poehali из index.html убираются.
set -euo pipefail

REF="${1:?укажите версию кода: ветку, тег или коммит}"
SITE_DOMAIN="${2:-megatulle.ru}"
API_HOST="api.$SITE_DOMAIN"
SERVER="${SERVER:-yarplan}"
REPO="$(git rev-parse --show-toplevel)"
WORK="${WORK_DIR:-${TMPDIR:-/tmp}/yarplan-release}"

echo "== версия: $(git -C "$REPO" rev-parse --short "$REF") ($REF), сайт: $SITE_DOMAIN, функции: $API_HOST"
rm -rf "$WORK" && mkdir -p "$WORK"
git -C "$REPO" archive --format=tar "$REF" | tar -x -C "$WORK"
cd "$WORK"

echo "== замена адресов poehali"
sed -i '/cdn\.poehali\.dev\/intertnal\//d' index.html
# Сначала полные адреса, потом голые имена хостов — их код сравнивает в проверках
# (аватарки, повтор запросов, кэш браузера в sw.js).
FILES=$(grep -rlE '(functions|cdn|bucket)\.poehali\.dev' src public backend index.html || true)
for f in $FILES; do
  sed -i \
    -e "s#https://bucket\.poehali\.dev#http://127.0.0.1:9000#g" \
    -e "s#https://functions\.poehali\.dev#https://$API_HOST#g" \
    -e "s#https://cdn\.poehali\.dev/projects#https://$API_HOST/projects#g" \
    -e "s#functions\.poehali\.dev#$API_HOST#g" \
    -e "s#cdn\.poehali\.dev#$API_HOST#g" \
    "$f"
done
# Старый домен сайта (заголовки, Метрика, карта сайта) — на новый.
if [ "$SITE_DOMAIN" != yarplan.ru ]; then
  for f in $(grep -rl 'yarplan\.ru' src public index.html || true); do
    sed -i "s#yarplan\.ru#$SITE_DOMAIN#g" "$f"
  done
fi
LEFT=$(grep -rnE '(functions|cdn|bucket)\.poehali\.dev' src public backend index.html | grep -vE '^\S+\.(md|txt):' || true)
if [ -n "$LEFT" ]; then
  echo "!! остались адреса poehali (проверить вручную):"
  echo "$LEFT" | head -20
fi

echo "== сборка сайта"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent

echo "== выкладка на сервер $SERVER"
tar -czf site.tgz -C dist .
tar -czf backend.tgz backend
scp -q site.tgz backend.tgz "$SERVER":/tmp/
ssh -o BatchMode=yes "$SERVER" "bash -s" <<EOF
set -e
cd /opt/yarplan
rm -rf site.new app.new && mkdir -p site.new app.new
tar -xzf /tmp/site.tgz -C site.new
tar -xzf /tmp/backend.tgz -C app.new
# Файлы прошлых сборок оставляем ещё на 14 дней: у сотрудника может быть открыта
# старая версия, и при переходе по разделам она запросит свой кусок кода. Без
# него вкладка перезагружалась бы посреди работы.
if [ -d site/assets ]; then
  cp -np site/assets/* site.new/assets/ 2>/dev/null || true
  find site.new/assets -type f -mtime +14 -delete
fi
chown -R root:yarplan site.new app.new && chmod -R g+rX,o-rwx site.new app.new
rm -rf site.old app.old
[ -d site ] && mv site site.old
[ -d app ] && mv app app.old
mv site.new site && mv app.new app
/opt/yarplan/venv/bin/python deploy/gen_nginx.py app/backend/func2url.json > /etc/nginx/yarplan-functions.map
for n in \$(awk '{print \$2}' /etc/nginx/yarplan-functions.map | tr -d ';'); do
  systemctl enable "yarplan-fn@\$n" >/dev/null 2>&1
done
# функции, которых больше нет в func2url.json, останавливаем
for u in \$(systemctl list-units 'yarplan-fn@*' --all --no-legend | awk '{print \$1}'); do
  n=\${u#yarplan-fn@}; n=\${n%.service}
  grep -q " \$n;" /etc/nginx/yarplan-functions.map || systemctl disable --now "\$u" >/dev/null 2>&1
done
systemctl restart 'yarplan-fn@*'
nginx -t >/dev/null 2>&1 && systemctl reload nginx
sleep 8
echo "функций работает: \$(systemctl list-units 'yarplan-fn@*' --state=active --no-legend | wc -l) из \$(wc -l < /etc/nginx/yarplan-functions.map)"
systemctl list-units 'yarplan-fn@*' --state=failed --no-legend
rm -f /tmp/site.tgz /tmp/backend.tgz
EOF
echo "== готово"
