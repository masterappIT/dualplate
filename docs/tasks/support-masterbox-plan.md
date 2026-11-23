# 客服改用 MasterBox：實作計劃（第一步：只用小視窗腳本）

## 已決定（管理者 2026-11-23）

- 先只用 MasterBox 小視窗腳本，已登入客戶用 `setData` 帶入資料。伺服器簽憑證、接 MasterBox API 是第二步。
- 客戶端不再另外放 WhatsApp、微信（按鈕、微信號、二維碼）：MasterBox 客服對話裏已經有（「成員與設定 › 離開後也收得到回覆」，客戶可轉用 WhatsApp 或微信，離開後照樣收到回覆），客戶端再放一套會重複（管理者 11-23 說明）。托管客戶也可以用線上客服。
- 顧問卡照舊（包括顧問本人的「複製微信號」）；「委託我們辦理」卡、「委託我們辦 ›」連結照舊。
- 畫面已確認：`docs/mockups/support-widget.html`（新畫面）、`docs/mockups/entrust-contact-current.html`（現有樣式和改句表）。
- 兩份客戶端同時做：`mobile/`（H5）和 `app/`（Flutter）。

## MasterBox 設定（已在 MasterBox 後台，不用改）

- 腳本：`<script src="https://masterboxapp.masterappinc.com/c/widget.js" data-link="DaZ-K0ltDZ--4uZd9hNXXYI_" async></script>`（和下載頁同一條入口連結「跨境車牌管家App」）。
- 「接收網站帶入的客戶資料」已開。
- 後台設定 11-23 已核對，管理者決定維持現狀：主題色 `#0F5C4A`；放在哪裡＝頁面區塊（區塊 `support-chat`，頁面上沒有這個區塊的地方退回角落按鈕）；固定淺色；不用先填名字；語音、視訊關；工作時間不設（一直在線）；「工作時間與聯絡方式」裏的 WhatsApp 照留（客戶在對話的「離開後也收得到回覆」看到，要用它轉 WhatsApp）；歡迎訊息、條款連結不填。
- **下載頁（`deploy/web/download/index.html`）用這條連結的角落按鈕**（`data-offset-y="76"`）。H5 和 App 在程式碼寫 `data-button="none"` 蓋過、用本產品自己的按鈕，所以後台「角落按鈕」必須保持「顯示」，不然下載頁的按鈕會不見。後台的樣式（主題色、標題列、工作時間外的按鈕、不顯示的網址等）三個地方共用，改之前要想到下載頁。
- 說明文件：`/Users/vincentw/development/masterbox-platform/docs/website-widget-guide.md`（腳本屬性、`open({ text })`、`setData`、`clearData`、事件）、`api-embedding-guide.md`（Flutter 內嵌網頁）。只讀。

## 帶入的客戶資料（兩邊一樣）

已登入時 `setData` 寫這些欄位（沒有值的不寫；全部轉成文字；每項最多 200 字）：

| 欄位 | 內容 |
|---|---|
| `name` | 登入帳戶名稱 |
| `email` | 登入電郵；`@phone.invalid` 結尾的是佔位，不寫 |
| `phone` | 客戶手機（取得到才寫） |
| `客戶編號` | `customerId` |
| `後台連結` | `https://dualplateadmin.masterappinc.com/#/customers/<customerId>` |
| `管理方式` | 自管／托管 |
| `顧問` | 托管客戶的顧問名字 |
| `牌照` | 內地車牌，用「、」連起來 |
| `來自` | `H5 網頁`、`iPhone App 1.1.0`、`Android App 1.1.0` |

登出時清掉（`clearData()`）。未登入的畫面（登入頁、申請使用、審批中）不寫資料，客服要問客戶是誰。

## 第 1 部分：`mobile/`（H5）

1. 新增 `mobile/src/lib/support.js`（只在 H5 運作，`#ifdef H5`）：
   - 第一次用到時插入腳本，加 `data-button="none"`（不用角落泡泡，用本產品自己的按鈕）、`data-src="h5"`。
   - `openSupport(text?)`：`open()` 或 `open({ text })`。
   - `syncSupportData()`：按上表寫 `setData`；`clearSession()` 時呼叫 `clearData()`。
   - 未讀數：聽 `unread` 事件，給「聯絡客服」按鈕和底部「我的」分頁顯示紅點。管理者 11-23「客服回覆沒有提示」後改為：已登入就載入小視窗（App.vue 啟動、登入成功時 `startSupport()`），不等打開「我的」頁；網頁開着就有紅點，網頁關着時沒有（要第二步的 Webhook）。
2. 新組件 `SupportCard.vue`（線上客服卡，照草稿）：
   - 已登入版（草稿 ①②）：標題「線上客服」、說明、主按鈕「聯絡客服」和紅點。工作時間提示照 MasterBox 設定，做不到就不寫，不自己判斷工作時間。
   - 未登入版（草稿 ⑤）：標題可另給（例如「忘記密碼？」），說明一句，按鈕「聯絡客服」。
3. 換掉 `ContactCard`：
   - 「我的」頁：托管客戶顧問卡下面加 `SupportCard`；自管客戶的 `ContactCard` 換成 `SupportCard`。
   - 登入頁（忘記密碼、申請審批中）、申請使用頁：換成未登入版。
   - 訊息頁不再有入口（頁面檔案先留著，見最後一節）。
4. 「刪除牌照」「註銷帳號」頁的「聯絡我們」改成「問客服」，用 `open({ text })` 預填第一句（例如「我想刪除牌照 粵Z·A123港，但它還有未完成的委託。」）。
5. 改句（`entrust-contact-current.html` 底部表格）：牌照詳情和改資料頁的「不再續期」、帳單頁、申請使用頁、登入頁說明。
6. 微信小程序：小視窗用不了，`SupportCard` 在小程序不顯示（小程序未上線）。
7. 檢查：`npm run build:h5` 通過；本機打開「我的」頁（自管、托管）、登入頁、刪除牌照頁，1366 和 390 兩個寬度；按「聯絡客服」真的打開 MasterBox；不要在正式對話裏發測試訊息。

## 第 2 部分：`app/`（Flutter）＋ 客服頁

1. 本產品網站加一頁 `deploy/web/support/index.html`（`https://dualplate.masterappinc.com/support/`），App 用內嵌網頁打開它：
   - 載入同一段腳本，`data-src="app"`，載入後全屏打開對話。
   - 從網址 `#` 後面讀 App 傳來的資料（JSON，base64url）：`data`（上表）、`text`（預填句子），寫 `setData`、`open({ text })`；沒有 `data` 時 `clearData()`。
   - 對話被關上（`close` 事件）時通知 App 回到原頁。
   - `deploy/web/Caddyfile` 加 `/support/*`（照 `/download/*`）、`deploy/web/Dockerfile` 複製這個資料夾。
2. Flutter 加套件 `webview_flutter`（Flutter 官方；Android 選檔要 `webview_flutter_android` 的 `setOnShowFileSelector` 接現有的 `image_picker`）。管理者 11-23 已同意 App 用內嵌網頁打開客服。
3. 新頁「線上客服」：App 自己的標題列（標題「線上客服」、右上「完成」），下面是內嵌網頁。iOS `Info.plist` 相機、相簿說明照現有的；麥克風只在對話要錄音時才加。
4. 照第 1 部分做同樣的畫面：`SupportCard` 等價組件、「我的」頁、登入頁、申請使用頁、刪除牌照和註銷帳號的「問客服」、改句。App 舊的訊息頁不再有入口。
5. 檢查：`flutter analyze`、`flutter test` 全過；模擬器打開「我的」頁和客服頁，確認對話打得開、可以選相片、按「完成」和對話的 × 都回到原頁。真機要管理者測。

## 第一步做不到的（和草稿不同，要讓管理者知道）

- **App 的紅點只在 App 開著時有**（管理者 11-23「先做第一種」）：客戶已登入、App 開著時，App 在看不見的內嵌網頁用背景模式打開客服頁（`/support/?bg=1`：不打開對話、不放區塊），讀小視窗的未讀數，顯示在「我的」分頁和「聯絡客服」按鈕（超過 99 寫 99+）；客戶在客服頁讀了訊息後歸零。App 關著時沒有提示，要等第二步用 Webhook 加推送。
- **客服看不到「最近做過」**（草稿 ⑥ 下半）：App 關著客服頁時送不出行為紀錄，兩邊先都不做，等第二步。
- 帶入資料未經驗證、換裝置是另一段對話：第二步加伺服器簽憑證解決。

## 暫時不動，接 MasterBox API 時拿掉（管理者 11-23：先記錄放著）

- 後台收件匣（客服訊息收件匣）
- 舊訊息接口（`/my/messages` 等）和相關資料
- 客戶端舊訊息頁檔案：`mobile/src/pages/messages/`、`app/lib/pages/messages/`
- 後台「聯絡方式」設定頁（`admin/src/views/SupportContact.vue`）和 `/my/contact`、`/public/contact` 接口：客戶端不再讀，先留著
- `ContactCard` 組件（兩邊）：沒有地方用之後一併刪

後台「申請使用」審批頁裏「用 WhatsApp 聯絡申請人」是同事聯絡申請人用的，不屬於客戶端，照舊。
