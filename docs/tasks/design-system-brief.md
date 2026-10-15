# 任務：管理端移植腳手架交互並建立本產品設計系統（第 11.5 輪）

先讀 `AGENTS.md`，再**完整閱讀 `docs/design-system.md`**（規格）。參考來源：`/Users/vincentw/development/scaffold-master/scaffold-vue`（管理者本人的腳手架，MIT 授權）——先讀它的 `DESIGN.md`、`docs/admin-redesign-architecture.md` 和 `scaffold-vue/src`，了解組件 API 與交互。**只讀不改**腳手架目錄。

## 目標

管理端改用腳手架的交互與排版（組件、列表頁、表單彈窗、浮層、外殼、動效），換上本產品自己的風格（第二節），呈現統一視覺語言。**功能、資料流、後端 API 一律不變**。

## 1. 技術基礎（本任務允許新增依賴）

- `admin/` 新增：`vue-router@4`、`gsap@3`（依賴）；`typescript@~5.7`、`vue-tsc@2`（開發依賴）。版本與腳手架 `package.json` 一致，寫入並產生 lock
- 新增 `tsconfig.json`（`allowJs: true`，路徑別名 `@/` → `src/`，同步加到 `vite.config`）；新檔用 TypeScript，現有 JS 可逐步轉，不強制本輪全轉
- 改用 Vue Router（hash 模式）：`#/today`、`#/customers`、`#/customers/:id`、`#/plates`、`#/plates/:id`、`#/vehicles/:id`、`#/business`、`#/requests/:id`、`#/requests/new`、`#/settings/:tab?`；舊網址（`#plates`、`#dashboard` 等）重新導向；瀏覽器上一頁／下一頁正常
- 現有 `store.js` 的資料與動作保留，頁面改由路由參數決定打開哪個客戶／牌照／工單；換頁後資料要重新整理（現在用網址直接進入不會更新，屬缺陷）

## 2. 移植（從腳手架複製，保留 API）

按 `docs/design-system.md` 第四節清單移植 `components/ui`、`components/business`（`ListPage`、`SearchForm`、`FormDialog`、`BoardView`）、`components/layout`（`AppShell`、`Sidebar`、`Topbar`、`CommandPalette`）、`composables`（`list`、`focus`、`motion`、`toast`、`confirm`、`view`）。

- 腳手架依賴後端的部分（權限碼、服務端菜單、字典接口、部門接口）改為本產品資料：菜單為固定五項（今日工作、客戶、牌照、業務、設定），`PermissionButton` 暫不移植
- 樣式按七層方法建立 `admin/src/styles/`，**token 和 materials 必須重寫**成第二節的值；`components.css`、`layout.css` 可沿用結構但所有顏色、圓角、陰影只能引用 token
- 不移植的項目見第四節，不得帶入
- 每個移植檔頂部註明「移植自 scaffold-vue/src/…，已改：…」

## 3. 本產品新增組件

`DateInput`、`DueDate`、`PlateChip`、`StatCard`、`KeyValue`（規格見設計文件第二、四節）。`PlateChip` 須依車牌判斷樣式：內地（以省份簡稱開頭，如「粵Z」）黑底白字；香港黃底黑字；澳門（以 `M` 開頭的格式）白底黑字；無法判斷用中性灰框。

## 4. 逐頁遷移（全部頁面）

今日工作、客戶列表、客戶詳情（各分頁、公司組與公司卡片）、牌照總表（含批量、CSV 匯入）、牌照詳情、車輛詳情、業務列表、工單詳情、新增工單、設定（規則、官方來源）、登入頁、全部彈窗。

- 列表頁一律用 `ListPage`；表單一律用 `FormDialog`＋`Field` 系列
- **今日工作**：`StatCard` 一列可點擊切換；`Segmented` 分頁；日期欄 `DueDate editable`；車牌用 `PlateChip`
- **牌照總表**：分類用 `Segmented`；「匯入 CSV」為頁首次要按鈕，打開 `Drawer`（下載範本 → 選檔 → 預覽表格（新增／更新／錯誤用 `StatusTag`）→ 確認寫入）；勾選後底部浮條出現「批量填日期」；CRP 欄 `DueDate editable`；批文沒有日期顯示灰色「待錄入」
- **規則設定**：`DataTable`，開關用 `Switch`（即時儲存、失敗還原），編輯用 `FormDialog`，操作欄吸附右側、按鈕不換行
- **登入頁**：簡潔單卡片，本產品配色；不做腳手架的動態畫布
- **批文卡區塊**：只可換外層容器；`ApprovalCard.vue` 與預覽、翻轉、上傳辨識、手動修改、原件核對流程**一行不改**，逐項實測仍可用
- 介面上「案件」改為「工單」

## 5. 清理與規則檢查

- 刪除舊 `admin/src/style.css`（批文卡外圍若仍需要的少量樣式，移到 `pages.css` 並註明）
- 新增 `admin/scripts/check-style-rules.mjs` 並加入 `npm run check`：掃描 `views/`、`components/business/`（排除 `ApprovalCard.vue`）的 `<style>` 與行內 `style=`，出現十六進位顏色、`rgb(`/`rgba(`、`font-size`、`border-radius`、`box-shadow` 即報錯
- `npm run check` 同時跑 `vue-tsc --noEmit`

## 6. 測試與驗收

- `cd admin && npm run check`（模板引用＋樣式規則＋型別）、`npm run build` 通過；`cd api && npm test` 全過；`cd mobile && npm run build:h5` 通過
- **每一頁** 1366px 與 390px 各看一次，報告逐頁寫：有無報錯、空白、排版錯亂、文字截斷、按鈕換行
- 實測：⌘K 搜尋客戶與車牌、今日工作行內填日期、批量填日期浮條、CSV 匯入全流程、規則開關失敗還原、各彈窗新增與編輯、鍵盤 Escape 關閉最上層浮層、瀏覽器上一頁、直接用網址進入詳情頁、批文卡全部流程

## 限制

遵守 `AGENTS.md`。不改 `api/`、`mobile/`、兩個 `ApprovalCard.vue`、腳手架目錄。
