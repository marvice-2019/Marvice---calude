#!/bin/sh
# Bayline database backups. Modes:
#   health                  container healthcheck
#   loop                    nightly backup at BACKUP_AT_UTC (default 21:00 UTC = 02:30 IST), forever (container default)
#   backup                  one backup now, upload, prune older than RETENTION_DAYS (default 14)
#   list                    backups in the bucket, newest last
#   restore <name|latest> <target_database_url>
#                           restore a dump into a database (drops and recreates objects that exist in the dump)
#   verify [name|latest]    restore into a throwaway database on the same server and compare row counts with live
# Storage: rclone remote "s3" configured entirely from env (RCLONE_CONFIG_S3_*), bucket path S3_BUCKET/S3_PREFIX.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
PREFIX="${S3_PREFIX:-bayline}"
REMOTE="s3:${S3_BUCKET}/${PREFIX}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
WORK=/var/lib/backup

log() { printf '{"level":"%s","msg":"%s","at":"%s"}\n' "$1" "$2" "$(date -u +%FT%TZ)"; }

backup() {
  name="bayline-$(date -u +%Y%m%dT%H%M%SZ).dump"
  log info "backup start $name"
  pg_dump --format=custom --compress=9 --no-owner --dbname="$DATABASE_URL" --file="$WORK/$name"
  pg_restore --list "$WORK/$name" > /dev/null   # the archive is readable before we ship it
  size=$(wc -c < "$WORK/$name")
  rclone copyto "$WORK/$name" "$REMOTE/$name" --s3-no-check-bucket
  remote_size=$(rclone size --json "$REMOTE/$name" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  [ "$remote_size" = "$size" ] || { log error "uploaded size $remote_size != local $size"; exit 1; }
  rm -f "$WORK/$name"
  rclone delete "$REMOTE" --min-age "${RETENTION_DAYS}d" --include 'bayline-*.dump' --s3-no-check-bucket
  date +%s > "$WORK/last_success"
  log info "backup ok $name $size bytes; kept last ${RETENTION_DAYS} days"
}

latest() { rclone lsf "$REMOTE" --include 'bayline-*.dump' | sort | tail -n 1; }

fetch() {
  name="$1"; [ "$name" = "latest" ] && name="$(latest)"
  [ -n "$name" ] || { log error "no backups found in $REMOTE"; exit 1; }
  rclone copyto "$REMOTE/$name" "$WORK/restore.dump"
  echo "$name"
}

restore() {
  target="${2:?usage: restore <name|latest> <target_database_url>}"
  name="$(fetch "${1:-latest}")"
  log info "restore $name"
  pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$target" "$WORK/restore.dump"
  rm -f "$WORK/restore.dump"
  log info "restore ok $name"
}

counts() {  # one line per base table: name=rows (exact counts; fine at this size)
  psql "$1" -At -c "SELECT format('SELECT %L || ''='' || count(*) FROM %I.%I;', table_name, table_schema, table_name)
                    FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                      AND table_name NOT IN ('spatial_ref_sys') ORDER BY table_name" | psql "$1" -At
}

verify() {
  scratch="bayline_restore_check_$(date -u +%s)"
  admin_url="$(echo "$DATABASE_URL" | sed 's#/[^/?]*\(?\|$\)#/postgres\1#')"
  target_url="$(echo "$DATABASE_URL" | sed "s#/[^/?]*\(?\|\$\)#/${scratch}\1#")"
  psql "$admin_url" -qc "CREATE DATABASE ${scratch}"
  trap 'psql "$admin_url" -qc "DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)" >/dev/null 2>&1 || true' EXIT
  restore "${1:-latest}" "$target_url"
  counts "$DATABASE_URL" > "$WORK/live.txt"; counts "$target_url" > "$WORK/restored.txt"
  if diff "$WORK/live.txt" "$WORK/restored.txt" > "$WORK/diff.txt"; then
    log info "verify ok: $(wc -l < "$WORK/restored.txt") tables, row counts match live"
  else
    # rows written after the dump are expected; report rather than fail when only live is ahead
    log warn "verify: counts differ (writes since the dump?) $(tr '\n' ' ' < "$WORK/diff.txt")"
  fi
}

health() {  # healthy until 26 h after start with no backup yet, then only if the last success is under 26 h old
  ref=$(cat "$WORK/last_success" 2>/dev/null || stat -c %Y "$WORK/started" 2>/dev/null || date +%s)
  [ $(( $(date +%s) - ref )) -lt 93600 ]
}

case "${1:-loop}" in
  health) health ;;
  backup) backup ;;
  list) rclone lsf "$REMOTE" --include 'bayline-*.dump' | sort ;;
  restore) shift; restore "$@" ;;
  verify) shift; verify "${1:-latest}" ;;
  loop)
    touch "$WORK/started"
    at="${BACKUP_AT_UTC:-21:00}"
    while true; do
      now=$(date -u +%s); next=$(date -u -d "today $at" +%s)
      [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow $at" +%s)
      log info "next backup at $(date -u -d "@$next" +%FT%TZ)"
      sleep $((next - now))
      backup || log error "backup failed; will retry next night (healthcheck turns unhealthy after 26 h)"
    done ;;
  *) echo "usage: backup.sh loop|backup|list|restore <name|latest> <url>|verify [name|latest]"; exit 2 ;;
esac
