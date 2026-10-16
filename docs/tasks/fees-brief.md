# 任務：收費、代墊與報價（第 17 輪）

先讀 `AGENTS.md`、`docs/design-system.md`、`docs/v1-plan.md` 第三節。本任務在出租 A 輪（第 16 輪）驗收後進行。參照 **AppFolio 業主帳** 與 **TaxDome 帳單**。

**分工（2026-10-16）**：**後端與 32 項測試已由負責人完成**（`api/src/fees.js`、`api/test/fees.test.js`，提交 40dfa8b），客戶端帳單也由負責人做。**你（Codex）只做第 3 節管理端畫面**（加上結案收費、報價），不改 `api/`、`mobile/`。

### 可用的 API（只限管理者；員工、客戶 403；跨租戶 404；金額單位「分」）

| 用途 | 請求 | 說明 |
|---|---|---|
| 收費列表 | `GET /api/fees?customerId=&status=&kind=&overdue=1` | `{totals:{amount,paid,outstanding}（各為 {HKD:..,RMB:..}）, items:[{id,customerId,customerName,kind,kindLabel,requestId,plateId,description,currency,amount,paid,outstanding,incurredOn,dueOn,status,overdue,voidReason,installmentPlanId,installmentSeq,customerConfirmedAt,payments[]}]}` |
| 新增 | `POST /api/fees {customerId,kind:'annual'|'service'|'gov_fee'|'advance',currency,amount,description,dueOn?,requestId?,plateId?,notes?}` | 自有客戶 400；`rent_commission` 只由系統產生 |
| 修改／作廢 | `PATCH /api/fees/:id`；`POST /api/fees/:id/void {reason}` | 有收款不可作廢（先撤銷收款） |
| 收款 | `POST /api/fees/:id/payments {paidOn,amount,method,proof?}`；撤銷 `DELETE /api/fees/:id/payments/:pid` | 超過未收金額 400 |
| 年費設定 | `GET/PUT /api/customers/:id/billing {annualAmount,currency,billMonth:1–12,active?}` | 每年該月 1 日自動產生 |
| 分期 | `POST /api/installment-plans {customerId,name,currency,requestId?,installments:[{name,amount,dueOn}]}` | 2–12 期；每期一筆收費，客戶在客戶端確認 |
| 報價 | `GET/POST /api/quotes`、`GET/PATCH /api/quotes/:id`、`POST /api/quotes/:id/send`、`POST /api/quotes/:id/accept`、`GET /api/quotes/:id/print`（A4 HTML，帶令牌取得後在新視窗開啟列印） | 狀態 草擬→已發出→已接受；過期自動已失效 |
| 報價開工單 | 現有 `POST /api/work-orders` 加 `quoteId` | 只限已接受、未開過工單的報價 |
| 結案收費 | 工單 `PATCH` 結案時加 `fees:[{kind:'service'|'gov_fee'|'advance',currency,amount,description}]` 或 `skipFees:true` | 工單詳情 `expectedFees`（從報價帶入）作為預設值；員工結案時不顯示收費欄 |

## 業務規則（管理者已確認／負責人代決定）

- 向客戶收費三種都有：**年費**（按客戶、按年）、**每單代辦費**（工單完成時）、**租金抽成**（代收租金按合約的 `fee_type`／`fee_value`，第 16 輪已記錄）
- **政府規費與代辦費分開記**
- **代墊**：替客戶先付的規費、罰款、保險等，之後向客戶收回
- 新辦等大額業務可**分期收款**（定金 → 稅款 → 尾數），每期客戶確認
- 幣種：人民幣、港幣、澳門幣；**不做匯率換算**，按幣種分開合計
- 只有**管理者**可看與改收費；員工 403（第 14 輪的 `canManage`）
- 本公司（自有）客戶不產生收費

## 1. 資料

- `fee_items`：`id`、`tenant_id`、`customer_id`、`kind`（`annual` 年費／`service` 代辦費／`gov_fee` 政府規費／`advance` 代墊／`rent_commission` 租金抽成）、`request_id`（可空）、`plate_asset_id`（可空）、`description`、`currency`、`amount`（分）、`incurred_on`、`due_on`、`status`（`未收`／`部分收`／`已收`／`作廢`）、`installment_plan_id`（可空）、`notes`、時間
- `fee_payments`：`fee_item_id`、`paid_on`、`amount`、`method`、`proof`（圖片，另表）、`recorded_by`
- `installment_plans` 與 `installments`：分期名稱、每期金額、到期、客戶確認時間
- `customer_billing`：每客戶年費金額、幣種、計費月份（每年該月 1 日自動產生年費 `fee_items`，冪等）
- 工單結案時（第 14 輪結案對話框）加「本單收費」：代辦費、規費（可多筆）、代墊；可略過
- 代收租金入帳時自動產生 `rent_commission`（從應付客戶中扣），不重複

## 2. 報價

- `quotes`：客戶、業務、逐項（代辦費／規費／代墊預估）、幣種、有效期、狀態（`草擬`／`已發出`／`已接受`／`已失效`）
- 報價接受後可一鍵轉成工單並帶入預計收費
- 報價可列印（A4、證件感版面，`docs/design-system.md` 第二節）

## 3. 畫面（設定頁以外新增導航「收費」，只管理者可見）

- 列表 `ListPage`：客戶、類別、描述、金額（帶幣種）、到期、狀態（`StatusTag`）；篩選未收、逾期、按客戶、按類別
- 客戶詳情新增「收費」分頁：應收總額（按幣種）、明細、收款記錄
- 記收款 `FormDialog`；收款完成時「已收款」印章動效
- 報價列表與編輯 `Drawer`

## 4. 測試（後端已完成）

你只需確保 `cd api && npm test`（目前 308 項）、`cd admin && npm run check`、`cd admin && npm run build` 全過，截 1366／390（彈窗用點擊欄）。

## 限制

遵守 `AGENTS.md`。不改 `api/`、`mobile/`。
