# 正式環境搬到 HostKVM（2026-10-19）

> 管理者決定（2026-10-19）：
> - 這次只是把正式環境從 Google 的 VM 搬到 HostKVM 共用伺服器，部署按項目現在的做法，只改新環境逼着要改的地方
> - 備份保留 35 天
> - 準備好、測試通過就切換
> - 不改 MasterApp-infra repo
>
> 執行：Claude。做法見 `docs/deploy.md`。

## 照舊不變

- Docker Compose 兩個容器、`deploy.sh` 的流程和結束碼、`rollback.sh`、每日 03:15 `npm run backup`、伺服器路徑 `/srv/dualplate/`
- Artifact Registry 和 workflow 的品質檢查、建置步驟
- 資料、網址、`/r/` 連結
- `app.env` 從 Secret Manager 原樣抄過去，只改 `BACKUP_KEEP_DAYS=7`

## 改了的地方

| # | 原因 | 改動 |
|---|---|---|
| 1 | 80/443 已由共用 Caddy 使用 | `deploy/web/Caddyfile` 改為只用內部 HTTP 80 埠，網頁規則不變，並加 `trusted_proxies` 保留用戶 IP；`deploy/vm/dualplate.caddy` 是共用 Caddy 的網域設定 |
| 2 | 和其他產品共用伺服器 | `compose.yaml` 的變動：<br>- 用容器名稱 `dualplate-api`／`dualplate-web` 互連，因為 `edge` 網絡上有其他產品也叫 `api`<br>- 記憶體上限 api 768MB、web 64MB |
| 3 | 改 DNS 前新伺服器沒有證書 | `deploy.sh`、`rollback.sh` 的外層健康檢查改為經 web 容器帶網域 Host 檢查 |
| 4 | 新伺服器沒有 IAP | workflow 最後一步改為以 `deploy-dualplate` 經 SSH 呼叫 `deploy.sh`；帳號只能執行 `deploy.sh`，`deploy.sh` 只接受本產品的映像摘要 |
| 5 | 伺服器拉映像 | `masterapp-prod-vm` 加 `dualplate` 倉庫的只讀權限 |
| 6 | 新伺服器讀不到 Secret Manager | `bootstrap.sh` 改為放入抄過來的 `app.env`，並建立部署帳號；`refresh-env.sh` 改為讀你給的新檔案 |
| 7 | 備份去向 | `backup-to-gcs.sh` 改為用 rclone 上傳到 `gs://masterapp-prod-backups/dualplate/`（35 天） |

和定案文件的差別（自行判斷）：
- 定案寫「另加 `Caddyfile.hostkvm`」。實際直接改了 `Caddyfile`，因為 Google VM 以後不會再部署新映像，回退時用的是它已有的舊映像，不需要兩份 Caddyfile。
- 共用 Caddy 的網域設定必須放到伺服器的 `/srv/infra/sites/`。這是唯一碰到共用設定的地方；檔案來源在本 repo 的 `deploy/vm/dualplate.caddy`。

## 發現

- **正式環境的 `app.env` 沒有 `PASSWORD_VIEW_KEY`**：資料庫裏沒有任何密碼副本，「查看密碼」會顯示「伺服器未設定密碼查看金鑰」。搬遷後行為不變。要不要設定這把金鑰由負責人決定；設定後，只有之後設定或重設的密碼看得到。
- 主機上的 `app.env` 和 Secret Manager 最新版本的 sha256 一致。
- 資料庫 13.7MB；舊 VM 上 api 約 53MB、web 約 31MB 記憶體。
- `masterapp-prod-vm` 服務帳號建在 `dualplate-511819` 專案裏，其他產品也在用。清理 GCP 時**不能刪除整個專案**，只刪 Dualplate 舊 VM 相關的資源。
- 10/08–10/16 期間 `dualplate` repo 的提交全部來自負責人自己的電腦，Google 部署 10/17 才建立，所以不受被盜 token 事件影響，秘密不用換。

## 操作記錄（UTC）

| 時間 | 指令 | 結果 |
|---|---|---|
| 01:2x | `gcloud compute ssh dualplate-app … --command='sha256sum app.env; secrets versions access … \| sha256sum; ls data; docker stats'`（唯讀，只比對雜湊，不印內容） | 兩邊一致；資料庫 13.7MB |
| 01:28:29 | `gh variable set DEPLOY_ENABLED --body false` | 暫停自動發布 |
| 01:28:32 | `gcloud artifacts repositories add-iam-policy-binding dualplate --member=serviceAccount:masterapp-prod-vm@… --role=roles/artifactregistry.reader` | 已授權 |
| 01:29 | 新伺服器 `docker pull` 現行 api 映像 | 成功 |
| 01:29 | `git push`（提交 `1c4167d`） | 品質檢查通過，部署跳過 |
| 01:29:56 | `rsync deploy/` 到伺服器；`gcloud secrets versions access latest … \| ssh … cat > /tmp/dualplate-app.env`（不經本機磁碟）；`sudo bootstrap.sh` | `app.env` 雜湊與 Secret 一致；安裝完成；暫存檔已刪除 |
| 01:30 | `gh secret set HOSTKVM_DEPLOY_SSH_KEY --env production` | 已設定；本機私鑰已刪除 |
| 01:41:54 | `gh variable set DEPLOY_ENABLED --body true`；`gh workflow run deploy-production.yml`（run 39186536874） | 01:54:39 `Release healthy`；首次部署，空資料庫 |
| 01:55:25 | 經 SSH 串流 `app-2026-10-18T19-15-04-373Z.sqlite` 從舊 VM 到新伺服器 | 兩邊 sha256 一致（`79513dc8…`） |
| 01:56 | 停 api，放入測試副本，`integrity_check`，啟動 api | `ok`；兩個網域首頁 200、`/api/health` ok、客戶端 `/r/` 由 API 回應；api 31MB、web 11MB |
| 01:56:49 | `sudo /srv/dualplate/backup-to-gcs.sh`，再用 rclone 下載核對 | 已上傳 `dualplate/2026/10/19/app-2026-10-19T01-56-49-826Z.sqlite`，下載的副本 sha256 一致 |
| 01:58 | `dig` 兩個網域 | A `34.92.107.172`，**TTL 14400（4 小時）** |
| 02:03:35 | 管理者決定即時切換；`gh variable set DEPLOY_ENABLED --body false` | 暫停自動發布 |
| 02:03:40 | 舊 VM：`docker compose stop api`；`backup-to-gcs.sh`（上傳到舊 bucket `dualplate-511819-backups`） | 舊 api 停止寫入；最後備份 `app-2026-10-19T02-04-01-105Z.sqlite` |
| 02:04–02:05 | 經 SSH 串流最後備份到新伺服器；換入 `data/app.sqlite`；`integrity_check`；啟動 api | sha256 一致（`feb5e5fd…`）；`ok`；`/api/health` ok；測試副本已刪除 |
| 02:07 | Squarespace：`dualplate` A 改為 `45.134.82.239`，TTL 30 分鐘（Squarespace 預設選項的最低值） | 權威 DNS 已回新 IP |
| 02:08:15 | 共用 Caddy 暫時只加客戶端網域並 reload | 證書即時取得；HTTPS 200，`/api/health` ok |
| 02:11 | Squarespace：`dualplateadmin` A 改為 `45.134.82.239`，TTL 30 分鐘 | 權威 DNS 已回新 IP |
| 02:12:27 | 安裝完整的 `/srv/infra/sites/dualplate.caddy`（兩個網域）並 reload | 兩個網域 HTTPS 200、證書有效、`/api/health` ok；管理端 `noindex`、CSP、快取標頭照舊；`/r/` 由 API 回應 |

停機時間：舊 api 02:03:40 停止 → 客戶端 02:08 恢復、管理端 02:12 恢復（以新 DNS 計）。舊記錄 TTL 是 4 小時，所以最遲到約 06:12 UTC（香港 14:12），仍有部分網絡會連到舊 VM；舊 VM 只剩網頁，API 已停止，不會寫入舊資料。

## 未做／待辦

- 管理端和客戶端的真實登入、批文卡上傳 OCR、真實 `/r/` 連結：我沒有正式帳號密碼，未測試。請負責人實際使用一次。
- 經共用 Caddy 的用戶 IP：只在本機用相同的 Caddy 設定模擬驗證過（API 收到用戶 IP，偽造的 `X-Forwarded-For` 被丟棄），正式路徑沒有另外查看。
- 舊 VM 保留不動（web 仍在運行、api 已停），作為回退。穩定 2 週後清理 GCP 上 Dualplate 舊 VM 相關的資源，每項先問負責人；`masterapp-prod-vm` 帳號和 `dualplate` 映像倉庫仍在使用，不能刪。
- 每日備份第一次自動執行：今晚香港 03:15，明天檢查 `/srv/dualplate/logs/backup-cron.log` 和 GCS。

## 回退

1. 新伺服器：`docker compose stop api`，把 `data/app.sqlite` 用 `npm run backup` 備份後串流回舊 VM 的 `/srv/dualplate/data/app.sqlite`（擁有者 10001），刪除舊的 WAL／SHM。
2. 舊 VM：`docker compose up -d api`。
3. Squarespace 兩筆 A 記錄改回 `34.92.107.172`。
