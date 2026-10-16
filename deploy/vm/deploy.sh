#!/usr/bin/env bash
set -euo pipefail
ROOT=/srv/dualplate
new_api="${1:?API digest required}"
new_web="${2:?web digest required}"
[[ "$new_api" =~ @sha256:[0-9a-f]{64}$ && "$new_web" =~ @sha256:[0-9a-f]{64}$ ]] || { printf 'Images must use sha256 digests.\n' >&2; exit 2; }
cd "$ROOT"
exec 9>"$ROOT/deploy.lock"
flock -n 9 || { printf 'Another deployment is active.\n' >&2; exit 3; }
old_api=''; old_web=''
if [[ -f deploy.env ]]; then
  old_api="$(sed -n 's/^API_IMAGE=//p' deploy.env)"
  old_web="$(sed -n 's/^WEB_IMAGE=//p' deploy.env)"
fi
printf 'Pulling release images.\n'
docker pull "$new_api" >/dev/null
docker pull "$new_web" >/dev/null
if [[ -f data/app.sqlite ]]; then
  GCP_BACKUP_BUCKET="${GCP_BACKUP_BUCKET:?}" "$ROOT/backup-to-gcs.sh" || { printf 'Pre-release backup failed; release stopped.\n' >&2; exit 4; }
else
  [[ -z "$old_api" && -z "$old_web" ]] || { printf 'Existing release has no database; refusing update.\n' >&2; exit 4; }
  printf 'First deployment: no database exists yet.\n'
fi
printf 'API_IMAGE=%s\nWEB_IMAGE=%s\nADMIN_DOMAIN=%s\nMOBILE_DOMAIN=%s\nCADDY_EMAIL=%s\n' "$new_api" "$new_web" "${ADMIN_DOMAIN:?}" "${MOBILE_DOMAIN:?}" "${CADDY_EMAIL:?}" > deploy.env.next
chmod 600 deploy.env.next
mv deploy.env.next deploy.env
if ! docker compose --env-file deploy.env -f compose.yaml up -d --remove-orphans; then
  printf 'Container startup failed.\n' >&2
  failed=5
else
  failed=0
  for _ in $(seq 1 30); do
    if docker compose --env-file deploy.env -f compose.yaml exec -T api node -e "fetch('http://127.0.0.1:4100/api/health').then(r=>r.json()).then(x=>process.exit(x.ok===true&&x.database==='ok'?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && curl --silent --show-error --fail --max-time 4 --resolve "${MOBILE_DOMAIN}:443:127.0.0.1" "https://${MOBILE_DOMAIN}/api/health" | grep -q '"database":"ok"'; then
      printf 'Release healthy.\n'
      exit 0
    fi
    sleep 2
  done
  printf 'Health check failed after 60 seconds.\n' >&2
  failed=6
fi
if [[ -n "$old_api" && -n "$old_web" ]]; then
  printf 'Restoring previous image digests.\n' >&2
  printf 'API_IMAGE=%s\nWEB_IMAGE=%s\nADMIN_DOMAIN=%s\nMOBILE_DOMAIN=%s\nCADDY_EMAIL=%s\n' "$old_api" "$old_web" "$ADMIN_DOMAIN" "$MOBILE_DOMAIN" "$CADDY_EMAIL" > deploy.env
  chmod 600 deploy.env
  docker compose --env-file deploy.env -f compose.yaml up -d --remove-orphans || printf 'Rollback container restart failed.\n' >&2
else
  printf 'No previous image exists for rollback.\n' >&2
fi
exit "$failed"
