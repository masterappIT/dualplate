# 任務：司機管理（第 14.5 輪）

先讀 `AGENTS.md`、`docs/design-system.md`。本任務在第 14 輪驗收後進行。參照 **Fleetio**：司機是獨立聯絡人，證件到期掛在司機身上提醒。

## 業務規則（管理者已確認）

- 兩地牌一主兩副：每個牌照最多 1 位主司機、2 位副司機（批文卡「駕駛人 1–3」）
- 同一位司機可登記在多個牌照
- 換司機業務完成後，牌照的司機登記要更新

## 1. 資料

- `drivers`：`id`、`tenant_id`、`customer_id`、`name`、`phone`、`hk_id_no`（香港身份證，只存後 4 位以外遮蔽）、`home_return_permit_no`（回鄉證號）、`notes`、時間
- `plate_drivers`：`plate_asset_id`、`driver_id`、`role`（`主`／`副`）、`sort`、`registered_on`；同一牌照 `主` 最多 1、`副` 最多 2，同一司機在同一牌照只一條
- 一次性遷移：按每個牌照批文卡 `driver1–3` 姓名建立司機（同客戶同名視為同一人）並登記（driver1 為主）
- 證件到期全部用現有到期規則機制：新增 `scope='driver'` 及預設規則 `home_return_permit`（回鄉證）、`hk_driving_licence`（香港駕駛執照）、`cn_driving_licence`（內地駕駛證），手動填寫到期日、提前 60 天、客戶看得到、委託項目 `plate_service`
- 批文卡內容被修改後，若駕駛人姓名與登記不同，在牌照詳情提示「批文卡駕駛人與司機登記不一致」，按「同步」才更新（不自動改）

## 2. API（租戶隔離；員工可讀寫，客戶不可）

`GET/POST /api/drivers`、`GET/PATCH /api/drivers/:id`、`PUT /api/plates/:id/drivers`（整組設定主副司機，驗證上限）、`POST /api/plates/:id/drivers/sync-from-card`

## 3. 畫面

- 客戶詳情「車輛與司機」分頁：司機列表（`ListPage`），欄位：姓名、登記牌照（`PlateChip`）、各證件到期（`DueDate editable`）
- 牌照詳情：「司機」區塊顯示主／副司機，可更換（`FormDialog` 選現有或新增）
- 今日工作自動包含司機證件到期（規則機制）
- 工單「換司機」結案時的「更新到期日」對話框加入「更新司機登記」

## 4. 測試（具名、一情況一測試）

遷移建立與登記正確、同名合併、上限（第 2 位主司機、第 3 位副司機 400）、同一司機重複登記 400、跨租戶 404、客戶 403、證件到期出現在今日工作、客戶自理委託時不派工、同步批文卡、不一致提示。`npm test`、`npm run check`、兩端 build 全過，測試數量不減。

## 限制

遵守 `AGENTS.md`。不改 `mobile/`（客戶端司機顯示由負責人做）、兩個 `ApprovalCard.vue`。
