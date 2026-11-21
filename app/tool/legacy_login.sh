#!/bin/sh
# 讓對照用模擬器上的現有 App（連本機伺服器的版本，3-0 裝好）直接以某個測試帳號登入，不用在模擬器打字。
# 用法：[PORT=<端口>] app/tool/legacy_login.sh <電郵，例如 li@demo.local> [模擬器 UDID]
# 做法：向本機伺服器（local_api.sh，端口預設 4130，可用環境變數 PORT 另選，要和該模擬器上現有 App 打包時的端口相同）登入取得 token，照 mobile/src/lib/api.js saveSession 寫進
# 現有 App 的 uni 儲存（Library/Pandora/apps/__UNI__09DF642/data/wxstorage/wxstorage.plist），再重開 App。
# 只可用在 3-0 建的對照用模擬器；不可用在 iPhone 16 Pro Max 原機（78302077，保持登入審查帳號）。
set -eu
EMAIL=${1:?用法：app/tool/legacy_login.sh <電郵> [模擬器 UDID]}
UDID=${2:-361F2754-4795-4DD7-9DBB-58CBAF4097C5}
[ "$UDID" != 78302077-5771-463E-83BB-E44C81FCAD60 ] || { echo "不可改 16 Pro Max 原機" >&2; exit 1; }
BUNDLE=com.masterappinc.dualplate
PORT=${PORT:-4130}
RESULT=$(curl -sf -X POST http://localhost:$PORT/api/login -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"CustomerDemo123!\"}") || { echo "登入失敗：本機伺服器開了嗎（app/tool/local_api.sh <批次>）？" >&2; exit 1; }
DATA=$(xcrun simctl get_app_container "$UDID" $BUNDLE data)
xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
mkdir -p "$DATA/Library/Pandora/apps/__UNI__09DF642/data/wxstorage"
python3 -I - "$DATA/Library/Pandora/apps/__UNI__09DF642/data/wxstorage/wxstorage.plist" "$RESULT" <<'EOF'
import json, os, plistlib, sys
path, result = sys.argv[1], json.loads(sys.argv[2])
store = plistlib.load(open(path, 'rb')) if os.path.exists(path) else {}
# saveSession：token、user；清掉 serviceMode 和首頁緩存（clearSession 也清 homeCache）
for key in ('serviceMode', 'homeCache'):
    store.pop(key, None)
store['token'] = result['token']
store['user'] = json.dumps({'type': 'object', 'data': result['user']}, ensure_ascii=False, separators=(',', ':'))
plistlib.dump(store, open(path, 'wb'), fmt=plistlib.FMT_XML)
print(f"已寫入：{result['user']['name']}（{result['user']['serviceMode']}）")
EOF
xcrun simctl launch "$UDID" $BUNDLE >/dev/null
