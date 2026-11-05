#!/usr/bin/env bash
# Записать секрет в /opt/yarplan/.env, не показывая его на экране.
#   ssh -t yarplan /opt/yarplan/deploy/set_secret.sh GAZELKA_API_KEY      — ввести вслепую
#   Get-Clipboard | ssh yarplan /opt/yarplan/deploy/set_secret.sh ИМЯ    — из буфера (PowerShell)
# Значение на экран не выводится, функции перезапускаются.
set -euo pipefail
NAME="${1:?укажите имя секрета, например GAZELKA_API_KEY}"
[[ "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Имя секрета — заглавные латинские буквы, цифры и _"; exit 1; }
ENV=/opt/yarplan/.env

if [ -t 0 ]; then
  read -r -s -p "Вставьте значение $NAME и нажмите Enter: " VALUE; echo
else
  # Значение пришло из буфера обмена: Get-Clipboard | ssh yarplan .../set_secret.sh ИМЯ
  IFS= read -r VALUE || true
fi
VALUE="${VALUE%$'\r'}"
VALUE="$(printf '%s' "$VALUE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
[ -n "$VALUE" ] || { echo "Пусто — ничего не записано"; exit 1; }
case "$VALUE" in *$'\n'*|*\"*) echo "В значении не должно быть переводов строк и кавычек"; exit 1;; esac

tmp=$(mktemp /opt/yarplan/.env.XXXX)
grep -v "^$NAME=" "$ENV" > "$tmp" || true
printf '%s=%s\n' "$NAME" "$VALUE" >> "$tmp"
chown root:yarplan "$tmp" && chmod 640 "$tmp" && mv "$tmp" "$ENV"
unset VALUE

systemctl restart 'yarplan-fn@*'
echo "$NAME записан (символов: $(grep "^$NAME=" "$ENV" | cut -d= -f2- | tr -d '\n' | wc -c)). Функции перезапущены."
