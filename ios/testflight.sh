#!/bin/sh
# 打包跨境車牌管家，上傳到 TestFlight（.github/workflows/testflight.yml 呼叫）
# 需要：BUILD_NUMBER；上傳時另需 ASC_KEY_ID、ASC_ISSUER_ID、ASC_KEY_PATH、PROFILE_NAME
# ARCHIVE_ONLY=1 只打包不上傳，本機試打包用（用開發簽名）
set -eu
# Podfile 有中文，CocoaPods 要 UTF-8
export LANG=en_US.UTF-8
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ARCHIVE="$ROOT/ios/app/build/testflight/HBuilder.xcarchive"
BUNDLE_ID=com.masterappinc.dualplate
TEAM_ID=YU6GT6HQJ8

"$ROOT/ios/sync-www.sh"
cd "$ROOT/ios/app"
pod install
rm -rf "$ARCHIVE"

if [ "${ARCHIVE_ONLY:-}" = 1 ]; then set -- -allowProvisioningUpdates; else set --; fi
xcodebuild archive "$@" \
  -workspace HBuilder-Hello.xcworkspace \
  -scheme HBuilder \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build/testflight/dd \
  -archivePath "$ARCHIVE" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER"

[ "${ARCHIVE_ONLY:-}" = 1 ] && { echo "已打包 ${ARCHIVE}（未上傳）"; exit 0; }

OPTIONS="$ROOT/ios/app/build/testflight/ExportOptions.plist"
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
  -exportPath "$ROOT/ios/app/build/testflight/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"
echo "已上傳到 App Store Connect（Build ${BUILD_NUMBER}）"
