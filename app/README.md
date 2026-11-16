# 跨境車牌管家 iOS／Android App（Flutter）

2026-11-15 起，iOS、Android App 由 uni-app 改為 Flutter。網頁版和微信小程序繼續用 uni-app（`mobile/`）。

- 方案、六個階段、代替清單和進度記錄：`docs/tasks/flutter-app-plan.md`
- 必須按目前 App 的 UI **一比一**完成：畫面、各種狀態、互動和動畫都要和現在相同，移植期間不做改良。
- 後端不改，連 `https://dualplate.masterappinc.com`。

## 目錄

| 位置 | 用途 |
|---|---|
| `lib/main.dart` | App 入口（`MaterialApp.router`）；未登入打開登入頁，已登入打開首頁分頁（開發時可用 `--dart-define=START=/sample` 打開組件樣板頁） |
| `lib/ui/tokens.dart` | 顏色、字號、圓角、陰影、控件高度、動畫。數值照抄 `mobile/src/App.vue`；頁面只可用這裏的數值，不可自寫 |
| `lib/ui/base.dart` | `App.vue` 通用樣式類別的對應組件（例如 `.list-card` → `ListCard`） |
| `lib/ui/dialogs.dart` | 確認框 `ask`、提示框 `notice`、底部選單 `choose`，對應 `mobile/src/lib/choice.js`；不用系統原生對話框 |
| `lib/ui/choices.dart`、`lib/ui/toast.dart` | 單選、勾選；提示（對應 `uni.showToast`） |
| `lib/business/` | 仿真車牌、`PlateChip`、`DueDate`、`StampMark`；`css.dart` 是 CSS 數值換算 |
| `lib/shell/` | 導航列、底部分頁、換頁動畫、路由；新頁面在 `router.dart` 登記 |
| `lib/core/` | API 連線和 401 處理、登入狀態、自管／托管用語和金額日期工具，對應 `mobile/src/lib/api.js` |
| `lib/pages/` | 各頁面，一頁一個目錄（現有 `login/`、`plate_detail/`；開發時用 `--dart-define=START=/plate-detail?id=<牌照 id>` 直接打開詳情頁） |
| `lib/business/card_capture*.dart`、`card_stage.dart`、`card_edges.dart`、`pick_image.dart` | 拍批文卡（全螢幕對準框、即時找卡邊和自動拍、相冊拖動縮放、截出 2274×1445 JPEG）和 Android 權限說明 |
| `assets/approval_card/`、`assets/fonts/` | 批文卡底圖（`tool/card_png.sh` 由原 SVG 轉成）；宋體子集（Noto Serif SC，OFL，`tool/song_subset.py` 產生，只在 Android 用） |
| `lib/ui/keyboard_bar.dart` | iOS 鍵盤上方的「上一項／下一項／完成」工具列 |
| `assets/tabbar/` | 底部分頁圖示，和 `mobile/src/static/` 同名檔案相同 |
| `lib/ui/sample.dart`、`sample_*.dart` | 組件樣板頁，用來和現有 App 對照（只在開發時用）；`lib/sample_business_main.dart` 是開發用入口 |
| `integration_test/` | 模擬器上自動操作外殼示範，配合錄影（不是單元測試） |
| `test/` | 單元和組件測試，一個情況一個具名測試。實卡樣本測試要 `api/test/fixtures/cards/`（不在 git 裏），找不到就跳過；`DP_CARD_FIXTURES=目錄` 可指明位置 |

## 常用指令

```bash
cd app && flutter analyze
```

```bash
cd app && flutter test
```

iOS 模擬器（iPhone 17 Pro，iOS 26）：

```bash
cd app && flutter build ios --simulator --debug && xcrun simctl install booted build/ios/iphonesimulator/Runner.app && xcrun simctl launch booted com.masterappinc.dualplate
```

Android 模擬器（打包、安裝、打開、截圖；用法見腳本開頭）：

```bash
app/run.sh
```

外殼示範（自動操作，可同時用 `xcrun simctl io <udid> recordVideo` 錄影）：

```bash
cd app && flutter test integration_test/shell_demo_test.dart -d <udid>
```

登入頁各狀態（印出 `SHOT:名稱` 時由外面截圖；帳號只用 `--dart-define=DP_PHONE=… --dart-define=DP_PASS=…` 傳入，不寫進檔案，不傳就不登入）：

```bash
cd app && flutter test integration_test/login_flow_test.dart -d <udid>
```

## 規則

- Bundle ID 和 Android 包名都是 `com.masterappinc.dualplate`，與現有 App 相同，不可更改，否則用戶不能直接升級。
- 不用 Material／Cupertino 的預設外觀；水波紋已在 `main.dart` 關掉。
- 文字逐字照搬 `mobile/` 現有的提示文字；新文字要管理者確認。
- 每改完一部分，在方案第九節加一筆進度記錄，並更新第八節代替清單的狀態。
