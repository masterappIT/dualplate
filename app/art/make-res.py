# 產生安卓圖示素材：dp 換算以 16 px/dp 的母版縮小到各密度
# 用法：python3 make-res.py <app/art> <輸出的 res 資料夾> <iOS 淺色 1024 圖示>
import sys, os
from PIL import Image, ImageDraw
R, OUT, IOS_ICON = sys.argv[1], sys.argv[2], sys.argv[3]
plates = Image.open(f'{R}/plates-2048.png').convert('RGBA')   # 1024 設計畫布（雙牌＋M，玻璃半透明）
bg = Image.open(f'{R}/icon-background-1536.png').convert('RGBA')    # 108dp 畫布，中間 72dp 等於 1024 設計
D = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
K = 16
FG_CANVAS = 62   # dp：雙牌最遠點 0.5285 × 62 = 32.8dp，在 66dp 安全圓（半徑 33dp）之內
fg_master = Image.new('RGBA', (108*K, 108*K), (0, 0, 0, 0))
fg_master.alpha_composite(plates.resize((FG_CANVAS*K, FG_CANVAS*K), Image.LANCZOS), ((108-FG_CANVAS)//2*K, (108-FG_CANVAS)//2*K))
bg_master = bg.resize((108*K, 108*K), Image.LANCZOS)
full = bg_master.copy(); full.alpha_composite(fg_master)
visible = full.crop((18*K, 18*K, 90*K, 90*K))   # 72dp 可見範圍
def masked(img, shape):
    s = img.size[0]; m = Image.new('L', (s, s), 0); d = ImageDraw.Draw(m)
    if shape == 'circle': d.ellipse((0, 0, s-1, s-1), fill=255)
    else: d.rounded_rectangle((0, 0, s-1, s-1), radius=round(s*0.225), fill=255)
    out = img.copy(); out.putalpha(m); return out
legacy_sq, legacy_round = masked(visible, 'square'), masked(visible, 'circle')
def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True); img.save(path, optimize=True)
for name, f in D.items():
    px = lambda dp: round(dp*f)
    save(bg_master.convert('RGB').resize((px(108), px(108)), Image.LANCZOS), f'{OUT}/mipmap-{name}/ic_launcher_background.png')
    save(fg_master.resize((px(108), px(108)), Image.LANCZOS), f'{OUT}/mipmap-{name}/ic_launcher_foreground.png')
    save(legacy_sq.resize((px(48), px(48)), Image.LANCZOS), f'{OUT}/mipmap-{name}/ic_launcher.png')
    save(legacy_round.resize((px(48), px(48)), Image.LANCZOS), f'{OUT}/mipmap-{name}/ic_launcher_round.png')
    # DCloud 運行時按名稱找 drawable/icon（例如通知），與桌面圖示同一張
    save(legacy_sq.resize((px(48), px(48)), Image.LANCZOS), f'{OUT}/drawable-{name}/icon.png')
# Play 商店 512 圖示：與 App Store 同一張（iOS 淺色 1024）
save(Image.open(IOS_ICON).convert('RGB').resize((512, 512), Image.LANCZOS), f'{R}/play-icon-512.png')
# 預覽：圓形、圓角方形、水滴三種遮罩
prev = Image.new('RGB', (3*300 + 40, 300), (240, 240, 240))
for i, shape in enumerate(['circle', 'square']):
    prev.paste(masked(visible, shape).resize((260, 260), Image.LANCZOS), (20 + i*300, 20), masked(visible, shape).resize((260, 260), Image.LANCZOS))
sq = visible.resize((260, 260), Image.LANCZOS); m = Image.new('L', (260, 260), 0); dd = ImageDraw.Draw(m)
dd.rounded_rectangle((0, 0, 259, 259), radius=130, fill=255); dd.rectangle((130, 130, 259, 259), fill=255)
prev.paste(sq, (20 + 600, 20), m)
prev.save(f'{R}/icon-mask-preview.png')
adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""
os.makedirs(f'{OUT}/mipmap-anydpi-v26', exist_ok=True)
for n in ('ic_launcher', 'ic_launcher_round'):
    open(f'{OUT}/mipmap-anydpi-v26/{n}.xml', 'w').write(adaptive)
print('ok')
