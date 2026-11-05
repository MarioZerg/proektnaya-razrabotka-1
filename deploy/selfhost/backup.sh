#!/usr/bin/env bash
# Ночная резервная копия: база целиком + файлы. Хранится 14 дней.
#   /var/backups/yarplan/db-ГГГГММДД-ЧЧММ.dump     — восстановление: pg_restore
#   /var/backups/yarplan/files-ГГГГММДД-ЧЧММ.tgz
# Копия лежит на том же сервере: от ошибки и случайного удаления спасает,
# от поломки сервера — нет. Для этого включите резервное копирование
# сервера в панели reg.ru (или выгрузку копий на другой сервер).
set -euo pipefail
umask 077
DIR=/var/backups/yarplan
KEEP_DAYS=14
mkdir -p "$DIR" && chmod 700 "$DIR"
set -a; . /opt/yarplan/.env; set +a
STAMP=$(date +%Y%m%d-%H%M)

pg_dump "$DATABASE_URL" -Fc -Z 6 -f "$DIR/db-$STAMP.dump.tmp"
mv "$DIR/db-$STAMP.dump.tmp" "$DIR/db-$STAMP.dump"
tar -czf "$DIR/files-$STAMP.tgz.tmp" -C /opt/yarplan files
mv "$DIR/files-$STAMP.tgz.tmp" "$DIR/files-$STAMP.tgz"

find "$DIR" -name 'db-*.dump' -mtime +$KEEP_DAYS -delete
find "$DIR" -name 'files-*.tgz' -mtime +$KEEP_DAYS -delete
echo "$(date '+%F %T') backup ok: $(du -h "$DIR/db-$STAMP.dump" | cut -f1) база, $(du -h "$DIR/files-$STAMP.tgz" | cut -f1) файлы" >> /var/log/yarplan-backup.log
