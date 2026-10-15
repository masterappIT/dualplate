# 任務：委託範圍與自有指標

先讀 `AGENTS.md`。本任務在「管理端結構重整」驗收後進行。業務背景見 `docs/requirements.md` 第 5.6.1 節（管理者 2026-10-16 確認）。

## 業務規則（管理者已確認，不要自行修改）

- 系統服務多位客戶，每位委託的範圍不同；例如李先生：牌照業務和內地公司（維護＋每月報帳）委託我們，**香港公司由客戶自理**。
- 委託範圍**按每間公司、每個牌照逐項設定**，不是按客戶一刀切。
- 「客戶自理」的項目：仍記錄、仍推算到期日（辦牌要用到），只提醒客戶；**不產生員工工作，不計入今日工作的任何數字和分頁**。
- 本公司也有自有的兩地牌指標（出租、自用、空置、準備轉讓都有），用同一套功能管理。

## 1. 資料（一次性遷移，沿用 `schema_migrations`）

- 新表 `service_scopes`：`id`、`tenant_id`、`owner_type`（`company`／`plate`）、`owner_id`、`service`、`handler`（`us` 我們做／`outsourced` 外包／`client` 客戶自理）、`provider_name`（外包時必填，例如會計公司名稱）、`started_on`、`ended_on`（空＝現行）、`notes`、`updated_by`、`updated_at`
  - 同一 `owner_type + owner_id + service` 只可有一條現行記錄；修改時把舊記錄填上 `ended_on` 再新增，保留歷史
- `service` 固定清單：
  - 公司：`company_upkeep` 公司維護（年報、周年申報、商業登記、狀態核對）、`bookkeeping` 每月報帳報稅、`audit_tax` 審計及利得稅（只適用香港、澳門公司）、`secretary` 公司秘書（只適用香港公司）
  - 牌照：`plate_service` 牌照業務代辦（續期、換車、備案、驗車等）、`rental_management` 出租代管
  - 不適用的組合（例如內地公司的 `secretary`）API 回 400
- 沒有記錄的項目一律視為 `us`（保持現有行為，現有資料不用逐條遷移）
- `customers` 加 `is_self INTEGER NOT NULL DEFAULT 0`
- 每個租戶自動建立一個「本公司（自有）」客戶（`is_self=1`，類型「公司」）：遷移時為現有租戶建立，新建租戶時同時建立；每個租戶最多一個

## 2. 規則與委託項目的對應

每條到期規則屬於一個委託項目。在 `rules` 加 `service` 欄位，預設規則對應如下；自訂規則在規則彈窗選擇（預設按對象：公司 → `company_upkeep`，牌照、車輛 → `plate_service`）：

| 規則 | 委託項目 |
|---|---|
| `approval`、`hk_crp`、`mo_permit` | `plate_service` |
| 車輛規則（`hk_licence`、`local_insurance`、`cn_ctpl`、`inspection`） | 該車輛所屬牌照的 `plate_service`；車輛沒有掛牌照時視為 `us` |
| `hk_nar1`、`hk_br`、`cn_annual_report`、`cn_status_check` | `company_upkeep` |
| `cn_cit_annual`、`mo_tax` | `bookkeeping` |

- 新增預設規則 `hk_audit_tax`「香港公司審計及利得稅報稅」：公司、只適用香港公司、手動填寫到期日、提前 60 天、客戶看得到、委託項目 `audit_tax`。可在待辦中標記「本年未做」（記錄在 `tracked_items.notes`，到期項目顯示「未做」風險標籤）
- `computeDeadlines` 的每個結果加上 `service`、`handler`、`providerName`

## 3. 對各頁面的影響

- **今日工作**：`handler=client` 的項目不出現在任何分頁，也不計入上方數字；`outsourced` 的項目照常出現，顯示「外包：會計公司名」
- **客戶詳情、牌照總表、公司卡片**：`client` 的項目照常顯示日期，加灰色標籤「客戶自理」，不提供「開工單」「已辦好」按鈕；仍可填日期
- 客戶端：`customer-routes.js` 由負責人改，你**不要改**；你只要確保 `computeDeadlines` 的結果帶有 `handler`，並在報告寫明欄位名

## 4. 設定委託範圍的介面

- 客戶詳情「公司組」分頁：每間公司卡片加「委託範圍」區塊，逐項顯示「我們做／外包：某某／客戶自理」，點「修改」打開彈窗（沿用 `App.vue` 的 modal 模式）
- 牌照詳情：同樣顯示 `plate_service`、`rental_management`
- **委託範本**：客戶詳情頁首加「套用委託範本」，選範本後一次套用到該客戶全部公司和牌照，套用前顯示將改變的項目清單並確認：
  - 全權托管：全部 `us`
  - 只管牌照：牌照兩項 `us`，公司全部 `client`
  - 牌照＋內地公司：牌照兩項 `us`；內地公司全部 `us`；香港、澳門公司全部 `client`
- 每項可查看修改歷史（誰、何時、由甚麼改成甚麼）

## 5. 自有指標

- 「本公司（自有）」在客戶列表置頂，有「自有」標籤；**不可刪除、不可開通客戶端登入**（API 回 409，介面不顯示對應按鈕）
- 牌照總表、今日工作加篩選：全部／客戶的／自有的
- 自有客戶的委託範圍不可設為 `client`（API 回 400），介面上不顯示「客戶自理」選項
- 出租功能尚未做；`docs/tasks/rentals-brief.md` 已註明出租方預設本公司、自有指標的租金不產生應付客戶結算，本任務不用處理

## 6. 轉讓牌照到其他客戶

- 新增 `POST /api/plates/:id/transfer`，內容 `{ toCustomerId, transferredOn, notes }`
- 一併搬移：該牌照、其所屬公司組及組內公司、牌照掛的車輛；到期記錄（`tracked_items`）、完成記錄、委託範圍跟隨對象不用改
- **公司組內還有其他牌照時**（一間公司持兩個指標）：回 409 並列出其他牌照；請求可帶 `includePlateIds` 一次轉讓整組
- 舊的案件／工單保留在原客戶名下，不搬
- 新表 `plate_transfers` 記錄：牌照、原客戶、新客戶、日期、備註、操作人；牌照詳情顯示轉讓歷史
- 只可在同一租戶內轉讓；不可轉給自己現在的客戶；目標客戶不存在、屬別的租戶都要拒絕
- 普通的牌照、公司、車輛編輯 API **不可修改 `customer_id`**（若現有 API 可以，改為忽略並在報告列出）
- 介面：牌照詳情加「轉讓給其他客戶」按鈕，彈窗選客戶、日期、備註，確認前列出將一併搬移的公司和車輛

## 7. 測試（一個情況一個具名測試）

- 委託範圍：新增、修改後保留歷史、同時只有一條現行、不適用組合 400、外包缺 `provider_name` 400、空值／null／錯誤類型、不存在的 ID、別的租戶的公司或牌照、客戶帳號越權
- 今日工作：`client` 項目不出現、不計數；`outsourced` 帶外包名稱；沒有記錄時等同 `us`
- 車輛規則跟隨所屬牌照的 `plate_service`
- 範本：三個範本各自結果正確；重複套用不產生多餘歷史
- 自有客戶：遷移只建立一次、每租戶一個、不可刪除、不可開通登入、不可設 `client`
- 轉讓：成功搬移、整組 409、`includePlateIds` 整組成功、跨租戶拒絕、轉給原客戶拒絕、舊工單仍在原客戶、普通編輯改不到 `customer_id`、重複提交不重複搬移
- `cd api && npm test`、`cd admin && npm run check`、`cd admin && npm run build`、`cd mobile && npm run build:h5` 全部通過

## 8. 驗收方式

負責人會在 1366px 與 390px 實測：公司卡片的委託範圍與修改彈窗、範本套用預覽與確認、修改歷史、今日工作排除客戶自理項目、「客戶自理」標籤、自有客戶置頂與限制、自有／客戶篩選、轉讓彈窗與整組轉讓。

## 限制

遵守 `AGENTS.md`。不改 `mobile/`、`api/src/customer-routes.js`、兩個 `ApprovalCard.vue`。
