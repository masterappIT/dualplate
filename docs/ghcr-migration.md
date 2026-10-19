# 映像由 Artifact Registry 改為 GHCR 私人倉庫

> 撰寫：2026-10-19。
> **狀態（2026-10-19）**：只是方案，**未實施**。正式 workflow 和伺服器仍用 Artifact Registry。第五節第 1 步的改動曾在本機試做並驗證（見第八節），沒有提交。實施時每步先問負責人。
> 參考：`masterappIT/master-travel-project` 的 `deploy-hostkvm.yml`、`ghcr-retention.yml`（提交 `17b44700`），以及 MasterApp-infra 的 `apps/mastertravel/deploy.sh`、`docs/step-2-master-travel.md`。

## 一、為甚麼改

現在每次發布：

1. workflow 用 Workload Identity 登入 GCP（`dualplate-deploy` 帳號，Artifact Registry 寫入權限），把 `api`、`web` 推到 `asia-east2-docker.pkg.dev/dualplate-511819/dualplate`。
2. 伺服器用共用的 `masterapp-prod-vm` 服務帳號金鑰（長期有效，放在伺服器上）從 Artifact Registry 拉映像。

改用 GHCR 後：

- GitHub 不再需要任何 Google 權限，可以刪除 Workload Identity 和 `dualplate-deploy`。
- 伺服器不再為 Dualplate 保存任何映像倉庫登入：每次發布由 workflow 當次的 `GITHUB_TOKEN` 經 SSH 標準輸入交給伺服器，拉完即刪，工作結束後 token 失效。
- 部署私鑰外洩時，對方沒有 token，只能重新部署伺服器上已有的映像。
- Master Travel、MasterBox 已用同樣做法。

## 二、映像名稱

| 現在 | 改後 |
|---|---|
| `asia-east2-docker.pkg.dev/dualplate-511819/dualplate/api@sha256:…` | `ghcr.io/masterappit/dualplate-api@sha256:…` |
| `asia-east2-docker.pkg.dev/dualplate-511819/dualplate/web@sha256:…` | `ghcr.io/masterappit/dualplate-web@sha256:…` |

- GHCR 名稱只能用小寫，所以是 `masterappit`。
- 標籤照舊用 `<提交 SHA>-<run id>-<attempt>`，部署一律用 digest。
- 映像加標籤 `org.opencontainers.image.source=https://github.com/masterappIT/dualplate`，讓 package 第一次建立時就連到本 repo。這樣：
  - 本 repo 的 `GITHUB_TOKEN` 才能推送、拉取和清理
  - package 會跟隨 repo 的私人權限

## 三、workflow 改動（`.github/workflows/deploy-production.yml`）

檔名保持不變。這是唯一的 workflow，HostKVM 搬遷時就直接改了它；改名會令 Actions 記錄分成兩條，沒有好處。

1. 頂層權限改為只有 `contents: read`，刪除 `id-token: write`。只有 `deploy` job 加 `packages: write`。這樣品質檢查拿不到推送權限。
2. 刪除這三步：`google-github-actions/auth`、`setup-gcloud`、`Configure Artifact Registry`。
3. 新增 GHCR 登入：

   ```yaml
   - name: Log in to GHCR
     env:
       GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     run: printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "${{ github.actor }}" --password-stdin
   ```

4. 建置步驟改為推到 GHCR，用 `docker buildx imagetools inspect` 取 digest，取代 `gcloud artifacts docker images describe`：

   ```yaml
   - name: Build and push immutable images
     id: images
     env:
       REGISTRY: ghcr.io/masterappit
       SOURCE_LABEL: org.opencontainers.image.source=https://github.com/${{ github.repository }}
     run: |
       set -euo pipefail
       tag="${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
       for name in api web; do
         image="${REGISTRY}/dualplate-${name}:${tag}"
         docker buildx build --platform linux/amd64 --file "deploy/${name}/Dockerfile" \
           --label "$SOURCE_LABEL" --tag "$image" --push --provenance=false .
         digest="$(docker buildx imagetools inspect "$image" --format '{{json .Manifest}}' | jq -r .digest)"
         [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { printf 'Invalid digest for %s\n' "$image" >&2; exit 1; }
         printf '%s=%s@%s\n' "$name" "${REGISTRY}/dualplate-${name}" "$digest" >> "$GITHUB_OUTPUT"
       done
   ```

5. `Release over SSH` 加上 token 經標準輸入傳過去。參數仍是兩個完整映像引用，`deploy-ssh.sh` 不用改：

   ```yaml
   env:
     GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     # 其餘照舊
   run: |
     # 前面照舊
     printf '%s\n' "$GHCR_TOKEN" | ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o BatchMode=yes \
       "deploy-dualplate@${DEPLOY_HOST}" "$API_IMAGE $WEB_IMAGE"
   ```

   `sudo` 會把標準輸入原樣交給 `deploy.sh`；`authorized_keys` 的 `restrict` 只禁止 pty 和轉發，不影響標準輸入。Master Travel 已是這樣運作。

6. 新增 `prune-images` job（`needs: deploy`）：部署成功後，每個映像只留最近 10 版。回滾用的映像已在伺服器本機（見第四節），不靠 GHCR。

   ```yaml
   prune-images:
     needs: deploy
     runs-on: ubuntu-24.04
     permissions:
       packages: write
     strategy:
       fail-fast: false
       matrix:
         image: [api, web]
     steps:
       - uses: actions/delete-package-versions@v5
         with:
           package-name: dualplate-${{ matrix.image }}
           package-type: container
           min-versions-to-keep: 10
   ```

   和 Master Travel 不同：沒有另建 `ghcr-retention.yml`。Master Travel 的做法是 `workflow_run` 觸發，但 Dualplate 在 `DEPLOY_ENABLED=false` 時部署 job 會被跳過，workflow 結果仍是成功，清理就會在 package 還沒建立時執行並失敗。放在同一個 workflow 的 `needs: deploy` 裏，部署跳過時清理也跳過；同一次執行本來就在 `dualplate-production` 並行組內，不會和下一次部署同時拉映像。

7. 刪除 workflow 裏的 `vars.GCP_*` 引用。之後 GitHub `production` 環境的 8 個 `GCP_*` 變數都可以刪除（見第六節），只留 repo 變數 `DEPLOY_ENABLED`。

不在本方案內：只改文件時跳過部署（Master Travel 用 `paths-ignore`）。現在每次推送都會部署，要不要改由負責人另行決定。

## 四、伺服器腳本改動（本 repo 的 `deploy/vm/`）

Dualplate 的伺服器腳本在本 repo，不在 MasterApp-infra（和 Master Travel 不同），所以改動全部在本 repo。

### `deploy.sh`

1. **映像來源檢查**：只接受 GHCR 的 Dualplate 映像。點號要轉義；現在的寫法把 `REGISTRY` 直接放進正則，`.` 會配對任何字元。

   ```bash
   REGISTRY=ghcr.io/masterappit
   API_RE='^ghcr\.io/masterappit/dualplate-api@sha256:[0-9a-f]{64}$'
   WEB_RE='^ghcr\.io/masterappit/dualplate-web@sha256:[0-9a-f]{64}$'
   [[ "$new_api" =~ $API_RE && "$new_web" =~ $WEB_RE ]] || { printf 'Images must be %s/dualplate-{api,web}@sha256 digests.\n' "$REGISTRY" >&2; exit 2; }
   ```

2. **讀 token**：參照 Master Travel，只檢查字元和長度。GitHub 不保證 token 格式，Master Travel 第一次部署就因檢查 `ghs_` 前綴而失敗。

   ```bash
   token=''
   if [[ ! -t 0 ]]; then
     IFS= read -r -t 10 token || true
     [[ -z "$token" || ( ${#token} -ge 20 && ${#token} -le 4096 && "$token" =~ ^[A-Za-z0-9_.-]+$ ) ]] \
       || { printf 'Invalid registry token.\n' >&2; exit 2; }
   fi
   ```

3. **拉映像**：用臨時的 `DOCKER_CONFIG` 登入，拉完即刪；伺服器上不保存 GHCR 登入。沒有 token（手動執行）時不拉，只確認兩個映像已在本機。失敗照舊用結束碼 `9`。

   ```bash
   pull_images() {
     local cfg status=0
     if [[ -z "$token" ]]; then
       docker image inspect "$new_api" "$new_web" >/dev/null 2>&1 || { printf 'Images are not on this server; run the workflow.\n' >&2; return 1; }
       return 0
     fi
     cfg="$(mktemp -d)"
     printf '%s' "$token" | DOCKER_CONFIG="$cfg" docker login ghcr.io --username x-access-token --password-stdin >/dev/null || status=$?
     (( status == 0 )) && { DOCKER_CONFIG="$cfg" docker pull "$new_api" >/dev/null && DOCKER_CONFIG="$cfg" docker pull "$new_web" >/dev/null || status=$?; }
     rm -rf "$cfg"
     return "$status"
   }
   pull_images || { printf 'Image pull failed.\n' >&2; exit 9; }
   token=''
   ```

4. **清理舊映像**：伺服器硬碟和其他產品共用。發布健康後，刪除本產品不是 `new_*`、`old_*` 的映像。只刪 `ghcr.io/masterappit/dualplate-*` 和舊的 `asia-east2-docker.pkg.dev/dualplate-511819/dualplate/*`，其他產品的映像不動。做法同 Master Travel `deploy.sh` 的 `prune_images`。重新部署同一版時不清理，否則會刪掉再上一版、失去回滾目標。
5. 其餘流程、結束碼都不變：發布前備份、更新容器、兩次健康檢查、失敗換回舊摘要。換回舊摘要時舊映像已在本機，`docker compose up` 不用拉取。第一次 GHCR 發布時，舊摘要是 Artifact Registry 的映像，同樣已在本機。

### `rollback.sh`

現在無條件 `docker pull`。GHCR 是私人倉庫，伺服器沒有登入，會拉取失敗，`set -e` 會直接結束。改為：

- 映像已在本機就不拉
- 不在本機就停止，提示「在 GitHub 重新執行那個提交的 workflow」
- 同時加上和 `deploy.sh` 一樣的來源檢查：接受 GHCR，過渡期也接受舊 Artifact Registry 的 Dualplate 映像

### 不用改

- `deploy-ssh.sh`：標準輸入原樣經 `sudo` 交給 `deploy.sh`。
- `bootstrap.sh`、`compose.yaml`、`backup-to-gcs.sh`、`refresh-env.sh`：只用本機已有的映像。
- `docs/deploy.md`「首次安裝」的前提要刪除「Artifact Registry 登入」。

## 五、實施次序

每次推送 `main` 都會部署，所以要先暫停自動部署，和 HostKVM 切換時一樣：

1. 在本機改好 workflow、`deploy.sh`、`rollback.sh`、`docs/deploy.md`。
   - 跑 `bash -n deploy/vm/*.sh`
   - 用假 digest 測試 `deploy.sh` 的來源檢查：Artifact Registry 映像、別的 GHCR 映像、`ghcrXio` 這類點號變體都要回結束碼 `2`
2. `gh variable set DEPLOY_ENABLED --body false`，再 push。這次只跑品質檢查。
3. 把新的 `deploy.sh`、`rollback.sh` 裝到伺服器：
   ```bash
   rsync -az deploy/ masterapp-prod:/tmp/dualplate-deploy/
   ssh masterapp-prod 'sudo install -m 0755 -o root -g root /tmp/dualplate-deploy/vm/deploy.sh /srv/dualplate/deploy.sh && sudo install -m 0755 -o root -g root /tmp/dualplate-deploy/vm/rollback.sh /srv/dualplate/rollback.sh'
   ```
   - 不重跑整個 `bootstrap.sh`：它要 `DEPLOY_PUBKEY`，會重寫 `authorized_keys`。
   - 第 2 步到第 4 步之間，若有人推送並觸發部署，舊 workflow 傳來的 Artifact Registry 摘要會被新 `deploy.sh` 拒絕（結束碼 `2`），正式環境不受影響。
4. `gh variable set DEPLOY_ENABLED --body true`，再 `gh workflow run deploy-production.yml`。確認：
   - 日誌有 `Release healthy`
   - 伺服器 `deploy.env` 的兩個映像都是 `ghcr.io/masterappit/dualplate-*`
   - 兩個網域的 `/api/health` 正常
5. 在 GitHub 的 package 設定確認 `dualplate-api`、`dualplate-web`：
   - 是 **Private**
   - 已連到 `masterappIT/dualplate`
   - 勾選「繼承 repo 權限」

   用 `gh` 查要先 `gh auth refresh -s read:packages`。
6. 確認同一次執行的 `prune-images` 兩個 job 成功。
7. 再正常推送一次，確認自動部署成功，而且伺服器的舊映像清理只動 Dualplate 的映像。

## 六、改完後 GCP 可以刪甚麼

以下是 2026-10-19 唯讀查到的現況。每一項都要先問負責人，第 4 步和第 7 步都通過後才刪。

| 資源 | 現況 | 建議 |
|---|---|---|
| Artifact Registry `dualplate`（約 1.25GB） | workflow 寫入；`masterapp-prod-vm`、`dualplate-vm` 只讀 | 刪除。映像都可從 git 重建；伺服器正在用的和上一版已在本機 |
| 服務帳號 `dualplate-deploy` | AR 寫入；專案層級還有 `compute.osAdminLogin`、`compute.viewer`、`iap.tunnelResourceAccessor` | 刪除。後三個是舊 VM 經 IAP 部署時留下的，**現在就已沒有用處**，可以不等 GHCR 先移除 |
| WIF pool `github`／provider `github` | 只信任 `masterappIT/dualplate` 的 `production`、`main` | 刪除（先刪 `dualplate-deploy` 的 `workloadIdentityUser` 綁定） |
| 服務帳號 `dualplate-vm` | 舊 VM 用的帳號，只剩 AR 只讀 | 舊 VM 已刪除，**現在就可以刪** |
| 預設 compute 帳號 `763886931438-compute@…` | 專案層級 `roles/editor` | **現在就移除 `roles/editor`**：專案裏已沒有 VM，這和 Master Travel 事件裏被移除的是同一類權限 |
| Cloud Build 帳號的 `cloudbuild.builds.builder` | 2026-10-17 起已改在 GitHub 建置（`df770c1`） | 可移除權限並停用 Cloud Build API |
| Secret `dualplate-initial-admin-password` | 首次安裝時的管理員初始密碼 | 確認管理員已改密碼後刪除 |
| GitHub `production` 環境 8 個 `GCP_*` 變數 | `GCP_VM_NAME`、`GCP_ZONE`、`GCP_BACKUP_BUCKET` **現在就沒有使用**；其餘 5 個改完後不再使用 | 刪除，只留 repo 變數 `DEPLOY_ENABLED` |

**不能刪**：

- 專案 `dualplate-511819`
- 服務帳號 `masterapp-prod-vm`：所有產品共用，用來上傳備份
- bucket `masterapp-prod-backups`、`dualplate-511819-backups`：後者有搬遷前的舊備份
- Secret `dualplate-app-env`：`docs/deploy.md` 的改設定流程會寫入它當副本。要不要只留伺服器上一份，由負責人決定

**MasterApp-infra 那邊**（本 repo 不改）：

- Dualplate 改用 GHCR 後，若已沒有產品從 Artifact Registry 拉映像，`server/registry-login.sh` 的 `asia-east2-docker.pkg.dev` 登入可以移除。
- `masterapp-prod-vm` 在 `dualplate` 倉庫的只讀權限會隨倉庫刪除一起消失。

## 七、風險與待確認

- `GITHUB_TOKEN` 只在當次工作有效（最長 24 小時）。所以手動回滾到伺服器上沒有的舊版本時，要重新執行那個提交的 workflow；會重新建置，digest 可能不同。這和 Master Travel 一樣。
- **Master Travel 說法不一致**：`master-travel-project` 的 `deploy-hostkvm.yml` 註解寫映像「公開可讀」，但 MasterApp-infra 的 `deploy.sh` 和 `step-2-master-travel.md` 寫私人倉庫。我沒有 `read:packages` 權限，未能核實。Dualplate 實施時要在第 5 步親自確認是 Private。Master Travel 那邊由它自己的 session 確認。
- 第一次推送會在 `masterappIT` 個人帳號下建立 package。`masterappIT` 是個人帳號，不是組織，和 Master Travel 一樣，所以沒有組織層級的 package 設定要調。

## 附：共用 Caddy 的請求記錄（`import access_log`，2026-10-19 加入，和 GHCR 無關）

**來源**：伺服器上的 `/srv/infra/sites/dualplate.caddy` 來自本 repo 的 `deploy/vm/dualplate.caddy`，不在 MasterApp-infra。
- `bootstrap.sh` 把它複製到 `/srv/dualplate/dualplate.caddy`。
- 2026-10-19 02:12 UTC 切換 DNS 時，用 `docs/deploy.md` 的 `install` 指令手動裝到 `/srv/infra/sites/`。
- 同日唯讀比對，三份的 sha256 相同（`23875cb8…`）。

**改動**：網站區塊加 `import access_log`，未部署。
- 共用 Caddy 的主 Caddyfile 已定義這個 snippet，2026-10-19 15:19 UTC 起生效：寫到 `/data/access.log`，JSON 格式，每份 50MB，留 5 份。
- 用伺服器 Caddy 容器的 `caddy adapt` 唯讀檢查過：設定經標準輸入傳入，不寫檔、不 reload。兩個網域都接到這份記錄。

**上線步驟**：

```bash
rsync -az deploy/ masterapp-prod:/tmp/dualplate-deploy/
ssh masterapp-prod 'sudo install -m 644 /tmp/dualplate-deploy/vm/dualplate.caddy /srv/dualplate/dualplate.caddy && sudo install -m 644 /srv/dualplate/dualplate.caddy /srv/infra/sites/dualplate.caddy && cd /srv/infra && sudo docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'
```

上線後確認：
- 兩個網域 HTTPS 200，`/api/health` 正常
- `/data/access.log` 出現 `dualplate`、`dualplateadmin` 的記錄

可以和第五節第 3 步一起做，也可以單獨做。

**已處理（2026-10-19）**：負責人選了「遮蔽」，共用 Caddyfile 已把 `/r/<令牌>` 和 `?k=` 的值寫成 `REDACTED`（MasterApp-infra `ed5ced1`）。本產品的網站區塊不用另外設定。以下是當時的分析。

**疑慮：承租方連結的令牌會寫進記錄。** 承租方專屬連結是 `/r/<令牌>`，上傳後還會轉到 `/r/<令牌>?k=<金鑰>&done=1`（`api/src/renter-portal.js`），令牌和金鑰都在網址裏。Caddy 的請求記錄會原樣記下完整網址，所以能讀 `/data/access.log` 的人，可以在連結有效期內用這些連結。Caddy 預設會遮蔽 `Cookie`、`Authorization` 標頭，但不會遮蔽網址。

可選做法（未實施，由負責人決定）：
1. **照現在**：讀得到記錄的人本來就有伺服器 root 權限，也讀得到資料庫。
2. **遮蔽 `/r/` 的網址**：在本產品的網站區塊用 Caddy 的 `log` filter，把 `/r/` 開頭請求的 `request.uri` 遮蔽。這要另寫 log 設定，不能只用共用 snippet。
3. **完全不記 `/r/`**：用 `log_skip` 不記錄 `/r/*` 的請求。

另外，伺服器上的 `masterdriver.caddy` 也還沒有 `import access_log`。它的原檔是 MasterDriver repo 的 `deploy/hostkvm/masterdriver.caddy`，本 repo 不改。

## 八、本機驗證記錄（2026-10-19）

- `actionlint .github/workflows/deploy-production.yml`：沒有新問題，只剩改動前就有的 4 條 SC1007 警告（`VITE_API_BASE_URL= npm run build` 是刻意給空值）。
- `bash -n deploy/vm/*.sh`、`shellcheck -S warning deploy/vm/deploy.sh deploy/vm/rollback.sh`：通過。
- 用假的 `docker`、`flock`、`timeout` 在暫存目錄執行 `deploy.sh`、`rollback.sh`（`ROOT` 改到暫存目錄）。全部 19 項符合預期：
  - `deploy.sh` 拒絕（結束碼 `2`）：Artifact Registry 映像、`ghcrXio` 點號變體、別的產品的 GHCR 映像、api／web 對調、用 tag 不用 digest、digest 後有多餘字元、token 含空格、token 太短、token 含分號
  - `deploy.sh` 結束碼 `9`：沒有 token 且映像不在本機、GHCR 登入失敗
  - `deploy.sh` 成功（結束碼 `0`）：
    - 首次發布：`deploy.env` 寫入 GHCR 摘要，臨時登入目錄已刪除，token 沒有出現在任何 docker 參數
    - 由 Artifact Registry 切換到 GHCR：先執行發布前備份，只刪更舊的 Dualplate 映像，上一版和其他產品（MasterBox、Master Travel、postgres）的映像都保留
    - 手動重新部署本機映像：沒有登入、沒有拉取
    - 同一版重新部署：不刪任何映像
  - `rollback.sh`：
    - 回到本機的 Artifact Registry 舊版：成功
    - 回到不在本機的版本：結束碼 `9`
    - 別的產品映像、參數對調：結束碼 `2`
    - 全程沒有拉取
- 本機只有 bash 3.2，伺服器是 Ubuntu 24.04 的 bash 5；用到的語法兩者都支援。
- 未驗證：真實的 GHCR 推送和拉取、`sudo` 經 forced command 傳遞標準輸入（Master Travel 用同樣的 `exec sudo -n … $SSH_ORIGINAL_COMMAND`，正式環境已成功）、`delete-package-versions` 對個人帳號 package 的權限。這些在第五節第 4–6 步確認。
