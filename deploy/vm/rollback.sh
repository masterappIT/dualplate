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
curl --fail --silent --show-error --max-time 15 --resolve "${domain}:443:127.0.0.1" "https://${domain}/api/health" | grep -q '"database":"ok"'
printf 'Rollback healthy.\n'
