#!/bin/sh
# 在安卓模擬器上看 App：打包 → 開模擬器 → 安裝 → 打開 App → 等幾秒 → 截圖
# 用法：android/emu-run.sh [選項]
#   --api 地址          App 連的伺服器，預設正式網站；模擬器連本機用 http://10.0.2.2:埠號
#   --avd 名稱          模擬器，預設 Medium_Phone_API_37.0（另有 Dualplate_API_30 即 Android 11）
#   --version-code 數字  APK 的版本編號（測試 App 更新時用），預設 gradle.properties 的 appVersionCode
#   --release           打正式版（assembleRelease，網站發布的就是這個），預設除錯版
#   --skip-build        不重新打包，直接安裝上次的 APK
#   --cold              冷開機（不載入快照）；模擬器已開著時會先關掉。畫面或網絡不正常時用
#   --wait 秒數         打開 App 後等多久才截圖，預設 20
#   --out 檔案          截圖存放位置，預設 /private/tmp/dualplate-android/shot.png
# 另存一張縮小版（檔名加 -small）方便查看。所有記錄在 /private/tmp/dualplate-android/。
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SDK="$HOME/Library/Android/sdk"
ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"
# Gradle 8.11.1 要 Java 17（見 android/README.md）
JAVA17=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
PACKAGE=com.masterappinc.dualplate
VARIANT=debug
WORK=/private/tmp/dualplate-android

API=https://dualplate.masterappinc.com
AVD=Medium_Phone_API_37.0
VERSION_CODE=
BUILD=1
COLD=0
OUT="$WORK/shot.png"
WAIT=20
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API=$2; shift 2 ;;
    --avd) AVD=$2; shift 2 ;;
    --version-code) VERSION_CODE=$2; shift 2 ;;
    --release) VARIANT=release; shift ;;
    --skip-build) BUILD=0; shift ;;
    --cold) COLD=1; shift ;;
    --wait) WAIT=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    *) echo "不認識的選項：$1（用法見腳本開頭）" >&2; exit 2 ;;
  esac
done
APK="$ROOT/android/app/client/build/outputs/apk/$VARIANT/client-$VARIANT.apk"
TASK=assembleDebug; [ "$VARIANT" = release ] && TASK=assembleRelease
mkdir -p "$WORK" "$(dirname "$OUT")"
step() { echo "== $(date +%H:%M:%S) $*"; }
fail() { echo "失敗：$*" >&2; exit 1; }

# 1. 打包
if [ "$BUILD" = 1 ]; then
  step "編譯客戶端（API：$API）"
  "$ROOT/android/sync-www.sh" "$API" > "$WORK/build-www.log" 2>&1 || fail "客戶端編譯失敗，見 $WORK/build-www.log"
  step "打包 APK${VERSION_CODE:+（版本編號 $VERSION_CODE）}"
  (cd "$ROOT/android/app" && env JAVA_HOME="$JAVA17" ${VERSION_CODE:+ANDROID_VERSION_CODE=$VERSION_CODE} ./gradlew "$TASK" -q) > "$WORK/build-apk.log" 2>&1 || fail "APK 打包失敗，見 $WORK/build-apk.log"
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

# 3. 安裝：簽名不同（例如裝過別的簽名的包）時先移除舊的
step "安裝 APK"
if ! "$ADB" -e install -r "$APK" > "$WORK/install.log" 2>&1; then
  if grep -q INSTALL_FAILED_UPDATE_INCOMPATIBLE "$WORK/install.log"; then
    step "已裝的版本簽名不同，先移除（App 內資料會清空）"
    "$ADB" -e uninstall "$PACKAGE" > /dev/null
    "$ADB" -e install "$APK" > "$WORK/install.log" 2>&1 || fail "安裝失敗，見 $WORK/install.log"
  else
    fail "安裝失敗，見 $WORK/install.log"
  fi
fi

# 4. 重新打開 App
step "打開 App"
"$ADB" -e shell am force-stop "$PACKAGE"
"$ADB" -e logcat -c 2>/dev/null || true
"$ADB" -e shell am start -n "$PACKAGE/io.dcloud.PandoraEntry" > /dev/null

# 5. 固定等一段時間再截圖（不自動判斷：登入頁背景一直在動，啟動畫面又會靜止一陣，判斷不可靠）
step "等 ${WAIT} 秒讓 App 開好"
sleep "$WAIT"
"$ADB" -e exec-out screencap -p > "$OUT"
SMALL="${OUT%.png}-small.png"
sips -Z 800 "$OUT" --out "$SMALL" > /dev/null

# App 有沒有閃退
"$ADB" -e shell pidof "$PACKAGE" > /dev/null || echo "注意：App 沒有在運行（可能閃退），見 adb logcat"
"$ADB" -e logcat -d -s AndroidRuntime:E > "$WORK/crash.log" 2>/dev/null || true
[ -s "$WORK/crash.log" ] && grep -q "$PACKAGE" "$WORK/crash.log" && echo "注意：有閃退記錄，見 $WORK/crash.log"
step "完成，截圖：$OUT（縮小版 $SMALL）"
