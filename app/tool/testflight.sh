#!/bin/sh
# 打包 Flutter 版跨境車牌管家，上傳到 TestFlight（.github/workflows/testflight.yml 呼叫）
# 需要：BUILD_NUMBER；上傳時另需 ASC_KEY_ID、ASC_ISSUER_ID、ASC_KEY_PATH、PROFILE_NAME，
#       以及 CI 寫好的 app/ios/Flutter/Signing.xcconfig（手動簽名，不入庫）
# ARCHIVE_ONLY=1 只打包不上傳，本機試打包用（用開發簽名，自動管理描述檔）
# 版本名稱取自 app/pubspec.yaml 的 version（+ 前面的部分），Build 號用 BUILD_NUMBER
set -eu
APP=$(cd "$(dirname "$0")/.." && pwd)
ARCHIVE="$APP/build/testflight/Runner.xcarchive"
BUNDLE_ID=com.masterappinc.dualplate
TEAM_ID=YU6GT6HQJ8
VERSION=$(sed -n 's/^version: *\([0-9.]*\).*/\1/p' "$APP/pubspec.yaml")
[ -n "$VERSION" ] || { echo "讀不到 pubspec.yaml 的 version" >&2; exit 1; }

cd "$APP"
flutter pub get
# 只產生 Xcode 設定（版本名稱、Build 號），打包交給 xcodebuild，和舊版做法一樣
flutter build ios --release --config-only --build-name "$VERSION" --build-number "$BUILD_NUMBER"
rm -rf "$ARCHIVE"

if [ "${ARCHIVE_ONLY:-}" = 1 ]; then set -- -allowProvisioningUpdates; else set --; fi
xcodebuild archive "$@" \
  -workspace ios/Runner.xcworkspace \
  -scheme Runner \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build/testflight/dd \
  -archivePath "$ARCHIVE"

[ "${ARCHIVE_ONLY:-}" = 1 ] && { echo "已打包 ${ARCHIVE}（${VERSION} Build ${BUILD_NUMBER}，未上傳）"; exit 0; }

OPTIONS="$APP/build/testflight/ExportOptions.plist"
cat > "$OPTIONS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict><key>$BUNDLE_ID</key><string>$PROFILE_NAME</string></dict>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
EOF

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$OPTIONS" \
  -exportPath "$APP/build/testflight/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"
echo "已上傳到 App Store Connect（${VERSION} Build ${BUILD_NUMBER}）"
