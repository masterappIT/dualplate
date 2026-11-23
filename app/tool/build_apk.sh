#!/bin/sh
# 打包網站下載用的正式 APK（Flutter 版），用 android/signing/ 同一把正式金鑰簽名，並核對簽名指紋。
# 版本名稱和 versionCode 取自 app/pubspec.yaml 的 version（例：1.1.0+2）。
# 用法：app/tool/build_apk.sh
# 輸出：app/build/app/outputs/flutter-apk/app-release.apk
# 上傳到網站的步驟見 android/README.md「發佈」：先傳 APK，再改 deploy/web/download/version.json。
set -eu
APP=$(cd "$(dirname "$0")/.." && pwd)
SDK="$HOME/Library/Android/sdk"
APK="$APP/build/app/outputs/flutter-apk/app-release.apk"
# android/README.md 記下的正式金鑰指紋；不一致就不是同一把金鑰，用戶不能覆蓋更新
EXPECTED_SHA1=0a116b442e25a8ec4b3090e5243f228e876e711f

[ -f "$APP/../android/signing/release.properties" ] || [ -n "${RELEASE_STORE_FILE:-}" ] || {
  echo "找不到 android/signing/release.properties，不能用正式金鑰簽名" >&2; exit 1; }

cd "$APP"
flutter build apk --release

# apksigner 要 Java；本機命令列沒有時用 Android Studio 自帶的
[ -n "${JAVA_HOME:-}" ] || export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
APKSIGNER=$(ls -d "$SDK"/build-tools/*/apksigner | sort -V | tail -1)
CERT=$("$APKSIGNER" verify --print-certs "$APK" | sed -n 's/^Signer #1 certificate SHA-1 digest: //p')
if [ "$CERT" != "$EXPECTED_SHA1" ]; then
  echo "簽名指紋不對：$CERT（應為 $EXPECTED_SHA1）" >&2; exit 1
fi
AAPT=$(ls -d "$SDK"/build-tools/*/aapt | sort -V | tail -1)
"$AAPT" dump badging "$APK" | sed -n 's/^package: \(.*\) platformBuildVersionName.*/\1/p'
echo "簽名指紋正確（$CERT）"
echo "APK：$APK"
