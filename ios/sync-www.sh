#!/bin/sh
# 編譯客戶端 App 版，放進 Xcode 項目的 Pandora 資料夾（離線打包用）
# 用法：ios/sync-www.sh [API 地址]，預設正式伺服器
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
API=${1:-https://dualplate.masterappinc.com}
APPID=__UNI__09DF642
WWW="$ROOT/ios/app/HBuilder-Hello/Pandora/apps/$APPID/www"

cd "$ROOT/mobile"
rm -rf dist/build/app
VITE_API_BASE_URL="$API" npm run build:app-plus
grep -q "\"id\": *\"$APPID\"\|\"id\":\"$APPID\"" dist/build/app/manifest.json || { echo "manifest.json 的 appid 不是 $APPID" >&2; exit 1; }

rm -rf "$WWW"
mkdir -p "$WWW"
cp -R dist/build/app/. "$WWW/"
echo "已放入 ${WWW}（API：${API}）"
