# 任務：客戶端到期提醒（第三階段）

先讀 `AGENTS.md`。需求背景見 `docs/requirements.md` §5.6、§5.8；到期規則引擎見 `api/src/rules.js` 與 `docs/phase1-design.md`。

## 目標

委託客戶在小程序／App／H5 裡，看到**自己名下**每個兩地牌、每輛車、每間公司的到期日和提醒。資料和管理端總覽同源，由同一套規則計算。

## A. 後端

1. **規則新增「客戶可見」設定**：`rules` 表加 `customer_visible INTEGER NOT NULL DEFAULT 1`（用一次性遷移，沿用第一階段的 `schema_migrations`）。管理端規則設定畫面可切換。`PATCH /api/rules/:id` 接受 `customerVisible`（布林）。
2. **`GET /api/my/deadlines?days=180`**（只限 `role === 'customer'`；管理員呼叫回 403）：
   - 只計算該客戶自己的兩地牌、車輛、公司，且只用 `active` 且 `customer_visible` 的規則
   - 回傳 `{ deadlines, counts: { overdue, due, upcoming } }`
   - **不回傳 `missing`（待錄入）項目**。資料未錄入是代辦公司的內部工作，不顯示給客戶
   - 每項含：項目名稱、對象類型與標籤、到期日、剩餘天數、狀態；推算型項目附說明（例如「第 6 年上線檢驗」「2026 年度」）
   - 不回傳內部欄位（規則 id、code、tenant_id、備註中的內部記錄）
   - `days` 限 30–365，預設 180
3. **`GET /api/my/companies`**（只限客戶）：回傳自己名下的公司組，每組含境外公司、內地公司（名稱、司法區、登記號碼、成立日期）與所屬兩地牌（車牌、類別、口岸）。只讀
4. `GET /api/plate-assets/:id`（客戶呼叫時）在回應加 `deadlines`：該牌適用的到期項目（同第 2 點的過濾）
5. 客戶不能標記完成、不能修改到期日、不能看別的客戶或別的租戶的資料

## B. 客戶端（`mobile/`）

沿用現有頁面風格（`mobile/src/uni.scss`、各頁現有元件與排版），繁體中文。

1. **總覽頁**（`pages/index/index.vue`）：把現有「牌證提醒」區塊改為讀取 `/api/my/deadlines`。顯示最近 3 項（逾期優先），每項顯示名稱、對象、到期日、剩餘天數、狀態色（逾期紅、需處理琥珀、即將到期綠）；「查看全部」進入到期提醒頁。沒有項目時沿用現有的空狀態樣式
2. **新頁面「到期提醒」**（`pages/deadlines/deadlines.vue`，在 `pages.json` 註冊，不加入底部分頁）：完整列表，可按「全部／兩地牌／車輛／公司」篩選；點擊兩地牌項目進入該牌檔案
3. **兩地牌檔案頁**（`pages/plate-detail/plate-detail.vue`）：新增「到期項目」區塊，列出該牌的到期項目（唯讀）
4. **新頁面「我的公司」**（`pages/companies/companies.vue`）：按公司組列出境外公司、內地公司和所屬兩地牌；從總覽頁的「管理資料」入口或適當位置進入
5. **批文卡前端效果不得改變**：不修改 `mobile/src/components/ApprovalCard.vue`；兩地牌頁的疊層卡片、單獨預覽、翻轉保持原樣

## C. 管理端

- 規則設定畫面加「客戶可見」切換和列表顯示

## D. 測試

- 整合測試（具名、一情況一測試）：客戶只看到自己的到期項目；看不到 `missing`；看不到 `customer_visible=0` 的規則；看不到停用規則；跨客戶、跨租戶資料不出現；管理員呼叫 `/api/my/*` 回 403；回應不含內部欄位
- `cd api && npm test`、`cd admin && npm run build`、`cd mobile && npm run build:h5` 全部通過
- 按 `AGENTS.md` 在瀏覽器檢查 H5 客戶端（390px）的總覽、到期提醒、兩地牌檔案、我的公司四個畫面；無法使用瀏覽器時如實寫明

## 限制

遵守 `AGENTS.md` 全部限制。本任務允許修改 `mobile/` 中上述頁面、`pages.json` 和 `lib/api.js`。
