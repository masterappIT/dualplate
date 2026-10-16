# 正式環境部署：第 1 輪驗收

日期：2026-10-17。正式網址已上線，主體做得好；以下 5 項退回，改完再報告。

## 負責人實測結果

| 驗收項（brief 第四節） | 結果 |
|---|---|
| 1. `api` 測試 | 390／390 通過；`admin npm run check` 通過 |
| 1. 空 `VITE_API_BASE_URL` 建置 | 通過；正式網站兩個 JS 檔內沒有 `localhost:4100` |
| 2. 腳本 `bash -n` | 4 個腳本全過 |
| 3. 本機 Docker 跑 `compose.yaml` | 通過：兩個網域首頁、SPA 深層路徑、`/api/health`、客戶端 `/r/` 轉發、`index.html` `no-store`、`/assets/` 永久快取、管理端 `noindex` 與 `frame-ancestors`；管理員登入、建立客戶、`restart` 與 `down/up` 後資料和登入狀態都在；`npm run backup` 輸出路徑可被 `backup-to-gcs.sh` 解析 |
| 3. 安全 | API 映像以 UID 10001 執行，內無 `.sqlite`；偽造 `X-Forwarded-For` 無法繞過登入鎖定（Caddy 會換成真實 IP） |
| 4. 秘密 | `git grep` 只有空白佔位；沒有追蹤 `.sqlite` 或 `.env` |
| 正式環境 | 兩個網域 HTTPS、`/api/health` 回 `database: ok`；備份 bucket 90 天刪除且禁止公開；資料磁碟已掛快照排程；GitHub `production` 環境變數齊全 |

## 退回項目

1. **`docs/go-live.md` 刪掉了與部署無關的內容。** brief 只要求「相關段落同步更新」。你刪掉了：上線前第 7–10 項（管理員、員工帳號、到期事項天數、合約範本）、「開放給客戶前」第 2–5 項（顧問資料、委託範圍、轉發開通文字、小程序綁定碼）、回滾時用「設定 → 操作記錄」查補錄、「出事聯絡」整張表、試行計劃三段。
   → 從 `git show HEAD:docs/go-live.md` 取回原文，**只改**和伺服器有關的字（`systemctl`、三個子網域、`api.<網域>`、`.env`、`npm run backup` 手動另存等），改成新架構的做法。表格與打勾欄保留。

2. **`docs/deploy.md` 刪掉了微信小程序一節，而且沒有「改秘密」的方法。** 小程序上架不在本任務，但說明不能消失。`bootstrap.sh` 只在第一次把 Secret 寫成 `app.env`，之後要填 `WECHAT_APPID`／`WECHAT_SECRET` 或換任何設定，現在沒有任何步驟。
   → 恢復小程序一節並改寫：AppID／AppSecret 寫入 `dualplate-app-env` 新版本；request 合法網域要已備案，`masterappinc.com` 主機在香港、未備案，寫明「要上小程序須另備已備案網域」。
   → 新增 `deploy/vm/refresh-env.sh`（從 Secret Manager 讀最新版本 → 權限 600 寫入 → 只重啟 `api`，健康檢查）和文件中的逐條指令。不得把內容印到日誌。

3. **一次性設定有幾步只有文字、沒有指令**，不懂程式的人做不到（驗收項 5）：
   - 建立 `dualplate-app-env` 的暫存檔（給出 `umask 077` ＋ 逐行範本，秘密留空佔位）
   - 授予 VM `roles/secretmanager.secretAccessor`（給出完整 `gcloud` 指令）
   - 「把 `deploy/` 送至 VM」（給出 `gcloud compute scp --recurse ... --tunnel-through-iap`）
   - 事故還原（給出逐條指令：停 `api`、保留故障檔、從 GCS 下載、`PRAGMA integrity_check`、放回、`chown 10001:10001`、啟動、檢查健康）
   - DNS 生效檢查（`dig +short` 兩個網域應回固定 IP）

4. **每日備份時間大概率不對。** `backup.cron` 用 `CRON_TZ=Asia/Hong_Kong`，但 Debian 12 的 `cron`（vixie cron）**不支援 `CRON_TZ`**，而 Compute Engine 預設時區是 UTC，結果會在香港 11:15（上班時間）執行，不是 03:15。
   → 不靠 `CRON_TZ`：在 `bootstrap.sh` 加 `timedatectl set-timezone Asia/Hong_Kong`，或把時間寫成 UTC `15 19 * * *` 並加註解。二選一，報告寫明選擇與理由。
   → 報告寫出主機目前的時區（`timedatectl`），以及 `backup-cron.log` 是否已有紀錄。負責人這邊無法進主機查證。

5. **`deploy.sh` 自動切回舊版後沒有再檢查健康。** 切回後若舊版也起不來，現在仍只回 6，日誌看不出網站是否已恢復。
   → 切回後同樣檢查 `/api/health`（最多 60 秒），結果分別寫「Rollback healthy」或「Rollback unhealthy」，並用不同結束碼（例：6 = 新版失敗已恢復，7 = 新版失敗且恢復也失敗）。在 `docs/deploy.md` 列出全部結束碼的意思。

## 報告必須補上

- 按 `AGENTS.md` 報告要求逐項對應 brief 第二、三、四節。
- 列出正式環境上**實際執行過的所有雲端操作**（誰執行、指令、時間），因為 brief 原本寫明由管理者或負責人執行。
- 正式環境是否已建立管理員；兩份 GCS 備份（19:37）是怎樣產生的。

## 不用做（負責人處理）

- 提交與推送、設 `DEPLOY_ENABLED=true`、用 GitHub Actions 跑第一次完整發布：負責人做。目前正式環境的映像檔是從**未提交的工作目錄**建置的，這一步要盡快完成。
- `CORS_ORIGINS` 留空時 `server.js` 會退回本機開發的預設來源：風險低，日後另開任務，本輪不要改 `server.js`。
