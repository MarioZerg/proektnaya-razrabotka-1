#!/usr/bin/env bash
# Загрузка таблиц, которые MCP не отдаёт (личные данные), из CSV-выгрузки poehali.
#   load_manual.sh <папка с *_export.csv>
# Таблица = имя файла без _export.csv. Перед загрузкой таблица очищается.
# После загрузки снова применяются связи (schema_post.sql): те, что не прошли
# без этих таблиц, теперь должны встать. Счётчики id выравниваются по данным.
set -euo pipefail
DIR="${1:?папка с CSV}"
EXPORT="${EXPORT_DIR:-/root/dbexport-archive/dbexport}"
set -a; . /opt/yarplan/.env; set +a
S=t_p86119184_proektnaya_razrabotk

# Порядок важен: выплаты ссылаются на сотрудников, поэтому сотрудники — первыми.
for t in users suppliers salary_payouts; do
  f="$DIR/${t}_export.csv"
  [ -f "$f" ] || { echo "$t: файла нет — пропускаю"; continue; }
  cols=$(head -1 "$f" | tr -d '\r\357\273\277')
  rows=$(($(wc -l < "$f") - 1))
  # DELETE, а не TRUNCATE CASCADE: каскад очистил бы и все таблицы, ссылающиеся на эту.
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
    -c "BEGIN" \
    -c "DELETE FROM $S.$t" \
    -c "\\copy $S.$t ($cols) FROM '$f' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')" \
    -c "COMMIT"
  echo "$t: в файле строк $rows, в базе $(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM $S.$t")"
done

echo "== связи и индексы"
fails=0
while IFS= read -r stmt; do
  [ -z "$stmt" ] && continue
  out=$(psql "$DATABASE_URL" -q -c "$stmt" 2>&1) || true
  if grep -q ERROR <<<"$out" && ! grep -qE 'already exists|multiple primary keys' <<<"$out"; then
    fails=$((fails + 1)); echo "  ${stmt:0:110}… → $(grep ERROR <<<"$out" | head -1)"
  fi
done < "$EXPORT/schema_post.sql"
echo "не применилось: $fails"

echo "== счётчики id"
psql "$DATABASE_URL" -q <<SQL
DO \$\$ DECLARE r record; BEGIN
  FOR r IN SELECT s.relname seq, t.relname tbl, a.attname col FROM pg_depend d
    JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S' JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    JOIN pg_namespace n ON n.oid = s.relnamespace WHERE n.nspname = '$S' AND d.deptype IN ('a', 'i') LOOP
    EXECUTE format('SELECT setval(%L, GREATEST((SELECT last_value FROM $S.%I), COALESCE((SELECT max(%I) FROM $S.%I), 1)))',
                   '$S.' || r.seq, r.seq, r.col, r.tbl);
  END LOOP; END \$\$;
SQL
echo готово
