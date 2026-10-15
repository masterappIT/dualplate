# 任務：客戶端補強（上傳文件、顧問聯絡、登入方式、站內通知）

先讀 `AGENTS.md`、`docs/design-system.md`、`docs/v1-plan.md` 第六節分工。本任務在第 14 輪（工單改版）驗收後進行；文中「案件」即「工單」，「節點」即工單「步驟」，「待客戶配合」即 `owner=client` 的未完成步驟（第 14 輪的 `clientTodos`）。

**分工（2026-10-16 更新）**：本任務的**後端 API、資料表、管理端畫面由你（Codex）做**；**客戶端 `mobile/` 頁面由負責人親自做**，你不要改 `mobile/`。`api/src/customer-routes.js` 本任務允許你修改以加入下列客戶 API，改動須逐行在報告說明。每個客戶 API 的請求與回應格式請在報告列出，供負責人接上手機頁面。

## 1. 客戶在手機上傳文件

- 案件節點狀態為「待客戶配合」時，客戶在首頁「需要你處理」和辦理進度頁可以**直接拍照或選圖片／PDF 上傳**（每個檔案 ≤ 5 MB，PNG、JPG、PDF）
- 新表 `request_attachments`：`id`、`tenant_id`、`request_id`、`task_id`（可空）、`uploaded_by`、`file_name`、`mime`、`data`、`status`（`待確認`／`已確認`／`需重交`）、`review_note`、時間
- 客戶 API：`POST /api/my/requests/:id/attachments`、`GET /api/my/requests/:id/attachments`（只看自己案件；不回傳檔案內容，另以 `GET .../attachments/:aid/file` 取得）
- 管理員 API：`GET /api/requests/:id/attachments`、`GET .../:aid/file`、`PATCH .../:aid`（確認或要求重交並寫原因）
- 管理端案件詳情加「客戶上傳的文件」區塊：預覽、確認、要求重交
- 客戶端顯示每個檔案的狀態；「需重交」顯示原因並可重新上傳
- 該節點的文件全部「已確認」後，不自動改節點狀態（由員工決定），但在管理端提示「客戶文件已齊」

## 2. 你的顧問

- `customers` 加 `advisor_name`、`advisor_phone`、`advisor_wechat`（一次性遷移）
- 管理端客戶詳情可編輯
- 客戶端：「我的」頁頂部和首頁底部顯示顧問卡片：姓名、**一鍵撥號**（`uni.makePhoneCall`）、**複製微信號**；沒有資料時顯示「顧問資料整理中」

## 3. 登入方式

- **手機號碼＋密碼**：`users` 加 `phone`（唯一，允許空）；`POST /api/login` 接受電郵或手機號碼；管理端「開通客戶登入」可填手機號碼
- **微信一鍵登入（先做好框架）**：
  - 後端 `POST /api/wechat/login {code}`：以環境變數 `WECHAT_APPID`、`WECHAT_SECRET` 呼叫微信 `code2session` 取得 openid；openid 已綁定就登入，否則回傳「尚未綁定」
  - 綁定：管理端為客戶帳號產生 6 位一次性綁定碼（10 分鐘有效）；客戶在小程序首次微信登入時輸入綁定碼完成綁定（`POST /api/wechat/bind`）
  - 沒有設定環境變數時，介面不顯示微信登入按鈕，接口回 503「尚未設定微信登入」
  - 測試用本機假伺服器模擬 `code2session`（以環境變數覆寫網址），不得連真實微信
  - H5 預覽不顯示微信登入（只在小程序條件編譯 `#ifdef MP-WEIXIN` 出現）

## 4. 站內通知

- 到期類通知只發給：客戶看得到的規則，且 90 天過關只限已開啟提醒的牌照；`handler=client` 的項目通知文字寫「請你處理」，其他寫「我們會為你辦理」
- 「開通客戶登入」成功後，管理端顯示一段可複製轉發的文字（小程序名稱或網址、帳號、首次登入步驟），見 `docs/v1-plan.md` 第八節

- 新表 `notifications`：`id`、`tenant_id`、`customer_id`、`kind`、`title`、`body`、`link`（客戶端頁面路徑）、`read_at`、`created_at`
- 產生時機：案件狀態改變、節點變為「待客戶配合」、上傳文件被要求重交、到期項目首次進入「需處理」或「已逾期」（每項每期只發一次；伺服器啟動及每次讀取總覽時檢查即可，不需排程器）
- 客戶 API：`GET /api/my/notifications`、`POST /api/my/notifications/read`（單筆或全部）
- 客戶端：首頁右上角鈴鐺與未讀數，新頁面「通知」列表，點擊跳到對應頁面
- 微信訂閱消息先不做（需要模板編號），在報告中列為後續

## 5. 測試

具名、一情況一測試：上傳格式與大小限制；客戶只能上傳到自己的案件；員工確認／要求重交；手機號碼登入；手機號碼重複被拒；微信登入的已綁定、未綁定、綁定碼過期、未設定環境變數；通知產生不重複、已讀、跨客戶不可見；跨租戶 404。

`cd api && npm test`、`cd admin && npm run check`、`cd admin && npm run build`、`cd mobile && npm run build:h5` 全部通過；測試數量不得減少。

## 6. 驗收方式

負責人會在手機寬度實測：需要你處理 → 上傳 → 管理端確認／要求重交 → 客戶看到狀態與通知；顧問卡片撥號與複製；手機號碼登入；通知鈴鐺與列表；批文卡疊層、單獨預覽、翻轉照常。

## 限制

遵守 `AGENTS.md`。不新增 npm 依賴；不改 `mobile/`。
