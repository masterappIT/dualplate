# iOS／Android App 改用 Flutter（2026-11-15）

## 一、背景與決定

- 2026-11-15 管理者認為 uni-app 有問題，經討論決定：**iOS、Android App 不再使用 uni-app，改用 Flutter**；**網頁版（H5）和微信小程序繼續用 uni-app**（`mobile/`），不受影響。
- 不用原生（Swift＋Kotlin）：客戶端會變三份，每個功能做三次；本 App 的內容（表單、列表、批文卡、拍照）沒有 Flutter 做不好的部分。
- 管理者指出 App 現在**最麻煩的是掃描批文卡**，所以階段 2 先做掃描，並作為繼續與否的關卡。
- 後端（`api/`）不改。App 用的接口和網頁版相同。
- **管理者 2026-11-15：必須按目前 UI 狀態一比一完成。** Flutter 版只換底層，用戶看到和操作到的一切都要和現在的 App 一樣（見第二節「UI 一比一照舊」）。

### 現在 App 的問題（都出在 DCloud 外殼，不在頁面）

| 問題 | 換 Flutter 後 |
|---|---|
| 拍卡用 WebView 裏的網頁鏡頭（getUserMedia），要經 renderjs 傳指令；Android 要先另外拿系統權限；相冊相片要先轉成 data URL；開不了鏡頭要走後備流程 | 原生相機，全解像度、可對焦、可開閃光燈；整套繞路取消 |
| 啟動要處理 DCloud 開屏，出現過白條；Android 啟動曾要 8–9 秒 | 沒有 DCloud 開屏；原生啟動圖直接銜接首頁 |
| iOS 模擬器要手動拼裝 HBuilder 基座，只能跑 iOS 18.4 | 用 Xcode、Android Studio 標準模擬器和真機調試 |
| SDK 只能從 DCloud 網盤下載；appkey 有名額；帳號被鎖過 | 不再依賴 DCloud |
| 啟動時連到 DCloud 和騰訊雲，內容不明 | 只連自己的伺服器 |

### 換框架不會改變的

- **辨識準確度**：伺服器用 Tesseract 按固定位置讀欄位（`api/src/card.js`），10-18 實測每張 36 欄讀對 24–25 欄。拍得更好會提高一些，但上限在伺服器。改伺服器辨識（例如自建 PaddleOCR）是另一個決定，三邊同時受惠，不在本計劃內。
- **小程序拍卡**：小程序仍用系統選相片、沒有對準框，要另外做，不在本計劃內。

## 二、範圍

### 要搬的內容（現有 `mobile/`，約 4,800 行）

- **頁面 26 個**（底部分頁：首頁、牌照、公司、我的）：launch、index、vehicles、companies、me、deadlines、plate-detail、plate-create、card-capture、self-change、requests、request-detail、notifications、billing、reports、login、terms、close-account、company-new、plate-delete、signup、messages、profile、rental-new、rental、scope。
- **組件 13 個**：ApprovalCard、CardCapture、MainlandPlate、HongKongPlate、MacauPlate、PlateChip、DueDate、StampMark、SignaturePad、AdvisorCard、ContactCard、CompanyEditor、WelcomeGuide。
- **共用邏輯**：`lib/api.js`（登入狀態、自管／托管用語、金額、日期、狀態顏色）、`lib/choice.js`（確認框和選單）、`lib/back-close.js`、`lib/ports-canvas.js`。
- **App 專用**：啟動畫面（iOS 雙牌合位動畫；Android 單一靜態白色 M 雲）、首頁緩存（`homeCache`）、Android App 內更新（讀 `/download/version.json`）、Android 權限用途說明卡、首次打開的條款同意框（`androidPrivacy.json`）。

### 不搬

- 微信登入和綁定（只在小程序）。
- 網頁版專用的處理（`#ifdef H5`）。

### 必須照舊

1. **文字逐字照搬**。現有提示文字一律不能改（管理者 2026-10-18）。只有新加的提示（例如找卡邊時的「可以拍了」）才寫新文字，新文字先給管理者確認。
2. **批文卡外觀、翻轉和上傳流程照舊**（AGENTS.md）。Flutter 版逐像素對照網頁版，管理者確認。
3. **兩款仿真車牌**（內地、香港、澳門）的比例和字形照舊。
4. **UI 一比一照舊**（見下文）。
5. **彈窗**一律用自己的確認框和選單組件，樣子和行為與現在的 Wot 版一致，不用系統原生對話框。
6. **用戶升級**：iOS 用同一個 Bundle ID `com.masterappinc.dualplate`；Android 用同一個包名和同一把正式金鑰（`android/signing/`）。現有用戶直接升級，但要重新登入一次（舊的登入資料存在 DCloud 的儲存，讀不到）。

### UI 一比一照舊（管理者 2026-11-15）

「一比一」的意思：
- **畫面**：版面、顏色、字號、字重、行高、間距、圓角、陰影、圖示和文字都和現在相同；
- **狀態**：載入中、空白、出錯、按鈕不可按、送出中、鍵盤彈出、長文字換行、自管和托管的用語差異，都和現在相同；
- **互動和動畫**：按下效果、頁面切換、彈窗出入、批文卡翻轉、印章、啟動動畫、返回鍵和右滑返回的行為，都和現在相同。

**移植期間不做任何改良**：發現現有畫面的問題，記入本文件第七節，不在 Flutter 版自行修正；要改由管理者決定，兩邊一起改。

**比較的基準是目前 `main` 的 `mobile/` 打包成的 App**，不是 App Store 上的 1.0.0（1.0.0 較舊）。

現在的畫面幾乎全是自寫的樣式，Wot 只用在少數組件。Flutter 版逐項照搬，**不用 Material 或 Cupertino 的預設外觀**：

| 現在的樣式來源 | Flutter 版做法 |
|---|---|
| `mobile/src/App.vue` 的變量和通用類別（`.page`、`.card`、`.list-card`／`.list-title`／`.list-sub`／`.list-note`、`.section-head`／`.section-title`、`.intro`、`.kicker`、`.pill` 及 amber／gray／red／blue、`.note-*`、`.warn-card`、`.chips`／`.chip`、`.segmented`／`.seg`、`.primary`／`.secondary`／`.btn-sm`／`.btn-line`／`.danger`、`.field`／`.field-label`、`.kv`、`.empty`、`.guilloche`、`.ticket-rule` 等） | 顏色、字號、間距、圓角、陰影抄成一個 token 檔（`app/lib/ui/tokens.dart`）；每個通用類別對應一個同名組件（例如 `.list-card` → `ListCard`），數值逐項照抄 |
| 各頁和各組件自己的樣式（`<style scoped>`） | 逐頁照抄數值，不重新設計 |
| 頂部導航列：`#F7F6F1` 底、黑字、標題置中；頁面底色 `#F7F6F1` | 自製導航列，不用 Material AppBar（沒有陰影、不靠左） |
| 底部分頁：白底，文字 `#85918A`，選中 `#0F5C4A`，圖示用 `static/` 的 `home`／`vehicle`／`company`／`me` 的 `-normal`／`-selected` 兩款 | 自製底部分頁，用同一批圖示檔 |
| Wot 組件：`wd-message-box`（13 處）、`wd-action-sheet`（5）、`wd-radio`／`wd-radio-group`、`wd-checkbox`、`wd-signature` | 自製同樣外觀和動畫的組件，按現在 App 的截圖對照 |
| 圖示和圖片：`static/` 的 svg、png（批文卡底圖、M 雲、WhatsApp、微信、鈴等） | 直接用同一批檔案 |
| 字型：`PingFang TC`／`Noto Sans TC`；車牌用 Arial；批文卡用宋體 | 同上（第三節「字型」） |

另外：
- 關掉 Material 的按下水波紋，改用現在 App 按下時的效果；
- 頁面切換動畫和現在 App 一樣，從右邊滑入；
- 只有系統畫的部分可以不同：狀態列、系統權限框、系統相片選擇器、系統相機頁。
- 新組件登記在 `docs/design-system.md` 新增的「客戶端（Flutter）」一節，頁面內不可自寫顏色、字號、圓角、陰影。

**怎樣核對**：每一頁都和**現有 App** 同一頁比較，不是和網頁版比較。
- 在同一尺寸、同一個測試帳號下截圖：iOS 現有 App 用 iPhone 16 Pro Max（iOS 18.4，按現有方法裝目前代碼；本機只有這台 18.4 模擬器），Flutter 版用同尺寸的 iPhone 17 Pro Max；Android 用 `android/emu-run.sh` 打包的目前代碼。
- 每頁要截的狀態：正常、載入中、空白、出錯；有自管／托管差別的頁面兩種都截；彈窗、選單、鍵盤彈出各截一張。
- 動畫和互動用錄影並排比較（批文卡翻轉、印章、啟動、頁面切換、彈窗）。
- 兩張並排，再疊在一起比較，差異逐項列出，修到一致。
- 按 `docs/visual-qa-checklist.md` 逐頁回答 A–H 各項。
- 給管理者確認的材料包括：並排圖、差異清單、A–H 結果。

## 三、技術選擇

| 項目 | 選擇 | 原因 |
|---|---|---|
| 位置 | 倉庫根目錄新建 `app/`（Flutter 專案，內含它自己的 `ios/`、`android/`） | 與 `mobile/` 並列；舊的 DCloud 專案 `android/`、`ios/` 到階段 6 才移除 |
| 版本 | Flutter 3.47.4（本機已安裝）、Dart 3.13 | 鎖定版本，CI 用同一版 |
| 頁面跳轉 | `go_router` | 官方維護；底部分頁和返回鍵行為與現在一致 |
| 狀態 | Flutter 自帶的 `ChangeNotifier` | 頁面簡單，不加框架 |
| 網絡 | `http` | 只有 JSON 和上傳圖片 |
| 登入資料 | `flutter_secure_storage`（存 token）、`shared_preferences`（首頁緩存等） | token 放在 Keychain／Keystore |
| 相機 | `camera`（官方） | Android 用 CameraX，不需要 Google 服務 |
| 選相片 | `image_picker`（官方） | — |
| 圖片裁切 | `image`（純 Dart） | 截出固定 2274×1445 JPEG |
| 權限 | `permission_handler` | Android 申請權限前先顯示用途說明（內地要求） |
| 即時找卡邊 | 先把伺服器 `api/src/card-face.js` 的找邊方法（背景色差，約 85 行）改寫成 Dart，在低解像度預覽畫面上跑 | 不加 OpenCV（安裝包會大幾十 MB），也不依賴 Google ML Kit（內地手機沒有 Google 服務）。階段 2 實測不夠用，才再考慮 `opencv_dart` |
| Android 更新 | 自寫一個安裝 APK 的原生通道（Kotlin，約 50 行） | 不加第三方套件 |
| 字型 | 先用系統字型並指定 `zh_Hant_HK`；批文卡要宋體，Android 很多手機沒有，所以只打包批文卡用的宋體子集 | 階段 1、2實測字形，不對才再打包其他字型 |

**新增依賴**：AGENTS.md 規定不新增 npm 依賴；Flutter 是新專案，上表的套件要管理者批准。全部是 Flutter 官方或廣泛使用的套件，都不依賴 Google 服務。

## 四、分階段（共六階段）

### 全部階段一覽

| 階段 | 內容 | 完成標準 | 估計 | 狀態 |
|---|---|---|---|---|
| 1 | 骨架和登入 | 組件樣板和登入頁與現有 App 一比一；iOS、Android 都能登入，四個分頁正常 | 約 1 週 | 進行中，2026-11-15 暫停（見第九節） |
| 2 | 掃描批文卡和牌照詳情（關卡） | 同一批實卡，Flutter 版讀對的欄數不低於現有 App；管理者決定繼續 | 約 1 週 | 未開始 |
| 3 | 其餘頁面（3a–3d 四批） | 第八節清單的頁面和組件全部一比一，三種帳號走過 | 2–3 週 | 未開始 |
| 4 | App 專用功能 | 啟動畫面、首頁緩存、App 內更新、條款同意框、返回鍵全部和現在一樣 | 3–4 天 | 未開始 |
| 5 | 發布 | iOS 1.1.0 通過審核上架；Android 新 APK 放上網站；真機從舊版升級成功 | 約 1 週 | 未開始 |
| 6 | 清理 | `mobile/` 不再有 App 專用代碼；舊 DCloud 專案移除 | 1–2 天（上線穩定約兩週後） | 未開始 |

**甚麼時候算「代替了 uni-app」**：
- **階段 5 完成**：用戶手上的 iOS、Android App 已經是 Flutter 版，uni-app 不再用在 App 上。
- **階段 6 完成**：倉庫裏不再有 uni-app 的 App 代碼和 DCloud 專案，替換才算全部完成。
- 由開工到全部完成約 6–7 週（不含階段 6 前等待穩定的兩週）。
- 以後 `mobile/`（uni-app）只負責網頁版和微信小程序。

### 每階段的做法

每一階段都照以下做法，才提交（不推送）：

- 在本機做完，跑 `flutter analyze` 和 `flutter test`；
- 在 iOS 模擬器和 Android 模擬器各截圖（Android 寫一個與 `android/emu-run.sh` 同樣做法的 `app/run.sh`，每次改動只跑一次）；
- 和**現有 App** 同一頁並排、疊圖核對（第二節「怎樣核對」），連同差異清單給管理者確認。

Flutter 版在階段 5 發布之前，不影響現有 App、網頁版和小程序。

### 階段 1：骨架和登入（約 1 週）

- 建立 `app/`：token 檔（數值全部從 `mobile/src/App.vue` 和各組件樣式照抄）。
- 基礎組件，全部按現有樣式：
  - `App.vue` 各通用類別的對應組件；
  - 導航列、底部分頁；
  - 確認框和選單（對應 `wd-message-box`、`wd-action-sheet` 和 `choice.js`）、單選、勾選、提示；
  - `DueDate`、`PlateChip`、三款仿真車牌、`StampMark`。
- 先做一頁「組件樣板」，把每個組件和現有 App 對照，管理者確認後才用來做頁面。
- API：連 `https://dualplate.masterappinc.com`，處理登入狀態和 401（對應 `lib/api.js`）。
- 用語工具：自管／托管用語、金額、日期、狀態顏色，逐條對應 `lib/api.js`，並寫單元測試。
- 底部四個分頁的外殼（先放空頁）和登入頁。
- **驗收**：
  - 組件樣板和登入頁與現有 App 一比一：並排、疊圖看不出分別，差異清單為空；
  - 在 iOS、Android 模擬器登入測試帳號，四個分頁正常；
  - 繁體字形正確。

#### 階段 1 分四批（管理者 2026-11-15 同意）

| 批次 | 內容 | 做完給管理者看 | 依賴 |
|---|---|---|---|
| 1a 通用組件和彈窗 | 外觀數值、`App.vue` 通用類別、確認框、提示框、底部選單；補做單選、勾選、提示（toast）；寫 `app/run.sh`（Android） | 樣板頁在 iOS、Android 模擬器的截圖，彈窗逐個點開 | 無 |
| 1b 業務小組件 | 內地、香港、澳門三款仿真車牌，`PlateChip`、`DueDate`、`StampMark` | 樣板頁截圖，和現有 App 牌照頁上的同一組件並排、疊圖 | 只用已提交的 `tokens.dart`、`base.dart` |
| 1c 外殼 | 頂部導航列、底部四個分頁（內容先空）、從右滑入的頁面切換、返回鍵先關彈窗（`back-close.js`） | 兩個平台的截圖，切換和返回行為錄影 | 只用已提交的 `tokens.dart`、`base.dart`、`dialogs.dart` |
| 1d 登入 | API 連線和 401 處理、自管／托管用語等工具（附單元測試）、登入頁 | 登入頁和現有 App 並排、疊圖，附差異清單；兩個平台都用測試帳號登入成功 | 1a–1c 合併後才開始 |

做法：
- 1a、1b、1c 同時開工，各自一個 session、一條分支（各自的 worktree）。完成後由負責人逐批驗收，合併到 `main`，再刪除分支和 worktree。1d 在三批合併後從 `main` 開工，同樣做法。
- 為了合併時少衝突，各批只改自己的檔案：新組件放新檔案；樣板頁每批一個獨立區塊檔（例如 `sample_plates.dart`），`sample.dart` 只加一行引用。本計劃文件、`app/README.md`、`docs/design-system.md` 由負責人在合併時統一更新，各批把要登記的內容寫在報告裏。
- 模擬器分配（同時開工時不可共用，否則互相蓋掉安裝）：
  - iOS 現有 App 的對照基準在 iPhone 16 Pro Max（iOS 18.4，`78302077`），**Flutter 版不可裝在這台**（Bundle ID 相同，會蓋掉現有 App）。
  - Flutter 版：1a 用 iPhone 17 Pro（iOS 26.0）；1b 用 iPhone 17 Pro Max（iOS 26.0，畫面尺寸和 16 Pro Max 相同，用來並排對照）；1c 用 iPhone 17（iOS 26.0）。
  - Android 這一輪只有 1a 運行（寫 `app/run.sh` 並跑一次）。1b、1c 的 Android 截圖由負責人在合併後統一跑一次。

### 階段 2：掃描批文卡和牌照詳情（約 1 週，關卡）

- `CardCapture`：
  - 全螢幕原生相機，對準框和現在一樣；
  - 「從相冊選」後可以雙指縮放、拖動對框；
  - 截出框外每邊多 6% 的 2274×1445 JPEG，交給現有接口，伺服器照舊找邊、辨識和保存；
  - Android 申請權限前先顯示用途說明，文字照搬 `pick-image.js`。
- 拍卡畫面的對準框、四角、提示文字位置、按鈕和「① 正面 ② 背面」與現在一樣。
- 即時找卡邊：預覽畫面上顯示卡的四邊是否對齊，標示樣式先給管理者確認；對齊而且畫面夠清楚時，提示「可以拍了」。**是否加自動拍照，由管理者決定**（第五節第 2 點）。快門按鈕照舊保留。
- 牌照詳情頁（`plate-detail`，394 行，最複雜的一頁）：`ApprovalCard` 顯示和翻轉、上傳並讀取、只保存正本、手動修改、原件核對。
- **驗收（決定是否繼續）**：
  1. 用管理者手上的實卡（`api/test/fixtures/cards/` 只可在測試中讀取，不可印出或複製，所以不用）；
  2. 在同樣光線、同樣手機上，現有 App 和 Flutter 版各拍一次；
  3. 比較每張卡讀對幾欄、操作要幾步、由按下到看到結果要多久。
  - Flutter 版讀對的欄數**不低於**現有 App，才進入階段 3。
  - 結果和數字寫進本文件，由管理者決定是否繼續。

### 階段 3：其餘頁面（約 2–3 週）

分四批，每批做完給管理者看：

- **3a 首頁和瀏覽**：index、vehicles、companies、deadlines、me、notifications、AdvisorCard、ContactCard、WelcomeGuide。
- **3b 牌照和辦理**：plate-create、plate-delete、self-change、requests、request-detail、scope。
- **3c 出租和帳目**：rental、rental-new（含 SignaturePad 手寫簽名）、billing、reports、messages、profile、company-new、CompanyEditor。
- **3d 帳號**：signup、terms、close-account。註銷會按 `docs/tasks/account-closure-retention-plan.md` 的進度決定送不送 `retain: true`。

每一頁都要用三種帳號走一遍：空白的自管客戶、有資料的自管客戶、托管客戶（管理者 10-19 的要求）。

### 階段 4：App 專用功能（3–4 天）

- **啟動畫面**：
  - iOS：雙牌合位動畫，深翠綠 `#0B3B30`，只有兩塊牌和 M，不加圖示底板，至少 2 秒；原生啟動圖要和動畫第一幀相同。
  - Android：只有一個靜態畫面，翠綠底加白色 M 雲（管理者 11-15 的決定）。
- **首頁緩存**：按帳號保存首頁資料，下次打開先顯示緩存，不等網絡。
- **Android App 內更新**：讀 `/download/version.json`，提示和必須更新的規則照搬 `lib/app-update.js`。
- **首次打開的條款同意框**：文字照搬 `androidPrivacy.json`。iOS 現在沒有這個框，維持不變。
- Android 返回鍵和底部導航條顏色。

### 階段 5：發布（約 1 週）

- **iOS**：
  - 改寫 `.github/workflows/testflight.yml` 和 `ios/testflight.sh`，改用 `flutter build ipa`，觸發條件改為 `app/` 有改動；
  - 簽名沿用 `ios/signing/` 的證書和描述檔（2027-11-03 到期）；
  - 版本號 1.1.0，送 TestFlight，再送 App Store 審核；
  - 審核備註刪去「SDK 會連 DCloud」那一句，其餘不變。
- **Android**：
  - 用 `android/signing/` 同一把金鑰簽名，版本編號大於網站上現有的版本；
  - APK 放到網站下載位置，更新 `version.json`；
  - 舊版 App 會透過 App 內更新提示用戶升級。
- **驗收**：
  - 真機從舊版升級到新版：要求重新登入，之後一切正常；
  - Android 11 和 Android 17 各試一次，以前 Android 11 沒有測過。
- **發布前要管理者批准**。

### 階段 6：清理（兩個平台新版都上線、穩定約兩週後）

- 刪除 `mobile/` 裏 App 專用的代碼：`#ifdef APP-PLUS` 共 35 處，以及 `lib/launch.js`、`lib/nav-bar.js`、`lib/app-update.js`、`pick-image.js` 的 Android 部分、`pages/launch`、`pages/card-capture`、`androidPrivacy.json`。
- 刪除 `@dcloudio/uni-app-plus` 依賴。
- 移除舊的 DCloud 專案 `android/`、`ios/`。簽名檔先搬到 `app/` 用的位置，確認新版能簽名後才刪。
- 更新 `AGENTS.md`：受保護檔案加入 Flutter 版的批文卡和車牌組件；寫明客戶端改動以後要做兩份（uni-app 一份、Flutter 一份）。
- 這一步要管理者批准才做。

**合計約 6–7 週**（推算，未實測；一比一核對每頁多個狀態和錄影，比原先估計多約 1 週；階段 2 完成後會按實際速度修正）。

## 五、管理者決定（2026-11-15 全部按建議批准）

管理者答「全部按建議」：新增套件批准；卡對齊且清楚時自動拍、快門保留；移植期間 `mobile/` 只修錯；骨架、組件、掃描和批文卡由負責人親自做，其餘頁面交 Codex、負責人驗收；暫不做鴻蒙。以下保留原來的建議內容。

1. **批准新增的 Flutter 套件**（第三節表內）。
2. **掃描時是否自動拍照**：
   - 建議：卡對齊而且清楚時自動拍，快門按鈕保留。這是銀行和證件類 App 常見的做法。
   - 否則只顯示「可以拍了」，由用戶自己按快門。
3. **移植期間客戶端新功能怎樣處理**：
   - 建議：期間 `mobile/` 只修錯，不加新功能；
   - 必須加的功能，同時記入本計劃，Flutter 版一併做。
4. **誰來實作**：
   - 建議：階段 1 骨架和組件、階段 2 掃描和批文卡由負責人（我）親自做，因為客戶端畫面屬負責人負責；
   - 階段 3 的頁面可以交給 Codex 實作、我驗收。
5. **鴻蒙**：華為純血鴻蒙新機裝不了 APK，Flutter 官方也不支援鴻蒙。建議暫不做，這些用戶用小程序或網頁版。

## 六、已知風險

| 風險 | 處理 |
|---|---|
| 升級後要重新登入 | 接受。在更新說明和登入頁寫明 |
| 裁切尺寸和位置差一兩個像素，辨識分數就會變 | 階段 2 用同一批樣本比較，不低於現在才繼續 |
| 部分 Android 手機用簡體或日文字形顯示中文 | 指定 `zh_Hant_HK`；階段 1 在模擬器和真機檢查 |
| 批文卡要用宋體，Android 很多手機沒有 | 只打包批文卡用的宋體子集 |
| Flutter 版看起來或用起來和現在不一樣（例如 Material 預設的水波紋、陰影、字距、行高、滾動回彈） | 不用 Material／Cupertino 外觀；token 照抄；逐頁、逐狀態和現有 App 疊圖、錄影核對，差異清單為空才算完成 |
| 兩邊字型渲染不同，字距和換行位置會有一兩個像素的差 | 同一系統字型、同一行高；差異列出給管理者判斷，不自行調整版面去遷就 |
| 兩份客戶端的文字和行為慢慢出現差別 | 業務規則放在伺服器；用語工具集中在一個檔案並寫測試；改動時兩邊一起改 |
| 新版 Xcode 推出時，Flutter 可能暫時編譯不了 | CI 鎖定 Xcode 和 Flutter 版本 |
| App Store 審核可能再要求補充資料 | 保留審核帳號和示範資料；錄影和備註沿用上次的做法 |

## 七、移植時發現的現有問題

（移植時發現現有 App 畫面或行為的問題，記在這裏，不在 Flutter 版自行修正，由管理者決定。）

| 日期 | 頁面 | 問題 | 管理者決定 |
|---|---|---|---|

## 八、代替清單（全部打勾才算可以代替）

現有 uni-app App 的每一項功能都列在這裏。「階段」是在哪一階段做；「狀態」做完並一比一核對過才填「完成」。

### 頁面（26 個）

| 頁面 | 名稱 | 階段 | 狀態 |
|---|---|---|---|
| login | 登入 | 1 | 未做 |
| （外殼） | 底部四個分頁、頂部導航列 | 1 | 未做 |
| plate-detail | 牌照詳情 | 2 | 未做 |
| card-capture | 拍批文卡 | 2 | 未做 |
| index | 首頁 | 3a | 未做 |
| vehicles | 我的牌照 | 3a | 未做 |
| companies | 我的公司 | 3a | 未做 |
| deadlines | 到期提醒 | 3a | 未做 |
| me | 我的 | 3a | 未做 |
| notifications | 通知 | 3a | 未做 |
| plate-create | 新增牌照 | 3b | 未做 |
| plate-delete | 刪除牌照 | 3b | 未做 |
| self-change | 自行辦理更新 | 3b | 未做 |
| requests | 申請辦理 | 3b | 未做 |
| request-detail | 辦理進度 | 3b | 未做 |
| scope | 委託內容 | 3b | 未做 |
| rental | 出租 | 3c | 未做 |
| rental-new | 新增出租 | 3c | 未做 |
| billing | 帳單 | 3c | 未做 |
| reports | 月報 | 3c | 未做 |
| messages | 聯絡我們 | 3c | 未做 |
| profile | 我的資料 | 3c | 未做 |
| company-new | 新增公司 | 3c | 未做 |
| signup | 申請使用 | 3d | 未做 |
| terms | 服務條款及私隱聲明 | 3d | 未做 |
| close-account | 註銷帳號 | 3d | 未做 |
| launch | 啟動畫面 | 4 | 未做 |

### 組件

| 組件 | 階段 | 狀態 |
|---|---|---|
| `App.vue` 通用樣式類別（列表卡、標籤、按鈕、輸入框等） | 1 | 已寫，未和現有 App 對照 |
| 確認框、提示框、底部選單（`choice.js`） | 1 | 已寫，未和現有 App 對照 |
| 單選、勾選（`wd-radio`、`wd-checkbox`） | 1 | 未做 |
| 提示（toast） | 1 | 未做 |
| MainlandPlate、HongKongPlate、MacauPlate | 1 | 未做 |
| PlateChip、DueDate、StampMark | 1 | 未做 |
| ApprovalCard（顯示、翻轉） | 2 | 未做 |
| CardCapture（原生相機、對準框、找卡邊、自動拍） | 2 | 未做 |
| AdvisorCard、ContactCard、WelcomeGuide | 3a | 未做 |
| CompanyEditor、SignaturePad | 3c | 未做 |

### 共用邏輯和 App 專用功能

| 項目 | 對應現有檔案 | 階段 | 狀態 |
|---|---|---|---|
| 登入狀態、401 處理、API | `lib/api.js` | 1 | 未做 |
| 自管／托管用語、金額、日期、狀態顏色（附單元測試） | `lib/api.js` | 1 | 未做 |
| 返回鍵先關彈窗 | `lib/back-close.js` | 1 | 未做 |
| 相機和相片權限、用途說明卡 | `lib/pick-image.js` | 2 | 未做 |
| 口岸圖 | `lib/ports-canvas.js` | 3 | 未做 |
| iOS 雙牌合位啟動動畫、Android 靜態 M 雲 | `pages/launch`、`lib/launch.js` | 4 | 未做 |
| 首頁緩存 | `homeCache` | 4 | 未做 |
| Android App 內更新 | `lib/app-update.js` | 4 | 未做 |
| 首次打開條款同意框 | `androidPrivacy.json` | 4 | 未做 |
| Android 底部導航條顏色 | `lib/nav-bar.js` | 4 | 未做 |
| iOS TestFlight 自動上傳 | `.github/workflows/testflight.yml` | 5 | 未做 |
| Android 簽名、APK 下載、`version.json` | `android/`、`deploy/web/download` | 5 | 未做 |

不搬：微信登入和綁定（只在小程序）、網頁版專用處理（`#ifdef H5`）。

## 九、進度記錄

每做完一部分都在這裏加一筆：日期、做了甚麼、檢查結果、未做的、暫停或改動的原因。

### 2026-11-15（階段 1，按管理者指示暫停）

已完成（已提交為 `524f365`，未推送）：
- 建立 `app/`：iOS Bundle ID、Android 包名都是 `com.masterappinc.dualplate`；加入 `go_router`、`http`、`flutter_secure_storage`、`shared_preferences`，以及 Flutter 自帶的 `flutter_localizations`（顯示繁體用）。
- `app/lib/ui/tokens.dart`：顏色、字號、圓角、陰影、控件高度、動畫，數值抄自 `mobile/src/App.vue`。
- `app/lib/ui/base.dart`：`App.vue` 通用樣式類別的對應組件。
- `app/lib/ui/dialogs.dart`：確認框、提示框、底部選單，數值照 Wot 原始碼和 `App.vue` 的覆寫。
- `app/lib/ui/sample.dart`：組件樣板頁。

檢查結果：
- `flutter analyze`：沒有問題。
- `flutter test`：3 個測試全部通過。
- iPhone 17 Pro 模擬器打開樣板頁，看過上半部：繁體字形正確，沒有 Material 外觀。
- 修正了兩個執行時才出現的錯誤：缺少繁體語系本地化設定；輸入框需要外層容器。

未做：
- 單選、勾選、提示、三款仿真車牌、PlateChip、DueDate、StampMark、導航列、底部分頁、API、用語工具、登入頁。
- 樣板頁下半部和彈窗還沒在模擬器上逐個點開看；Android 未運行。
- 現有 App 的對照截圖和一比一核對未做。現有 App 沒有組件樣板頁，繼續時改用登入頁做第一次對照。
