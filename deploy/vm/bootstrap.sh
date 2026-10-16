#!/usr/bin/env bash
set -euo pipefail
[[ "${EUID}" -eq 0 ]] || { printf 'Run as root.\n' >&2; exit 2; }
ROOT=/srv/dualplate
DEVICE="${DATA_DEVICE:?Set DATA_DEVICE to the attached persistent disk /dev/disk/by-id path}"
PROJECT="${GCP_PROJECT_ID:?GCP_PROJECT_ID required}"
SECRET="${GCP_APP_ENV_SECRET:-dualplate-app-env}"
[[ -b "$DEVICE" ]] || { printf 'Data disk is not a block device.\n' >&2; exit 2; }
apt-get update
apt-get install -y ca-certificates curl gnupg cron
mkdir -p /usr/share/keyrings
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
printf "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main\n" > /etc/apt/sources.list.d/google-cloud-sdk.list
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian %s stable\n' "$(dpkg --print-architecture)" "$(. /etc/os-release && echo "$VERSION_CODENAME")" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin google-cloud-cli
gcloud auth configure-docker asia-east2-docker.pkg.dev --quiet
systemctl enable --now docker cron
if ! blkid "$DEVICE" >/dev/null 2>&1; then
  [[ "${FORMAT_EMPTY_DISK:-}" == 'yes' ]] || { printf 'Disk has no filesystem. Set FORMAT_EMPTY_DISK=yes only after checking it is empty.\n' >&2; exit 3; }
  mkfs.ext4 -F "$DEVICE"
fi
fstype="$(blkid -s TYPE -o value "$DEVICE")"
[[ "$fstype" == ext4 ]] || { printf 'Expected ext4 data disk; found %s.\n' "$fstype" >&2; exit 3; }
mkdir -p "$ROOT"
uuid="$(blkid -s UUID -o value "$DEVICE")"
if ! grep -q "UUID=$uuid " /etc/fstab; then printf 'UUID=%s %s ext4 defaults,nofail 0 2\n' "$uuid" "$ROOT" >> /etc/fstab; fi
mountpoint -q "$ROOT" || mount "$ROOT"
mkdir -p "$ROOT"/{data,backups,logs,caddy/data,caddy/config}
chown -R 10001:10001 "$ROOT/data" "$ROOT/backups" "$ROOT/logs"
chmod 700 "$ROOT/data" "$ROOT/backups" "$ROOT/logs"
gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT" > "$ROOT/app.env"
chmod 600 "$ROOT/app.env"
install -m 0644 /tmp/dualplate-deploy/compose.yaml "$ROOT/compose.yaml"
install -m 0755 /tmp/dualplate-deploy/vm/deploy.sh "$ROOT/deploy.sh"
install -m 0755 /tmp/dualplate-deploy/vm/rollback.sh "$ROOT/rollback.sh"
install -m 0755 /tmp/dualplate-deploy/vm/backup-to-gcs.sh "$ROOT/backup-to-gcs.sh"
install -m 0644 /tmp/dualplate-deploy/vm/backup.cron /etc/cron.d/dualplate-backup
printf 'Bootstrap complete.\n'
