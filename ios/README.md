# iOS 離線打包與 TestFlight

DCloud uni-app App 版，用 Xcode 離線打包。Bundle ID `com.masterappinc.dualplate`，Team `YU6GT6HQJ8`，DCloud appid `__UNI__09DF642`。

## 本機

1. 從 DCloud 官方網盤下載 iOS 離線 SDK 5.34 的 `SDK.zip`（不要用第三方 GitHub 鏡像），把裏面的 `SDK/` 解壓成 `ios/dcloud-sdk-5.34/`。
2. 建立 `ios/app/Config/Secrets.xcconfig`，寫入 `DCLOUD_APPKEY = …`（DCloud 開發者中心 › 各平台信息 › 查看）。
3. `ios/sync-www.sh`，再到 `ios/app` 跑 `pod install`，打開 `HBuilder-Hello.xcworkspace`。

## 自動發佈

推送到 main、`Deploy production` 成功後，`.github/workflows/testflight.yml` 檢查 `mobile/`、`ios/` 從上一次上傳以來有沒有改動，有就打包上傳。想手動發佈：Actions › TestFlight › Run workflow。

Build 編號是工作流程的執行編號；每次成功上傳會在該提交打 `testflight/<編號>` 標籤。**App Store 上架 1.0.0 之後**，要先改 `project.pbxproj` 的 `MARKETING_VERSION`，否則 Apple 會拒收。

環境 `testflight`（只限 main）內的設定：

| 名稱 | 種類 | 內容 |
|---|---|---|
| `ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_KEY_BASE64` | secret | App Store Connect API 金鑰 |
| `IOS_DIST_P12_BASE64`、`IOS_DIST_P12_PASSWORD`、`IOS_PROFILE_BASE64` | secret | 發佈證書和描述檔，`ios/create-signing.mjs` 產生，**每年到期要重跑**（現有的 2027-11-03 到期） |
| `DCLOUD_APPKEY` | secret | DCloud 離線打包 key |
| `IOS_SDK_PASSPHRASE` | secret | SDK 加密密碼 |
| `IOS_SDK_ENC_SHA256` | variable | 加密 SDK 檔的校驗值 |

本機簽名檔案放在 `ios/signing/`，這個資料夾不入庫：API 金鑰 `.p8`（團隊金鑰 `dualplate-ci`，Apple 只讓下載一次，遺失就要撤銷再建一把）、`dist.p12` 和密碼、描述檔。重跑 `ios/create-signing.mjs` 時輸出到這裏。

## 更新 SDK

倉庫是公開的，SDK 加密後放在 Release（`ios-sdk-<版本>`），打包機用 `IOS_SDK_PASSPHRASE` 解密：

```bash
openssl enc -aes-256-cbc -pbkdf2 -pass env:PASSPHRASE -in SDK.zip -out SDK.zip.enc
```

換版本時要同時改 `testflight.yml` 的 Release 名稱和解壓路徑、`ios/app/Podfile` 的 `SDK_DIR`，以及 `IOS_SDK_ENC_SHA256`。
