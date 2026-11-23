#!/bin/sh
# 在安卓模擬器上看 Flutter 版 App：打包 → 開模擬器 → 安裝 → 打開 App → 固定等幾秒 → 截圖。
# 每次真實改動只跑一次，結果不對就照實報告，不要反覆重跑。
# 用法：app/run.sh [選項]
#   --avd 名稱      模擬器，預設 Medium_Phone_API_37.0（另有 Dualplate_API_30 即 Android 11）
#   --skip-build    不重新打包，直接安裝上次的 APK
#   --cold          冷開機（不載入快照）；模擬器已開著時會先關掉。畫面或網絡不正常時用
#   --wait 秒數     打開 App 後等多久才截圖，預設 15
#   --out 檔案      截圖存放位置，預設 /private/tmp/dualplate-flutter/android/shot.png
# 另存一張縮小版（檔名加 -small）方便查看。所有記錄在 /private/tmp/dualplate-flutter/android/。
#
# 注意：Flutter 版和現有 App 的包名相同（com.masterappinc.dualplate），但除錯版簽名不同。
# 每次安裝前都先移除模擬器上的舊 App（App 內資料會清空），連同 HBuilder 基座和 uni-app 舊版（管理者 11-23「HBuilder 我不想再看到」）。
# 不要再用 android/emu-run.sh：那是 uni-app 舊版，會裝回 HBuilder 的東西。
set -eu

APP=$(cd "$(dirname "$0")" && pwd)
SDK="$HOME/Library/Android/sdk"
ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"
PACKAGE=com.masterappinc.dualplate
WORK=/private/tmp/dualplate-flutter/android
APK="$APP/build/app/outputs/flutter-apk/app-debug.apk"

AVD=Medium_Phone_API_37.0
BUILD=1
COLD=0
OUT="$WORK/shot.png"
WAIT=15
while [ $# -gt 0 ]; do
  case "$1" in
    --avd) AVD=$2; shift 2 ;;
    --skip-build) BUILD=0; shift ;;
    --cold) COLD=1; shift ;;
    --wait) WAIT=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    *) echo "不認識的選項：$1（用法見腳本開頭）" >&2; exit 2 ;;
  esac
done
mkdir -p "$WORK" "$(dirname "$OUT")"
step() { echo "== $(date +%H:%M:%S) $*"; }
fail() { echo "失敗：$*" >&2; exit 1; }

# 1. 打包（除錯版）
if [ "$BUILD" = 1 ]; then
  # 版本照網站 version.json（現在網站上的 Android 版本）：pubspec.yaml 只跟 iOS，比網站舊時一打開就會被強制更新擋住
  VJ="$APP/../deploy/web/download/version.json"
  VNAME=$(sed -n 's/.*"versionName": *"\([^"]*\)".*/\1/p' "$VJ")
  VCODE=$(sed -n 's/.*"versionCode": *\([0-9]*\).*/\1/p' "$VJ")
  [ -n "$VNAME" ] && [ -n "$VCODE" ] || fail "讀不到 $VJ 的版本"
  step "打包 APK（flutter build apk --debug，版本 $VNAME／$VCODE）"
  (cd "$APP" && flutter build apk --debug --build-name "$VNAME" --build-number "$VCODE") > "$WORK/build-apk.log" 2>&1 || fail "APK 打包失敗，見 $WORK/build-apk.log"
fi
[ -f "$APK" ] || fail "找不到 $APK，不要用 --skip-build"

# 2. 模擬器：已開著就沿用（--cold 時先關掉），否則開機並等到開好
running_avd() { "$ADB" -e emu avd name 2>/dev/null | head -1 | tr -d '\r'; }
if [ -n "$(running_avd)" ] && { [ "$COLD" = 1 ] || [ "$(running_avd)" != "$AVD" ]; }; then
  step "關掉現在的模擬器（$(running_avd)）"
  "$ADB" -e emu kill > /dev/null 2>&1 || true
  i=0; while [ -n "$("$ADB" devices | grep emulator)" ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done
fi
if [ -z "$(running_avd)" ]; then
  step "開模擬器 $AVD"
  SNAP=-no-snapshot-save; [ "$COLD" = 1 ] && SNAP=-no-snapshot
  nohup "$EMULATOR" -avd "$AVD" $SNAP -no-audio > "$WORK/emulator.log" 2>&1 &
fi
step "等模擬器開好"
i=0
until [ "$("$ADB" -e shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
  sleep 2; i=$((i + 2))
  [ $i -lt 240 ] || fail "模擬器 4 分鐘內沒開好，見 $WORK/emulator.log"
done
# 剛開好時安裝服務可能還沒準備好
i=0
until "$ADB" -e shell pm path android 2>/dev/null | grep -q package; do
  sleep 2; i=$((i + 2))
  [ $i -lt 60 ] || fail "模擬器的安裝服務 1 分鐘內沒準備好"
done

# 3. 安裝：每次都先移除舊的再裝（管理者 11-23「每次打開新版都需要把舊的清除」；App 內資料會清空）
step "移除舊的 App（連同 HBuilder 基座、uni-app 舊版）"
for old in "$PACKAGE" io.dcloud.HBuilder $("$ADB" -e shell pm list packages -3 2>/dev/null | tr -d '\r' | sed -n 's/^package:\(uni\.app\..*\)$/\1/p'); do
  "$ADB" -e uninstall "$old" > /dev/null 2>&1 || true
done
step "安裝 APK"
"$ADB" -e install "$APK" > "$WORK/install.log" 2>&1 || fail "安裝失敗，見 $WORK/install.log"

# 4. 重新打開 App
step "打開 App"
"$ADB" -e shell am force-stop "$PACKAGE"
"$ADB" -e logcat -c 2>/dev/null || true
"$ADB" -e shell am start -n "$PACKAGE/.MainActivity" > /dev/null

# 5. 固定等一段時間再截圖（不自動判斷畫面是否開好）
step "等 ${WAIT} 秒讓 App 開好"
sleep "$WAIT"
"$ADB" -e exec-out screencap -p > "$OUT"
SMALL="${OUT%.png}-small.png"
sips -Z 800 "$OUT" --out "$SMALL" > /dev/null

# App 有沒有閃退、Flutter 有沒有報錯
"$ADB" -e shell pidof "$PACKAGE" > /dev/null || echo "注意：App 沒有在運行（可能閃退），見 adb logcat"
"$ADB" -e logcat -d -s AndroidRuntime:E > "$WORK/crash.log" 2>/dev/null || true
[ -s "$WORK/crash.log" ] && grep -q "$PACKAGE" "$WORK/crash.log" && echo "注意：有閃退記錄，見 $WORK/crash.log"
"$ADB" -e logcat -d -s flutter:* > "$WORK/flutter.log" 2>/dev/null || true
grep -qiE "exception|error" "$WORK/flutter.log" && echo "注意：Flutter 有錯誤訊息，見 $WORK/flutter.log"
step "完成，截圖：$OUT（縮小版 $SMALL）"
