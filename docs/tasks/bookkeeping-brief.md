# 任務：內地公司報帳報稅追蹤（外包會計）

先讀 `AGENTS.md`；需求背景見 `docs/requirements.md` §5.3。

## 業務規則（管理者已確認）

- 客戶名下每間內地公司每月要做帳和申報稅務
- **做帳報稅外包給會計公司**；系統不做記帳本身，只追蹤外包進度、收回回執、到期催辦
- 已註銷的內地公司不再產生報帳工作（沿用公司狀態）
- 申報截止一般是次月 15 日，遇節假日順延；截止日要能逐月調整

## 1. 資料（一次性遷移）

- `accounting_firms`：`id`、`tenant_id`、名稱、聯絡人、電話、電郵、備註
- `companies` 加 `accounting_firm_id`、`taxpayer_type`（已有欄位沿用）、`filing_cycle`（`monthly`／`quarterly`，小規模納稅人可按季）
- `filing_periods`：`id`、`tenant_id`、`company_id`、`period`（`YYYY-MM`；按季者為季首月）、`due_on`、步驟狀態：`docs_received_on`（客戶票據收齊）、`sent_to_firm_on`（交給會計）、`filed_on`（已申報）、`paid_on`（已繳款）、`tax_amount`（分）、`zero_filing`（零申報）、`receipt`（回執圖片／PDF，另表存放）、`notes`、更新人與時間
- `filing_calendar`：`tenant_id`、`period`、`due_on`（當月截止日；沒有設定時預設次月 15 日）

## 2. 工作生成

- 每間「存續／經營異常／註銷中」的內地公司，自動生成到「本月」為止、最近 3 期的報帳工作（冪等）；`filing_cycle=quarterly` 只在季首月生成
- 公司改為已註銷後，之後的期數不再生成；已生成未完成的標記「公司已註銷」而不是刪除

## 3. 狀態與提醒

- 一期的狀態由步驟推算：`未開始` → `資料已收` → `會計處理中` → `已申報` → `已繳款`（零申報則已申報即完成）
- 截止前 5 天仍未申報為「需處理」，過了截止日未申報為「已逾期」；接入管理總覽的到期列表（名稱「報稅：公司名 YYYY-MM」）
- 已申報但沒有回執，標示「缺回執」

## 4. API（管理員；租戶隔離）

- 會計公司：`GET/POST /api/accounting-firms`、`PATCH /:id`
- 報帳：`GET /api/filings?period=&companyId=&firmId=&status=`、`PATCH /api/filings/:id`（逐步驟更新、稅額、零申報、備註）、`POST /api/filings/:id/receipt`（PNG／JPG／PDF，≤ 5 MB）、`GET /api/filings/:id/receipt`
- 截止日：`GET/PUT /api/filing-calendar/:period`
- 矩陣：`GET /api/filings/matrix?months=6`，回傳「公司 × 月份」的狀態，供總表使用
- 客戶：`GET /api/my/filings`（只讀，自己名下內地公司最近 6 期的狀態、稅額、是否零申報，不含會計公司聯絡資料和內部備註）

## 5. 管理端（`admin/src/views/Filings.vue`）

- 新導航「報帳報稅」：上方是**進度矩陣**（列：公司；欄：最近 6 個月；格內顏色＋文字顯示狀態，點格子打開該期）
- 一期的詳情彈窗：逐步驟打勾並填日期、稅額、零申報、上傳回執、備註
- 篩選：會計公司、狀態（需處理、已逾期、缺回執）
- 會計公司管理；公司編輯彈窗可選會計公司和申報週期
- 截止日設定：可逐月修改

## 6. 客戶端

由負責人親自接上（你不要改 `mobile/`），你只需提供 `/api/my/filings`。

## 7. 測試

具名、一情況一測試：生成冪等；按季只在季首月；已註銷公司不再生成；狀態推算；零申報；截止前 5 天需處理、逾期；缺回執；自訂截止日生效；矩陣內容；回執上傳格式與大小；客戶只看到自己的公司且不含內部資料；跨租戶 404；客戶呼叫管理接口 403。

## 限制

遵守 `AGENTS.md`。不新增依賴；回執檔案存資料庫（與現有圖片相同方式）。
