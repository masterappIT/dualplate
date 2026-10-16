# 任務：每月客戶報告（第 20 輪）

先讀 `AGENTS.md`、`docs/design-system.md`、`docs/v1-plan.md`。本任務在報帳追蹤（第 19 輪）驗收後進行。參照 **AppFolio 業主月結單**。

**分工（2026-10-16）**：**後端與 13 項測試已由負責人完成**（`api/src/reports.js`、`api/test/reports.test.js`，提交 9c17669）；客戶端由負責人做。**你（Codex）只做第 2 節管理端**，不改 `api/`、`mobile/`。

### 可用的 API（管理者與員工可看；只有管理者可重算／確認／更正；客戶 403；跨租戶 404）

| 用途 | 請求 | 說明 |
|---|---|---|
| 列表 | `GET /api/reports?customerId=&period=&status=` | `[{id,customerId,customerName,period,version,status:'草稿'|'已確認'|'已更正',confirmedAt,net:{HKD:..}}]`；打開列表時自動補產生上月草稿 |
| 詳情 | `GET /api/reports/:id` | 加 `report`（六節）與 `versions[]`；`report = {customerName, period, generatedOn, completed[{title,service,plate,completedOn}], upcoming[{name,owner,dueOn,daysLeft,level,handledBy:'us'|'you'}], usage{items[{plate,user,currency,amount,received,status,collectedByUs}],due,received,outstanding}, charges{items[{kind,kindLabel,description,currency,amount,status}],byKind}, net{collected,commission,unpaid,net}, filings[{company,status,dueOn,taxAmount,zeroFiling,hasReceipt}]}`，金額為「分」、按幣種分列 |
| 重算草稿 | `POST /api/reports/:id/recalculate` | 已確認 409 |
| 確認 | `POST /api/reports/:id/confirm` | 鎖定；同月舊確認版自動變「已更正」 |
| 更正 | `POST /api/reports/:id/correct` | 從已確認版產生下一版草稿 |

淨額正數＝應付客戶，負數＝客戶應付；畫面要寫清楚「應付客戶」「客戶應付」而不是只顯示正負號。月報給客戶看，用語一律「使用費」「代收服務費」，不寫「租金」。

## 業務規則（負責人代管理者決定）

- 每月 1 日自動為每位客戶（自有客戶除外）產生上月報告草稿；**管理者確認後客戶才看得到**
- 報告內容固定六節：
  1. **本月完成的工作**：已結案工單（業務、牌照、結案日）
  2. **即將到期**：未來 60 天到期事項（`DueDate`），標明「我們辦理」或「請你處理」（委託範圍 `client`）
  3. **車輛使用與使用費**：各合約本月應收、已收、未收（按幣種）
  4. **收費**：本月年費、代辦費、規費、代墊、租金抽成（按幣種）
  5. **應付／應收淨額**：代收使用費 − 抽成 − 代墊 − 未付收費 ＝ 應付客戶（正）或客戶應付（負），按幣種分列，**不換算**
  6. **內地公司報帳**：各公司本月報帳報稅狀態與回執
- 確認後鎖定；如需更正，產生「更正版」並保留舊版

## 1. 資料與 API

- `monthly_reports`：`id`、`tenant_id`、`customer_id`、`period`（`YYYY-MM`）、`version`、`status`（`草稿`／`已確認`／`已更正`）、`snapshot_json`（確認時凍結的全部數字）、`confirmed_by`、`confirmed_at`
- 產生：伺服器啟動及每次打開報告列表時補產生（冪等）
- 管理 API：列表、詳情、重新計算草稿、確認、產生更正版
- 客戶 API：`GET /api/my/reports`、`GET /api/my/reports/:id`（只回傳已確認，且不含內部備註）

## 2. 畫面

- 管理端新導航「月報」：`ListPage`（客戶、月份、狀態、淨額）；詳情為 A4 證件感版面（封面防偽底紋、客戶印章、票根分隔各節），可列印／存 PDF（瀏覽器列印）
- 確認按鈕：確認後「已確認」印章動效
- 客戶端由負責人做

## 3. 測試（後端已完成）

你只需確保 `cd api && npm test`（不少於 343 項）、`cd admin && npm run check`、`cd admin && npm run build` 全過，截 1366／390；列印版面用瀏覽器列印預覽自查。

## 限制

遵守 `AGENTS.md`。不改 `api/`、`mobile/`。
