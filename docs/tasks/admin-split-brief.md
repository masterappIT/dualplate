# 任務：管理端主程式拆分（畫面與行為完全不變）

先讀 `AGENTS.md`。

## 背景

`admin/src/App.vue` 約 54 KB，模板與程式都擠成極長的單行。每次修改都要反覆嘗試精確插入，拖慢開發，也容易誤傷批文卡區塊。本任務只做結構整理，**用戶看到的畫面和操作一律不變**。

## 要做的事

1. 把各畫面拆成獨立組件，放在 `admin/src/views/`：
   - `Dashboard.vue`（案件工作台）、`Requests.vue`、`RequestDetail.vue`、`NewRequest.vue`、`Customers.vue`、`CustomerDetail.vue`、`Vehicles.vue`、`VehicleDetail.vue`、`PlateDetail.vue`、`Sources.vue`
   - 已存在的 `Overview.vue`、`Companies.vue`、`Rules.vue` 保持原樣
2. 共用狀態與資料讀取（客戶、車輛、兩地牌、案件、目錄、目前選中的對象、錯誤和成功提示）抽到 `admin/src/store.js`（用 Vue 的 `reactive`／`ref`，不新增依賴）
3. 新增、登記類彈窗（`modal`）抽到 `admin/src/components/RecordModal.vue` 或按用途拆分
4. `App.vue` 只保留：登入畫面、側欄與頂欄、提示訊息、按 `view` 切換畫面
5. 拆出來的檔案用正常的多行格式（每個元素、每個函數獨立成行），方便日後修改
6. **批文卡區塊**（模擬卡、正反翻轉、上傳辨識、修改內容、原件核對）整段搬到 `PlateDetail.vue`，邏輯和樣式不得改動；兩個 `ApprovalCard.vue` 不改
7. `style.css` 不改類別名稱；組件內不要另起新樣式

## 驗收方法（負責人會逐項做）

- 拆分前後，在 1280px 與 390px 逐頁截圖比對：工作台、案件列表與詳情、建立案件、客戶列表與詳情、車輛列表與詳情、兩地牌詳情（含批文卡正反面）、管理總覽、公司與指標、規則設定、官方來源，畫面須一致
- 每個按鈕、彈窗、篩選、儲存操作照常可用
- `cd api && npm test`、`cd admin && npm run build`、`cd mobile && npm run build:h5` 全部通過

## 限制

遵守 `AGENTS.md`。本任務**不得改任何功能或文字**，也不要碰 `api/`、`mobile/`。發現原有的錯誤只記在報告裡，不要順手修。
