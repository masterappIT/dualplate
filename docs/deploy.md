# 部署說明（車牌管家 V1）

一台雲伺服器即可：Node API ＋ Nginx 提供管理端與客戶端 H5 的靜態檔，並反向代理 `/api`。小程序另外在微信開發者工具上傳。

## 一、伺服器與網域

| 項目 | 建議 |
|---|---|
| 系統 | Ubuntu 22.04 或 24.04，2 核 4 GB 起 |
| Node | **24 或以上**（API 使用內建 `node:sqlite`） |
| 網域 | `admin.<你的網域>`（管理端）、`m.<你的網域>`（客戶端 H5）、`api.<你的網域>`（API） |
| HTTPS | Let's Encrypt（`certbot --nginx`），三個子網域都要 |

**香港與內地伺服器的差別**

- **香港伺服器**：不需 ICP 備案，內地客戶一般可以打開，但速度視線路而定。
- **內地伺服器**：網域必須先完成 **ICP 備案** 才能對外提供網站；**微信小程序的業務網域（request 合法網域）必須是已備案的 HTTPS 網域**。若要上小程序，API 網域要符合這個要求。
- 建議：先用香港伺服器給內部員工試行；確定上小程序時再按小程序要求準備備案網域。

## 二、目錄

```
/srv/plate-crm/app       程式（git 取得）
/srv/plate-crm/data      資料庫 app.sqlite（只放這裡）
/srv/plate-crm/backups   每日備份（保留 30 天）
/srv/plate-crm/logs      錯誤記錄（按日一個檔）
```

## 三、API

```bash
cd /srv/plate-crm/app/api && npm ci --omit=dev
cp .env.example .env        # 按註解填寫；DEMO_SEED 保持 0
```

`.env` 必填：`PORT`、`DB_PATH`、`CORS_ORIGINS`（管理端與 H5 的 https 網址）、`BACKUP_DIR`、`LOG_DIR`、`PUBLIC_BASE_URL`（API 對外網址，承租方專屬連結 `/r/…` 由 API 直接提供）。要開微信登入才填 `WECHAT_APPID`、`WECHAT_SECRET`。

**第一個管理員**（建立後即可登入管理端再新增員工）：

```bash
ADMIN_USERNAME=boss ADMIN_NAME="負責人" ADMIN_PASSWORD='至少10位的強密碼' node src/create-admin.js
```

**用 systemd 常駐**（`/etc/systemd/system/plate-crm-api.service`）：

```ini
[Unit]
Description=Plate CRM API
After=network.target
[Service]
WorkingDirectory=/srv/plate-crm/app/api
EnvironmentFile=/srv/plate-crm/app/api/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
User=platecrm
[Install]
WantedBy=multi-user.target
```

`systemctl enable --now plate-crm-api`；`curl https://api.<網域>/api/health` 應回 `{"ok":true,"database":"ok","version":"1.0.0"}`。

## 四、每日備份

```bash
# crontab -u platecrm -e
15 3 * * * cd /srv/plate-crm/app/api && set -a && . ./.env && set +a && npm run backup >> /srv/plate-crm/logs/backup.log 2>&1
```

備份用 SQLite 線上備份，不必停機；每份都做完整性檢查，超過 `BACKUP_KEEP_DAYS`（預設 30）自動刪除。**建議每週把最新一份另存到另一地點**（雲端硬碟或另一台機）。

**還原**（出事時）：

```bash
systemctl stop plate-crm-api
cp /srv/plate-crm/data/app.sqlite /srv/plate-crm/data/app.sqlite.before-restore
cp /srv/plate-crm/backups/app-<日期時間>.sqlite /srv/plate-crm/data/app.sqlite
systemctl start plate-crm-api && curl https://api.<網域>/api/health
```

還原演練已寫成自動測試（`api/test/security.test.js`「備份產生可開啟的完整副本，從備份啟動資料一致」）。

## 五、管理端與客戶端 H5

```bash
cd /srv/plate-crm/app/admin && npm ci && VITE_API_BASE_URL=https://api.<網域> VITE_CLIENT_LOGIN_URL=https://m.<網域> npm run build   # 輸出 admin/dist
cd /srv/plate-crm/app/mobile && npm ci && VITE_API_BASE_URL=https://api.<網域> npm run build:h5                                  # 輸出 mobile/dist/build/h5
```

Nginx（節錄）：

```nginx
server { server_name admin.<網域>; root /srv/plate-crm/app/admin/dist; location / { try_files $uri /index.html; } }
server { server_name m.<網域>;     root /srv/plate-crm/app/mobile/dist/build/h5; location / { try_files $uri /index.html; } }
server { server_name api.<網域>;   client_max_body_size 15m;
         location / { proxy_pass http://127.0.0.1:4100; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; } }
```

`X-Forwarded-For` 必須設定，否則登入鎖定會把所有人當成同一個 IP。上傳上限 5 MB／檔，`client_max_body_size 15m` 已留餘量。

## 六、微信小程序

1. 在微信公眾平台註冊小程序，取得 AppID 與 AppSecret，填入 API 的 `.env` 後重啟。
2. 「開發設定 → 伺服器網域」的 request 合法網域填 `https://api.<網域>`（須已備案，見第一節）。
3. `cd mobile && VITE_API_BASE_URL=https://api.<網域> npm run build:mp-weixin`，用微信開發者工具匯入 `mobile/dist/build/mp-weixin`，上傳並提交審核。
4. 客戶第一次用微信登入時，輸入顧問在管理端「客戶帳號 → 產生微信綁定碼」給的 6 位數字。

## 七、更新版本

```bash
cd /srv/plate-crm/app && git pull
cd api && npm ci --omit=dev && npm run backup && systemctl restart plate-crm-api
# 管理端與 H5 重新 build（第五節）
```

更新前一定先備份；資料庫遷移在 API 啟動時自動執行且只執行一次。

## 八、本機以生產模式試跑

```bash
cd api && DB_PATH=/tmp/plate-prod.sqlite PORT=4300 CORS_ORIGINS=http://localhost:4301,http://localhost:4302 node src/server.js
cd admin && VITE_API_BASE_URL=http://localhost:4300 npm run build && npx vite preview --port 4301
cd mobile && VITE_API_BASE_URL=http://localhost:4300 npm run build:h5 && npx vite preview --outDir dist/build/h5 --port 4302
```
