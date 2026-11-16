#!/bin/zsh
# 批文卡底圖（階段 2c）：把 mobile/src/static/approval-card/front.svg、back.svg 原樣轉成 2 倍大的 PNG（2026×1286），
# 放到 assets/approval_card/。Flutter 不加 svg 套件；圖案有 pattern、clipPath、漸變，用 Chrome 照網頁畫出來最接近現有 App。
# 用法：app/tool/card_png.sh（需要 Google Chrome）。svg 改了才要重跑。
set -e
APP=${0:A:h:h}
SRC=$APP/../mobile/src/static/approval-card
OUT=$APP/assets/approval_card
TMP=$(mktemp -d)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p $OUT
for side in front back; do
  print "<html><body style=\"margin:0;background:transparent\"><img src=\"file://$SRC/$side.svg\" style=\"display:block;width:2026px;height:1286px\"></body></html>" > $TMP/$side.html
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=1 \
    --allow-file-access-from-files --window-size=2026,1286 --screenshot=$OUT/$side.png file://$TMP/$side.html >/dev/null 2>&1
done
rm -rf $TMP
ls -la $OUT
