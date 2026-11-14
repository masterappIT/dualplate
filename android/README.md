# 安卓離線打包

DCloud uni-app App 版，用 DCloud 安卓離線 SDK 5.34 打包。包名 `com.masterappinc.dualplate`，名稱「跨境車牌管家」（與 iOS 一致），DCloud appid `__UNI__09DF642`。圖示和啟動畫面與 iOS 正式版同一套設計，素材說明見 `android/art/README.md`。

## 本機

1. 從 DCloud 官方網盤下載 `Android-SDK@5.34.82692_20261030.zip`（不要用第三方鏡像），把裏面的資料夾解壓成 `android/dcloud-sdk-5.34/`。這個資料夾不入庫。
2. 用 Java 17 編譯（Android Studio 自帶的 Java 25 太新，Gradle 8.11.1 不支援），例如 `export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`。
3. `android/sync-www.sh`：編譯客戶端，放進 `android/app/client/src/main/assets/apps/`（預設連正式 API，可在後面加別的地址）。
4. 在 `android/app` 跑 `./gradlew assembleDebug`，APK 在 `client/build/outputs/apk/debug/`。

在模擬器上看：`android/emu-run.sh` 一次做完打包、開模擬器、安裝、打開 App、截圖（選項見腳本開頭，例如 `--skip-build` 不重新打包、`--version-code 2` 測試更新）。

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

## 私隱同意框和權限

- 第一次打開先顯示 DCloud 的私隱同意框（`AndroidManifest.xml` 的 `DCLOUD_PRIVACY_PROMPT`，內容在 `mobile/src/androidPrivacy.json`），同意前不載入 App；按「不同意」再問一次，再不同意就退出。連結打開網站的服務條款和私隱聲明頁（`/#/pages/terms/terms`）。改了私隱聲明而要用戶重新同意時，把 `androidPrivacy.json` 的 `version` 加 1。
- 權限：網絡、相機、讀相片（Android 13 起只讀相片；12 或以下讀儲存空間）、安裝更新（App 內更新用）。DCloud 自帶而本 App 用不到的已拿掉：華為和 vivo 的圖示角標（`tools:node="remove"`），以及讀取設備廣告標識的 `oaid_sdk`（連同它的兩個 MSA 權限）。
- 讀影片、寫入儲存空間兩個權限由 DCloud 帶入，暫時保留：要先用帳戶測試拍照和選相片，確認拿掉後仍正常。Android 14 起「只允許部分相片」（`READ_MEDIA_VISUAL_USER_SELECTED`）也由 DCloud 帶入，本 App 的流程同樣用到，要保留。
- 申請相機或相片權限時，頂部同時顯示用途說明卡；被拒時頂部提示到手機設定開啟（`mobile/src/lib/pick-image.js`，批文卡相機頁也用它）。iOS 和網頁版照舊直接呼叫 `uni.chooseImage`。權限流程寫入系統記錄，查問題時用 `adb logcat -s DualplatePerm`。

## App 內更新

APK 在網站下載（`/download/`），不經 Google Play，所以由 App 自己檢查新版本（`mobile/src/lib/app-update.js`）：

- 首頁和登入頁每次顯示時讀 `/download/version.json`（`deploy/web/download/version.json`），比對已安裝 APK 的 `versionCode`。
- 有新版本：問「稍後／立即更新」，每次打開 App 只問一次；已安裝版本低於 `minVersionCode`：必須更新，提示不能關閉。首頁的服務條款提示等更新提示關掉才出。
- 立即更新：App 內下載 APK，核對是本 App 而且不舊於 `version.json` 的版本，才交給系統安裝。用戶第一次要在系統設定允許本 App「安裝未知應用」，允許後系統自動回到安裝畫面。
- 安裝靠 DCloud 的 `install-apk-release.aar`（`build.gradle` 依賴清單），範例工程的五個庫沒有它；缺了它按「立即更新」只會下載，不會打開系統安裝畫面。
- 已是最新版時刪掉以前下載的更新檔。
- 2026-11-14 在 Android 17 模擬器實測 1.0.0 → 1.0.1：提示、下載、允許安裝未知應用、系統安裝、更新後打開都正常。未測：更新後是否保持登入（沒有測試帳戶）。

模擬器測試更新：本機起一個伺服器提供 `/download/version.json` 和 APK、其他請求轉到正式網站，用 `android/sync-www.sh http://10.0.2.2:埠號` 打包兩個版本（`ANDROID_VERSION_CODE=2 ./gradlew assembleRelease -PappVersionName=1.0.1`）。模擬器開了很久會變得很慢（App 啟動要 20 秒以上，看似卡在啟動畫面），測試前先冷開機（`emu-run.sh --cold`）。

## 發新版本

1. 改 `android/app/gradle.properties` 的 `appVersionCode`（每版加 1）和 `appVersionName`。
2. `android/sync-www.sh`（連正式 API），再在 `android/app` 跑 `./gradlew assembleRelease`，APK 在 `client/build/outputs/apk/release/client-release.apk`。
3. 上傳到主機 `/srv/dualplate/download/dualplate.apk`：先傳成臨時檔名，傳完再改名，免得有人下載到一半的檔案。網站的 `/download/dualplate.apk` 直接讀這個檔（`deploy/web/Caddyfile`、`deploy/compose.yaml`），APK 不入 git。
4. APK 上傳好之後，才改 `deploy/web/download/version.json` 的 `versionCode`、`versionName`（和 `notes`）並部署。次序不能倒過來：先改 `version.json` 的話，App 會下載到舊 APK，核對不過，顯示「下載的檔案不完整」。
5. 舊版已不能用時，把 `minVersionCode` 改成新的 `versionCode`，舊版會被要求必須更新。

## 已知問題

- **雙牌位置和大小在接上時仍有變化，第一版接受、不修**（經理 2026-11-14 決定）。在 Android 11 模擬器（`Dualplate_API_30`）和 Android 17 模擬器（`Medium_Phone_API_37.0`）上，DCloud 啟動圖和雙牌合位頁（`launch.vue`）的雙牌比原生畫面偏高約 12 至 23dp，大小也不一致，啟動時看得到雙牌輕微跳動。以後要修時從下面的量度記錄開始查。
- 量度記錄（2026-11-14 配好 appkey 後實測；沒有 appkey 時頁面根本呼叫不到原生類別，配好後 `LaunchNavBar.insetDp()`、`restore()` 都正常被呼叫，Android 11 回傳 48dp，頁面算出的位置正確）：
  - Android 17：視窗底的雙牌在螢幕正中；DCloud 啟動圖顯示時向上約 12dp（看來它只畫在導航列以上的範圍）；雙牌合位頁回到正中，但雙牌寬度約為原生的 87%。
  - Android 11：雙牌合位頁比原生畫面高約 23dp，大小也不一致，原因未查明。
  - 導航列由原生程式在 DCloud 換上網頁後 2.22 秒還原（最遲 8 秒），雙牌合位頁離開時也會呼叫 `restore()`。
- Android 13 的單色主題圖示沒有做；安卓沒有深色模式圖示。
- 用戶在系統安裝畫面按取消後，App 要下次打開才會再提示更新（一般更新可接受，未改）。

## 更新 SDK

換版本時要改 `android/app/client/build.gradle` 的 SDK 路徑，並與 HBuilderX、`@dcloudio` 套件版本對齊（SDK 說明寫明要用相同版本編譯 App 資源）。依賴庫照 SDK 範例工程 `HBuilder-Integrate-AS/simpleDemo` 的清單。
