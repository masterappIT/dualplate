#!/bin/sh
# 產生 DCloud 啟動圖 drawable-*/splash.png：深綠 #0B3B30 底 360×800dp，正中白色 MasterApp 標誌（M 雲）100×76dp。
# 平時 LaunchCover 已叫 DCloud 不顯示這張圖，只在那一步失敗時才會用到；DCloud 會把它拉伸到整個螢幕。
# 標誌是 SVG（mobile/src/static/masterapp-mark.svg），Pillow 畫不了，用 Google Chrome 無頭模式渲染，再用 Pillow 存成不透明 PNG。
# 用法：sh android/art/make-splash.sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
RES="$ROOT/android/app/client/src/main/res"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
SVG=$(base64 < "$ROOT/mobile/src/static/masterapp-mark.svg" | tr -d '\n')
for pair in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  name=${pair%%:*}; f=${pair##*:}
  set -- $(python3 -c "f=$f; W=round(360*f); H=round(800*f); print(W, H, 100*f, 76*f, (W-100*f)/2, (H-76*f)/2)")
  cat > "$WORK/p.html" <<HTML
<html><body style="margin:0;width:$1px;height:$2px;background:#0B3B30;overflow:hidden"><img src="data:image/svg+xml;base64,$SVG" style="position:absolute;width:$3px;height:$4px;left:$5px;top:$6px"></body></html>
HTML
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$1,$2" --screenshot="$WORK/$name.png" "file://$WORK/p.html" > /dev/null 2>&1
  python3 -c "from PIL import Image; Image.open('$WORK/$name.png').convert('RGB').save('$RES/drawable-$name/splash.png', optimize=True)"
  echo "drawable-$name/splash.png $1×$2"
done
