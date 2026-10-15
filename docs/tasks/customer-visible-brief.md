# 任務：規則「客戶可見」設定

先讀 `AGENTS.md`。

## 背景

負責人已親自重做客戶端（`mobile/`）並新增客戶專用接口 `api/src/customer-routes.js`（`/api/my/overview`、`/api/my/companies`、`/api/my/plates/:id`），測試在 `api/test/customer.test.js`。這些是負責人寫的，**不要改動它們的行為**，只按本任務接上新欄位。

目前 `cn_status_check`「核對內地公司登記狀態」這類**員工內部工作**也會出現在客戶的到期提醒，導致 `api/test/customer.test.js` 有 2 項失敗（plateA 被判為逾期）。

## 要做的事

1. `rules` 表加 `customer_visible INTEGER NOT NULL DEFAULT 1`，用 `schema_migrations` 一次性遷移。
2. `defaultRules` 加 `customerVisible` 欄位：`cn_status_check` 為 `false`，其餘為 `true`；`seedRules` 寫入此值；既有租戶的 `cn_status_check` 在遷移時設為 0（只在遷移那一次）。
3. `GET /api/rules` 回傳 `customerVisible`（布林）；`POST`／`PATCH /api/rules` 接受 `customerVisible`（必須是布林，否則 400）。
4. `api/src/customer-routes.js` 的 `deadlines()`：上一輪你未經許可在這裡硬寫了 `code<>'cn_status_check'`，請**移除這個硬寫**，改為只使用 `active=1 AND customer_visible=1` 的規則。這是本任務唯一允許的修改點。
5. 管理端規則設定畫面：列表顯示「客戶可見／僅內部」；編輯和新增表單加切換。
6. 測試：
   - `api/test/customer.test.js` 必須全部通過（不得修改其中既有斷言；可新增測試）
   - 新增：`customer_visible=0` 的規則不出現在 `/api/my/*`；管理員總覽仍然顯示；遷移只執行一次
   - `cd api && npm test`、`cd admin && npm run build`、`cd mobile && npm run build:h5` 全部通過

## 附帶修正

7. 管理端 `admin/src/views/Companies.vue` 仍有「境外」字眼（頁面說明、「境外公司（香港／澳門）」標題、「尚未登記境外公司」提示）。按 `AGENTS.md` 用語規則改為「香港／澳門公司」，或按該組公司實際註冊地顯示「香港公司」「澳門公司」；全倉庫介面文字不得再出現「境外」。

8. 管理總覽在窄螢幕的卡片：標籤欄寬度不一致（「項目」的值和其他行起點不同、「對象」那行縮排不同）。所有行的標籤固定同一寬度、值從同一位置開始。

## 限制

遵守 `AGENTS.md`。除第 4 點外，不要改 `mobile/` 和 `api/src/customer-routes.js`。
