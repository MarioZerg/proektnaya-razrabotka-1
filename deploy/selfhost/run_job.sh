#!/usr/bin/env bash
# Запуск фонового задания функции — вместо cron-job.org.
#   run_job.sh <функция> <action> [GET|POST]
# Обращается к функции напрямую через её сокет на этом сервере: в интернет
# ключ планировщика не уходит. Ответ и код пишутся в /var/log/yarplan-jobs.log.
set -uo pipefail
FN="$1"; ACTION="$2"; METHOD="${3:-GET}"
set -a; . /opt/yarplan/.env; set +a
SOCK="/run/yarplan-fn/$FN/sock"
LOG=/var/log/yarplan-jobs.log
if [ "$METHOD" = POST ]; then
  BODY=$(printf '{"action":"%s","cronSecret":"%s"}' "$ACTION" "$CRON_SECRET")
  OUT=$(curl -s -m 600 -w '\n%{http_code}' --unix-socket "$SOCK" -X POST \
        -H 'Content-Type: application/json' --data-binary @- "http://localhost/" <<<"$BODY")
else
  OUT=$(curl -s -m 600 -w '\n%{http_code}' --unix-socket "$SOCK" -G "http://localhost/" \
        --data-urlencode "action=$ACTION" --data-urlencode "cronSecret=$CRON_SECRET")
fi
CODE=$(tail -n1 <<<"$OUT")
printf '%s %s/%s %s %s\n' "$(date '+%F %T')" "$FN" "$ACTION" "$CODE" "$(head -n -1 <<<"$OUT" | head -c 300 | tr '\n' ' ')" >> "$LOG"
