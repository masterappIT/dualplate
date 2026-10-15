# 任務：收費、代墊與報價（第 17 輪）

先讀 `AGENTS.md`、`docs/design-system.md`、`docs/v1-plan.md` 第三節。本任務在出租 A 輪（第 16 輪）驗收後進行。參照 **AppFolio 業主帳** 與 **TaxDome 帳單**。

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

## 4. 測試（具名、一情況一測試）

年費每年只產生一次、工單結案收費、略過不產生、租金抽成不重複、分期確認、部分收款狀態、作廢、員工 403、客戶 403、跨租戶 404、自有客戶不產生、按幣種合計不換算、金額為負或非整數 400。`npm test`、`npm run check`、兩端 build 全過，測試數量不減。

## 限制

遵守 `AGENTS.md`。不改 `mobile/`（客戶端帳單顯示由負責人做；請提供 `GET /api/my/fees` 並在報告列出格式）。
