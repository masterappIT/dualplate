# 正式部署（HostKVM 共用伺服器）

2026-10-19 起，正式環境由 Google Compute Engine 搬到 MasterApp 的 HostKVM 共用伺服器 `45.134.82.239`（香港）。部署方式沿用 Google VM 時的做法：同一套 Docker Compose、`deploy.sh` 和備份。只改了以下幾項：

- 80/443 和 HTTPS 證書由伺服器的共用 Caddy 負責
- 發布改用普通 SSH
- `app.env` 放在伺服器上
- 備份上傳到共用 bucket

搬遷過程見 `docs/tasks/hostkvm-migration.md`。

```mermaid
flowchart LR
  Users[瀏覽器] -->|HTTPS| Shared[共用 Caddy: 80/443]
  Shared -->|兩個網域| Web[dualplate-web: 內部 HTTP]
  Web --> Admin[管理端靜態檔]
  Web --> Mobile[客戶端 H5 靜態檔]
  Web -->|/api, /r| API[dualplate-api: Node 24]
  API --> DB[/srv/dualplate/data/app.sqlite]
  DB --> Backup[每日備份 + 發布前備份]
  Backup --> GCS[gs://masterapp-prod-backups/dualplate 35 天]
  GitHub[GitHub Actions 建置] --> Registry[Artifact Registry 摘要映像]
  Registry --> Web
  Registry --> API
```

## 網址與檢查

- 客戶端：`https://dualplate.masterappinc.com`
- 管理端：`https://dualplateadmin.masterappinc.com`
- 健康：兩個網域的 `/api/health` 應回 `{"ok":true,"database":"ok"}`。首頁應回 200，`index.html` 是 `no-store`，`/assets/` 可永久快取。
- 承租方專屬連結：客戶端網域的 `/r/<令牌>`。

## 伺服器上的檔案

全部在 `/srv/dualplate/`，由 `deploy/vm/bootstrap.sh` 安裝：

| 檔案 | 內容 |
|---|---|
| `compose.yaml` | 來自 `deploy/compose.yaml`：`dualplate-api` 只接本產品的內部網絡；`dualplate-web` 另接共用 Caddy 的 `edge` 網絡。記憶體上限 api 768MB、web 64MB |
| `deploy.env` | 現行映像摘要和兩個網域，由 `deploy.sh` 寫入 |
| `app.env` | API 環境設定，權限 600，只在伺服器上；副本在 Secret Manager `dualplate-app-env` |
| `data/`、`backups/`、`logs/` | SQLite、本機備份（保留 7 天）、錯誤記錄；擁有者 10001，權限 700 |
| `deploy.sh`、`rollback.sh`、`backup-to-gcs.sh`、`refresh-env.sh` | 來自 `deploy/vm/`，root 擁有 |
| `dualplate.caddy` | 共用 Caddy 的網域設定，已安裝到 `/srv/infra/sites/dualplate.caddy` |

- web 容器的 `deploy/web/Caddyfile` 只用內部 HTTP，按網域分管理端和客戶端，並保留以前的規則：15MB 上傳上限、`noindex`、CSP、快取標頭、`/r/` 轉發。
- `trusted_proxies` 只信任內部網絡傳來的 `X-Forwarded-For`，所以 API 記錄到的是用戶 IP；共用 Caddy 不信任外面傳入的值，用戶不能偽造。
- 容器之間用容器名稱 `dualplate-api` 互連，因為共用的 `edge` 網絡上有其他產品也叫 `api` 的服務。

## 發布與回滾

推送 `main` 後，`.github/workflows/deploy-production.yml` 依次執行：

1. 品質檢查：API 測試、管理端 check/build、客戶端 H5 build、腳本語法檢查。
2. `DEPLOY_ENABLED=true` 時，用 Workload Identity 登入 GCP，以 `docker buildx` 建置兩個映像並推送到 Artifact Registry。
3. 再次檢查 commit 仍是 `main` 最新。
4. 以 `deploy-dualplate@45.134.82.239` 經 SSH 傳兩個映像摘要。workflow 固定了伺服器的 host key，私鑰是 `production` environment 的 secret `HOSTKVM_DEPLOY_SSH_KEY`。

`deploy-dualplate` 帳號的限制：
- 只能用金鑰登入
- `authorized_keys` 的 forced command 只會執行 `sudo /srv/dualplate/deploy.sh <API> <web>`
- 不能開 shell、不在 docker 群組
- `deploy.sh` 只接受 `asia-east2-docker.pkg.dev/dualplate-511819/dualplate/{api,web}@sha256:…`

`deploy.sh` 的流程：
1. 拉映像
2. 先備份 SQLite 並上傳 GCS
3. 更新容器
4. 健康檢查兩次：先在 api 容器內檢查，再經 web 容器帶網域檢查 `/api/health`
5. 60 秒內不健康就切回舊摘要

首次沒有資料庫時跳過發布前備份，API 首次啟動時會建立空資料庫。

伺服器拉映像用共用的 `masterapp-prod-vm` 服務帳號，它只有 `dualplate` 倉庫的只讀權限。

手動回滾（以管理帳號 SSH 登入伺服器）：

```bash
ssh masterapp-prod 'sudo /srv/dualplate/rollback.sh <舊API映像@sha256> <舊web映像@sha256>'
```

摘要可從 Artifact Registry 或之前的 GitHub Actions 日誌取得。回滾程式不會回滾 SQLite 結構；如需還原資料，先停止容器並由負責人核對備份。

`deploy.sh` 結束碼：

| 碼 | 意思 |
|---|---|
| `0` | 新版健康 |
| `1` | 缺少必要參數或其他命令錯誤 |
| `2` | 摘要格式錯或不是本產品的映像 |
| `3` | 另一次發布佔用鎖 |
| `4` | 發布前備份失敗，或既有版本缺資料庫 |
| `5` | 新版容器啟動失敗、舊版已恢復健康 |
| `6` | 新版健康檢查失敗、舊版已恢復健康 |
| `7` | 新版失敗，舊版恢復後仍不健康 |
| `8` | 首次發布失敗、沒有舊版可切回 |
| `9` | 無法拉取映像 |

腳本會明確記錄 `Rollback healthy` 或 `Rollback unhealthy`。

## 備份

- 每日香港 03:15（伺服器 UTC 19:15，`/etc/cron.d/dualplate-backup`），每次發布前也會執行 `backup-to-gcs.sh`：
  1. 在 api 映像內執行 `npm run backup`：SQLite 線上備份，附完整性檢查
  2. 用 rclone 和 `/srv/infra/secrets/gcs-backup-sa.json` 上傳到 `gs://masterapp-prod-backups/dualplate/<年>/<月>/<日>/`
- bucket 35 天後自動刪除；這個服務帳號只能新增和讀取，不能覆寫或刪除。
- 記錄在 `/srv/dualplate/logs/backup-cron.log`。
- HostKVM 不提供磁碟快照，所以異地備份是唯一的機外副本。

## 首次安裝（重建伺服器時）

前提：伺服器已由 MasterApp-infra 初始化，Docker、rclone、共用 Caddy、`edge` 網絡、Artifact Registry 登入都已就緒。以下在持有 repo 的本機執行，不印出秘密：

```bash
ssh-keygen -t ed25519 -N '' -C deploy-dualplate -f deploy_key
ssh masterapp-prod 'rm -rf /tmp/dualplate-deploy && mkdir -p /tmp/dualplate-deploy'
rsync -az deploy/ masterapp-prod:/tmp/dualplate-deploy/
scp deploy_key.pub masterapp-prod:/tmp/dualplate-deploy.pub
gcloud secrets versions access latest --secret=dualplate-app-env --project=dualplate-511819 | ssh masterapp-prod 'umask 077; cat > /tmp/dualplate-app.env'
ssh masterapp-prod 'sudo APP_ENV_FILE=/tmp/dualplate-app.env DEPLOY_PUBKEY=/tmp/dualplate-deploy.pub bash /tmp/dualplate-deploy/vm/bootstrap.sh'
gh secret set HOSTKVM_DEPLOY_SSH_KEY --env production --repo masterappIT/dualplate < deploy_key
rm -P deploy_key deploy_key.pub
```

`bootstrap.sh` 只在伺服器沒有 `app.env` 時放入抄過來的檔案，並把 `BACKUP_KEEP_DAYS` 改為 7；放入後刪除暫存檔。之後手動執行 workflow 部署一次。

**兩個網域的 DNS 指向本伺服器後**才安裝共用 Caddy 的網域設定，否則 Caddy 會不斷申請證書失敗：

```bash
ssh masterapp-prod 'sudo install -m 644 /srv/dualplate/dualplate.caddy /srv/infra/sites/dualplate.caddy && cd /srv/infra && sudo docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'
```

DNS 在 Squarespace 管理：`dualplate`、`dualplateadmin` 兩筆 A 記錄指向 `45.134.82.239`，不改其他紀錄。

## 第一個管理員與還原演練

管理者在安全終端機輸入管理員名稱與密碼，不把密碼寫在命令列歷史、腳本或日誌：

```bash
ssh masterapp-prod
read -r -p "管理員帳號：" admin_user
read -r -p "顯示名稱：" admin_name
read -r -s -p "初始密碼（至少 10 字元）：" admin_password; echo
sudo docker compose --env-file /srv/dualplate/deploy.env -f /srv/dualplate/compose.yaml exec -T \
  -e ADMIN_USERNAME="$admin_user" -e ADMIN_NAME="$admin_name" -e ADMIN_PASSWORD="$admin_password" api node src/create-admin.js
unset admin_password
```

還原演練：從 GCS 取一份備份到隔離的位置，對副本執行 `PRAGMA integrity_check`，啟動測試 API 並核對筆數。正式資料庫不作演練覆蓋。

### 事故還原

先核對備份日期及事故時段的操作記錄。以下在伺服器的 shell 內由負責人執行；`BACKUP_OBJECT` 填已核對的 GCS 物件路徑（`dualplate/<年>/<月>/<日>/app-….sqlite`）。若有現存資料庫，先保留故障檔，絕不直接覆蓋。

```bash
ROOT=/srv/dualplate
KEY=/srv/infra/secrets/gcs-backup-sa.json
BACKUP_OBJECT='<已核對的備份物件路徑>'
sudo docker compose --env-file "$ROOT/deploy.env" -f "$ROOT/compose.yaml" stop api
sudo install -d -m 0700 "$ROOT/incident"
INCIDENT_TIME="$(date -u +%Y%m%dT%H%M%SZ)"
for suffix in '' '-wal' '-shm'; do
  if sudo test -f "$ROOT/data/app.sqlite${suffix}"; then
    sudo cp -a "$ROOT/data/app.sqlite${suffix}" "$ROOT/incident/app.sqlite.${INCIDENT_TIME}${suffix}"
  fi
done
sudo rclone copyto ":gcs:masterapp-prod-backups/${BACKUP_OBJECT}" "$ROOT/incident/restore.sqlite" --gcs-service-account-file "$KEY" --gcs-bucket-policy-only
sudo chown 10001:10001 "$ROOT/incident/restore.sqlite"
sudo docker compose --env-file "$ROOT/deploy.env" -f "$ROOT/compose.yaml" run --rm --no-deps -v "$ROOT/incident:/incident" api \
  node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('/incident/restore.sqlite',{readOnly:true}).prepare('PRAGMA integrity_check').get().integrity_check)"
```

只有 `integrity_check` 輸出 `ok` 時才繼續；否則換另一份備份。確認事故現況已保存後執行。舊的 WAL／SHM 不能和還原的資料庫混用，須在 API 已停止、舊檔已保存後移開：

```bash
sudo rm -f "$ROOT/data/app.sqlite-wal" "$ROOT/data/app.sqlite-shm"
sudo install -o 10001 -g 10001 -m 0600 "$ROOT/incident/restore.sqlite" "$ROOT/data/app.sqlite"
sudo docker compose --env-file "$ROOT/deploy.env" -f "$ROOT/compose.yaml" up -d api
curl --fail --silent --show-error https://dualplate.masterappinc.com/api/health
curl --fail --silent --show-error https://dualplateadmin.masterappinc.com/api/health
```

兩個健康端點都應回 `{"ok":true,"database":"ok"}`；再由負責人核對客戶、牌照與操作記錄。還原資料會失去備份時間後的變更，需按操作記錄判斷補錄。

### 改設定與微信小程序

新增微信 `WECHAT_APPID`／`WECHAT_SECRET` 或更換任何 API 環境設定的步驟如下，不要把秘密放在命令列或日誌：

1. 在本機修改權限 600 的暫存檔。
2. 同步成 Secret Manager 的新版本，作為副本。
3. 交給伺服器的 `refresh-env.sh`：它以權限 600 原子替換 `/srv/dualplate/app.env`，只重建 `api` 並檢查健康，失敗時還原舊檔。
4. 刪除暫存檔。

```bash
umask 077
APP_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/dualplate-app-env.XXXXXX")"
ssh masterapp-prod 'sudo cat /srv/dualplate/app.env' > "$APP_ENV_FILE"
${EDITOR:-vi} "$APP_ENV_FILE"
gcloud secrets versions add dualplate-app-env --data-file="$APP_ENV_FILE" --project=dualplate-511819
ssh masterapp-prod 'umask 077; cat > /tmp/dualplate-app.env.new' < "$APP_ENV_FILE"
ssh masterapp-prod 'sudo /srv/dualplate/refresh-env.sh /tmp/dualplate-app.env.new'
rm -P "$APP_ENV_FILE"
unset APP_ENV_FILE
curl --fail --silent --show-error https://dualplate.masterappinc.com/api/health
```

微信小程序的 request 合法網域須符合備案要求。`masterappinc.com` 的主機在香港、未備案；要上小程序須另備已備案網域，並完成微信平台的合法網域設定與審核。這是後續上架工作；現有兩個 H5 網址不代表小程序可直接上架。

有了已備案網域後：
1. `cd mobile && VITE_API_BASE_URL=https://<已備案網域> npm run build:mp-weixin`
2. 用微信開發者工具匯入 `mobile/dist/build/mp-weixin`，上傳並提交審核。

客戶第一次用微信登入時，輸入顧問在管理端「客戶帳號 → 產生微信綁定碼」給的 6 位數字。
