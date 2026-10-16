# 任務：司機管理（第 14.5 輪）

先讀 `AGENTS.md`、`docs/design-system.md`。

**分工（2026-10-16）**：**後端、遷移、測試和客戶端已由負責人完成**（`api/src/drivers.js`、`api/test/drivers.test.js`，提交 b5602f0、32fe9bb）。**你（Codex）只做下文第 3 節的管理端畫面**，不改 `api/`、`mobile/`；後端有問題寫進報告「疑慮」。

### 可用的 API（員工與管理者可用，客戶 403，跨租戶 404）

| 用途 | 請求 | 回應 |
|---|---|---|
| 司機列表 | `GET /api/drivers?customerId=` | `[{id,customerId,name,phone,hkIdNo（已遮蔽）,homeReturnPermitNo,notes,plates:[{plateId,role,registeredOn,mainlandPlate,localPlate,route}],documents:[{code,name,expiresOn}]}]` |
| 新增 | `POST /api/drivers {customerId,name,phone?,hkIdNo?,homeReturnPermitNo?,notes?}` | 201 同上；同客戶同名 409 |
| 單一／修改 | `GET`、`PATCH /api/drivers/:id`（不可改客戶；遮蔽的身份證原樣送回不會覆寫） | 同上 |
| 牌照的司機 | `GET /api/plates/:id/drivers` | `{plateId,drivers:[{driverId,name,phone,role,registeredOn}],cardDrivers:[駕駛人1,2,3],mismatch}` |
| 整組設定 | `PUT /api/plates/:id/drivers {drivers:[{driverId,role:'主'|'副'}]}` | 同上；第 2 位主司機、第 3 位副司機、重複、其他客戶的司機都 400 |
| 按批文卡同步 | `POST /api/plates/:id/drivers/sync-from-card` | 同上；批文卡沒有駕駛人 400 |
| 證件到期 | 現有 `GET/PUT /api/tracked-items`，`ownerType='driver'`，規則代碼 `home_return_permit`、`hk_driving_licence`、`cn_driving_licence` | — |
| 結案更新 | 工單 `PATCH` 的 `deadlineUpdates` 已接受 `ownerType='driver'` | — |

今日工作的到期列表已自動包含司機證件（`ownerType='driver'`，`label` 為「司機 姓名」）。

參照 **Fleetio**：司機是獨立聯絡人，證件到期掛在司機身上提醒。

## 業務規則（管理者已確認）

- 兩地牌一主兩副：每個牌照最多 1 位主司機、2 位副司機（批文卡「駕駛人 1–3」）
- 同一位司機可登記在多個牌照
- 換司機業務完成後，牌照的司機登記要更新

## 1. 資料（已完成，供理解）

- `drivers`：`id`、`tenant_id`、`customer_id`、`name`、`phone`、`hk_id_no`（香港身份證，只存後 4 位以外遮蔽）、`home_return_permit_no`（回鄉證號）、`notes`、時間
- `plate_drivers`：`plate_asset_id`、`driver_id`、`role`（`主`／`副`）、`sort`、`registered_on`；同一牌照 `主` 最多 1、`副` 最多 2，同一司機在同一牌照只一條
- 一次性遷移：按每個牌照批文卡 `driver1–3` 姓名建立司機（同客戶同名視為同一人）並登記（driver1 為主）
- 證件到期全部用現有到期規則機制：新增 `scope='driver'` 及預設規則 `home_return_permit`（回鄉證）、`hk_driving_licence`（香港駕駛執照）、`cn_driving_licence`（內地駕駛證），手動填寫到期日、提前 60 天、客戶看得到、委託項目 `plate_service`
- 批文卡內容被修改後，若駕駛人姓名與登記不同，在牌照詳情提示「批文卡駕駛人與司機登記不一致」，按「同步」才更新（不自動改）

## 2. API（已完成，見上表）

`GET/POST /api/drivers`、`GET/PATCH /api/drivers/:id`、`PUT /api/plates/:id/drivers`（整組設定主副司機，驗證上限）、`POST /api/plates/:id/drivers/sync-from-card`

## 3. 畫面

- 客戶詳情「車輛與司機」分頁：司機列表（`ListPage`），欄位：姓名、登記牌照（`PlateChip`）、各證件到期（`DueDate editable`）
- 牌照詳情：「司機」區塊顯示主／副司機，可更換（`FormDialog` 選現有或新增）
- 今日工作自動包含司機證件到期（規則機制）
- 工單「換司機」結案時的「更新到期日」對話框加入「更新司機登記」

## 4. 測試（後端已完成 27 項具名測試）

你只需確保 `cd api && npm test`（目前 250 項）、`cd admin && npm run check`、`cd admin && npm run build` 全過；每個改動畫面截 1366／390，彈窗用點擊欄。

## 限制

遵守 `AGENTS.md`。不改 `api/`、`mobile/`、兩個 `ApprovalCard.vue`。
