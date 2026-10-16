#!/usr/bin/env bash
set -euo pipefail
[[ "${EUID}" -eq 0 ]] || { printf 'Run as root.\n' >&2; exit 2; }
ROOT=/srv/dualplate
PROJECT="${GCP_PROJECT_ID:?GCP_PROJECT_ID required}"
SECRET="${GCP_APP_ENV_SECRET:-dualplate-app-env}"
cd "$ROOT"
exec 9>"$ROOT/deploy.lock"
flock -n 9 || { printf 'Another deployment is active.\n' >&2; exit 3; }
[[ -f app.env ]] || { printf 'Current app.env is missing.\n' >&2; exit 4; }
umask 077
next="$(mktemp "$ROOT/.app.env.next.XXXXXX")"
previous="$(mktemp "$ROOT/.app.env.previous.XXXXXX")"
trap 'rm -f "$next" "$previous"' EXIT
if ! gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT" > "$next" 2>/dev/null || [[ ! -s "$next" ]]; then
  printf 'Secret refresh failed; API was not changed.\n' >&2
  exit 4
fi
cp app.env "$previous"
chmod 600 "$next" "$previous"
mv "$next" app.env
if ! docker compose --env-file deploy.env -f compose.yaml up -d --no-deps --force-recreate api >/dev/null 2>&1; then
  printf 'API restart failed; restoring previous environment.\n' >&2
  mv "$previous" app.env
  docker compose --env-file deploy.env -f compose.yaml up -d --no-deps --force-recreate api >/dev/null 2>&1 || printf 'Previous API restart failed.\n' >&2
  exit 5
fi
for _ in $(seq 1 30); do
  if docker compose --env-file deploy.env -f compose.yaml exec -T api node -e "fetch('http://127.0.0.1:4100/api/health').then(r=>r.json()).then(x=>process.exit(x.ok===true&&x.database==='ok'?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    printf 'API healthy after secret refresh.\n'
    exit 0
  fi
  sleep 2
done
printf 'API unhealthy after secret refresh; restoring previous environment.\n' >&2
mv "$previous" app.env
docker compose --env-file deploy.env -f compose.yaml up -d --no-deps --force-recreate api >/dev/null 2>&1 || printf 'Previous API restart failed.\n' >&2
exit 6
