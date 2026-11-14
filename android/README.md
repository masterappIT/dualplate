# 安卓離線打包

DCloud uni-app App 版，用 DCloud 安卓離線 SDK 5.34 打包。包名 `com.masterappinc.dualplate`，名稱「跨境車牌管家」（與 iOS 一致），DCloud appid `__UNI__09DF642`。圖示和啟動畫面與 iOS 正式版同一套設計，素材說明見 `android/art/README.md`。

## 本機

1. 從 DCloud 官方網盤下載 `Android-SDK@5.34.82692_20261030.zip`（不要用第三方鏡像），把裏面的資料夾解壓成 `android/dcloud-sdk-5.34/`。這個資料夾不入庫。
2. 用 Java 17 編譯（Android Studio 自帶的 Java 25 太新，Gradle 8.11.1 不支援），例如 `export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`。
3. `android/sync-www.sh`：編譯客戶端，放進 `android/app/client/src/main/assets/apps/`（預設連正式 API，可在後面加別的地址）。
4. 在 `android/app` 跑 `./gradlew assembleDebug`，APK 在 `client/build/outputs/apk/debug/`。

正式版的簽名和 appkey 放在 `android/signing/release.properties`（不入庫），也可以用同名環境變數：

| 名稱 | 內容 |
|---|---|
| `DCLOUD_APPKEY` | DCloud 安卓離線 appkey（開發者中心 › 各平台信息，要填包名和簽名 SHA1） |
| `RELEASE_STORE_FILE` | 正式簽名金鑰檔名，放在 `android/signing/`（除錯版和正式版都用它簽） |
| `RELEASE_STORE_PASSWORD`、`RELEASE_KEY_ALIAS`、`RELEASE_KEY_PASSWORD` | 正式簽名金鑰的密碼和別名 |

正式簽名金鑰（`dualplate-release.jks`，指紋 `CN=Dualplate, O=IM MASTER INC. LIMITED`，SHA1 `0A:11:6B:44:2E:25:A8:EC:4B:30:90:E5:24:3F:22:8E:87:6E:71:1F`）每一版 APK 都要用同一把，弄丟了已安裝的用戶就不能更新，金鑰檔和密碼要另外備份。以後上架 Google Play 時，選擇「使用自己的金鑰」，交給 Google 的也是這一把，網站版和 Play 版才能互相更新。
| `ANDROID_VERSION_CODE` | 版本編號（環境變數），每次上傳 Google Play 要遞增，預設 1 |

**沒有 appkey 的包只能看啟動畫面**：DCloud 會彈出「Appkey is not configured or configured incorrectly」，按 OK 後 App 直接退出。appkey 綁定包名和簽名指紋，用別的金鑰簽的包同樣會彈出這個錯誤。目前的 appkey 在 DCloud 開發者中心 › `dualplate` › 各平台信息 › Android App 正式版（2026-11-14 建立）。

## 啟動畫面怎樣接上

順序與 iOS 一樣：深綠底、正中 180dp 雙牌，接 `mobile/src/pages/launch/launch.vue` 的雙牌合位動畫。

1. Android 12 起：系統啟動畫面（`res/values-v31/styles.xml`、`res/drawable-v31/launch_icon.xml`）。圖示用自適應圖示格式，縮放比例才固定；雙牌四邊留 14.5% 是在 Android 17 模擬器上量出來的。
2. 視窗底（`res/drawable*/launch_background.xml`）：入口畫面和 DCloud 主畫面的主題都用它，換畫面時不會露出灰色或白色。
3. DCloud 啟動圖（`res/drawable-*/splash.png`，由 `android/art/make-res.py` 產生）。
4. 雙牌合位頁。

底部導航列和狀態列在啟動期間設成深綠（主題設定，加上 `LaunchNavBar.java`：Android 15 起 DCloud 在導航列後面另墊一塊近白色的底，要另外改）。雙牌合位頁離開時還原成 DCloud 預設的近白色；有底部標籤列的頁面，DCloud 會再改成標籤列的顏色。

## 已知未解決

- **雙牌位置和大小在接上時仍有變化**（2026-11-14 配好 appkey 後實測；沒有 appkey 時頁面根本呼叫不到原生類別，配好後 `LaunchNavBar.insetDp()`、`restore()` 都正常被呼叫，Android 11 回傳 48dp，頁面算出的位置正確）：
  - Android 17：視窗底的雙牌在螢幕正中；DCloud 啟動圖顯示時向上約 12dp（看來它只畫在導航列以上的範圍）；雙牌合位頁回到正中，但雙牌寬度約為原生的 87%。
  - Android 11：雙牌合位頁比原生畫面高約 23dp，大小也不一致，原因未查明。
  - 導航列由原生程式在 DCloud 換上網頁後 2.22 秒還原（最遲 8 秒），雙牌合位頁離開時也會呼叫 `restore()`。
- Android 13 的單色主題圖示沒有做；安卓沒有深色模式圖示。

## 更新 SDK

換版本時要改 `android/app/client/build.gradle` 的 SDK 路徑，並與 HBuilderX、`@dcloudio` 套件版本對齊（SDK 說明寫明要用相同版本編譯 App 資源）。依賴庫照 SDK 範例工程 `HBuilder-Integrate-AS/simpleDemo` 的清單。
