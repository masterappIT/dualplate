# 跨境車牌管家 iOS／Android App（Flutter）

2026-11-15 起，iOS、Android App 由 uni-app 改為 Flutter。網頁版和微信小程序繼續用 uni-app（`mobile/`）。

- 方案、六個階段、代替清單和進度記錄：`docs/tasks/flutter-app-plan.md`
- 必須按目前 App 的 UI **一比一**完成：畫面、各種狀態、互動和動畫都要和現在相同，移植期間不做改良。
- 後端不改，連 `https://dualplate.masterappinc.com`。

## 目錄

| 位置 | 用途 |
|---|---|
| `lib/main.dart` | App 入口；階段 1 期間只打開組件樣板頁 |
| `lib/ui/tokens.dart` | 顏色、字號、圓角、陰影、控件高度、動畫。數值照抄 `mobile/src/App.vue`；頁面只可用這裏的數值，不可自寫 |
| `lib/ui/base.dart` | `App.vue` 通用樣式類別的對應組件（例如 `.list-card` → `ListCard`） |
| `lib/ui/dialogs.dart` | 確認框 `ask`、提示框 `notice`、底部選單 `choose`，對應 `mobile/src/lib/choice.js`；不用系統原生對話框 |
| `lib/ui/sample.dart` | 組件樣板頁，用來和現有 App 對照（只在開發時用） |
| `test/` | 單元和組件測試，一個情況一個具名測試 |

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

Android：尚未設定（階段 1 會加 `app/run.sh`，做法同 `android/emu-run.sh`）。

## 規則

- Bundle ID 和 Android 包名都是 `com.masterappinc.dualplate`，與現有 App 相同，不可更改，否則用戶不能直接升級。
- 不用 Material／Cupertino 的預設外觀；水波紋已在 `main.dart` 關掉。
- 文字逐字照搬 `mobile/` 現有的提示文字；新文字要管理者確認。
- 每改完一部分，在方案第九節加一筆進度記錄，並更新第八節代替清單的狀態。
