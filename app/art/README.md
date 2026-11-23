# App 圖示素材（母版）

與 iOS 正式版同一套設計（Figma `y9pGKdDAYvCtmkckIdFVnc`，節點 `1616:666`「A-2 雙牌玻璃＋牌框螺絲（定稿・淺色）」）。M 只等比縮放，不改形狀、不加效果。

原本放在舊的 DCloud 安卓專案（`android/art/`），2026-11-23 階段 6 刪除舊專案時搬來這裏。Flutter 版現用的圖示已放在 `app/android/app/src/main/res/mipmap-*`、`app/ios/Runner/Assets.xcassets/AppIcon.appiconset/`；只有要重做圖示時才用這裏的母版。

| 檔案 | 內容 | 來源 |
|---|---|---|
| `plates-2048.png` | 雙牌＋M，透明底，1024 設計畫布的 2 倍 | `mobile/src/static/launch/` 的分層 SVG 逐層渲染，黑牌磨砂玻璃的背景模糊按 Figma（CSS blur 24px，以 1024 畫布計）合成。疊在深綠 `#0B3B30` 上與 iOS 啟動圖 `launch-logo.png` 平均差 1.2／255；疊在背景上與 iOS 圖示平均差 2.5／255 |
| `icon-background-1536.png` | 自適應圖示背景，108dp 畫布，中間 72dp 等於 iOS 圖示的 1024 底色 | Figma「背景」層（對角線漸變，向外延伸時取端點顏色）加「綠色光暈」（`#5FE0B4` 25%、半徑 280、模糊 95） |
| `make-res.py` | 由兩張母版產生各密度素材：自適應圖示、方形和圓形舊式圖示、`icon`、Play 商店 512 圖示 | — |
| `play-icon-512.png`、`icon-mask-preview.png` | 由 `make-res.py` 產生：Play 商店圖示、三種遮罩的預覽 | — |

尺寸：
- 自適應圖示前景的雙牌畫布為 62dp，最遠點 32.8dp，在 66dp 安全圓之內。
- Play 商店 512 圖示直接縮小 iOS 淺色 1024 圖示，與 App Store 同一張。
- 安卓沒有深色模式圖示；Android 13 的主題圖示（單色層）沒有做，系統會照常顯示彩色圖示。
- 安卓啟動畫面不用這裏的圖：深綠底、正中白色 MasterApp 標誌（M 雲）100×76dp，是向量圖 `app/android/app/src/main/res/drawable/launch_mark.xml`。

重新產生（需要 Pillow）。先輸出到暫存資料夾，核對過再抄進 `app/android/app/src/main/res/`：

```bash
python3 app/art/make-res.py app/art /private/tmp/dualplate-icons app/ios/Runner/Assets.xcassets/AppIcon.appiconset/icon-1024-light.png
```
