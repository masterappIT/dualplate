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
| 1 | 骨架和登入 | 組件樣板和登入頁與現有 App 一比一；iOS、Android 都能登入，四個分頁正常 | 約 1 週 | 收尾（管理者 2026-11-17 決定）；1f 未做，留待讀卡調整時一併處理 |
| 2 | 掃描批文卡和牌照詳情（關卡） | 同一批實卡，Flutter 版讀對的欄數不低於現有 App；管理者決定繼續 | 約 1 週 | 收尾（管理者 2026-11-17 決定）：2a–2c 已合併；2d 真機讀卡未過，問題見第九節；Flutter 其餘部分全部完成後再回來調整讀卡 |
| 3 | 其餘頁面（3-0 預備、3a–3d 四批、3e 收尾） | 第八節清單的頁面和組件全部一比一，三種帳號走過 | 2–3 週 | 完成：管理者 2026-11-21 批准，逐批做；3-0 完成（1a49ad9）；3a 已合併（331da7c）；3b 已合併（2c2cabd）；3c 已合併（0d7c356）；3d 已合併（a691b0c）；3e 收尾完成（2026-11-22），22 頁全部搬完；待決定事項見第七節 |
| 4 | App 專用功能 | 啟動畫面、首頁緩存、App 內更新、條款同意框、返回鍵全部和現在一樣 | 3–4 天 | 完成：flutter-4 一次做完五項並補斷網檢查，已合併 |
| 5 | 發布 | iOS 1.1.0 通過審核上架；Android 新 APK 放上網站；真機從舊版升級成功 | 約 1 週 | 進行中：5b 讀卡收尾（管理者 2026-11-23「目前可以接受」）；5a 已推送（TestFlight 打包 Flutter 版；APK 未發佈）；5c、5d 未開始 |
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
| 1e 彈窗遮罩範圍（2026-11-15 加） | 1c 錄影發現：現有 App 開確認框時，狀態列、導航列、底部分頁不變暗，只有頁面內容變暗；Flutter 版整個畫面變暗。改成一樣；底部選單的位置（有分頁時在分頁列之上還是之下）和彈窗開着時按導航列、分頁的反應，先在現有 App 核實再照做。另複核全局字型修正後的導航列標題和分頁文字位置 | 現有 App 和 Flutter 版的確認框、底部選單並排截圖 | 1a–1c 合併後，與 1d 同時做 |
| 1f 階段 1 收尾（2026-11-15 加） | 補齊驗收：通用樣式、單選、勾選、提示和現有 App 對照；登入頁未對照的三個狀態和鍵盤工具列；最終版本在 Android 跑一次；查清字形差異是否系統字體造成；修正對照發現的差異；組件樣板和差異清單交管理者確認。**管理者決定：等階段 2 做完，和階段 2 一起收尾驗收**，現在不開模擬器 | 組件樣板和登入頁的並排圖、差異清單 | 階段 2 完成後 |

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

#### 階段 2 分四批（管理者 2026-11-16 同意，2a、2c 同時開工）

| 批次 | 內容 | 做完給管理者看 | 依賴 |
|---|---|---|---|
| 2a 拍卡和裁切 | 一比一移植 `CardCapture.vue`、`lib/card-stage.js`、`pages/card-capture`：全螢幕鏡頭預覽、對準框、四角、提示、「① 正面 ② 背面」、快門；開不了鏡頭時的「從相冊選／拍照」；選相片後雙指縮放、拖動、重選、確認；截出 2274×1445 JPEG；Android 權限用途說明和拒絕提示（`pick-image.js`） | 拍卡畫面各狀態和現有 App 並排截圖；測試證明截出的圖尺寸、位置和伺服器 `card-face.js` 一致 | 無 |
| 2b 即時找卡邊和自動拍 | 把 `api/src/card-face.js` 找邊方法改寫成 Dart，在預覽上顯示四邊是否對齊；對齊而且清楚時自動拍，快門保留 | 四邊標示樣式先給管理者確認，再交錄影 | 2a 合併後 |
| 2c 牌照詳情頁 | `plate-detail` 全頁：`ApprovalCard` 顯示和翻轉、上傳哪一面、只保存正本／上傳並讀取、手動修改、原件核對、查看正本；批文卡宋體子集 | 三種帳號的詳情頁和現有 App 並排截圖，彈窗逐個點開 | 無；拍卡只經 `lib/business/card_capture.dart` 的 `openCardCapture` |
| 2d 收尾驗收 | 實卡在真手機比較現有 App 和 Flutter 版（讀對幾欄、步數、時間）；連同 1f 一起做 | 比較數字和差異清單，管理者決定是否進入階段 3 | 2a–2c 合併；管理者拿實卡和真手機 |

做法同階段 1：每批一個 session、一條分支（各自 worktree），負責人驗收後合併到 `main`。
- 共用接口：`app/lib/business/card_capture.dart`（負責人已放佔位）。2a 實作它；2c 只呼叫，不改。
- 模擬器分配：2a 用 iPhone 17 Pro（iOS 26.0，`B5D9F7C6`）和 Android 模擬器；2c 用 iPhone 17 Pro Max（iOS 26.0，`98D84492`）。2c 的 Android 截圖由負責人合併後統一跑。現有 App 基準仍在 iPhone 16 Pro Max（`78302077`），Flutter 版不可裝在這台。
- iOS 模擬器沒有鏡頭：2a 在 iOS 模擬器只能核對開不了鏡頭和相冊兩條路；鏡頭預覽在 Android 模擬器（虛擬鏡頭）看，真鏡頭到 2d 在真手機核對。
- 2d 真手機（管理者 2026-11-16 決定）：用 iPhone。測試期間 Flutter 版臨時改用 Bundle ID `com.masterappinc.dualplate.trial`，和現有 App 同時裝在同一部 iPhone 上比較；只在 2d 的測試打包時改，不提交到 `main` 的正式設定。階段 5 發布一定用原來的 `com.masterappinc.dualplate`，舊版用戶才能直接升級。臨時 ID 要在公司開發者帳號（團隊 `YU6GT6HQJ8`）登記才能裝上真機，2d 開始前處理。

### 階段 3：其餘頁面（約 2–3 週）

搬第八節清單裏標「3a–3d」的 22 頁和 4 個組件（2026-11-21 按清單數過是 22 頁，原寫 20 頁有誤）（現有約 2,300 行）。每一頁都要用三種帳號走一遍：空白的自管客戶、有資料的自管客戶、托管客戶（管理者 10-19 的要求）。

#### 階段 3 分批（負責人 2026-11-17 擬定；管理者 2026-11-21 批准，但**改為逐批做**）

管理者 2026-11-21 決定：下列三點按建議批准；另指示「做完 3a 才能開下一個 session」，所以第 2 點改為逐批：3a → 3b → 3c → 3d，前一批驗收合併後才開下一批。對照模擬器只需一份（每批輪流用同一份）。

| 批次 | 內容 | 現有行數 | 做完給管理者看 | 依賴 |
|---|---|---|---|---|
| 3-0 預備（負責人做，**2026-11-21 完成**） | ① 22 頁各有佔位頁檔 `app/lib/pages/<頁>/<頁>_page.dart`，路由表已接好（查詢參數原樣交給頁面），各批只替換自己的頁面檔；② `app/tool/local_api.sh <批次>`：本機伺服器，每批一份資料（`/private/tmp/dp3/<批次>/`），三種帳號；③ 對照用模擬器「iPhone 16 Pro Max 對照本機」（`361F2754`）裝了連本機的現有 App，`app/tool/legacy_login.sh <電郵>` 直接登入 | — | 佔位路由提交；對照用模擬器能用三種帳號登入 | 無 |
| 3a 首頁和瀏覽 | index、vehicles、companies、deadlines、me、notifications；AdvisorCard、WelcomeGuide（ContactCard 已在 1d 做） | 約 560 | 四個分頁和兩個子頁，三種帳號並排截圖 | 3-0 |
| 3b 牌照和辦理 | plate-create、plate-delete、self-change、requests、request-detail、scope；另把 2c 遺留的車輛證件選相片接上（`doc_photo.dart` 改用 `pickPhoto`，照 `cardPhoto()` 壓縮） | 約 700 | 各頁三種帳號並排截圖，寫入流程逐步截圖，彈窗逐個點開 | 3-0 |
| 3c 出租和帳目 | rental、rental-new（含 SignaturePad 手寫簽名）、billing、reports、messages、profile、company-new、CompanyEditor | 約 800 | 同上；手寫簽名另外錄影並排 | 3-0 |
| 3d 帳號 | signup、terms、close-account | 約 230 | 同上 | 3a 合併後（從登入頁和「我的」進入） |
| 3e 階段 3 收尾（負責人做） | Android 模擬器統一截圖（只跑一次）；三種帳號從首頁沿真正入口走完 22 頁；更新第八節 | — | 並排圖、差異清單、A–H 結果 | 3a–3d 合併 |

做法：
- 同階段 1、2：每批一個 session、一條分支（各自 worktree），負責人驗收後合併到 `main`；合併後不推送，等管理者指示。
- 逐批做（管理者 2026-11-21：「做完 3a 才能開下一個 session」）：3a 驗收合併後才開 3b，3b 合併後開 3c，3c 合併後開 3d。3e 再從真正入口走完全部頁面。
  - 同日管理者再指示「可以開3b」：3b 在 3a 未完成時開工。3b 用端口 4131、新建的 17 Pro Max「3b」和 16 Pro Max 複製品「對照本機 3b」，不碰 3a 的伺服器和模擬器。之後每批驗收合併後，仍等管理者指令才開下一批。
- 各批只改自己的檔案：新頁面、新組件放新檔案；`tokens.dart` 只在末尾加；本計劃文件、`app/README.md`、`docs/design-system.md` 由負責人合併時統一更新，各批把要登記的內容寫在報告裏。
- 每批驗收：`flutter analyze` 無問題、`flutter test` 全部通過（沒有卡樣本時跳過的除外）；每頁正常、載入中、空白、出錯四個狀態，有自管／托管差別的兩種都截；彈窗、選單、鍵盤彈出逐個點開；和現有 App 並排、疊圖；按 `docs/visual-qa-checklist.md` 回答 A–H。發現現有 App 的問題記入第七節，Flutter 版照舊。
- 本機測試資料：各批用自己那組帳號，不改別批的資料；不在正式後端寫入。Android 截圖由負責人在 3e 統一跑。
- 1f 和讀卡照管理者 2026-11-17 決定，留到 Flutter 其餘部分全部完成後處理，不在階段 3 做。

為甚麼要讓現有 App 改連本機：2c 時現有 App 連正式伺服器、只登入審查帳號，寫入流程和三種帳號都沒法在現有 App 對照。現有 App 的伺服器地址在打包時決定（`mobile/src/lib/api.js` 讀 `VITE_API_BASE_URL`），所以可以另外打包一個連本機伺服器的版本，兩邊用同一批帳號、同一份資料比較。

批准結果（管理者 2026-11-21「三點都按建議批准」；第 2 點其後改為逐批）：
1. **複製對照模擬器**（負責人建議批准）：把 iPhone 16 Pro Max（iOS 18.4，`78302077`）複製三份，給 3a、3b、3c 各用一份，裝上連本機伺服器的現有 App；原本那台保持登入審查帳號，不動。不批准的話只能在正式伺服器對照只讀頁面，寫入流程不對照（同 2c）。
2. ~~三批同時開工~~：管理者其後指示逐批做，約多一週。
3. **註銷頁**：「停用 30 天後刪除」（`docs/tasks/account-closure-retention-plan.md`）仍待批准，3d 先照現在的行為搬（不送 `retain: true`）；該計劃實施時網頁版和 Flutter 版一起改。

模擬器分配（逐批做，各批輪流用同一組）：Flutter 版用 iPhone 17 Pro Max（iOS 26.0，`98D84492`，畫面尺寸和 16 Pro Max 相同）；現有 App 用 16 Pro Max 的複製品（3-0 建立）。Flutter 版不可裝在 `78302077` 或它的複製品上（Bundle ID 相同，會蓋掉現有 App）。

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
- 更新 `AGENTS.md`：受保護檔案加入 Flutter 版的批文卡和車牌組件。（「客戶端改動要做兩份」已按管理者 2026-11-23 指示提早寫入。）
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
| 2026-11-15 | 多頁（PlateChip） | 沒指定地區、號碼又是空時顯示「待補充」，因「待」是漢字被判為內地牌，顯示黑底白字，而不是中性灰框 | 2026-11-22 照建議：Flutter 版改用中性灰框 |
| 2026-11-15 | 多頁（DueDate） | 收到不是「年-月-日」格式的日期時，顯示綠色的「還有 NaN 天」 | 2026-11-22 照建議：Flutter 版當作還沒有填日期（顯示「待錄入」） |
| 2026-11-15 | 牌照詳情 | 粵澳路線沒有用 MacauPlate，另寫了一款澳門牌，和登入頁的澳門牌樣子不同 | 2026-11-22 照建議：Flutter 版改用 MacauPlate |
| 2026-11-15 | 多頁（鎖定提示框） | 「必須更新」等鎖定提示框開着時，Android 返回鍵照常返回頁面，可以繞過（Flutter 版照舊） | 2026-11-22 照建議：Flutter 版鎖定提示框開着時，返回鍵、返回箭頭、iOS 右滑都不離開 |
| 2026-11-15 | 所有子頁 | 新頁滑入時內容是空白的，滑入完成才顯示（網頁載入造成）。Flutter 版內容即時顯示，**沒有照做**，請管理者確認 | 2026-11-22 照建議：保留 Flutter 版（內容即時顯示） |
| 2026-11-15 | 登入 | 電郵欄會把第一個字母自動變大寫（Flutter 版照舊） | 2026-11-22 照建議：Flutter 版不自動大寫、不自動校正，用電郵鍵盤 |
| 2026-11-15 | 登入 | 「登入中」時在密碼欄按鍵盤的「完成」仍會再送一次（`@confirm="login"` 沒有檢查登入中；Flutter 版照舊） | 2026-11-22 照建議：Flutter 版登入中不再送 |
| 2026-11-15 | 登入 | WhatsApp 按鈕在 App 裏只複製連結、提示「請在瀏覽器打開」，沒有打開 WhatsApp（`openLink`；Flutter 版照舊） | 2026-11-22 照建議：Flutter 版直接打開（url_launcher），打不開才複製連結；微信客服連結、出租「用 WhatsApp 傳送」同樣 |
| 2026-11-15 | 登入 | 號碼欄的 8 位上限把空格也算進去（`maxlength`；Flutter 版照舊） | 2026-11-22 照建議：Flutter 版只算數字（內地 11 位同樣） |
| 2026-11-15 | 登入 | 找不到用戶時，畫面顯示原始的程式錯誤文字（按原始碼推斷，未在現有 App 重現；Flutter 版照舊） | 2026-11-22 照建議：Flutter 版顯示「找不到這個帳號，請檢查後再試」 |
| 2026-11-16 | 拍批文卡 | 模擬器上允許使用攝影機後，網頁得到空白鏡頭畫面，頁面停在「拍批文卡」，此時按快門會上傳黑色截圖（未按，以免改資料） | 2026-11-22 照建議：不用改（模擬器加網頁的問題，Flutter 用原生相機）；階段 4 真機再看 |
| 2026-11-16 | 拍批文卡 | 相冊選擇器是 DCloud 自帶的，關閉按鈕的無障礙標籤是簡體「关闭」 | 2026-11-22 照建議：不用改（Flutter 用系統相冊，沒有這問題） |
| 2026-11-16 | 拍批文卡 | 左上 ✕ 現有 App 約 11pt、筆畫粗；Flutter 版約 16pt、筆畫細，認不出網頁用的字型，**未改**，請管理者決定 | 2026-11-22 照建議：Flutter 版改成和現有 App 一樣（自己畫 11pt、線粗 2.2；沒有舊截圖可再量，按當時記下的尺寸） |
| 2026-11-16 | 牌照詳情 | iOS 上批文卡不是宋體：iOS 沒有 Songti SC／STSong，落到 serif（英文數字 Times、中文蘋方）。Flutter 版照舊；打包的宋體子集只在 Android 用 | 2026-11-22 照建議：iOS 也用打包的宋體子集，缺字落到蘋方（和現有 App 的 iOS 樣子不同） |
| 2026-11-16 | 牌照詳情 | 批文卡畫成 377 寬，比卡片內容區寬 3pt（CSS 推不出原因；Flutter 版照 CSS 為 374） | 2026-11-22 照建議：保留 374 |
| 2026-11-16 | 牌照詳情 | 到期項目只有「還沒有填日期」時，上面出現一張約 10pt 高的空白卡（按原始碼推斷，未在現有 App 重現） | 2026-11-22 照建議：Flutter 版不顯示這張卡 |
| 2026-11-16 | 牌照詳情 | 打開時 onLoad、onShow 各載入一次，同一批請求送兩次。Flutter 版只載一次，**沒有照做** | 2026-11-22 照建議：保留 Flutter 版（只載一次） |
| 2026-11-16 | 牌照詳情 | 切換 90 天過關開關時，「今天已過關」按鈕也變成「記錄中」（共用 crossingBusy；Flutter 版照舊） | 2026-11-22 照建議：Flutter 版兩者各自顯示（兩個請求仍不會同時送） |
| 2026-11-16 | 牌照詳情 | 「已過關」印章蓋在提醒開關上（Flutter 版照舊） | 2026-11-22 照建議：Flutter 版印章移到卡片右下角 |
| 2026-11-22 | 出租 | 「上傳 PDF」顯示 JavaScript 錯誤原文 `uni.chooseFile is not a function`（3c 在模擬器截圖證實；Flutter 版照舊） | 2026-11-22 照建議：Flutter 版真的選 PDF（file_picker，最多 3 份）；辦理進度的「選擇 PDF 文件」同樣 |
| 2026-11-22 | 出租 | 已上傳的簽署本是 PDF 時，按「查看」只把整串 data URL 複製到剪貼簿（按原始碼推斷，未在現有 App 試；Flutter 版照舊） | 2026-11-22 照建議：Flutter 版用手機自帶的檢視器打開（open_filex；計劃外多加的套件，url_launcher 打不開本機 PDF） |
| 2026-11-22 | 新增出租 | 結束日期不受起租日限制（同 3b 新到期日的情況；Flutter 版照舊） | 2026-11-22 照建議：Flutter 版結束日期最早只能選起租日（起租日改到結束日期之後時清掉結束日期）；辦理進度的新到期日最早只能選今天 |
| 2026-11-22 | 首頁 | 本機條款未同意時，現有 App 首頁沒有彈出「請先閱讀服務條款」提示，Flutter 版有（3d 發現）。3e 對照原始碼：兩邊都是「每次開 App 只問一次、已發佈且未同意才問」。推斷是 3d 先開 App、後發佈條款，現有 App 那次啟動已問過；未在現有 App 重現 || 2026-11-22 照建議：不算差別，結案 |

## 八、代替清單（全部打勾才算可以代替）

現有 uni-app App 的每一項功能都列在這裏。「階段」是在哪一階段做；「狀態」做完並一比一核對過才填「完成」。

### 頁面（26 個）

| 頁面 | 名稱 | 階段 | 狀態 |
|---|---|---|---|
| login | 登入 | 1 | 已做（1d，iOS 已和現有 App 並排對照）；選內地區號、空白送出、號碼不足 8 位三個狀態未和現有 App 對照；QR 碼放大未做 |
| （外殼） | 底部四個分頁、頂部導航列 | 1 | 完成（1c，已和現有 App 錄影對照） |
| plate-detail | 牌照詳情 | 2 | 已合併，待 2d 核對（車輛證件選相片已在 3b 接上） |
| card-capture | 拍批文卡 | 2 | 已合併，真鏡頭待 2d 核對 |
| index | 首頁 | 3a | 完成（331da7c） |
| vehicles | 我的牌照 | 3a | 完成（331da7c） |
| companies | 我的公司 | 3a | 完成（331da7c） |
| deadlines | 到期提醒 | 3a | 完成（331da7c） |
| me | 我的 | 3a | 完成（331da7c） |
| notifications | 通知 | 3a | 完成（331da7c） |
| plate-create | 新增牌照 | 3b | 完成（2c2cabd） |
| plate-delete | 刪除牌照 | 3b | 完成（2c2cabd） |
| self-change | 自行辦理更新 | 3b | 完成（2c2cabd） |
| requests | 申請辦理 | 3b | 完成（2c2cabd） |
| request-detail | 辦理進度 | 3b | 完成（2c2cabd） |
| scope | 委託內容 | 3b | 完成（2c2cabd） |
| rental | 出租 | 3c | 完成（0d7c356） |
| rental-new | 新增出租 | 3c | 完成（0d7c356） |
| billing | 帳單 | 3c | 完成（0d7c356） |
| reports | 月報 | 3c | 完成（0d7c356） |
| messages | 聯絡我們 | 3c | 完成（0d7c356） |
| profile | 我的資料 | 3c | 完成（0d7c356） |
| company-new | 新增公司 | 3c | 完成（0d7c356） |
| signup | 申請使用 | 3d | 完成（a691b0c） |
| terms | 服務條款及私隱聲明 | 3d | 完成（a691b0c） |
| close-account | 註銷帳號 | 3d | 完成（a691b0c） |
| launch | 啟動畫面 | 4 | 未做 |

### 組件

| 組件 | 階段 | 狀態 |
|---|---|---|
| `App.vue` 通用樣式類別（列表卡、標籤、按鈕、輸入框等） | 1 | 已寫，未和現有 App 對照 |
| 確認框、提示框、底部選單（`choice.js`） | 1 | 完成（1e 修正遮罩範圍和選單外框，已和現有 App 對照） |
| 單選、勾選（`wd-radio`、`wd-checkbox`） | 1 | 已寫（1a），未和現有 App 對照 |
| 提示（toast） | 1 | 已寫（1a），未和現有 App 對照 |
| MainlandPlate、HongKongPlate、MacauPlate | 1 | 完成（1b，已和現有 App 對照） |
| PlateChip、DueDate、StampMark | 1 | 完成（1b，已和現有 App 對照；差異見進度記錄） |
| ApprovalCard（顯示、翻轉） | 2 | 已合併，待 2d 核對 |
| CardCapture（原生相機、對準框、找卡邊、自動拍） | 2 | 已合併（2a、2b）；真 iPhone 對焦和找卡邊未過（2026-11-17），Flutter 其餘部分完成後再改 |
| AdvisorCard、ContactCard、WelcomeGuide | 3a | 完成（331da7c）：ContactCard 擴充登入後版本 |
| iOS 鍵盤上方工具列（WebView 系統畫的「上一項／下一項／完成」） | 1 | 已做（1d），未和現有 App 並排對照 |
| CompanyEditor、SignaturePad | 3c | 完成（0d7c356） |

### 共用邏輯和 App 專用功能

| 項目 | 對應現有檔案 | 階段 | 狀態 |
|---|---|---|---|
| 登入狀態、401 處理、API | `lib/api.js` | 1 | 完成（1d，附單元測試；兩個平台都用審查帳號登入成功） |
| 自管／托管用語、金額、日期、狀態顏色（附單元測試） | `lib/api.js` | 1 | 完成（1d，每個函數每種情況一個具名測試） |
| 返回鍵先關彈窗 | `lib/back-close.js` | 1 | 完成（返回箭頭、Android 返回鍵先關彈窗；子頁 iOS 右滑連彈窗一起返回，和現有 App 一樣） |
| 相機和相片權限、用途說明卡 | `lib/pick-image.js` | 2 | 已合併，Android 相冊路徑未截圖 |
| 口岸圖 | `lib/ports-canvas.js` | 3 | 已做（1d，登入頁用）；首頁用時再對照 |
| iOS 雙牌合位啟動動畫、Android 靜態 M 雲 | `pages/launch`、`lib/launch.js` | 4 | 未做 |
| 首頁緩存 | `homeCache` | 4 | 未做 |
| Android App 內更新 | `lib/app-update.js` | 4 | 未做 |
| 首次打開條款同意框 | `androidPrivacy.json` | 4 | 未做 |
| Android 底部導航條顏色 | `lib/nav-bar.js` | 4 | 未做 |
| iOS TestFlight 自動上傳 | `.github/workflows/testflight.yml` | 5 | 未做 |
| Android 簽名、APK 下載、`version.json` | `android/`、`deploy/web/download` | 5 | 完成（2026-11-23 發佈 1.1.0） |

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

### 2026-11-15（階段 1a 已合併）

- 1a 在分支完成（`11a4bb1`），負責人驗收後快轉合併到 `main`，已刪除分支和 worktree。
- 新增：`app/lib/ui/choices.dart`（單選 `WdRadioGroup`／`WdRadio`、勾選 `WdCheckbox`）、`toast.dart`（`showToast`／`hideToast`，對應 `uni.showToast` 的 87 處 `icon:'none'` 用法，App 端是原生等待框）、`sample_choices.dart`、`app/run.sh`（Android 模擬器）、`app/test/tour/sample_tour.dart`（模擬器巡覽截圖用，不是測試）。
- 檢查：負責人重跑 `flutter analyze` 無問題、`flutter test` 29 個全部通過；看過 iPhone 17 Pro 的單選、勾選、提示截圖和 Android 樣板頁上半部截圖。
- 未做：
  - 和現有 App 並排對照（模擬器不能點擊，要等 1b 的點擊工具；對照頁面：company-new、rental-new、plate-delete、signup）；
  - Android 只截了樣板頁上半部，新組件未在 Android 上看過；Android 的 `uni.showToast` 原生外觀可能和 iOS 不同，合併三批後統一在 Android 上核對。
- 管理者 2026-11-15 表示階段 1 的安排和決定由負責人代為處理。

### 2026-11-15（階段 1b 已合併，全局字型修正）

- 1b 在分支完成（`8446602`、`11b958f`），負責人驗收後合併到 `main`（`63f7aa5`），已刪除分支和 worktree。合併後 `flutter analyze` 無問題、`flutter test` 69 個全部通過。
- 新增 `app/lib/business/`：`plates.dart`（MainlandPlate、HongKongPlate、MacauPlate）、`plate_chip.dart`、`due_date.dart`、`stamp_mark.dart`、`css.dart`（rpx 換算、CSS 陰影、行高取整）；樣板區塊 `lib/ui/sample_business.dart`；開發用入口 `lib/sample_business_main.dart`。
- 和現有 App 對照（現有 App 在 iPhone 16 Pro Max iOS 18.4，用審查帳號；Flutter 版在 iPhone 17 Pro Max）：
  - 登入頁四塊立體車牌：寬差 0–1 個實際像素，字位差不到 1pt；內地牌底下陰影短約 1pt（未修）。
  - 牌照詳情的內地牌、香港牌：差 1–2 個實際像素。
  - 到期徽章：同高、頂端對齊。
  - 車牌徽章：高度一致，Flutter 版寬約 3%（未修）。
  - 印章：外圈尺寸和動畫幅度吻合；定住時間快約 2 幀（可能是錄影誤差）；「已登入」字寬多 1.3pt。
  - 字寬差別的共同原因：Flutter 畫系統字比 WebView 寬約 3%、矮約 5%。不是 iOS 版本差別，試過的設定都無效。照第六節，不調版面遷就，由管理者並排看後判斷。
- 對照用工具：Xcode 27 的模擬器不能用指令點擊，1b 在 `/private/tmp/dualplate-uitest/` 做了 XCUITest 點擊工具（不在倉庫）。它在鍵盤打開後點擊不可靠，登入時改由管理者手動操作。
- 全局字型修正（負責人）：`tokens.dart` 的 `ts()` 改為先用系統字 `.AppleSystemUIFont`（對應 App.vue 的 `-apple-system`），中文才落到蘋方；行高照 WebView 向下取整到整數 px。之前英文數字用蘋方，短橫較長，粗體英文還會畫成空心。已在 iPhone 17 Pro Max 看過樣板頁。

### 2026-11-15（階段 1c 已合併；1a–1c 全部合併）

- 1c 在分支完成（`78d9c7c`、`0560833`、`5f911cf`），負責人驗收後合併到 `main`（`5d6cf2a`），已刪除分支和 worktree；三條開工分支全部清除，只剩 `main`。合併後 `flutter analyze` 無問題、`flutter test` 103 個全部通過。
- 新增 `app/lib/shell/`（導航列、底部分頁、換頁、路由）、`app/assets/tabbar/`、`app/integration_test/`。
- 用 1b 的點擊工具在現有 App（審查帳號）錄影核實：
  - 確認框開着時從左邊緣右滑：甚麼都不發生（不關彈窗、不返回）。Flutter 版改成一樣。
  - iOS 換頁：300ms easeInOut，上一頁左移 25% 並蓋 20% 黑，沒有陰影；返回箭頭左距 7。Flutter 版已對準，複量誤差約 1.5pt。
  - Android 換頁數值取自 DCloud SDK 的動畫資源（打開 300ms、返回 360ms、上一頁左移 25% 淡到 0.6），未和現有 App 錄影對照。
  - 按下效果錄不到，未核對。
- 發現：現有 App 的確認框遮罩不蓋狀態列、導航列和底部分頁，Flutter 版蓋住整個畫面 → 加開 1e 修正。
- `docs/design-system.md` 加「客戶端（Flutter）」一節，登記 1a–1c 的組件；`app/README.md` 更新目錄和指令。
- Android：合併後用 `app/run.sh` 跑一次，App 沒有打開——安裝後 Android 17 系統的「Updating...」更新畫面擋在最上層，日誌沒有崩潰記錄。按規定未重跑，已報告管理者。

### 2026-11-15（階段 1e 已合併）

- 1e 在分支完成（`d3113de`、`f128b34`），負責人驗收後合併到 `main`（`8d1cb84`），已刪除分支和 worktree。合併後 `flutter analyze` 無問題、`flutter test` 129 個全部通過。
- 用點擊工具在現有 App（審查帳號）核實，並照做：
  - 確認框的遮罩只蓋內容區（導航列底到分頁列頂；子頁到螢幕底），狀態列、導航列、分頁列不變暗。新增 `DialogArea`，`AppPage` 自動使用。
  - 確認框開着時按另一個分頁：立即切過去；切回來確認框仍在。
  - 子頁的底部選單是浮起的白卡：左右各 10、底距安全區 10、四角圓角 16。
  - 子頁彈窗開着時：按返回箭頭先關彈窗（Android 返回鍵同樣）；iOS 從左邊緣右滑則連頁面一起返回。1c 的「右滑甚麼都不發生」只適用於分頁頁面，已改正。
- 字型複核：導航列標題上移 1/3pt（`Shell.navTitleDy`）；分頁圖示和文字位置不用改。
- 未核實：分頁頁面上的底部選單位置（四個分頁沒有不改資料就能打開的選單），按 uni-app 原始碼做在分頁列之上。
- 現有 App 由 1d 登出截登入頁後，管理者手動登入一次（負責人錄影），現在仍登入審查帳號。

### 2026-11-15（階段 1d 已合併；階段 1 全部合併，按管理者指示暫停）

- 1d 在分支完成（`3798827`），負責人驗收後合併到 `main`（`b90d4e4`），沒有衝突，已刪除分支和 worktree。合併後 `flutter analyze` 無問題、`flutter test` 410 個全部通過。
- 內容：`lib/core/`（API、401 處理、登入狀態、自管／托管用語和金額日期工具）、登入頁、iOS 鍵盤上方工具列；`main.dart` 未登入打開登入頁，已登入打開首頁分頁。
- 帳號：提交裏沒有審查帳號的號碼和密碼（整合測試只從 `--dart-define` 讀）。測試裏唯一的真實號碼是正式後端 `/public/contact` 公開的 WhatsApp 號碼。
- 驗收：
  - 兩個平台都用審查帳號登入成功（iOS 跑兩次；Android 跑一次）。
  - iPhone 17 Pro Max 和現有 App（16 Pro Max，同為 1320×2868）並排：登入頁、電郵分頁、區號選擇器位置逐像素對齊。
  - 選擇器原本文字是粗體、沒有上下漸淡，1d 修正後負責人在模擬器重拍確認，和現有 App 相同。
- 未完成／未核實：
  - 選內地區號、空白送出、號碼不足 8 位三個狀態，只按原始碼做，未和現有 App 對照。
  - 鍵盤工具列未並排對照。
  - 「登入中」按鈕的灰色是按 `uni-button[disabled]` 推出來的。
  - Android 那次測試用的是選擇器修正前的版本，未重拍。
  - 中文字略寬、個別字形不同（iOS 18.4 和 26 的字體可能不同），未修。
  - QR 碼點擊放大未做；`/terms`、`/signup` 是空白佔位頁。
- 移植時發現登入頁五個現有問題，已記在第七節，Flutter 版照舊。
- 用審查帳號登入時的四段錄影（1d 的 iOS 兩次、Android 一次，和管理者手動登入那次）畫面上看得到手機號碼，管理者決定刪除，已刪除；截圖和沒有登入的錄影保留。

### 2026-11-22（第七節 23 處差別：照建議處理）

- 管理者「照建議處理」。只改 Flutter 版，現有 App（`mobile/`）沒有改。逐項決定寫在第七節。
- 改了 14 處：車牌徽章「待補充」用中性框；到期徽章日期格式不對當作未填；牌照詳情粵澳用 MacauPlate；鎖定提示框擋住返回鍵、返回箭頭和 iOS 右滑；登入頁電郵欄不自動大寫、登入中不再送、號碼上限只算數字、找不到帳號時顯示看得懂的話；牌照詳情只有未填日期時不留空白卡、開關和「今天已過關」各自顯示送出中、印章移到右下角；新增出租結束日期最早是起租日；辦理進度新到期日最早是今天。
- 丙類 4 處：加 url_launcher、file_picker（WhatsApp 和微信客服直接打開，打不開才複製；上傳 PDF 真的選檔）；另加 open_filex 和直接依賴 path_provider（查看 PDF 用手機自帶檢視器；url_launcher 打不開本機檔案，計劃外多加一個套件）；open_filex 自帶的讀影片、讀音樂權限在 Android 清單移除。拍卡頁 ✕ 改成約 11pt 粗線（沒有舊截圖可再量）。iOS 批文卡也用打包的宋體子集。批文卡寬保留 374。
- 不用改 5 處：子頁滑入、詳情只載一次保留 Flutter 版；空白鏡頭、DCloud 相冊是現有 App 外殼的問題；首頁條款提示不算差別。
- 測試：舊測試裏斷言舊行為的改成新行為（車牌徽章、到期徽章、鎖定提示框三個、號碼上限、WhatsApp 複製、澳門牌）；刪了 1 個「選 PDF 錯誤原文照舊」的測試（那段錯誤文字已按決定拿掉），由 `external_test.dart` 和出租頁四個新測試代替。
- 沒有開模擬器看畫面（按「不在測試和模擬器浪費時間」）。新套件只做了 iOS 模擬器版和 Android 除錯版編譯。真機上打開 WhatsApp、選 PDF、打開 PDF 留到階段 4 真機一起看。
- 留意：階段 4（flutter-4 分支，從 `57f155e` 開出）合併時，`pubspec.yaml`、`pubspec.lock`、Android 清單、`dialogs.dart`、`tokens.dart` 可能要手動合併；鎖定提示框現在擋返回鍵，「必須更新」可以直接用 `notice(locked: true)`。

### 2026-11-23（客戶端兩份同步規則提早寫入 AGENTS.md）

- 管理者確定：iOS、Android App 用 Flutter（`app/`），網頁版和微信小程序用 uni-app（`mobile/`），開發時兩邊同步。按負責人建議，原定階段 6 才寫的「客戶端改動要做兩份」提早寫進 `AGENTS.md`（長期限制）；受保護檔案加入 Flutter 版組件一項仍留在階段 6。

### 2026-11-23（5a 準備：已推送，TestFlight 打包 Flutter 版）

- 管理者「可以開始5a」；做完後「提交推送，apk先不發更新版。test fight可以推」：推送後 CI 打包 Flutter 版上傳 TestFlight；正式 APK 不上傳網站，`version.json` 不改。改動：
  - 版本 `1.1.0+2`（`app/pubspec.yaml`）：Android versionCode 2，大於網站上的 1；iOS Build 號照舊由 CI 給（`run_number.run_attempt`）。
  - 名稱：iOS、Android 都改為「跨境車牌管家」（原為 Flutter 預設的 Dualplate）。
  - 圖示：iOS 換成現有 App 的淺色／深色 1024 圖示；Android 換成現有 App 的 mipmap（含自適應和圓形圖示）。
  - 照現有 App 的設定：只支援 iPhone（原為 iPhone＋iPad，上傳後要補 iPad 截圖）、只用直向、淺色外觀、`UIRequiresFullScreen`、`ITSAppUsesNonExemptEncryption = false`；Android 直向。
  - iOS 團隊改為 YU6GT6HQJ8（原為個人團隊）。本機照常自動簽名；CI 寫入 `app/ios/Flutter/Signing.xcconfig`（不入庫，`Release.xcconfig` 以 `#include?` 引入）改為手動簽名。
  - Android 正式版用 `android/signing/` 同一把金鑰（`build.gradle.kts`）；沒有金鑰時退回除錯金鑰。除錯版照舊用除錯金鑰。
  - **補上網絡權限**：Flutter 範本只在 debug、profile 加 INTERNET，正式 APK 原本缺，裝上會連不到伺服器（模擬器用除錯版，所以之前看不出）。
  - 新腳本：`app/tool/testflight.sh`（`flutter build ios --config-only` 後照舊用 xcodebuild 打包、上傳）、`app/tool/build_apk.sh`（正式 APK，核對簽名指紋）。計劃原寫改 `ios/testflight.sh`，因階段 6 會刪 `ios/`，新腳本放 `app/tool/`；舊腳本暫留。
  - `.github/workflows/testflight.yml`：觸發改為 `app/` 有改動；用官方倉庫的 Flutter 3.47.4；不再還原 DCloud SDK、不再用 `DCLOUD_APPKEY`、`IOS_SDK_PASSPHRASE`（secrets 暫留，階段 6 再清）。
- 本機驗證：
  - 正式 APK：簽名 SHA1 `0a116b44…711f`（和現有 App 同一把），`1.1.0`／versionCode 2，名稱正確，權限清單含 INTERNET。
  - iOS 自動簽名試打包成功；另用 `ios/signing/` 的發佈證書和描述檔，在臨時鑰匙圈照 CI 做法手動簽名打包成功，App 和框架都是 Apple Distribution（YU6GT6HQJ8），描述檔 `dualplate-appstore-ci`。上傳一步只能在 CI 驗證。
  - `flutter analyze` 無問題；`flutter test` 1550 個全部通過。
- 疑慮：Flutter 版 Android 最低 Android 7.0（minSdk 24），現有 App 是 Android 5.0（21）。Android 5、6 的用戶不能升級。
- 同日：Android 17 模擬器裝除錯版給管理者測（後鏡頭接 Mac 鏡頭；相冊放了第 9 輪實拍的正反面相片）；模擬器上舊的 `io.dcloud.HBuilder` 已移除。

### 2026-11-23（Android 1.1.0 APK 發佈到網站）

- 管理者「apk 可以發最新版到下載html」；更新說明管理者定為「Bug Fixed」（以後沒有特別說明都只寫這句）；知道升級後要重新登入、Android 5、6 裝不了後「照發」。
- `app/tool/build_apk.sh` 打包：`1.1.0`／versionCode 2，簽名 SHA1 `0a116b44…711f`，約 70MB（舊版約 30MB）。
- 模擬器（Android 16）：先裝網站上的 1.0.0，再覆蓋安裝 1.1.0 成功，App 打得開。舊版 App 內「立即更新」的下載安裝沒有重新試。
- 正式主機 `/srv/dualplate/download/`：先傳 `/tmp`、核對 SHA-256 後改名換上；舊版留作 `dualplate-1.0.0.apk.bak`（網站讀不到）。之後才改 `version.json`（versionCode 2、`Bug Fixed`、`minVersionCode` 仍為 1，不強制）。

### 2026-11-23（5b 讀卡收尾：管理者「目前可以接受」）

- 之後不再開分支，直接在 `main` 做（管理者「5b分支沒有用了。直接在main工作」）。每次推送前先在 Docker（Linux + Noto 字型，和 CI 一樣）跑一次辨識測試。
- 伺服器辨識（`api/src/card.js`），每一步都經管理者批准才推送：
  - `200a8f2`：兩個中文辨識程式；正式主機 api 記憶體上限改 1GB。
  - `fd62733`：商號、內承單位按把握度逐字投票，括號統一，商號第二行。
  - `0cd9c79`：花紋桌面上找卡邊不再被拒；單行欄位跟着欄名行走。
  - `b164303`、`d9c0b08`：司機姓名由逐欄和備註各次讀法一起投票；三者一致才算正確。`b164303` 和合併 `1110e5d` 在 CI 不過（Linux 字型下合成卡讀錯卻標正確），由 `d9c0b08` 修正。
  - `f6bf504`：備註「主司机／副司机」字頭修正；內承單位品牌字可借商號的字（標待核對）；同一年的兩個批文號，現批文號碼較大即不標。
  - `d3d89bd`：投票結果來自另一次讀法時，把握度壓到 69（標待核對），不再錯了還標正確。
  - `17eb7ea`：備註第二行改為核對四位號碼後接上，不再要求前面一字不差。
- App（Flutter）：
  - `9806fb2`：拍卡時找卡邊用和伺服器一樣放寬的檢查。
  - `d3d89bd`：拍哪一面，模擬批文卡就翻到哪一面；提示寫明「已辨識正面／背面」；「點擊卡面翻轉」字放大到說明字大小。
- 結果（同一張實卡，iPhone 14 Pro Max 試用版）：
  - 最後一輪正面 5/5、背面 13/13 全部讀對，沒有錯了還標正確的欄位。
  - 仍有 3–4 欄讀對但標待核對：「王斌」的「斌」、現批文號約 88 分（門檻 90）、內地車牌，以及一律待核對的備註。
  - 秒數：正面約 16 秒，背面 17–21 秒。
- 樣本對比（30 個：合成卡、真實樣本、管理者歷次實拍）：讀對欄數 204 → 205。
- 管理者對 5b 遺留項目的決定：
  - 不再和現有 App 比較，以最新版為準；
  - 1f 直接收尾，現狀可以接受；
  - 舊樣本 5 欄正面錯了還標正確，按目前版本可以接受，不再追查；
  - 審核帳號只留 HK1234／MA1234：伺服器唯讀查過，只有這兩個範例牌照、4 間範例公司和 2 個公司組（都是 11-04 建立），11-05 後沒有新增或修改，沒有要刪的。
- 仍會發生：App 拍正面時找卡邊常缺下邊（目前版本沒改過找邊，最後一輪仍是三邊），要手動按快門；背面多數四邊都找到。記錄每 2 秒只記一次，分不出是自動拍還是手動按。

### 2026-11-23（5b 合併；伺服器辨識加速）

- 管理者「5b 和合併，推送來一次測試」。5b 合併到 main（`3d942bc`），和伺服器辨識加速（`0be722d`）一起推送；臨時 Bundle ID 沒有帶進 main。
- 第二輪真機（試用版）：手機拍照截卡不到 1 秒；正式伺服器辨識正面 38.6 秒、背面 45.3 秒，慢在伺服器。
- 伺服器辨識加速（管理者「照建議加快」，改 `api/src/card.js`）：
  - 中文、英文各一個常駐辨識程式，不再每次新開、來回換字庫；兩者同時做；閒置 5 分鐘關閉。
  - 每欄只送那一小塊圖；文字欄位去掉 psm 7。
  - 50 個樣本（真實樣本、對準框和找卡邊各種拍法、合成卡、管理者實卡）每個讀對的欄數都和以前一樣；1723 項後端測試通過。
  - 768MB 容器實測：正面 7.7 → 約 4.5 秒、背面 9.8 → 5.4 秒；舊做法兩人同時辨識記憶體不足被重啟，新做法最高約 560MB。兩個中文辨識程式更快但最高約 710MB，不用。正式伺服器實際秒數等推送後真機記錄。
- 批文卡文字照真卡（管理者「照建議改」、連接號「可以」，只改 Flutter 版）：正面欄名細宋體、字均勻拉開、冒號對齊，簽發機關細字，商號最多兩行，內承單位和商號一樣大；背面資料和欄名改黑體（iOS 蘋方、Android 系統黑體），欄名拉開對齊；有效期用短「-」（改了兩項寫明長「–」的測試）。位置不變。
- 未做：現有 App 用同一張卡比較讀對的欄數；1f；階段 5 其餘部分（5a、5c、5d）。

### 2026-11-23（5b 讀卡：第一輪真機）

- 管理者決定先做 5b，再做階段 5 其餘部分；批准用相機套件修改版；寫入用 Apple 審核帳號（破例）。
- 分支 `claude/flutter-5b-card`（未合併）：
  - `app/packages/camera_avfoundation`（0.11.1 修改版）：先用後鏡頭的組合鏡頭，近距離自動轉微距；
  - 解像度由 max 改 4K（ultraHigh）；
  - 試用版記錄 `card-log.txt`（`CARD_LOG=true` 才寫）。
- 試用版在 iPhone 14 Pro Max（臨時 Bundle ID `.trial`、團隊 `YU6GT6HQJ8`，只在工作目錄不提交）。結果：
  - 預覽清楚（清楚度 1100–1300，門檻 150），找邊每秒約 20 次、每次約 34 毫秒，四邊轉綠並自動拍；2d 的對焦和不轉綠已解決。
  - 讀卡仍差：截圖時卡上邊超出框線約 3.6%（舊門檻框外也容許 4%），上方背景只剩約 2%，伺服器找錯上邊、切進字裏；本機用伺服器同一流程重跑只讀對序號。同一張卡放回留足背景後，編號、口岸、序號讀對，商號、內承單位錯一兩字。
  - 「正在辨識」轉圈不動：轉圈圖案每格畫得一樣（位置和深淺一起轉），影響所有載入框，和辨識無關。
- 已改（`c95595e`）：轉圈修正；對齊門檻改為框內 4%、框外只容許 1%。已重裝試用版，等管理者再測。
- 商號、內承單位錯字屬伺服器辨識，現有 App 同樣受影響，不在這次改。

### 2026-11-23（階段 4 修正合併）

- flutter-4 交來 `a896daa`，負責人看過第二次同意框、退出提示、30 張底部色條拼圖後合併（`a3a6026`）。
- 1、2、3、5、8 已改：第二次同意框底色與第一次相同；按鈕「退出 App」；退出提示固定繁體、用 App 自己的 toast（顯示 2 秒，等於再按的時限；其他 toast 是 1.5 秒，session 自行決定）；連結經 `launchExternal`；Kotlin 的 `openUrl`、`toast` 和 `BackGate.rootBack` 已刪。
- 7：安卓 30 張截圖底部都沒有白條或錯位。沒截到兩頁：自管的「訊息」（陳先生「我的」頁找不到「在 app 內發訊息」，未追查）、申請使用（點擊落空，截到的是登入頁）。
- 合併後 `flutter analyze` 無問題；`flutter test --no-pub` 1540 全部通過（`pub get` 卡了 10 分鐘，pubspec 沒改，改用 `--no-pub`）。
- 未推送。

### 2026-11-23（階段 4 發現的問題：照建議修正）

- 管理者「照建議」。只改 Flutter 版，現有 App 階段 5 後停用，不改 `mobile/`。交 flutter-4 一次改完，負責人驗收合併，不推送。
- 現有 App 問題，Flutter 不照抄：
  1. 再問一次的同意框背景用深翠綠，和第一次一致（現有 App 變深灰）。
  2. 按鈕照條款原文顯示「退出 App」，不轉全大寫。
  3. 「再按一次退出應用」固定繁體，用 App 自己的 toast，不跟手機語言，不顯示 Flutter 圖示。
  4. 現有 App 安卓登入頁 35 秒白頁：不處理（只見一次，可能是模擬器慢）。
- 和現有 App 的差別：
  5. 條款連結保留系統瀏覽器，改用 `launchExternal`，刪去另寫的原生通道。
  6. 下載進度只換文字：保留（現有 App 每個百分比重開等待框會閃）。
  7. 安卓底部色條：用巡覽工具 22 頁各截一張核對底部。
  8. 刪除沒人用的 `BackGate.rootBack`。
- 9. App 內更新實際下載安裝：留到階段 5 用正式簽名 APK 在真機試。

### 2026-11-23（階段 4 合併）

- flutter-4 交來 `c1bf8b3`，負責人看過 iOS 啟動動畫、條款同意框、安卓啟動和返回提示的對照圖後合併進 main。
- 和 main 的 `2a7866a`（第七節 23 處）有兩處衝突：`router.dart` 只是註解，`dialogs.dart` 取 main 的鎖定提示框擋住返回鍵；session 原本讓鎖定框在分頁轉去「再按一次退出」的那段不再需要。
- 合併後 `flutter analyze` 無問題；`flutter test` 1536 通過、1 跳過（主倉庫有卡片樣本）。沒有另外在模擬器重看。
- 和現有 App 的差異（未改，待管理者看）：
  - 條款框裏的連結用系統瀏覽器打開（現有 App 是 DCloud 內建網頁視窗）。
  - 下載更新時的進度只換文字，不重開等待框。
  - 安卓所有有導航列的頁面和登入頁加了底部色條 `BottomStrip`，模擬器上只看過登入、首頁、通知、彈窗。
  - 「再按一次退出」的提示仍是 Flutter 預設圖示，App 圖示屬階段 5。
- 共用檔改動：`loading.dart` 修了短時間兩次 `showLoading` 會留下舊框的問題。
- 未做：App 內更新的實際下載和安裝沒有在模擬器上跑過，只有單元測試；`android-privacy-second.png` 截於背景改為 `#141414` 之前。
- 安卓模擬器上的現有 App 已被 Flutter 版覆蓋（同一包名）；要恢復用 `android/emu-run.sh --skip-build`。
- 可順手清理：`BackGate.rootBack` 合併後沒有人用；條款框連結用自寫的原生通道，main 已有 `launchExternal`。
- 現有 App 的問題（給第七節）：
  - 再問一次的同意框背景由深綠變深灰；
  - 「退出 App」按鈕被系統顯示成全大寫「退出 APP」；
  - 「再按一次退出」提示跟手機語言走（英文、簡體手機不顯示繁體）；
  - 安卓模擬器上有一次登入頁 35 秒仍是白頁，可能是模擬器慢，不確定。

### 2026-11-22（階段 4 開工）

- 管理者「開工階段 4」。開一個 session（flutter-4，自己的分支）做完五項：啟動畫面、首頁緩存、Android App 內更新、首次打開條款同意框、Android 導航條顏色和返回鍵；另補 3e 未做的斷網檢查。
- 不分批：五項都動到啟動流程，分開做容易互相衝突。
- 驗收照 3c 起的縮減範圍；負責人驗收後合併，不推送。

### 2026-11-22（3e 收尾：階段 3 完成）

- 管理者「可以開始3e」。負責人自己做，只跑一次，不另開 session。
- 新增巡覽工具 `app/integration_test/pages_3e_tour_test.dart`（照 3d，接上修改公司資料表單，回應檔附上目前網址，用來核對走到哪一頁）。本機伺服器 `local_api.sh 3e`。
- **iOS（iPhone 17 Pro Max）**：從首頁和分頁沿真正入口走。
  - 有資料自管（陳先生）18 頁；
  - 托管（李先生）20 頁，另截委託內容的公司頁和修改公司資料表單；
  - 空白自管 13 頁；
  - 未登入的申請使用。
  - 22 頁全部打開，網址正確，沒有報錯、空白或排版錯亂。
  - 刪除牌照只給自管：托管的牌照詳情沒有入口，和現有 App 一樣（`cardSelfManaged`）。
- **Android（Medium_Phone_API_37.0）**：統一截圖一次，托管 20 頁加自管的聯絡我們、註銷帳號、刪除牌照和未登入的申請使用，22 頁都打開，排版正常。
- 為了打開出租頁，用新增出租同一個接口給李先生建了一份草擬出租（「3e 測試承租人」，只在本機資料）。
- 截圖在 `/private/tmp/dp3/3e-shots/`：iOS 用帳號前綴（`customer-`、`li-`、`empty-`、`out-`），Android 用 `a-` 前綴，`sheet-*` 是拼圖。
- **沒有做到**：
  - 「出錯」畫面：停掉伺服器後，兩邊的巡覽工具立即結束（整合測試把未處理的網絡錯誤當成測試失敗），沒有截到。正式 App 會不會因此出問題未核實，按 15 分鐘上限沒有追查，建議階段 4 在真機斷網時看一次。
  - 沒有另開現有 App 模擬器對照。3c、3d 留下的現有 App 寫入流程、勾選條款、註銷後提示，以各批的單元測試和 Flutter 截圖為準。
- A–H：沒有逐頁另寫，以上截圖未見問題。

### 2026-11-22（3d 合併；階段 3 的 22 頁全部搬完）

- 管理者「開工 3d」：3d 一個 session 在分支做完（cea6f0c），負責人合併到 `main`（a691b0c），未推送。
- 內容：signup、terms、close-account 三頁。註銷照現在的行為搬，不送 `retain`（有專門測試）。
- 合併後負責人重跑一次：`flutter analyze` 無問題；`flutter test` 1383 通過（3d session 為 1377 通過、6 跳過；新增 75 個）。沒有再開模擬器。共用檔沒有改動。
- 寫入流程用 3d 自建的兩個本機測試帳號，走完「申請 → 批准 → 註銷」，三個基本帳號沒動。
- 截圖在 `/private/tmp/dp3/3d-shots/`（`pair-signup-*`、`pair-terms-*`、`pair-close-*`）。
- 自行判斷：沒有任何聯絡渠道時，現有 App 不顯示聯絡卡也不佔位置；Flutter 申請使用頁另讀 `/public/contact`，有渠道才放卡。
- 未截、留 3e：現有 App 條款勾選後畫面（點擊沒生效，有單元測試）；現有 App 註銷後提示（截圖前已消失）；首頁條款提示差異（見第七節）。
- 工具：點擊工具加了 `type` 指令（可在已聚焦輸入框打字）；`/private/tmp/dp3/3d-tools/` 有 `legacy_logout.sh`、`legacy_login_phone.sh`。本機發佈條款用 `POST /api/terms/publish`（草稿的【請填寫…】要先換掉），改強制模式用 `PUT /api/terms/mode`。新 worktree 開本機伺服器前要先連結 `api/node_modules`。

### 2026-11-22（3c 合併）

- 管理者「開工 3c……完成後直接提交」：3c 一個 session 在分支做完（2b6b967、1a98316），負責人合併到 `main`（0d7c356），未推送。
- 內容：rental、rental-new、billing、reports、messages、profile、company-new 七頁；SignaturePad（CustomPainter，輸出白底 PNG data URL，尺寸 = 邏輯尺寸 × 像素比，同現有 App）、CompanyEditor、UniTextArea。
- 合併後負責人重跑一次：`flutter analyze` 無問題；`flutter test` 1308 通過（3c session 在沒有卡樣本的 worktree 為 1302 通過、6 跳過；新增 135 個）。沒有再開模擬器。
- 共用檔改動（都向下兼容）：`Field` 加可選 `maxLength`；`toast.dart` 加 `showToastOn`（頁面先關、稍後才提示時用）；`Session.updateUser`（我的資料改顯示名稱）；`main()` 接 `CompaniesPage.editor = CompanyEditor.builder`（放 `main()` 而不在 `DualplateApp`，3a 三個佔位測試不用改；3e 可改為在 `DualplateApp` 接並改那三個測試）；`tokens.dart` 末尾加 `SignatureStyle`、`BillingStyle`、`ReportsStyle`、`MessagesStyle`、`RentalStyle`。
- 模擬器上修好：簽名框直向筆畫被頁面捲動搶走；新增公司返回後 400ms 提示時頁面已關會崩潰；新增出租「以誰的名義出租」低 8pt（網頁外距合併）。
- 截圖在 `/private/tmp/dp3/3c-shots/`（`f-` Flutter、`l-` 現有 App、`pair-` 並排）。點擊工具 `/private/tmp/dp3/uitest/` 已去掉點擊前等「空閒」，每下約 1 秒；swipe 速度不能為 0，否則工具退出。
- 已知差異（未改）：CompanyEditor 下接「每月報帳」間距 Flutter 20、現有 App 12（3a `filingBox` 自帶上距）；協議輸入框英文數字字寬較寬（字型）；照片選單字略大（3b 組件）；`icon:'success'` 提示只顯示文字（同 3b）。
- 未截、留 3e：現有 App 的寫入流程只截了開始畫面（點擊工具不能打字）；現有 App 沒有入口的組合（自管月報、空白自管帳單／出租、托管聯絡我們）；有內容的月報（三個帳號都沒有月報，只有單元測試）；納稅人類型選擇器；Android。

### 2026-11-22（3a、3b 清理）

- 管理者要求 3a、3b 先收尾，清理分支和開着的模擬器。
- 已刪除：3a、3b 的 worktree 和本地分支（都已併入 main；遠端沒有這兩條分支）；3b 專用的兩台模擬器「iPhone 17 Pro Max 3b」和「iPhone 16 Pro Max 對照本機 3b」。所有模擬器已關閉。
- 保留：iPhone 16 Pro Max（`78302077`，現有 App 登入審查帳號）和「iPhone 16 Pro Max 對照本機」（`361F2754`，3c 起輪流用）。
- 管理者再要求清理沒用的測試數據：已刪除 `/private/tmp/dp3/` 裏 3a、3b 的本機資料、截圖、建置產物和腳本，以及 `/private/tmp/dualplate-flutter/`、`dpdoc/` 和幾個記錄檔（約 1.2 GB）。只保留現有 App 的點擊工具 `/private/tmp/dp3/uitest/`（3c 要改用它）。3c 的本機資料由 `local_api.sh 3c` 重新建立。
- 沒有 3a、3b 的本機伺服器仍在運行。

### 2026-11-21（3b 收尾合併）

- 管理者說「現在的流程太浪費時間了」，要用最簡單流程收尾，由負責人接手。
- 收尾只做：委託內容頁測試（返回時由 PageShow 重新載入）跑通後提交（2189951）；`flutter analyze` 無問題；`flutter test` 1167 通過、6 個略過（樣本卡不在 worktree）。合併為 2c2cabd，未推送。
- 新到期日照舊：現有 App 寫了 `:start="today"`，但 App 的原生日期滾輪不受限，選得到今天以前，提交時才被伺服器拒絕；Flutter 原本選不到。負責人決定照舊，Flutter 拿掉下限（合併後補做；負責人最初誤記為「沒有改動」，已改正）。
- 不再做：新到期日專門測試；重截日期選擇器；模擬器重新核對。3b 的畫面對照以 3b session 先前截圖為準，3e 從真正入口再走一次。
- 車輛證件選相片已接上（`doc_photo.dart` 用 `pickPhoto` 和 `cardPhoto()`）。

### 2026-11-21（驗收範圍縮減：3c 起）

- 管理者說「測試佔據了太多時間。太慢了」，之後批准「照建議縮減」。3b 剩下的工作同時收窄成四件：委託內容頁返回重新載入補單元測試；新到期日照舊；重截一張日期選擇器；跑測試後提交。
- 3c 起保留：
  - 每頁三種帳號的主畫面（管理者 10-19 的要求，不減）；
  - 每個彈窗打開一次（用一種帳號）；
  - 寫入流程只截開始、提交前、結果三步。
- 3c 起去掉：
  - 每頁的「載入中」和「出錯」畫面（由共用件處理，3e 一次查）；
  - 每組疊圖差異圖（肉眼看到不同才做）；
  - 單元測試已證明的邏輯不再在模擬器重複核對。
- 時限：
  - 任何追查最多 15 分鐘，查不到就寫進報告，由負責人決定；
  - 共用件改動後只重截一張代表畫面。

### 2026-11-21（模擬器操作方法：3c 起改用）

- 3a、3b 的模擬器常卡住，原因有五個：
  1. 模擬器沒有直接點擊的指令，只能經 XCUITest 點擊工具間接點；
  2. 現有 App（uni-app 網頁殼）永遠不報「空閒」，XCUITest 每次點擊前都等到超時；
  3. 自動走頁面的程序跑完不退出；
  4. 原生滾輪點擊不能選中，只能拖動；
  5. 現有 App 是 x86_64 版本，靠 Rosetta 運行，較慢。
- 管理者批准（「照建議，3c 開始用」），3c 起改用以下做法。3b 不換方法，照原來的做完。
  1. Flutter 那邊用整合測試（`integration_test`）直接操作頁面：按按鈕、設滾輪值、等文字出現、截圖。不點座標，不拖滾輪。
  2. 現有 App 那邊，在點擊工具（`/private/tmp` 內，不入倉庫）關掉 XCUITest 點擊前等「空閒」的那一步。不安裝新工具。如果不穩，改用 Meta `idb`，但要先經管理者批准安裝。
  3. 每個點擊、截圖步驟都用腳本包起來：設時限，超時就停掉整組程序；開新一輪前，先確認舊程序已經退出。
  4. 現有 App 的原生滾輪仍然用拖動。拖完讀出選中值核對，不對就自動重拖。
  5. x86_64 不改（未核實 DCloud 程式庫有沒有 Apple 晶片模擬器版本）。
- 3c 開工時先用約半小時把工具改好、試通，再開始搬頁面。3a 的模擬器（`361F2754`、`98D84492`）和 4130 伺服器已關掉，沒有刪除。

### 2026-11-21（3a 驗收合併）

- 3a 合併（331da7c）：六頁和 AdvisorCard、WelcomeGuide、ContactCard 登入後版本；`flutter analyze` 無問題，`flutter test` 868 通過、6 跳過（負責人重跑）。三種帳號 59 組並排圖，負責人抽看首頁、牌照卡疊、「我的」、日期選擇器。
- 共用檔改動：ApprovalCard 加可選卡面圓角陰影（預設不變）；ContactCard 加登入後版本；原生殼加「致電」通道（未用 url_launcher，避免新增依賴；真機未試）；login_test 3 處改用 demoTabs（斷言不變）。
- 負責人決定（一比一）：日期選擇器改成現有 App 的 iOS 原生滾輪樣式；提示框尺寸圓角對齊現有 App；修 `AppNav.currentPath` 返回後網址不變的問題。交回 3a session 接着做。
- 3a 補修已合併：日期選擇器照現有 App 的 iOS 原生滾輪（只有「完成」、灰色圓角選中條、月日不補零，用 CupertinoPicker，未新增依賴）；提示框圓角 4、一行高 39；`AppNav.currentPath` 改用可見網址；`PageShow` 連查詢參數比較。`flutter test` 916 通過、6 跳過（負責人重跑）。字寬差異（「·」、全形括號）屬字型排版，不追。
- 現有 App 本身的問題（照舊）：載入中沒有轉圈；載入失敗只有短提示、沒有重試，「我的」頁一律當托管顯示。

### 2026-11-21（階段 3 批准；3-0 預備完成）

- 管理者「三點都按建議批准」；其後指示「做完 3a 才能開下一個 session」，所以改為逐批做：3a → 3b → 3c → 3d。
- 3-0 完成：
  - 佔位頁：22 頁各一個頁面檔，路由表接好（`_tabBuilders`、`_pageBuilders`）。外殼的換頁、返回測試原本靠首頁空頁上的示範按鈕，改用 `demoTabs`（`DualplateApp(demoTabs: true)`、樣板頁「打開外殼」），真正的首頁換上後這些測試不受影響。`flutter analyze` 無問題，`flutter test` 690 個全部通過。
  - 本機伺服器：`app/tool/local_api.sh <批次>`，端口 4130。用 API 自帶示範資料（`DEMO_SEED=1`），再經管理端接口把陳先生轉為自管、新增空白自管客戶（`local_api_seed.mjs`）。三種帳號：`empty-self@demo.local`（空白自管）、`customer@demo.local`（陳先生，自管，2 個牌照）、`li@demo.local`（李先生，托管，8 個牌照、公司、出租、帳目），密碼都是 `CustomerDemo123!`。
  - 對照用模擬器：把 iPhone 16 Pro Max（`78302077`）複製為「iPhone 16 Pro Max 對照本機」（`361F2754-4795-4DD7-9DBB-58CBAF4097C5`），裝上 `ios/sync-www.sh http://localhost:4130` 打包的現有 App。模擬器打字不可靠，所以寫了 `app/tool/legacy_login.sh <電郵>`：向本機伺服器登入，把 token 照 `saveSession` 寫進現有 App 的 uni 儲存再重開。三種帳號都已登入看過首頁（`/private/tmp/dp3/shots/`）。原機 `78302077` 沒有動。
  - 點擊工具：11-17 收尾時已刪除（1b 的 XCUITest），3a 要自己重做（只用來點分頁和按鈕；登入用 `legacy_login.sh`，不用鍵盤）。

### 2026-11-17（階段 3 分批擬定，未開工）

- 管理者要求先把第三階段分批寫入計劃：見第四節「階段 3 分批」（3-0 預備、3a–3c 同時、3d、3e 收尾）。
- 待管理者決定三點：複製對照模擬器並讓現有 App 改連本機伺服器；三批同時開工；註銷頁先照現在行為搬。
- 沒有開工，沒有改程式碼，沒有開模擬器。

### 2026-11-17（階段 1、2 收尾）

- 管理者決定：階段 1、2 收尾，清理測試資料和分支，關閉所有模擬器，推送。
- 未完成、留待之後：1f（階段 1 對照驗收）；讀卡（2d 的問題 1–3、實卡欄數比較）在 Flutter 其餘部分全部完成後再回來處理。
- 清理：刪除 `/private/tmp` 的測試資料（`dualplate-flutter/` 截圖和錄影、`dp2c/` 本機 API 資料、`dualplate-2d*`、`dualplate-review-2b/`、`dualplate-uitest/`、簽名證書暫存）；iPhone 14 Pro Max 移除 Flutter 試用版（現有 App 保留）；iOS 模擬器移除 Flutter 版；分支 `claude/flutter-2a-…`、`2b-…`、`2c-…`（已合併）和 `claude/flutter-2d-trial`（不合併）連同 worktree 刪除；所有 iOS 模擬器和 Android 模擬器關閉。

### 2026-11-17（2d 第一輪真機：讀卡未過，按管理者指示收尾）

- 做法：iPhone 14 Pro Max（iOS 27.2，用線連 Mac）同時裝現有 App（1.0.1）和 Flutter 試用版（臨時 Bundle ID `com.masterappinc.dualplate.trial`，公司團隊 `YU6GT6HQJ8` 簽名，正式版打包），連正式伺服器，用 Apple 審核帳號（管理者決定這次破例寫入；開始前管理者已記下原有批文卡）。管理者用實卡拍。
- 試用版在分支 `claude/flutter-2d-trial`（沒有合併，收尾時已刪除；需要時照下列內容重做）：臨時 Bundle ID 和簽名團隊、首頁臨時牌照清單（階段 3 前沒有路進入詳情頁）、計時記錄。iPhone 14 Pro Max 已登記在公司開發者帳號；Xcode 已由管理者登入。試用版收尾時已從 iPhone 移除。
- 結果：現有 App 拍卡讀取正常完成；Flutter 版管理者評為「識別能力不行，相機對焦也不穩定」。兩個 App 各讀對幾欄沒有記錄。
- 問題（之後回來調整讀卡時逐項處理）：
  1. **對焦不穩、預覽模糊**（實測，管理者截圖）。推測原因（未驗證）：iPhone 14 Pro Max 主鏡頭最近對焦約 20 厘米，卡填滿框時手機比這更近；`camera` 套件只用主鏡頭，不會像系統相機那樣自動轉超廣角拍近距。驗證方法：手機拿遠到約 25 厘米看預覽是否變清楚。若屬實，要用 iOS 的自動切換鏡頭（`builtInTripleCamera`／`builtInDualWideCamera`），現成套件做不到，要寫一段 iOS 原生程式。
  2. **框線完全不轉綠**（實測）：卡大致對準框，四邊都沒有標示對齊，即時找卡邊在真 iPhone 上沒有正常運作；模擬器正常。原因未查（畫面方向、BGRA 格式、清楚度或背景門檻都有可能）。
  3. **辨識時轉圈不動**（管理者看到）：整個畫面停住，原因未查。
  4. **上傳出錯時「正在上傳辨識」永遠不消失**（實測）：移植漏了現有 App 在 catch 裏的 `uni.hideLoading()`，「只保存正本」成功和失敗也一樣。**已修**（`0b2c76e`，加三個測試）。
  5. 記錄沒有取得：正式版打包的 `print` 不會經 `devicectl --console` 傳到 Mac，讀 iPhone 系統日誌要管理員權限（沒有做）。下次改為寫入 App 內檔案，再用 `xcrun devicectl device copy from` 取回。
  6. Flutter 專案的簽名團隊原本是 `XKLMB8B77V`（info@masterappinc.com），不是公司團隊 `YU6GT6HQJ8`；試用版改用公司團隊。正式發布用哪個由管理者在階段 5 決定。
- 未做：1f（階段 1 收尾對照）；實卡逐張欄數比較。
- 清理（管理者要求，2026-11-17 00:43）：測試時在審核帳號新增的牌照「粵Z05T7港 · TJ6717」（批文卡 2000337，連 2 位司機）和讀卡時建立的 2 間公司，經 App「刪除牌照」同一接口（`POST /my/plates/:id/delete`，用模擬器現有 App 的登入）刪除；原有兩個示範牌照（HK1234、MA1234）保留，首頁已回到「名下 2 個兩地牌」。

### 2026-11-16（階段 2b 已合併）

- 2b（`24978d1`、`d2d1879`）在分支完成，負責人驗收後合併到 `main`。只改 Flutter 版，現有 App、網頁、小程序、伺服器都沒有改。
- 找卡邊：`app/lib/business/card_edges.dart` 照搬 `api/src/card-face.js`（外圈背景色中位數、色差門檻、行列比例、`edge`、`edges`、`tilt`），同一批像素和伺服器結果相同（測試用 node 跑伺服器原檔比對）。鏡頭畫面（Android YUV420、iOS BGRA）只取框外擴 6% 的範圍，縮成 569×361，在常駐的背景 isolate 裏一次處理一張。Android 模擬器除錯版每秒約 6–9.5 次。
- 標示（管理者選定樣式三）：對齊的框線轉綠；四邊對齊、傾斜不超過 3°、清楚度 ≥150 時四角也轉綠，提示換成「可以拍了」（管理者同意的新文字）。綠色沿用 `C.onDeepOk`。
- 自動拍：「可以拍了」連續維持 600 毫秒就拍，中途一張不合格重新計時；和快門同一條路，快門保留；拍一次、離開頁面、改用相冊都停止找邊；相冊模式不自動拍。
- 門檻常數（`edgeAlignTolerance` 4%、`liveMaxTilt` 3°、`sharpThreshold` 150、`autoShotHold` 600 毫秒）都在 `card_edges.dart`。清楚度門檻按 4 張掃描樣本定（清楚 1700–3100，模糊 2 像素以上 ≤134），真手機預覽的數值、600 毫秒的手感要在 2d 核對（除錯版每 5 秒在記錄印出清楚度）。
- 合併後：`flutter analyze` 無問題；`flutter test` 有樣本並指明伺服器套件（`DP_API_DIR`）時 687 個全部通過，沒有樣本時 673 個通過、14 個跳過。
- 看過：iOS 17 Pro 模擬器三款樣式各三個狀態截圖（`/private/tmp/dualplate-flutter/2b/`）；Android 模擬器自動拍錄影 `android-autoshot.mp4`（卡是程式畫的示意圖，經只供開發的 `CaptureDemo` 注入，找邊、計時、停止都是正式流程）。沒看過：真鏡頭、實卡、真手機速度和預覽是否卡頓（2d）。
- 留意：預覽畫面若剛好和螢幕同比例，框外擴 6% 的範圍會超出畫面，可能找不到邊（真鏡頭畫面比螢幕寬，暫未遇到）。iOS 收到橫向畫面時當作轉 90°，未在真機核實。
- 照搬伺服器「卡在框內佔九成」的規則：深色桌面配大面積深色字、或卡伸進外圈 2% 時，預覽不標示對齊；伺服器遇到同樣照片也改用框內，兩邊一致。

### 2026-11-16（階段 2a、2c 已合併；按管理者指示暫停）

- 2a（`e582dd3`、`975782c`）和 2c（`4c63f3e`）各自在分支完成，負責人驗收後合併到 `main`（`0fa469b`、`d9d789d`）。兩批只在 `tokens.dart`（各自在末尾加樣式）和 `pubspec.yaml` 重疊，合併時兩邊全部保留。
- 合併後：`flutter analyze` 無問題；`flutter test` 有樣本時 606 個全部通過，沒有樣本時（`DP_CARD_FIXTURES=/nonexistent`，等於 CI 和全新 checkout）603 個通過、3 個跳過；`flutter build ios --simulator --debug` 和 `flutter build apk --debug` 都成功。合併後沒有開模擬器重看畫面。
- 2a：拍卡頁、相冊拖動縮放、截出 2274×1445 JPEG（品質 90），框內位置和伺服器找不到卡邊時取的範圍相差不到 1 像素；Android 權限說明照搬 `pick-image.js`。新套件 camera、image、image_picker、permission_handler（鎖 12.x，13.x 要 compileSdk 37）。
  - 自行判斷：原生相機的預覽和拍出的相片比例可能不同，先把相片按預覽比例置中裁切，令截出的範圍等於畫面所見。要在 2d 真機核實（同時核實相片方向）。
  - 看過：iOS（17 Pro）開不了鏡頭、相冊、縮放、確認、取消；Android 相機說明卡、虛擬鏡頭預覽、快門。沒看過：Android 相冊選後各狀態、現有 App 的 Android 權限說明卡並排、真鏡頭。
  - 截圖 `/private/tmp/dualplate-flutter/2a/`；點擊工具已重建在 `/private/tmp/dualplate-uitest`（不在倉庫）。Android 模擬器上的現有 App 已被移除，裝回用 `android/emu-run.sh --skip-build`。
- 2c：牌照詳情整頁和 `ApprovalCard`；本機 API（資料在 `/private/tmp/dp2c`）建空白自管、有資料自管、托管、和審查帳號同樣資料的鏡像客戶測試，正式後端沒有寫入。並排 17 組（`/private/tmp/dualplate-flutter/2c/pairs/`），頁首對齊，其餘差 ≤1–3pt。
  - 宋體：Noto Serif SC（SIL OFL 1.1）子集，一般體 8942 字 2.9 MB、粗體 173 字 84 KB，產生方法 `app/tool/song_subset.py`。只在 Android 用（iOS 照現有 App 用 Times＋蘋方），但 iOS 安裝包也帶着這 3 MB。
  - 差異：中文字寬約 1–3%（階段 1 已知）；批文卡寬 374 對 377；「簽發機關」一行低約 2pt；輸入框等寬數字（`.field.num`）未做。
  - 未做：車輛證件選相片（`doc_photo.dart` 仍回傳 null 當取消，要接上 2a 的 `pickPhoto` 並照 `cardPhoto()` 壓縮）；看大圖長按保存；寫入流程未在現有 App 對照（正式後端不可改資料）；Android 截圖；8 個連結去的頁面只是佔位。
- 新組件已登記在 `docs/design-system.md`「客戶端（Flutter）」和 `app/README.md`。
- 按管理者指示（「2a和2c完成後合併然後推送就暫停」）：合併、推送後暫停，2b、2d 未開始。2d 用 iPhone、臨時 Bundle ID（見第四節）。
