# 任務：正式環境部署到 Google Cloud（負責人 2026-10-17）

> **已過時（2026-10-19）**：正式環境已搬到 HostKVM 共用伺服器，本文件的 Compute Engine、IAP、磁碟快照做法不再使用，舊 VM 已刪除。現況見 `docs/deploy.md`。本文件只作歷史記錄。

開始前先讀 `AGENTS.md`，再讀本文件。參考做法是 MasterDriver 的 `/Users/vincentw/development/MasterDriver/docs/PRODUCTION-DEPLOYMENT.md` 和 `deploy/`、`.github/workflows/deploy-production.yml`（**只可讀取，不可修改那個倉庫**）。

## 一、負責人的決定與理由

管理者要求「和 MasterDriver 一樣，部署在 Google Cloud」。MasterDriver 是 Cloud Run ＋ Cloud SQL（PostgreSQL）。本產品的 API 用 SQLite（`node:sqlite`，同步呼叫約 580 處），**不能直接放上 Cloud Run**：Cloud Run 沒有持久磁碟，重啟或發布時資料會消失；把 SQLite 放在 Cloud Storage 掛載上又不安全。改寫成 PostgreSQL 要數週，風險高，現階段只有一位客戶，不值得。

所以：**沿用 MasterDriver 的全部做法，只有「API 和資料庫跑在哪裏」不同**——跑在一台 Compute Engine 主機的持久磁碟上。

| 項目 | 做法 | 與 MasterDriver |
|---|---|---|
| Google Cloud 專案 | 獨立專案（例：`dualplate-<編號>`，由管理者建立），區域 `asia-east2`（香港），可用區 `asia-east2-a` | 相同（各專案資源完全分開） |
| 映像檔 | Artifact Registry 倉庫 `dualplate`；一律用 `名稱@sha256:摘要` 部署，不用 `latest` | 相同 |
| 秘密 | Secret Manager（微信 AppSecret 等）；倉庫不得出現任何密碼或金鑰 | 相同 |
| 發布 | GitHub Actions：推送到 `main` → 品質閘門 → 建置推送映像檔 → 部署；以 Workload Identity Federation 登入，GitHub 不存 Google 金鑰；限定 `masterappIT/dualplate`、`production` 環境、`main` 分支；倉庫變數 `DEPLOY_ENABLED` 未設為 `true` 時只跑品質閘門 | 相同 |
| 網域 | 客戶端 H5 `dualplate.masterappinc.com`、管理端 `dualplateadmin.masterappinc.com`；API 不另開網域，經各自網域的 `/api` 轉發（同站，不需 CORS） | 相同的命名方式與同站 `/api` |
| 快取 | `index.html` `no-store`；`/assets/` 帶雜湊永久快取；API 回應 `no-store` | 相同 |
| **主機** | **Compute Engine `dualplate-app`：e2-small、Debian 12、Docker；資料放獨立持久磁碟 `dualplate-data`（20 GB，掛在 `/srv/dualplate`）** | **不同：MasterDriver 用 Cloud Run** |
| **資料庫** | **SQLite 檔 `/srv/dualplate/data/app.sqlite`（在持久磁碟上）** | **不同：MasterDriver 用 Cloud SQL** |
| HTTPS | 主機上的 Caddy 自動取得與續期憑證（兩個網域） | 不同：Cloud Run 由 Google 管理 |
| 備份 | ① 每日 03:15（香港）`npm run backup` 線上備份到 `/srv/dualplate/backups`，再複製到 Cloud Storage `gs://<專案>-backups`（不公開，生命週期 90 天刪除）② 持久磁碟每日快照，保留 14 天 ③ **每次發布前先備份，失敗就停止** | 相當於 Cloud SQL 備份 |
| 健康檢查 | 發布後檢查 `https://<網域>/api/health`，回 `{"ok":true,"database":"ok"}` 才算成功；失敗自動切回上一版映像檔 | 相當於候選 revision 檢查 |

日後要把產品賣給其他代辦（多租戶 SaaS）、流量變大時，再另開任務遷到 Cloud SQL。

## 二、要交付的檔案

1. **`deploy/api/Dockerfile`**：Node 24（`node:24-slim`），只裝 `api` 的正式依賴（`npm ci --omit=dev`），帶上 `tessdata/`；以非 root 用戶執行；`EXPOSE 4100`；資料目錄由外部掛載，映像檔內不得有任何 `.sqlite`。
2. **`deploy/web/Dockerfile`**：多階段建置，產出一個 Caddy 映像檔，內含 `admin/dist`（`VITE_API_BASE_URL` 留空）與 `mobile/dist/build/h5`（同樣留空）。
3. **`deploy/web/Caddyfile`**：
   - `dualplateadmin.<網域>` → 管理端靜態檔；`dualplate.<網域>` → 客戶端 H5 靜態檔。
   - 兩個網域的 `/api/*` 都轉到 API 容器；客戶端網域的 `/r/*`（承租方專屬連結）也轉到 API。
   - SPA 找不到檔案時回 `index.html`；`index.html` `Cache-Control: no-store`，`/assets/*` 永久快取。
   - 管理端加 `X-Robots-Tag: noindex` 和禁止被嵌入（`frame-ancestors 'none'`）。
   - 網域名稱用環境變數，方便日後更換。
4. **`deploy/compose.yaml`**：`api`、`web` 兩個服務；映像檔用環境變數傳入摘要；`api` 掛 `/srv/dualplate/data`、`/srv/dualplate/backups`、`/srv/dualplate/logs`；`api` 的環境變數從主機上的 `/srv/dualplate/app.env`（權限 600）讀；Caddy 的憑證目錄掛 `/srv/dualplate/caddy` 以免重啟後重新申請。
5. **`deploy/vm/deploy.sh`**（在主機上執行，由 GitHub Actions 經 IAP SSH 呼叫）：記下目前的映像檔摘要 → 拉新映像檔 → **先跑備份並上傳 Cloud Storage，失敗就停止** → 換上新版 → 檢查 `/api/health`（最多 60 秒）→ 失敗就換回舊摘要並以非零碼結束。全程 `set -euo pipefail`，不得把任何秘密印到日誌。
6. **`deploy/vm/rollback.sh`**：指定一組舊摘要換回。
7. **`deploy/vm/backup-to-gcs.sh`** 與 cron 設定：每日備份上傳 Cloud Storage。
8. **`deploy/vm/bootstrap.sh`**（主機第一次設定，由管理者或負責人執行一次）：格式化並掛載資料磁碟（**已有資料就不得格式化**）、安裝 Docker、建立目錄與權限、從 Secret Manager 讀秘密寫成 `/srv/dualplate/app.env`、設定 cron。
9. **`.github/workflows/deploy-production.yml`**：
   - 品質閘門：`cd api && npm test`、`cd admin && npm run check && npm run build`、`cd mobile && npm run build:h5`、部署腳本檢查（`bash -n`）。
   - 通過後才建置推送兩個映像檔，取得摘要。
   - 每次改動正式環境前確認此 commit 仍是 `main` 最新一筆（舊的排隊工作不能蓋過新的）。
   - `gcloud compute ssh dualplate-app --tunnel-through-iap` 執行 `deploy.sh <api 摘要> <web 摘要>`。
   - 所需變數全部用 GitHub `production` 環境變數，名稱參照 MasterDriver（`GCP_PROJECT_ID`、`GCP_REGION`、`GCP_ZONE`、`GCP_ARTIFACT_REPOSITORY`、`GCP_WORKLOAD_IDENTITY_PROVIDER`、`GCP_DEPLOY_SERVICE_ACCOUNT`、`GCP_VM_NAME`、`GCP_BACKUP_BUCKET`）。
10. **`docs/deploy.md` 改寫**為 Google Cloud 版本，結構參照 MasterDriver 的 `PRODUCTION-DEPLOYMENT.md`：架構圖、發布流程、健康檢查、回滾、一次性設定（逐條 `gcloud` 指令：啟用服務、Artifact Registry、主機與資料磁碟、快照排程、Cloud Storage 備份 bucket、Secret Manager、服務帳戶與最小權限、Workload Identity Federation、GitHub 環境與變數、DNS 指向）、第一個管理員、還原演練。**不得寫入任何密碼或金鑰。** 舊的單機 Nginx 部署說明刪除（歷史在 git 裏）。`docs/go-live.md` 相關段落同步更新。

## 三、要改的程式（只限這些）

- `admin/src/api.js`、`admin/src/views/Login.vue`、`admin/src/components/business/QuoteLedger.vue`、`mobile/src/lib/api.js`：`VITE_API_BASE_URL || 'http://localhost:4100'` 改成「**沒有設定（undefined）時**才用 `http://localhost:4100`，設為空字串時用同站相對路徑 `/api`」。本機開發照常可用。
- `api/.env.example`：按新架構更新註解與範例值（`CORS_ORIGINS` 可留空，因為同站；`PUBLIC_BASE_URL=https://dualplate.masterappinc.com`）。

## 四、驗收（負責人逐項檢查，任何一項不過即退回）

1. `cd api && npm test` 全過；`cd admin && npm run check` 通過；兩個前端都能以 `VITE_API_BASE_URL=` 空字串建置。
2. 所有腳本 `bash -n` 通過；`deploy.sh` 的失敗分支（備份失敗、健康檢查失敗）有清楚的結束碼與訊息。
3. 負責人在本機用 Docker 跑 `deploy/compose.yaml`（網域改 `localhost`），管理端與客戶端能登入、`/api` 和 `/r/` 轉發正常、重啟容器後資料還在。
4. 倉庫內沒有任何秘密、`.sqlite`、客戶資料；`git grep` 檢查 `password=`、`SECRET=` 等只出現在範例佔位。
5. `docs/deploy.md` 的一次性設定可以由不懂程式的人照着逐條執行。
6. 報告按 `AGENTS.md`「報告要求」，逐項對應本文件第二、三、四節。

## 五、不准做

- 不得執行任何 `gcloud`、SSH 或對外部網路的操作（你的沙盒也做不到）；所有雲端指令只寫在文件和腳本裏，由管理者或負責人執行。
- 不得改動資料庫結構、業務邏輯、介面樣式；不得新增 npm 依賴。
- 不得把本機資料庫、`.claude/local/` 的任何檔案、客戶資料放進映像檔或倉庫。
- 正式資料（李先生的 12 個牌照）**不在本任務範圍**：上線後由負責人用已核對的導入資料在正式環境重跑。
- 微信小程序上架不在本任務範圍（要已備案網域）。
