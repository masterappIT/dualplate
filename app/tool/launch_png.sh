#!/bin/sh
# iOS 啟動動畫的分層圖（階段 4）：把 mobile/src/static/launch/ 的五個 SVG 原樣渲染成透明 PNG，放 app/assets/launch/。
# Flutter 不加 svg 套件；分層有濾鏡（陰影、內陰影），用 Google Chrome 無頭模式渲染。
# 每層按 SVG 自己的寬高（即 launch.vue 以 1024 設計畫布排版時的大小）渲染，畫面上縮到 180pt 畫布，3 倍螢幕上仍有約 1.9 倍餘量。
# 另把第一幀的靜態圖 launch-logo.png（iOS 原生啟動圖 LaunchLogo 同一張）抄成 1x／2x／3x 三個檔。
# 用法：sh app/tool/launch_png.sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC="$ROOT/mobile/src/static/launch"
OUT="$ROOT/app/assets/launch"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT" "$OUT/2.0x" "$OUT/3.0x"
for name in yellow frame screw black m; do
  set -- $(python3 -c "import re; s=open('$SRC/$name.svg').read(); m=re.search(r'<svg width=\"(\d+)\" height=\"(\d+)\"', s); print(m[1], m[2])")
  SVG=$(base64 < "$SRC/$name.svg" | tr -d '\n')
  cat > "$WORK/p.html" <<HTML
<html><body style="margin:0;width:$1px;height:$2px;background:transparent;overflow:hidden"><img src="data:image/svg+xml;base64,$SVG" style="position:absolute;left:0;top:0;width:$1px;height:$2px"></body></html>
HTML
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 --window-size="$1,$2" --screenshot="$WORK/$name.png" "file://$WORK/p.html" > /dev/null 2>&1
  python3 -c "from PIL import Image; im=Image.open('$WORK/$name.png').convert('RGBA'); assert im.size==($1,$2), im.size; im.save('$OUT/$name.png', optimize=True)"
  echo "$name.png $1×$2"
done
LOGO="$ROOT/ios/app/HBuilder/Images.xcassets/LaunchLogo.imageset"
cp "$LOGO/launch-logo.png" "$OUT/launch-logo.png"
cp "$LOGO/launch-logo@2x.png" "$OUT/2.0x/launch-logo.png"
cp "$LOGO/launch-logo@3x.png" "$OUT/3.0x/launch-logo.png"
echo "launch-logo.png 1x／2x／3x"
