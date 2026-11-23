# 發佈 iOS、Android App（Flutter）

2026-11-23 起兩個平台都是 Flutter 版（`app/`）。舊的 DCloud 專案 `android/`、`ios/` 已在階段 6 刪除，本文件接手兩者 README 裏仍然有用的部分。

## 簽名檔案（只放本機，不入庫）

都在 `app/signing/`（`.gitignore` 已排除）。**檔案和密碼要另外備份**，弄丟了：安卓用戶不能覆蓋更新；iOS 要撤銷再重建。

| 位置 | 內容 |
|---|---|
| `app/signing/android/dualplate-release.jks` | 安卓正式簽名金鑰（`CN=Dualplate, O=IM MASTER INC. LIMITED`，SHA1 `0A:11:6B:44:2E:25:A8:EC:4B:30:90:E5:24:3F:22:8E:87:6E:71:1F`）。每一版 APK 都要用同一把；以後上架 Google Play 時選「使用自己的金鑰」，交給 Google 的也是這一把，網站版和 Play 版才能互相更新 |
| `app/signing/android/release.properties` | `RELEASE_STORE_FILE`（金鑰檔名）、`RELEASE_STORE_PASSWORD`、`RELEASE_KEY_ALIAS`、`RELEASE_KEY_PASSWORD`；也可以用同名環境變數代替。裏面的 `DCLOUD_APPKEY` 是舊 DCloud 版用的，已不需要 |
| `app/signing/ios/AuthKey_*.p8` | App Store Connect API 金鑰（團隊金鑰 `dualplate-ci`）。Apple 只讓下載一次，遺失就要撤銷再建一把 |
| `app/signing/ios/dist.p12`、`dist.p12.password`、`profile.mobileprovision` | 發佈證書和 App Store 描述檔，**2027-11-03 到期**，到期前用 `app/tool/create-signing.mjs` 重建（見下面「iOS」） |

## iOS

推送到 main、`Deploy production` 成功後，`.github/workflows/testflight.yml` 檢查 `app/` 從上一次上傳以來有沒有改動，有就用 `app/tool/testflight.sh` 打包上傳 TestFlight。想手動發佈：Actions › TestFlight › Run workflow。

- 版本名稱取自 `app/pubspec.yaml` 的 `version`（`+` 前面的部分）；Build 號是工作流程的「執行編號.重試次數」。每次成功上傳會在該提交打 `testflight/<編號>` 標籤。
- 送審版本號要比 App Store 上的版本大，先改 `pubspec.yaml` 再推送。
- 審查備註：更新版只寫幾行（修正、登入方法、註銷位置）。

環境 `testflight`（只限 main）用到的 secret：

| 名稱 | 內容 |
|---|---|
| `ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_KEY_BASE64` | App Store Connect API 金鑰 |
| `IOS_DIST_P12_BASE64`、`IOS_DIST_P12_PASSWORD`、`IOS_PROFILE_BASE64` | 發佈證書和描述檔（`app/signing/ios/` 的三個檔，base64） |

證書和描述檔一年到期，重建（只建新的，不會撤銷現有證書；輸出不印內容）：

```bash
ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=app/signing/ios/AuthKey_….p8 node app/tool/create-signing.mjs app/signing/ios
```

重建後把三個檔案 base64 後更新上表的 secret。

## Android

APK 在網站下載（`/download/`），不經 Google Play，由 App 自己檢查新版本（`lib/business/app_update.dart`）：打開時讀 `/download/version.json`，比對已安裝的 `versionCode`；有新版本問「稍後／立即更新」，已安裝版本低於 `minVersionCode` 必須更新。

發新版本：

1. 定好新的 `versionCode`（**比網站 `version.json` 現在的大**；現在是 3，下一版用 4 以上）和版本名稱。
2. `app/tool/build_apk.sh` 打包並核對簽名指紋，版本取自 `app/pubspec.yaml` 的 `version`（例：`1.1.1+3`）。只發 APK、不想觸發 TestFlight 時，打包前臨時改 `pubspec.yaml`，打完改回，不要提交。
3. 上傳到主機 `/srv/dualplate/download/dualplate.apk`：先傳到臨時位置、核對 SHA-256，再換上，免得有人下載到一半的檔案。網站的 `/download/dualplate.apk` 直接讀這個檔（`deploy/web/Caddyfile`、`deploy/compose.yaml`），APK 不入 git。
4. APK 換好之後，才改 `deploy/web/download/version.json` 的 `versionCode`、`versionName`、`notes`（沒有特別交代就寫「Bug Fixed」）並推送部署。次序不能倒過來：先改 `version.json` 的話，App 會下載到舊 APK，核對不過。
5. `version.json` 的 `versionCode` 必須和 APK 裏的一樣：寫得比 APK 高，用戶更新完還會一直被提示。
6. 舊版已不能用時，把 `minVersionCode` 改成新的 `versionCode`，舊版會被要求必須更新。

在模擬器上看新版：`app/run.sh`（每次先移除舊 App；版本照網站 `version.json`，不會被強制更新擋住）。
