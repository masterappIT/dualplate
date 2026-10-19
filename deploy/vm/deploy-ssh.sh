#!/bin/sh
# deploy-dualplate 帳號的 SSH forced command（伺服器上的位置：/usr/local/bin/dualplate-deploy-ssh）。
# 不論 SSH 要求執行甚麼，都只會把參數交給部署腳本；參數由部署腳本驗證。
set -f
exec sudo -n /srv/dualplate/deploy.sh $SSH_ORIGINAL_COMMAND
