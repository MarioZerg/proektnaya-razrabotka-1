#!/usr/bin/env bash
# Перенос секретов из файла ИМЯ=значение в /opt/yarplan/.env.
#   scp secrets.env yarplan:/root/secrets.env && ssh yarplan /opt/yarplan/deploy/merge_secrets.sh /root/secrets.env
# Значения на экран не выводятся — только имя и длина. Пустые строки пропускаются.
# Исходный файл после переноса стирается.
set -euo pipefail
SRC="${1:?файл с секретами}"
ENV=/opt/yarplan/.env
tmp=$(mktemp /opt/yarplan/.env.XXXX)
cp "$ENV" "$tmp"
changed=0
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  line="${line#$'\xef\xbb\xbf'}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  name="${line%%=*}"; value="${line#*=}"
  name="$(echo "$name" | tr -d '[:space:]')"
  value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "пропущена строка с непонятным именем"; continue; }
  if [ -z "$value" ]; then echo "$name: пусто — пропущено"; continue; fi
  grep -v "^$name=" "$tmp" > "$tmp.2" || true
  printf '%s=%s\n' "$name" "$value" >> "$tmp.2"
  mv "$tmp.2" "$tmp"
  echo "$name: записан (символов: ${#value})"
  changed=$((changed + 1))
done < "$SRC"
chown root:yarplan "$tmp" && chmod 640 "$tmp" && mv "$tmp" "$ENV"
shred -u "$SRC" 2>/dev/null || rm -f "$SRC"
if [ "$changed" -gt 0 ]; then systemctl restart 'yarplan-fn@*'; echo "функции перезапущены"; fi
