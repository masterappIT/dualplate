#!/usr/bin/env bash
# 更換 API 環境設定：refresh-env.sh <新 app.env 檔>（root 執行）。
# 以權限 600 原子替換 /srv/dualplate/app.env，只重建 api 並檢查健康；失敗就還原舊檔。新檔用完即刪除。
set -euo pipefail
[[ "${EUID}" -eq 0 ]] || { printf 'Run as root.\n' >&2; exit 2; }
ROOT=/srv/dualplate
source_file="${1:?New app.env file required}"
cd "$ROOT"
exec 9>"$ROOT/deploy.lock"
flock -n 9 || { printf 'Another deployment is active.\n' >&2; exit 3; }
[[ -f app.env ]] || { printf 'Current app.env is missing.\n' >&2; exit 4; }
[[ -s "$source_file" ]] || { printf 'New app.env is empty or missing; API was not changed.\n' >&2; exit 4; }
umask 077
next="$(mktemp "$ROOT/.app.env.next.XXXXXX")"
previous="$(mktemp "$ROOT/.app.env.previous.XXXXXX")"
trap 'rm -f "$next" "$previous"' EXIT
cp "$source_file" "$next"
shred -u "$source_file"
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
    printf 'API healthy after environment refresh.\n'
    exit 0
  fi
  sleep 2
done
printf 'API unhealthy after environment refresh; restoring previous environment.\n' >&2
mv "$previous" app.env
docker compose --env-file deploy.env -f compose.yaml up -d --no-deps --force-recreate api >/dev/null 2>&1 || printf 'Previous API restart failed.\n' >&2
exit 6
