#!/usr/bin/env bash
# HostKVM 共用伺服器首次安裝（root 執行，可重複執行）。Docker、rclone、共用 Caddy 已由伺服器初始化安裝。
# 用法：APP_ENV_FILE=<app.env> DEPLOY_PUBKEY=<部署公鑰> bootstrap.sh
# - 先把 deploy/ 送到 /tmp/dualplate-deploy
# - APP_ENV_FILE：從 Secret Manager dualplate-app-env 原樣抄出的檔案；只在伺服器還沒有 app.env 時放入，用完即刪除
# - DEPLOY_PUBKEY：GitHub Actions 部署用的 ed25519 公鑰；deploy-dualplate 帳號登入後只能執行 deploy.sh
# 共用 Caddy 的網域設定 dualplate.caddy 不在這裏安裝：要等 DNS 指向本伺服器後才放入（見 docs/deploy.md）。
set -euo pipefail
[[ "${EUID}" -eq 0 ]] || { printf 'Run as root.\n' >&2; exit 2; }
ROOT=/srv/dualplate
SRC=/tmp/dualplate-deploy
USER_NAME=deploy-dualplate
PUB="${DEPLOY_PUBKEY:?DEPLOY_PUBKEY required}"
[[ -f "$SRC/compose.yaml" ]] || { printf 'deploy/ not found at %s.\n' "$SRC" >&2; exit 2; }
grep -qE '^ssh-ed25519 [A-Za-z0-9+/=]+( |$)' "$PUB" || { printf 'Expected one ed25519 public key.\n' >&2; exit 3; }
docker network inspect edge >/dev/null 2>&1 || { printf 'Shared edge network missing.\n' >&2; exit 3; }
command -v rclone >/dev/null || { printf 'rclone missing.\n' >&2; exit 3; }

install -d -m 755 -o root -g root "$ROOT"
install -d -m 700 -o 10001 -g 10001 "$ROOT/data" "$ROOT/backups" "$ROOT/logs"
if [[ ! -f "$ROOT/app.env" ]]; then
  [[ -s "${APP_ENV_FILE:-}" ]] || { printf 'APP_ENV_FILE required for the first install.\n' >&2; exit 3; }
  install -m 600 -o root -g root "$APP_ENV_FILE" "$ROOT/app.env"
  # 伺服器硬碟和其他產品共用：本機備份只留 7 天，異地備份在 GCS 留 35 天
  sed -i 's/^BACKUP_KEEP_DAYS=.*/BACKUP_KEEP_DAYS=7/' "$ROOT/app.env"
  printf 'Installed %s/app.env\n' "$ROOT"
fi
[[ -n "${APP_ENV_FILE:-}" && -f "$APP_ENV_FILE" ]] && shred -u "$APP_ENV_FILE"

install -m 0644 -o root -g root "$SRC/compose.yaml" "$ROOT/compose.yaml"
for script in deploy rollback backup-to-gcs refresh-env; do
  install -m 0755 -o root -g root "$SRC/vm/$script.sh" "$ROOT/$script.sh"
done
install -m 0644 -o root -g root "$SRC/vm/dualplate.caddy" "$ROOT/dualplate.caddy"
install -m 0644 "$SRC/vm/backup.cron" /etc/cron.d/dualplate-backup

# 部署帳號：只能用金鑰登入，登入後只會執行 deploy.sh；不能開 shell、不能轉發連線，不在 docker 群組
install -m 0755 -o root -g root "$SRC/vm/deploy-ssh.sh" /usr/local/bin/dualplate-deploy-ssh
id "$USER_NAME" >/dev/null 2>&1 || useradd -m -s /bin/sh "$USER_NAME"
passwd -l "$USER_NAME" >/dev/null
home="$(getent passwd "$USER_NAME" | cut -d: -f6)"
install -d -m 755 -o root -g root "$home/.ssh"
printf 'restrict,command="/usr/local/bin/dualplate-deploy-ssh" %s\n' "$(head -1 "$PUB")" > "$home/.ssh/authorized_keys"
chown root:root "$home/.ssh/authorized_keys"
chmod 644 "$home/.ssh/authorized_keys"
tmp="$(mktemp)"
printf '%s ALL=(root) NOPASSWD: %s/deploy.sh\n' "$USER_NAME" "$ROOT" > "$tmp"
visudo -cqf "$tmp"
install -m 440 -o root -g root "$tmp" /etc/sudoers.d/dualplate-deploy
rm -f "$tmp"
conf=/etc/ssh/sshd_config.d/10-masterapp.conf
if ! grep -qE "^AllowUsers .*\b$USER_NAME\b" "$conf"; then
  sed -i -E "s/^AllowUsers (.*)$/AllowUsers \1 $USER_NAME/" "$conf"
  sshd -t
  systemctl reload ssh
fi
printf 'Bootstrap complete.\n'
