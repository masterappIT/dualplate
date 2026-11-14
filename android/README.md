# 安卓離線打包

DCloud uni-app App 版，用 DCloud 安卓離線 SDK 5.34 打包。包名 `com.masterappinc.dualplate`，名稱「跨境車牌管家」（與 iOS 一致），DCloud appid `__UNI__09DF642`。圖示與 iOS 正式版同一套設計；啟動畫面是深綠底、白色 MasterApp 標誌（iOS 仍是雙牌合位動畫，見下文）。素材說明見 `android/art/README.md`。

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

## 啟動畫面

安卓只有一個靜態畫面：深綠底、正中白色 MasterApp 標誌（M 雲，100×76dp），一直顯示到登入頁或首頁出現，不播雙牌合位動畫（管理者 2026-11-15 決定；iOS 和網頁版照舊播）。以前安卓要經過系統啟動畫面、DCloud 啟動圖、雙牌合位頁三層雙牌，DCloud 那層只在導航列以上置中，雙牌大小位置對不上，看起來像兩段動畫。

由按下圖示起，先後經過下面幾層，都用同一張圖（`res/drawable/launch_mark.xml`），大小位置一樣，看不出切換：

1. Android 12 起的系統啟動畫面（`res/values-v31/styles.xml`、`res/drawable-v31/launch_icon.xml`），每個 App 都一定有，關不掉。系統把 108dp 畫布顯示為 288dp（Android 17 模擬器實測），`launch_icon.xml` 按比例留邊，令標誌顯示為 100×76dp。
2. 入口畫面和 DCloud 主畫面的視窗底（`res/drawable-v23/launch_background.xml`）。Android 5 只有深綠（`res/drawable/launch_background.xml`，那時的 layer-list 不能指定大小和置中）。
3. `LaunchCover.java`：叫 DCloud 不建立它自己的啟動圖（啟動 Intent 的 `__splash_view__` 設成 false；那張圖會被拉伸到整個螢幕，之後又縮到導航列以上，標誌會變大再移位），再在 DCloud 主畫面最上面蓋一層同一張圖的畫面，連導航列也蓋住，網頁載入時的灰白和底部近白色的底都不會露出。`mobile/src/pages/launch/launch.vue` 在安卓上不畫任何東西，只取首頁資料，打開登入頁或首頁後呼叫 `LaunchCover.hide()` 淡出（萬一沒有呼叫，15 秒後自動拿走）。
4. DCloud 啟動圖 `res/drawable-*/splash.png`（`android/art/make-splash.sh` 產生）：平時不顯示，只在第 3 步叫 DCloud 不建立它失敗時才出現，所以同樣畫成深綠底白色標誌。

`LaunchCover` 和 `LaunchNavBar` 每次 DCloud 主畫面建立都重新做：按返回鍵離開後再打開、更新後重開時，程序可能還在，只做第一次的話會露出 DCloud 啟動圖和底部白條（試做時出現過）。

2026-11-15 在 Android 17 模擬器錄影逐格核對冷開機、完全關掉後打開、按返回鍵離開再打開三種情況：系統畫面到 `LaunchCover` 標誌位置大小不變，淡入首頁時沒有空白、沒有底部白條。模擬器上標誌停留約 7 秒（真機應快得多）。Android 11 未測。

## 底部導航列那一條

Android 15 起 DCloud 把網頁縮到導航列以上（`android:id/content` 的外邊距固定設成導航列高度，改了會被它不停改回），在導航列後面墊一塊近白色 `#FCFCFC` 的底；iOS 的 `safearea.bottom.offset: none` 在安卓不起作用。所以不改排版，只由 `LaunchNavBar.java` 把那一條塗成 iPhone 上同一位置的顏色：

- 啟動期間深綠，被 `LaunchCover` 蓋住；打開登入頁或首頁時換成頁面的顏色。
- 之後由 `mobile/src/lib/nav-bar.js`（只在安卓 App 執行）按頁面指定：有標籤列的頁面跟標籤列（白色），其他頁面用頁面底色 `#F7F6F1`（批文卡相機頁黑色）；彈窗打開時跟遮罩一起淡入淡出，變成遮罩疊在頁面底色上的顏色。標籤頁的彈窗遮罩蓋不到標籤列，那一條保持白色，與 iPhone 一致。彈窗由 `mobile/src/lib/back-close.js` 登記。
- DCloud 在畫面高度變化時（例如彈出鍵盤）會另墊新的底，又變回 `#FCFCFC`，每次排版後檢查並塗回。
- 安卓 WebView 的 `env(safe-area-inset-bottom)` 仍回報導航列高度（Android 17 為 24px），但網頁已停在導航列上面，所以 `App.vue` 的 `.page`、`WelcomeGuide.vue`、`CardCapture.vue` 在安卓不再多留這段。App 裏用 `-webkit-touch-callout`（只有 iPhone 的 WebView 支援）分辨，萬一以後 iOS 不再支援它，iPhone 頁面底部會少留安全區。

2026-11-15 在 Android 17 模擬器逐項核對：啟動接首頁、首頁、標籤頁的批文卡預覽、牌照詳情頁、「有變動？」選單（含第二層和返回鍵關閉）、退出登入確認框、使用導覽、表單頁鍵盤彈出再收起、批文卡相機頁、頁面底部留白。模擬器較慢，第一次打開「有變動？」選單時，那一條比選單早約 1 秒變暗；真機未測。

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

- Android 13 的單色主題圖示沒有做；安卓沒有深色模式圖示。
- 用戶在系統安裝畫面按取消後，App 要下次打開才會再提示更新（一般更新可接受，未改）。

## 更新 SDK

換版本時要改 `android/app/client/build.gradle` 的 SDK 路徑，並與 HBuilderX、`@dcloudio` 套件版本對齊（SDK 說明寫明要用相同版本編譯 App 資源）。依賴庫照 SDK 範例工程 `HBuilder-Integrate-AS/simpleDemo` 的清單。
