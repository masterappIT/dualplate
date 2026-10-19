#!/usr/bin/env bash
set -euo pipefail
ROOT=/srv/dualplate
api="${1:?Previous API digest required}"
web="${2:?Previous web digest required}"
[[ "$api" =~ @sha256:[0-9a-f]{64}$ && "$web" =~ @sha256:[0-9a-f]{64}$ ]] || { printf 'Images must use sha256 digests.\n' >&2; exit 2; }
cd "$ROOT"
exec 9>"$ROOT/deploy.lock"
flock -n 9 || exit 3
docker pull "$api" >/dev/null
docker pull "$web" >/dev/null
sed -e "s|^API_IMAGE=.*|API_IMAGE=$api|" -e "s|^WEB_IMAGE=.*|WEB_IMAGE=$web|" deploy.env > deploy.env.next
chmod 600 deploy.env.next
mv deploy.env.next deploy.env
docker compose --env-file deploy.env -f compose.yaml up -d --remove-orphans
domain="$(sed -n 's/^MOBILE_DOMAIN=//p' deploy.env)"
for _ in $(seq 1 30); do
  if docker compose --env-file deploy.env -f compose.yaml exec -T web wget -qO- --header "Host: ${domain}" http://127.0.0.1/api/health 2>/dev/null | grep -q '"database":"ok"'; then
    printf 'Rollback healthy.\n'
    exit 0
  fi
  sleep 2
done
printf 'Rollback unhealthy.\n' >&2
exit 1
