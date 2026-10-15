# 任務：第一階段實作（多租戶、公司組、到期規則、管理總覽）

你是實作工程師。技術負責人會逐項審查你的結果，不符合驗收標準會要求重做。

## 背景（必讀）

- 業務需求：`docs/requirements.md`（特別是 §1.2 官方規則核對結論）
- 本階段設計：`docs/phase1-design.md`
- 業務簡述：代辦公司全權托管客戶的粵港／粵澳兩地牌。一組公司＝一間境外公司（香港或澳門，持有指標並辦理業務）＋一間內地公司（內承單位），掛 1 個或多個指標。每個指標的類別和口岸都可能不同。日後會做成 SaaS 給同行使用，所以要多租戶、規則可設定。

## 已有的半成品（負責人寫的，未提交）

- `api/src/rules.js`：預設規則與 `computeDeadlines` 引擎
- `api/src/db.js`：新表 `tenants`、`company_groups`、`companies`、`rules`、`tracked_items`、`rule_completions`，以及新欄位和預設租戶遷移
- `api/src/server.js`：現有路由已加租戶隔離（`canAccessCustomer` 檢查 `tenant_id`）
- `api/src/create-admin.js`：建立管理員時寫入 `tenant_id`

在這些基礎上繼續。發現其中有錯可以修正，但要在最終報告裡逐項說明改了甚麼、為甚麼。

## 要做的事

### A. API（`api/src/server.js`，可另拆模組）

全部新路由只限 `role === 'admin'`，且只能操作自己租戶的資料（經 `customers.tenant_id` 或表上的 `tenant_id`）。跨租戶存取一律回 404。

1. **公司組**
   - `GET /api/company-groups?customerId=`：回傳該租戶（或指定客戶）的公司組，每組附 `companies`（公司陣列）和 `plates`（`plate_assets.group_id` 指向此組的兩地牌，含 id、route、mainland_plate、local_plate、indicator_category、port、usage_status）
   - `POST /api/company-groups` `{customerId, name, notes}`
   - `PATCH /api/company-groups/:id` `{name, notes}`
2. **公司**
   - `GET /api/companies?customerId=`
   - `POST /api/companies` `{customerId, groupId, jurisdiction, name, registrationNo, incorporatedOn, taxpayerType, notes}`；`jurisdiction` 只接受 `香港`／`澳門`／`內地`；`groupId` 可空，但若有必須屬同一客戶；日期用 `YYYY-MM-DD` 驗證
   - `PATCH /api/companies/:id`（同上欄位，部分更新）
3. **車輛**：`PATCH /api/vehicles/:id`，可改 `firstRegisteredOn`、`origin`、`plate`、`brand`、`model`、`vin`、`manufacturedYear`、`notes`。`GET /api/vehicles/:id` 回傳要含 `first_registered_on`（現已是 `SELECT *`，確認即可）
4. **到期項目（手動錄入）**
   - `GET /api/tracked-items?ownerType=&ownerId=`：回傳該對象「適用的 `expiry` 規則」清單，每項含規則 code、name、remindDays，以及已錄入的 `expiresOn`、`notes`、`updatedBy`、`updatedAt`。適用與否用 `ruleMatches` 和對象的 facts 判斷
   - `PUT /api/tracked-items` `{ownerType, ownerId, code, expiresOn, notes}`：upsert；`code` 必須是本租戶、同 scope、method 為 `expiry` 的規則；`expiresOn` 可為空字串（代表清除）
5. **規則**
   - `GET /api/rules`：本租戶全部規則，`match_json`／`params_json` 解析成物件回傳
   - `POST /api/rules`：新增自訂規則 `{code, name, scope, method, match, params, remindDays}`；`code` 須符合 `^[a-z][a-z0-9_]{1,39}$` 且租戶內唯一
   - `PATCH /api/rules/:id`：可改 `name`、`remindDays`（整數 0–730）、`active`、`match`、`params`；不可改 `code`、`scope`、`method`
   - 驗證：`scope` ∈ `ruleScopes`，`method` ∈ `ruleMethods`，`match` 的鍵只允許 `matchKeys`，值為字串或字串陣列；`params` 依 method 驗證（`yearly` 需 1–12 月與合法日；`anniversary` 需整數 `offsetDays`；`inspection` 需整數陣列 `markYears`、`inspectYears` 與整數 `yearlyFrom`；`expiry` 為空物件）
   - 不提供刪除，以 `active=false` 停用
6. **推算型項目完成記錄**
   - `POST /api/rule-completions` `{ruleCode, ownerId, period}` 標記本期完成；`DELETE /api/rule-completions` 同樣參數撤銷
   - 必須驗證 owner 屬本租戶、規則存在且非 `expiry`
7. **管理總覽**：`GET /api/overview?days=90`（days 限 7–365，預設 90）
   - 用 `computeDeadlines` 計算本租戶全部對象：
     - 兩地牌 facts：`route`、`indicatorCategory`、`port`
     - 公司 facts：`jurisdiction`、`incorporatedOn`
     - 車輛 facts：`route`、`origin`、`firstRegisteredOn`
   - `ownerLabel` 要讓人看得懂，例如兩地牌用「內地車牌 · 港澳車牌」，公司用公司名，車輛用車牌
   - 回傳 `{ deadlines（排除 level 為 ok 的）, counts: {overdue, due, missing, upcoming}, plates: {total, byUsage}, customers: [{id, name, plates, companies, overdue, due, missing, health}] }`，`health` 為 `red`（有逾期）、`amber`（有需處理或待錄入）、`green`
8. **租戶工具**：新增 `api/src/create-tenant.js` 與 `npm run create-tenant`，用環境變數 `TENANT_NAME`、`ADMIN_USERNAME`、`ADMIN_NAME`、`ADMIN_PASSWORD` 建立新租戶、播種預設規則（用 `seedRules`）及第一個管理員

### B. 管理端（`admin/`）

- 新畫面放在 `admin/src/views/` 與 `admin/src/components/`；`App.vue` 只做必要改動（導航、切換畫面、兩地牌與車輛詳情的插入點）。`App.vue` 是密集的單行風格，改動時保持一致，不要整檔重排
- 沿用 `admin/src/style.css` 已有的樣式類別（`panel`、`panel-head`、`form-grid`、`button primary`、`record-row`、`empty` 等）；需要新樣式時加在 `style.css` 尾部
- 全部介面文字使用繁體中文；不要加「非官方承諾」之類的免責字句

1. **管理總覽**（新導航第一項，登入後的預設畫面；原「工作總覽」保留並改名為「案件工作台」）
   - 四個數字：已逾期、需處理、待錄入、90 天內到期；點擊可篩選下方列表
   - 到期列表：項目名稱、對象、客戶、到期日、剩餘天數、狀態；可按狀態和客戶篩選；推算型項目有「本期已完成」按鈕；點擊對象跳到兩地牌詳情、車輛詳情或「公司與指標」畫面
   - 客戶健康列表（紅／黃／綠）與兩地牌使用狀況統計
2. **公司與指標**（新導航）
   - 選擇客戶後列出公司組；每組顯示公司（司法區、名稱、登記號碼、成立日期、納稅人類型）與所屬兩地牌
   - 可新增公司組、新增及編輯公司；每間公司可錄入其 `expiry` 到期項目（例如香港商業登記證）
3. **兩地牌詳情**：在現有表單加入「公司組」「指標類別」「口岸」三個下拉；加一個「到期項目」面板，列出適用的 `expiry` 規則並可錄入日期和備註
   - 指標類別選項：投資類、資格類、人才類、投資高新企業類、捐贈類、其他
   - 口岸選項：深圳灣、港珠澳大橋、蓮塘／香園圍、落馬洲、皇崗、文錦渡、沙頭角、拱北、橫琴、其他
4. **車輛詳情**：加入「港澳首次註冊日期」欄位和該車輛的到期項目面板
5. **規則設定**（新導航）：列出規則（名稱、對象、計算方式、條件、參數、提醒天數、啟用）；可編輯可修改的欄位；可新增自訂規則；條件和參數用易懂的表單，不要求用戶手寫 JSON

### C. 測試

- `api/package.json` 加 `"test": "node --test"`；測試放 `api/test/`
- `rules.js` 單元測試：`yearly`、`anniversary`（含 2 月 29 日）、`inspection`（第 2、4、8 年領標誌，第 6 年檢驗，第 10 年起每年）、`expiry` 缺日期為 `missing`、完成後跳到下一期、去年已過期很久的項目不出現、`ruleMatches` 的陣列條件
- API 整合測試：用臨時 `DB_PATH` 與隨機 `PORT` 啟動伺服器（不得使用 `api/data/` 下的真實資料庫），涵蓋：
  - 兩個租戶互相看不到客戶、兩地牌、公司、規則、總覽，跨租戶存取回 404
  - 公司組與公司的新增、修改、驗證錯誤
  - 到期項目錄入後總覽出現正確的 `overdue`／`due`／`missing`
  - 修改規則提醒天數或停用規則後，總覽結果隨之改變
  - 完成記錄的新增與撤銷
  - 客戶帳號呼叫新路由回 403
- `cd api && npm test` 與 `cd admin && npm run build` 都必須通過

## 限制

- 不新增任何 npm 依賴；後端只用 Node 24 內建模組
- **不得讀取或修改** `api/data/`、`data/`、任何 `*.sqlite` 檔、`api/tessdata/`，以及倉庫外的檔案
- 不要改 `mobile/`；不要 git commit 或建立分支
- 保留現有功能，不要改動與本任務無關的程式碼
- **批文卡的前端效果必須保留**：模擬卡的外觀、正反翻轉、預覽、疊層卡片、版本選擇、上傳後顯示辨識結果、手動修改欄位、原件掃描核對等畫面和交互，要和現在看起來、用起來一樣。不得修改 `admin/src/components/ApprovalCard.vue`、`mobile/src/components/ApprovalCard.vue` 的呈現效果
- **批文卡的新增和存檔邏輯可以改**：後端儲存方式、API、資料結構可按本階段需要調整（例如歸屬租戶、關聯公司組）。但改動後，前端上述流程必須照常可用；如果改了 API，要同步更新前端呼叫，並在報告中說明
- 後端程式風格與 `server.js` 一致

## 完成後的報告

在最後回覆中用繁體中文列出：
1. 新增及修改的檔案
2. 新 API 一覽
3. 對負責人半成品所做的修正及原因
4. 執行過的測試指令與結果（貼出通過／失敗數）
5. 未完成或有疑慮的地方
