#!/bin/sh
# 階段 3 本機測試伺服器（docs/tasks/flutter-app-plan.md 第四節「階段 3 分批」3-0）。
# 用法：[PORT=<端口>] app/tool/local_api.sh <批次，例如 3a>
# - 每批一份資料，放 /private/tmp/dp3/<批次>/（不讀寫 api/data/，正式後端不寫入）。
# - 第一次開時用 API 自帶的示範資料（DEMO_SEED=1），再建三種帳號（local_api_seed.mjs）；之後沿用同一份資料。
#   要重來：先停伺服器，刪除 /private/tmp/dp3/<批次>/ 再開。
# - 端口預設 4130；兩批同時做時用環境變數 PORT 另選一個（例如 3b：PORT=4131 app/tool/local_api.sh 3b）。
#   連本機的現有 App（對照用模擬器，打包時指定同一端口）和 Flutter 版都連這個地址：
#   flutter run --dart-define=API_BASE=http://localhost:<端口>
# 按 Ctrl-C 停止。
set -eu
BATCH=${1:?用法：app/tool/local_api.sh <批次，例如 3a>}
PORT=${PORT:-4130}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DIR=/private/tmp/dp3/$BATCH
mkdir -p "$DIR"
FIRST=0
[ -f "$DIR/api.db" ] || FIRST=1

if lsof -ti tcp:$PORT >/dev/null 2>&1; then
  echo "端口 $PORT 已有程式在用（可能是另一批的伺服器），請先停掉" >&2
  exit 1
fi

cd "$ROOT/api"
DB_PATH="$DIR/api.db" LOG_DIR="$DIR/logs" DEMO_SEED=1 PORT=$PORT node src/server.js &
PID=$!
trap 'kill $PID 2>/dev/null' INT TERM EXIT

i=0
until curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  [ $i -lt 50 ] || { echo "伺服器 10 秒內沒有啟動" >&2; exit 1; }
  sleep 0.2
done

if [ $FIRST = 1 ]; then
  node "$ROOT/app/tool/local_api_seed.mjs" "http://localhost:$PORT" || { echo "建測試帳號失敗；刪除 $DIR 再試" >&2; exit 1; }
fi

cat <<EOF
本機伺服器：http://localhost:${PORT}（批次 ${BATCH}，資料在 ${DIR}）
三種帳號（登入頁選「電郵」，密碼都是 CustomerDemo123!）：
  空白的自管客戶   empty-self@demo.local
  有資料的自管客戶 customer@demo.local（陳先生，2 個牌照）
  托管客戶         li@demo.local（李先生，8 個牌照、公司、出租、帳目）
管理端：帳號 admin，密碼 AdminDemo123!
EOF
wait $PID
