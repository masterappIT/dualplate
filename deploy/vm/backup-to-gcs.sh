#!/usr/bin/env bash
set -euo pipefail
ROOT=/srv/dualplate
BUCKET="${GCP_BACKUP_BUCKET:?GCP_BACKUP_BUCKET required}"
if [[ ! -f "$ROOT/data/app.sqlite" ]]; then
  printf 'No database exists; backup cannot run.\n' >&2
  exit 2
fi
cd "$ROOT"
result="$(docker compose --env-file "$ROOT/deploy.env" -f "$ROOT/compose.yaml" run --rm --no-deps api npm run backup)" || { printf 'SQLite backup failed.\n' >&2; exit 3; }
file="$(printf '%s\n' "$result" | sed -n 's/^備份完成：\([^；]*\).*/\1/p' | tail -1)"
if [[ -z "$file" || ! -s "$file" || "$file" != "$ROOT/backups/"* ]]; then
  printf 'SQLite backup output invalid.\n' >&2
  exit 4
fi
gcloud storage cp --quiet "$file" "gs://${BUCKET}/$(basename "$file")" >/dev/null || { printf 'Cloud Storage upload failed.\n' >&2; exit 5; }
printf 'Backup uploaded: %s\n' "$(basename "$file")"
