# 任務：動態視圖（第 11.6 輪）

先讀 `AGENTS.md`、`docs/design-system.md`（尤其第二節視覺識別、**第九節：只做「採用」表內的視圖，「不做」表內的一律不做**）。本任務在第 11.5 輪驗收後進行。參考腳手架 `/Users/vincentw/development/scaffold-master/scaffold-vue`（只讀）的 `OrgCanvas`、`PermissionTrace`、`RelationGraph`、`MenuStarMap`、`Swimlane`、`HeatGrid`、`Odometer`、`InsightPanel`、`GeneratorPipeline`、`composables/neural.ts`、`composables/viewport.ts`、`composables/view.ts`。

**交互與動效照搬，外觀與用字全部換成本產品**（證件感：紙色、通行綠、牌照黃點綴、白底節點＋細描邊；中心節點用「客戶印章」：深綠雙線圓章、客戶名首字，取代珍珠球）。不得出現腳手架用字。

## 1. 移植

`components/charts/`：`RelationGraph`、`Swimlane`、`HeatGrid`、`TickRing`、`TrendChart`；`components/ui/Odometer`；`components/business/`：`OrgCanvas`、`InsightPanel`（及溯源、口岸星圖所需部件）、`GeneratorPipeline`（改作 CSV 欄位對應）；`composables/neural.ts`、`viewport.ts`、`view.ts`。保留腳手架的性能紅線（DPR ≤ 2、離屏／隱藏暫停、每帧 try/catch、脈衝上限）、重播／暫停、減少動態效果直接終態、Esc 逐層返回、鍵盤替代路徑。

## 2. 本產品視圖（全部是 `ListPage` 的 `altView`，可切回表格，偏好按頁記住，820px 以下首次預設表格）

| 位置 | 視圖 | 資料 | 交互 |
|---|---|---|---|
| 客戶詳情 | **結構**（畫布） | 客戶 → 公司組（香港／澳門公司＋內地公司）→ 牌照 → 車輛 | 平移縮放；已註銷公司紅色標記＋文字；選中節點時四角面板顯示摘要（`KeyValue`）與操作「開工單」「到牌照詳情」 |
| 客戶詳情 | **時間軸**（泳道） | 每條泳道一個牌照，到期事項為時間塊 | 「今天」線每分鐘推進；逾期紅描邊；預設範圍「今天 −1 月 ～ +6 月」，角上切換「全年」 |
| 牌照總表 | **關係**（溯源三層） | 全景三表盤：客戶、口岸、到期狀態（刻度＝真實佔比）→ 某客戶的牌照觸鬚 → 牌照鏈路：客戶 → 公司 → 牌照 → 車 | 下鑽、面包屑與 Esc 返回；右側 `InsightPanel` 顯示該牌照到期事項（`DueDate`） |
| 牌照總表 | **口岸**（星圖） | 一級表盤為口岸（深圳灣、港珠澳大橋、蓮塘、皇崗、沙頭角、拱北、橫琴等，取自牌照 `port` 或批文卡通行口岸）；刻度為該口岸牌照的到期狀態佔比（真實數字）；點位為牌照，顏色為最嚴重到期狀態；中心為租戶印章 | 懸停點亮該口岸分支並 `HoverCard` 顯示車牌（`PlateChip`）、客戶、最近到期；點表盤在下方列表篩出該口岸；點牌照進入牌照詳情；可切換「全部／本公司自有／客戶的」；沒有口岸的牌照歸入「口岸待補」表盤並提示補錄 |
| 今日工作 | **到期日曆**（熱力格） | 未來 12 週 × 7 天的到期數量 | 懸停十字高亮；點格子在下方列表篩出當天到期 |
| 今日工作 | 統計卡 | `Odometer` 數字滾動落定（數據更新時） | |
| 今日工作 | **本週進度**（`TickRing`）與**到期趨勢**（`TrendChart`） | 本週到期已辦／總數；未來 6 個月每月到期數 | 刻度逐根點亮；折線描繪；點月份篩出該月到期 |
| 牌照 | **CSV 欄位對應** | 客戶 Excel 表頭 → 系統欄位，自動對應以連線顯示，可拖動改對應（移植代碼生成流水線） | 對應錯時紅線＋說明 |

需要的資料若現有 API 沒有，**只可新增唯讀 API**（例如 `GET /api/views/customer-structure/:customerId`、`GET /api/views/plate-graph`、`GET /api/views/due-calendar?weeks=12`），全部經租戶隔離，並補具名測試（別的租戶、不存在的 ID、客戶帳號 403、空資料）。

## 3. 測試與驗收

- `cd api && npm test`、`cd admin && npm run check`、`npm run build`、`cd mobile && npm run build:h5` 全過；測試數量不得減少
- 每個視圖 1366px 與 390px 各看一次；報告逐項寫：能否打開、動效是否運行、減少動態效果時是否直接終態、Esc 返回、切回表格後偏好是否記住
- 性能：12 個牌照、200 個牌照兩種資料量下，畫面不卡頓（在報告寫明測法）

## 限制

遵守 `AGENTS.md`。不改 `mobile/`、兩個 `ApprovalCard.vue`、`api/src/customer-routes.js`、腳手架目錄。
