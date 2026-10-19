#!/usr/bin/env bash
# 正式發布（HostKVM 共用伺服器，/srv/dualplate/deploy.sh，root 執行）。
# 由 GitHub Actions 經 deploy-dualplate 帳號呼叫：deploy.sh <API 映像@sha256> <web 映像@sha256>
set -euo pipefail
ROOT=/srv/dualplate
REGISTRY=asia-east2-docker.pkg.dev/dualplate-511819/dualplate
ADMIN_DOMAIN="${ADMIN_DOMAIN:-dualplateadmin.masterappinc.com}"
MOBILE_DOMAIN="${MOBILE_DOMAIN:-dualplate.masterappinc.com}"
new_api="${1:?API digest required}"
new_web="${2:?web digest required}"
[[ "$new_api" =~ ^${REGISTRY}/api@sha256:[0-9a-f]{64}$ && "$new_web" =~ ^${REGISTRY}/web@sha256:[0-9a-f]{64}$ ]] || { printf 'Images must be %s/{api,web}@sha256 digests.\n' "$REGISTRY" >&2; exit 2; }
cd "$ROOT"
exec 9>"$ROOT/deploy.lock"
flock -n 9 || { printf 'Another deployment is active.\n' >&2; exit 3; }
old_api=''; old_web=''
if [[ -f deploy.env ]]; then
  old_api="$(sed -n 's/^API_IMAGE=//p' deploy.env)"
  old_web="$(sed -n 's/^WEB_IMAGE=//p' deploy.env)"
fi
write_env() {
  printf 'API_IMAGE=%s\nWEB_IMAGE=%s\nADMIN_DOMAIN=%s\nMOBILE_DOMAIN=%s\n' "$1" "$2" "$ADMIN_DOMAIN" "$MOBILE_DOMAIN" > deploy.env.next
  chmod 600 deploy.env.next
  mv deploy.env.next deploy.env
}
# 先在 api 容器內檢查，再經 web 容器帶網域檢查整條路徑（共用 Caddy 只是把網域轉到 web）
check_health() {
  local deadline remaining response
  deadline=$(( $(date +%s) + 60 ))
  while remaining=$(( deadline - $(date +%s) )); (( remaining > 0 )); do
    if timeout "${remaining}s" docker compose --env-file deploy.env -f compose.yaml exec -T api node -e "fetch('http://127.0.0.1:4100/api/health').then(r=>r.json()).then(x=>process.exit(x.ok===true&&x.database==='ok'?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      remaining=$(( deadline - $(date +%s) ))
      if (( remaining > 0 )); then
        response="$(timeout "${remaining}s" docker compose --env-file deploy.env -f compose.yaml exec -T web wget -qO- --header "Host: ${MOBILE_DOMAIN}" http://127.0.0.1/api/health 2>/dev/null)" || response=''
        [[ "$response" == *'"ok":true'* && "$response" == *'"database":"ok"'* ]] && return 0
      fi
    fi
    remaining=$(( deadline - $(date +%s) ))
    (( remaining > 0 )) || break
    if (( remaining > 2 )); then remaining=2; fi
    sleep "$remaining"
  done
  return 1
}
printf 'Pulling release images.\n'
docker pull "$new_api" >/dev/null || { printf 'API image pull failed.\n' >&2; exit 9; }
docker pull "$new_web" >/dev/null || { printf 'Web image pull failed.\n' >&2; exit 9; }
if [[ -f data/app.sqlite ]]; then
  "$ROOT/backup-to-gcs.sh" || { printf 'Pre-release backup failed; release stopped.\n' >&2; exit 4; }
else
  [[ -z "$old_api" && -z "$old_web" ]] || { printf 'Existing release has no database; refusing update.\n' >&2; exit 4; }
  printf 'First deployment: no database exists yet.\n'
fi
write_env "$new_api" "$new_web"
if ! docker compose --env-file deploy.env -f compose.yaml up -d --remove-orphans; then
  printf 'Container startup failed.\n' >&2
  failed=5
else
  if check_health; then
    printf 'Release healthy.\n'
    exit 0
  fi
  printf 'Health check failed after 60 seconds.\n' >&2
  failed=6
fi
if [[ -n "$old_api" && -n "$old_web" ]]; then
  printf 'Restoring previous image digests.\n' >&2
  write_env "$old_api" "$old_web"
  docker compose --env-file deploy.env -f compose.yaml up -d --remove-orphans || printf 'Rollback container restart failed.\n' >&2
  if check_health; then
    printf 'Rollback healthy.\n'
    exit "$failed"
  fi
  printf 'Rollback unhealthy.\n' >&2
  exit 7
else
  printf 'No previous image exists for rollback.\n' >&2
  printf 'Rollback unhealthy.\n' >&2
  exit 8
fi
