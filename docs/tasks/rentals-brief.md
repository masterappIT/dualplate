# 任務：出租合約與每月租金（分兩輪）

先讀 `AGENTS.md`；需求背景見 `docs/requirements.md` §2、§5.5。

## 業務規則（管理者已確認）

- 部分兩地牌出租給他人使用，租金每月收取
- **收款方式兩種都有，每份合約單獨設定**：
  - `代收`：承租方付給代辦公司，代辦公司再和客戶（牌主）結算
  - `直付`：承租方直接付給客戶，系統只記錄是否收到
- 承租方**不登入系統**，透過每份合約的專屬連結查看合約、帳單、上傳轉帳憑證
- 第一階段不接電子簽約和線上支付（之後再做）

---

- **對外用語**（負責人代管理者決定，見 `docs/v1-plan.md` 第三節及 `docs/market-research.md` 第二節合規風險）：承租方連結、合約範本、客戶端一律寫「車輛使用安排」「使用費」，不寫「出租指標」「租用牌照」；管理端內部可用「出租」
- **自有指標**（2026-10-16）：出租方預設「本公司（自有）」，租金是本公司收入，不產生應付客戶結算；`lessor_type=agent` 只用於客戶的牌照

## 第 A 輪：合約、應收款、管理端與客戶端

> **委託範圍（第 12 輪已上線）**：牌照的 `rental_management` 為 `client`（客戶自理）時，管理端不產生收款提醒工作，只記錄合約與狀態；`outsourced` 時顯示外包單位。

### 1. 資料（一次性遷移，沿用 `schema_migrations`）

- `rental_contracts`：`id`、`tenant_id`、`plate_asset_id`、承租方（`renter_name`、`renter_type` 個人／公司、`renter_phone`、`renter_vehicle_plate`、`renter_driver`）、`starts_on`、`ends_on`、`rent_amount`（以「分」為單位的整數）、`lessor_type`（`company` 持牌的香港／澳門公司／`client` 客戶個人／`agent` 代辦公司作為代理人）與 `lessor_company_id`（`company` 時必填，須屬同一客戶）、`currency`（`HKD`／`RMB`／`MOP`）、`cycle`（`monthly`／`quarterly`／`yearly`）、`due_day`（1–28）、`deposit_amount`、`collection_mode`（`代收`／`直付`）、`fee_type`（`none`／`fixed`／`percent`）與 `fee_value`（代收時的管理費）、`status`（`草擬`／`生效`／`已結束`／`已終止`）、`notes`、建立及更新時間
- `rent_invoices`：`id`、`contract_id`、`period`（`YYYY-MM`，季繳／年繳用期初月份）、`due_on`、`amount`、`received_on`、`received_amount`、`received_by`（`代辦公司`／`客戶`）、`proof`（轉帳憑證圖片，另表存放）、`confirmed_by`、`notes`
- 既有 `plate_rentals` 中「出租中」的記錄遷移為 `生效` 合約（缺少租金資料者金額為 0、標註「待補充」），舊表保留不刪
- 兩地牌的 `usage_status` 改為由合約推算：有 `生效` 合約即「出租中」，合約結束則回到原本狀態；不要再讓兩處各自維護

### 2. 應收款生成

- 合約 `生效` 時，按週期生成從起租日到「今天起 3 個月」的應收款；之後每次讀取時補生成到同一範圍（冪等，不重複）
- 合約提前終止：終止日之後未收的應收款作廢（標記，不刪除）
- 修改金額只影響尚未到期的應收款

### 3. API（管理員；全部經租戶隔離）

- 合約：`GET /api/rental-contracts?plateId=&customerId=&status=`、`POST`、`PATCH /:id`、`POST /:id/terminate`
- 應收款：`GET /api/rent-invoices?contractId=&status=`、`POST /api/rent-invoices/:id/receive`（收款日期、金額、收款方、憑證圖片可選）、`POST /api/rent-invoices/:id/unreceive`（撤銷）
- 管理總覽 `GET /api/overview` 增加 `rent`：本月應收筆數與金額、已收、逾期（過了 `due_on` 仍未收），逾期租金也列入到期列表（level `overdue`，名稱「租金逾期」）
- 客戶：`GET /api/my/rentals`（只讀，自己名下牌照的合約摘要和最近 6 期應收款；承租方只回傳名稱和使用車牌，不回傳電話等其他個人資料）
- 驗證：金額為非負整數、日期合法、`due_day` 1–28、結束日不早於起始日、同一兩地牌同一時間只能有一份 `生效` 合約

### 4. 管理端（拆分任務完成後再做；放在 `admin/src/views/Rentals.vue`）

- 新導航「出租與租金」：合約列表（牌照、承租方、租金、收款方式、本期狀態），可按狀態、客戶篩選
- 合約新增／編輯彈窗；合約詳情顯示應收款表，可登記收款、上傳憑證、撤銷
- 兩地牌詳情的「出租記錄」改為顯示合約，並可從這裡新增合約
- 管理總覽顯示本月租金數字與逾期項

### 5. 客戶端（**負責人親自做**，你不要改 `mobile/`）

只需提供上述 `/api/my/rentals`；負責人會接上首頁「本月租金」、牌照詳情的出租資訊和新的租金頁面。

### 6. 測試

具名、一情況一測試：應收款生成與補生成冪等；季繳／年繳期數；提前終止作廢；同牌重疊合約被拒；收款與撤銷；逾期判斷；總覽租金數字；客戶只看到自己的合約且不含電話；跨租戶 404；客戶呼叫管理接口 403；舊 `plate_rentals` 遷移只執行一次。

---

## 第 B 輪（A 輪驗收後另行派發）：承租方專屬連結與代收結算

- 每份合約可產生專屬連結（32 位元組隨機令牌，資料庫只存雜湊值），可設有效期、隨時作廢重發；開啟時需輸入承租方電話末 4 碼
- 承租方頁面由 API 伺服器直接輸出精簡 HTML（不新增依賴）：合約摘要、可列印的合約全文（租戶可編輯合約範本，含佔位符）、各期帳單、上傳轉帳憑證（待代辦公司確認）、「我已閱讀並確認合約內容」按鈕（記錄姓名與時間；明確標示不是電子簽署）
- 頁面不顯示客戶的公司文件或個人資料；錯誤碼嘗試過多暫時鎖定
- 代收結算：按客戶、按月彙總代收租金、扣除管理費，得出應付客戶淨額；可標記已結算與結算日期

## 限制

遵守 `AGENTS.md`。A 輪不要碰 `mobile/` 和 `api/src/customer-routes.js` 以外的客戶端檔案；新增客戶接口請放在新檔或 `customer-routes.js` 尾部的新路由（不得改動既有路由行為）。
