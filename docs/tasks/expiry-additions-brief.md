# 任務：到期事項補充與 90 天過關提醒（第 13 輪）

> **2026-10-16 更新：後端與客戶端已由負責人完成並提交**（`f2aa4d8`、`e7c7deb`）：新規則、`since_last`／`after_field` 計算方式、`plate_crossings` 表、`api/src/crossings.js`、管理端 API `GET/POST /api/plates/:id/crossings`、`DELETE /api/plates/:id/crossings/:crossingId`、客戶 API、業務時區（香港）計算「今天」，測試見 `api/test/expiry-additions.test.js`。
> **管理者 2026-10-16 簡化：90 天過關提醒改為每個牌照自選開啟，預設關閉**（`plate_assets.crossing_reminder`，API `PUT /api/plates/:id/crossing-reminder {enabled}`；只有開啟的牌照才會出現在今日工作與到期清單）。管理端牌照詳情要有同一開關；牌照總表「上次過關」欄只對已開啟的牌照顯示倒數，其他顯示灰色「未開啟提醒」。
> **Codex 只需做第 3 節的管理端畫面**（今日工作「已過關」、牌照總表上次過關欄與篩選、牌照詳情過關記錄、公司卡片新欄位、規則設定新計算方式的白話顯示與編輯）。第 1、2 節僅供理解，不要重寫。API 回應格式：`{ lastCrossedOn, nextDueOn, days, crossings: [{ id, crossedOn, source, createdAt }] }`。

先讀 `AGENTS.md` 和 `docs/v1-plan.md`（第四節簡單使用準則、第五節參照系統）。本任務在「委託範圍與自有指標」驗收後進行。參照：**Fleetio 續期提醒**——每個事項「到期日＋提前提醒」，快到期／逾期兩段狀態。

## 業務規則（管理者已確認，不要自行修改）

- 兩地牌車輛**約每 90 天必須過關一次**
- 海關監管簿已取消，不做
- 新批文取得後 **6 個月內**須到海關、邊檢完成備案
- 海關及邊檢備案每年辦理一次

## 1. 新增預設規則（遷移時為每個租戶補上；已有同 code 的不覆蓋）

| code | 名稱 | 對象 | 適用 | 計算方式 | 提前提醒 | 客戶看得到 | 委託項目 |
|---|---|---|---|---|---|---|---|
| `customs_filing` | 海關及邊檢備案 | 牌照 | 全部 | 手動填寫到期日 | 30 天 | 是 | `plate_service` |
| `new_card_filing` | 新批文備案期限 | 牌照 | 全部 | 批文卡「有效期開始」（`card_data.validFrom`）後 183 天；標記完成後不再出現；沒有 validFrom 時不產生（不算「待錄入」） | 30 天 | 是 | `plate_service` |
| `crossing_90` | 90 天過關 | 牌照 | 全部 | 最近一次過關日期＋90 天（天數為規則參數，可改） | 15 天 | 是 | `plate_service` |
| `hk_registered_office` | 香港公司註冊地址／秘書服務合約 | 公司 | 香港 | 手動填寫到期日 | 30 天 | 是 | `secretary` |
| `cn_registered_address` | 內地公司註冊地址（掛靠）合約 | 公司 | 內地 | 手動填寫到期日 | 30 天 | 是 | `company_upkeep` |

- 新增計算方式 `since_last`（自上次事件起計），參數 `days`；規則設定頁「怎樣計算」白話寫成「上次過關後 90 天」
- `new_card_filing` 用新計算方式 `after_field`（某日期欄位後若干天，參數 `field`、`days`），白話「批文有效期開始後 183 天內」
- 規則設定頁的編輯彈窗要能修改這兩種方式的天數

## 2. 過關記錄

- 新表 `plate_crossings`：`id`、`tenant_id`、`plate_asset_id`、`crossed_on`（日期）、`source`（`admin`／`customer`）、`created_by`、`created_at`
- 過關掛在**牌照**上（換車後仍連續計算）
- 「最近一次過關」＝最大的 `crossed_on`；沒有任何記錄時，`crossing_90` 顯示「待錄入最近過關日期」
- `crossed_on` 不可晚於今天、不可早於 2000-01-01；同一牌照同一天重複提交只保留一條（回 200 並返回現有記錄）
- 管理端 API：`GET/POST /api/plates/:id/crossings`、`DELETE /api/plates/:id/crossings/:crossingId`（只可刪管理端自己錄入或 7 天內的記錄）
- 客戶端 API：`POST /api/customer/plates/:id/crossings`，只能為自己的牌照錄入；本任務**允許修改** `api/src/customer-routes.js` 只為加入這一個路由及 `computeDeadlines` 所需的過關資料，其餘不動，並在報告逐行說明

## 3. 畫面

- **今日工作**：`crossing_90` 行內直接有「已過關」按鈕，點後彈出日期（預設今天）→ 儲存；其他到期項目操作照舊
- **牌照總表**：加一欄「上次過關」（日期＋已過天數，例如「2026-09-01（45 天）」），超過 75 天橙色、超過 90 天紅色；可篩選「90 天內未過關」
- **牌照詳情**：「過關記錄」小區塊，列最近 10 條，可新增、可刪除（受上述限制）
- **客戶端**：由負責人親自做（牌照詳情「今天已過關」按鈕）；你只需提供第 2 節的客戶 API，並在報告列出請求與回應格式
- **公司卡片**：香港公司顯示「註冊地址／秘書合約到期」；內地公司顯示「註冊地址合約到期」；沒有錄入時「待錄入」並可就地填寫

## 4. 測試（一個情況一個具名測試）

- 每條新規則：有資料、沒資料、快到期、逾期、標記完成
- `since_last`：多條記錄取最近；換車後仍按牌照計
- `after_field`：沒有 validFrom 不產生；完成後不再出現
- 過關 API：未來日期 400、太早日期 400、空值／null／錯誤類型 400、同日重複不新增、不存在的牌照 404、別的租戶 404、客戶為別人的牌照錄入 404、客戶刪除 403、超過 7 天的客戶記錄不可刪
- 規則天數修改後即時影響推算
- `cd api && npm test`、`cd admin && npm run check`、`cd admin && npm run build`、`cd mobile && npm run build:h5` 全部通過

## 5. 驗收方式

負責人在 1366px 與 390px 實測：今日工作「已過關」、牌照總表上次過關欄和篩選、牌照詳情過關記錄、公司卡片新欄位、規則設定新規則的白話顯示和修改、客戶端「今天已過關」按鈕。

## 限制

遵守 `AGENTS.md`。不改 `mobile/`；`api/src/customer-routes.js` 只可按第 2 節加入過關路由；不改兩個 `ApprovalCard.vue`。
