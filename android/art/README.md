# 安卓圖示與啟動圖母版

與 iOS 正式版同一套設計（Figma `y9pGKdDAYvCtmkckIdFVnc`，節點 `1616:666`「A-2 雙牌玻璃＋牌框螺絲（定稿・淺色）」）。M 只等比縮放，不改形狀、不加效果。

| 檔案 | 內容 | 來源 |
|---|---|---|
| `plates-2048.png` | 雙牌＋M，透明底，1024 設計畫布的 2 倍 | `mobile/src/static/launch/` 的分層 SVG 逐層渲染，黑牌磨砂玻璃的背景模糊按 Figma（CSS blur 24px，以 1024 畫布計）合成。疊在深綠 `#0B3B30` 上與 iOS 啟動圖 `launch-logo.png` 平均差 1.2／255；疊在背景上與 iOS 圖示平均差 2.5／255 |
| `icon-background-1536.png` | 自適應圖示背景，108dp 畫布，中間 72dp 等於 iOS 圖示的 1024 底色 | Figma「背景」層（對角線漸變，向外延伸時取端點顏色）加「綠色光暈」（`#5FE0B4` 25%、半徑 280、模糊 95） |
| `make-res.py` | 由兩張母版產生各密度素材：自適應圖示、方形和圓形舊式圖示、`splash_logo`（180dp 雙牌）、DCloud 啟動圖 `splash.png`（深綠底 360×800dp，正中 180dp 雙牌）、`icon`、Play 商店 512 圖示 | — |
| `play-icon-512.png`、`icon-mask-preview.png` | 由 `make-res.py` 產生：Play 商店圖示、三種遮罩的預覽 | — |

尺寸：
- 啟動圖 `splash_logo` 為 180dp，與 iOS 的 180pt 和 `mobile/src/pages/launch/launch.vue` 第一幀同一尺寸。雙牌離中心最遠 95dp，在 Android 12 起系統啟動畫面的 192dp 圓形範圍之內，不會被切（系統啟動畫面的設定見 `android/README.md`）。
- 自適應圖示前景的雙牌畫布為 62dp，最遠點 32.8dp，在 66dp 安全圓之內。
- Play 商店 512 圖示直接縮小 iOS 淺色 1024 圖示，與 App Store 同一張。
- 安卓沒有深色模式圖示；Android 13 的主題圖示（單色層）沒有做，系統會照常顯示彩色圖示。

重新產生（需要 Pillow）：

```bash
python3 android/art/make-res.py android/art android/app/client/src/main/res ios/app/HBuilder/Images.xcassets/AppIcon.appiconset/icon-1024-light.png
```
