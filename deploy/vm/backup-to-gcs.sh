#!/usr/bin/env bash
# SQLite 線上備份並上傳到共用的備份 bucket（gs://masterapp-prod-backups/dualplate/，35 天後自動刪除）。
# 用伺服器已有的 rclone 和 gcs-backup-sa.json；這個服務帳號只能新增和讀取，不能覆寫或刪除備份。
set -euo pipefail
ROOT=/srv/dualplate
BUCKET="${BACKUP_BUCKET:-masterapp-prod-backups}"
KEY="${GCS_KEY_FILE:-/srv/infra/secrets/gcs-backup-sa.json}"
if [[ ! -f "$ROOT/data/app.sqlite" ]]; then
  printf 'No database exists; backup cannot run.\n' >&2
  exit 2
fi
[[ -s "$KEY" ]] || { printf 'Backup service account key missing.\n' >&2; exit 2; }
cd "$ROOT"
result="$(docker compose --env-file "$ROOT/deploy.env" -f "$ROOT/compose.yaml" run --rm --no-deps api npm run backup)" || { printf 'SQLite backup failed.\n' >&2; exit 3; }
file="$(printf '%s\n' "$result" | sed -n 's/^備份完成：\([^；]*\).*/\1/p' | tail -1)"
if [[ -z "$file" || ! -s "$file" || "$file" != "$ROOT/backups/"* ]]; then
  printf 'SQLite backup output invalid.\n' >&2
  exit 4
fi
target="dualplate/$(date -u +%Y/%m/%d)/$(basename "$file")"
rclone copyto "$file" ":gcs:${BUCKET}/${target}" \
  --gcs-service-account-file "$KEY" --gcs-bucket-policy-only --gcs-no-check-bucket \
  || { printf 'Cloud Storage upload failed.\n' >&2; exit 5; }
printf 'Backup uploaded: %s\n' "$target"
