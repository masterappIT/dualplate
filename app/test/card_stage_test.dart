// 拍批文卡的計算部分（lib/business/card_stage.dart）：對準框位置、座標換算、截出的圖尺寸和位置。
// 對照的數值來自 mobile/src/lib/card-stage.js、CardCapture.vue 的 layout() 和伺服器 api/src/card-face.js。
// 最後一組用 api/test/fixtures/cards/ 的樣本做輸入（只在測試中讀取，不印出、不另存）；沒有樣本時自動跳過並寫明原因。
// 樣本放在別處時用環境變量 DP_CARD_FIXTURES 指明目錄。
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' show Size;
import 'package:dualplate/business/card_capture.dart';
import 'package:dualplate/business/card_stage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

// 純色測試圖：[paint] 回傳每點顏色（RGBA，已乘 alpha）
Uint8List solid(int w, int h, List<int> Function(int x, int y) paint) {
  final out = Uint8List(w * h * 4);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      out.setRange((y * w + x) * 4, (y * w + x) * 4 + 4, paint(x, y));
    }
  }
  return out;
}

const red = [255, 0, 0, 255], blue = [0, 0, 255, 255];

// image 套件的圖轉成每點 4 字節、已乘 alpha 的 RGBA（和 dart:ui rawRgba 相同格式）
Uint8List premultiplied(img.Image image) {
  final rgba = image.convert(numChannels: 4).getBytes(order: img.ChannelOrder.rgba);
  for (var i = 0; i < rgba.length; i += 4) {
    final a = rgba[i + 3];
    for (var c = 0; c < 3; c++) {
      rgba[i + c] = (rgba[i + c] * a / 255).round();
    }
  }
  return rgba;
}

List<int> pixel(img.Image image, int x, int y) {
  final p = image.getPixel(x, y);
  return [p.r.toInt(), p.g.toInt(), p.b.toInt()];
}

// 伺服器 api/src/card-face.js：MARGIN_W／MARGIN_H，以及找不到卡邊時取的框內範圍
const serverFaceW = 2030, serverFaceH = 1290, serverMargin = 0.06;
final serverInnerLeft = (serverFaceW * serverMargin).round(); // 122
final serverInnerTop = (serverFaceH * serverMargin).round(); // 77

void main() {
  group('固定尺寸', () {
    test('截圖尺寸是 2274×1445，和 card-stage.js 的 FULL_W／FULL_H 算法相同', () {
      expect(cardFullW, 2274);
      expect(cardFullH, 1445);
      expect(cardFullW, (2030 * (1 + 2 * 0.06)).round());
      expect(cardFullH, (1290 * (1 + 2 * 0.06)).round());
    });

    test('和伺服器 card-face.js 的 MARGIN_W／MARGIN_H 相同', () {
      expect(cardFullW, (serverFaceW * (1 + 2 * serverMargin)).round());
      expect(cardFullH, (serverFaceH * (1 + 2 * serverMargin)).round());
    });
  });

  group('對準框位置（CardCapture.vue layout）', () {
    test('iPhone 17 Pro 直向：寬 402 減 40、高按 1015:645、置中後上移 40', () {
      final f = cardFrame(const Size(402, 874), 62);
      expect([f.left, f.top, f.width, f.height], [20, 282, 362, 230]);
    });

    test('iPhone 16／17 Pro Max 直向（寬 440）', () {
      final f = cardFrame(const Size(440, 956), 62);
      expect([f.left, f.top, f.width, f.height], [20, 311, 400, 254]);
    });

    test('寬螢幕框寬最多 560', () {
      final f = cardFrame(const Size(1024, 1366), 24);
      expect(f.width, 560);
      expect(f.height, (560 * 645 / 1015).round());
      expect(f.left, (1024 - 560) / 2);
    });

    test('矮畫面框頂最少離狀態列底 120', () {
      final f = cardFrame(const Size(402, 400), 62);
      expect(f.top, 182);
    });

    test('寬度有小數時照 JS Math.round 進位', () {
      final f = cardFrame(const Size(411.43, 866.29), 24.57);
      expect(f.left, 20); // (411.43 - 371.43) / 2 = 20
      expect(f.height, (371.43 * 645 / 1015 + 0.5).floorToDouble());
    });
  });

  group('鏡頭畫面換算（card-stage.js shoot）', () {
    test('相片和畫面同比例：框按比例換回原圖', () {
      const box = Size(400, 800);
      const f = FrameBox(20, 300, 360, 229);
      final r = shootRect(box, 2000, 4000, f);
      expect([r.x, r.y, r.width, r.height], [100, 1500, 1800, 1145]);
    });

    test('相片比畫面高（cover 裁走上下）', () {
      const box = Size(400, 800);
      const f = FrameBox(20, 300, 360, 229);
      final r = shootRect(box, 3000, 4000, f); // scale = max(400/3000, 800/4000) = 0.2，畫面寬 600、左右各裁 100
      expect(r.x, closeTo((20 + 100) / 0.2, 1e-9));
      expect(r.y, closeTo(300 / 0.2, 1e-9));
      expect(r.width, closeTo(360 / 0.2, 1e-9));
    });

    test('預覽 16:9、相片 4:3：先把相片置中裁成預覽比例再換算', () {
      const box = Size(450, 800);
      const f = FrameBox(20, 300, 410, 260);
      final withPreview = shootRect(box, 3000, 4000, f, previewAspect: 9 / 16);
      // 相片置中裁成 2250×4000（左右各 375），再按 cover 換算：scale = 0.2
      final expected = shootRect(box, 2250, 4000, f);
      expect(withPreview.x, closeTo(expected.x + 375, 1e-9));
      expect(withPreview.y, closeTo(expected.y, 1e-9));
      expect(withPreview.width, closeTo(expected.width, 1e-9));
    });

    test('預覽比相片寬時裁走相片上下', () {
      const box = Size(450, 800);
      const f = FrameBox(20, 300, 410, 260);
      // 相片 2250×4000（9:16），預覽 3:4：相片置中裁成 2250×3000（上下各 500）
      final r = shootRect(box, 2250, 4000, f, previewAspect: 3 / 4);
      final cropped = shootRect(box, 2250, 3000, f);
      expect(r.x, closeTo(cropped.x, 1e-9));
      expect(r.y, closeTo(cropped.y + 500, 1e-9));
      expect(r.height, closeTo(cropped.height, 1e-9));
    });
  });

  group('相片拖動縮放（card-stage.js placeImage／zoomAt／confirm）', () {
    const f = FrameBox(20, 282, 362, 230);

    test('相片先放大到剛好蓋滿框並置中', () {
      final v = StageView.place(f, 4000, 3000);
      expect(v.s, closeTo(362 / 4000, 1e-12)); // max(362/4000, 230/3000)：相片比框扁，按寬
      expect(v.min, closeTo(v.s / 2, 1e-12));
      expect(v.x, closeTo(20, 1e-9));
      expect(v.y + 3000 * v.s / 2, closeTo(282 + 230 / 2, 1e-9));
    });

    test('沒有移動時確認：截的是相片正中與框同比例的一塊', () {
      final r = StageView.place(f, 4000, 3000).confirmRect(f);
      expect(r.width, closeTo(4000, 1e-6));
      expect(r.height, closeTo(230 / (362 / 4000), 1e-6));
      expect(r.x, closeTo(0, 1e-6));
      expect(r.y + r.height / 2, closeTo(1500, 1e-6));
    });

    test('縮放限制在最小縮放的 1 至 12 倍', () {
      final v = StageView.place(f, 4000, 3000);
      v.zoomAt(200, 400, 100);
      expect(v.s, closeTo(v.min * 12, 1e-12));
      v.zoomAt(200, 400, 0.000001);
      expect(v.s, closeTo(v.min, 1e-12));
    });

    test('以手指中心縮放：中心點下的相片位置不變', () {
      final v = StageView.place(f, 4000, 3000);
      final before = ((200 - v.x) / v.s, (400 - v.y) / v.s);
      v.zoomAt(200, 400, v.s * 1.7);
      expect((200 - v.x) / v.s, closeTo(before.$1, 1e-9));
      expect((400 - v.y) / v.s, closeTo(before.$2, 1e-9));
    });
  });

  group('截圖（card-stage.js crop）', () {
    test('輸出 2274×1445', () {
      final src = solid(400, 300, (x, y) => blue);
      final out = cropCard(src, 400, 300, const SourceRect(50, 50, 300, 190));
      expect(out.width, 2274);
      expect(out.height, 1445);
    });

    test('框內範圍落在外圈 6% 以內，和伺服器找不到卡邊時取的框內範圍相差不到 1 像素', () {
      // 原圖 1000×1000，框內 (100, 200, 812, 516) 塗紅色，其餘藍色
      const r = SourceRect(100, 200, 812, 516);
      final src = solid(1000, 1000, (x, y) => x >= 100 && x < 912 && y >= 200 && y < 716 ? red : blue);
      final out = cropCard(src, 1000, 1000, r);
      // 框內邊界在輸出的 2274 × 0.06 / 1.12 = 121.8、1445 × 0.06 / 1.12 = 77.4
      final left = 2274 * 0.06 / 1.12, top = 1445 * 0.06 / 1.12;
      expect((left - serverInnerLeft).abs(), lessThan(1));
      expect((top - serverInnerTop).abs(), lessThan(1));
      expect((2274 - 2 * left - serverFaceW).abs(), lessThan(1));
      expect((1445 - 2 * top - serverFaceH).abs(), lessThan(1));
      // 原圖 812 寬放大到約 2030（2.5 倍），交界的雙線性漸變約 3 像素，所以在邊界內外各 4 像素取點
      final midY = 722, midX = 1137;
      expect(pixel(out, serverInnerLeft - 4, midY), [0, 0, 255]);
      expect(pixel(out, serverInnerLeft + 4, midY), [255, 0, 0]);
      expect(pixel(out, serverInnerLeft + serverFaceW - 4, midY), [255, 0, 0]);
      expect(pixel(out, serverInnerLeft + serverFaceW + 4, midY), [0, 0, 255]);
      expect(pixel(out, midX, serverInnerTop - 4), [0, 0, 255]);
      expect(pixel(out, midX, serverInnerTop + 4), [255, 0, 0]);
      expect(pixel(out, midX, serverInnerTop + serverFaceH - 4), [255, 0, 0]);
      expect(pixel(out, midX, serverInnerTop + serverFaceH + 4), [0, 0, 255]);
    });

    test('框內比例和伺服器卡面 2030:1290 相同（與 1015:645 一致）', () {
      expect(2030 / 1290, closeTo(1015 / 645, 1e-12));
    });

    test('超出原圖的部分填白色', () {
      final src = solid(200, 200, (x, y) => blue);
      final out = cropCard(src, 200, 200, const SourceRect(-100, -100, 400, 254));
      expect(pixel(out, 10, 10), [255, 255, 255]);
      expect(pixel(out, 2270, 1440), [255, 255, 255]);
      expect(pixel(out, 1137, 722), [0, 0, 255]);
    });

    test('框完全在原圖外時整張白色', () {
      final src = solid(100, 100, (x, y) => blue);
      final out = cropCard(src, 100, 100, const SourceRect(500, 500, 100, 64));
      expect(pixel(out, 0, 0), [255, 255, 255]);
      expect(pixel(out, 1137, 722), [255, 255, 255]);
    });

    test('透明的部分疊在白底上', () {
      final src = solid(100, 100, (x, y) => [0, 0, 0, 0]);
      final out = cropCard(src, 100, 100, const SourceRect(10, 10, 80, 51));
      expect(pixel(out, 1137, 722), [255, 255, 255]);
      final half = solid(100, 100, (x, y) => [0, 0, 128, 128]); // 半透明藍（已乘 alpha）
      expect(pixel(cropCard(half, 100, 100, const SourceRect(10, 10, 80, 51)), 1137, 722), [127, 127, 255]);
    });

    test('放大時雙線性取樣：兩色交界之間是漸變', () {
      final src = solid(2, 1, (x, y) => x == 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
      final out = cropCard(src, 2, 1, const SourceRect(0.1, 0, 1.8 / 1.12, 1 / 1.12));
      final values = [for (var x = 300; x < 2000; x += 300) pixel(out, x, 700)[0]];
      for (var i = 1; i < values.length; i++) {
        expect(values[i], greaterThanOrEqualTo(values[i - 1]));
      }
      expect(values.first, lessThan(80));
      expect(values.last, greaterThan(175));
    });

    test('編碼成 JPEG data URL，解出來是 2274×1445', () {
      final src = solid(400, 300, (x, y) => blue);
      final url = cropCardDataUrl(src, 400, 300, const SourceRect(50, 50, 300, 190));
      expect(url, startsWith('data:image/jpeg;base64,'));
      final jpeg = img.decodeJpg(base64Decode(url.substring('data:image/jpeg;base64,'.length)))!;
      expect([jpeg.width, jpeg.height], [2274, 1445]);
    });

    test('背景執行和直接執行結果相同', () async {
      final src = solid(300, 200, (x, y) => [x % 256, y % 256, 90, 255]);
      const r = SourceRect(20, 30, 250, 159);
      expect(await cropCardInBackground(src, 300, 200, r), cropCardDataUrl(src, 300, 200, r));
    });
  });

  group('實卡樣本（api/test/fixtures/cards，只在測試中讀取）', () {
    final dir = Directory(Platform.environment['DP_CARD_FIXTURES'] ?? '../api/test/fixtures/cards');
    final files = dir.existsSync() ? (dir.listSync().whereType<File>().where((f) => f.path.endsWith('.png') || f.path.endsWith('.jpg')).toList()..sort((a, b) => a.path.compareTo(b.path))) : <File>[];
    // 樣本被 .gitignore 排除，全新 checkout、CI 和 worktree 都沒有：找不到就跳過，不算失敗（尺寸和位置另由上面用程式生成的圖驗證）
    final skip = files.isEmpty ? '找不到實卡樣本（${dir.path} 沒有 png／jpg；樣本不在 git 裏，可用 DP_CARD_FIXTURES 指明目錄）' : null;

    test('從相冊選樣本、不移動直接確認：截圖 2274×1445，框內是相片正中與框同比例的一塊', () {
      final image = img.decodeImage(files.first.readAsBytesSync())!;
      final rgba = premultiplied(image);
      const window = Size(402, 874);
      final f = cardFrame(window, 62);
      final r = StageView.place(f, image.width, image.height).confirmRect(f);
      final out = cropCard(rgba, image.width, image.height, r);
      expect([out.width, out.height], [2274, 1445]);
      // 框內按 30×20 格點逐點比對：輸出點換回原圖座標，和原圖該點的雙線性取樣相同
      final innerLeft = 2274 * 0.06 / 1.12, innerTop = 1445 * 0.06 / 1.12;
      var checked = 0;
      for (var gy = 1; gy < 20; gy++) {
        for (var gx = 1; gx < 30; gx++) {
          final ox = (innerLeft + serverFaceW * gx / 30).floor(), oy = (innerTop + serverFaceH * gy / 20).floor();
          // card-stage.js crop：外擴後的範圍 (r.x - 6%, r.width × 1.12) 對應整張 2274 寬
          final sx = r.x - r.width * cardMargin + (ox + 0.5) * r.width * (1 + 2 * cardMargin) / cardFullW;
          final sy = r.y - r.height * cardMargin + (oy + 0.5) * r.height * (1 + 2 * cardMargin) / cardFullH;
          final expected = image.getPixelInterpolate(sx - 0.5, sy - 0.5, interpolation: img.Interpolation.linear);
          final got = out.getPixel(ox, oy);
          expect((got.r - expected.r).abs(), lessThanOrEqualTo(3));
          expect((got.g - expected.g).abs(), lessThanOrEqualTo(3));
          expect((got.b - expected.b).abs(), lessThanOrEqualTo(3));
          checked++;
        }
      }
      expect(checked, 29 * 19);
    }, skip: skip);

    test('每個樣本都截出 2274×1445 JPEG', () {
      for (final file in files) {
        final image = img.decodeImage(file.readAsBytesSync())!;
        final f = cardFrame(const Size(440, 956), 62);
        final r = StageView.place(f, image.width, image.height).confirmRect(f);
        final jpeg = img.decodeJpg(base64Decode(cropCardDataUrl(premultiplied(image), image.width, image.height, r).split(',').last))!;
        expect([jpeg.width, jpeg.height], [2274, 1445], reason: file.uri.pathSegments.last);
      }
    }, skip: skip);

    test('拖動後確認：相片移動多少，截取範圍反方向移動同樣距離（按縮放換算）', () {
      final image = img.decodeImage(files.first.readAsBytesSync())!;
      final f = cardFrame(const Size(402, 874), 62);
      final v = StageView.place(f, image.width, image.height);
      final before = v.confirmRect(f);
      v.x += 30;
      v.y -= 12;
      final after = v.confirmRect(f);
      expect(after.x, closeTo(before.x - 30 / v.s, 1e-9));
      expect(after.y, closeTo(before.y + 12 / v.s, 1e-9));
      expect(after.width, closeTo(before.width, 1e-9));
    }, skip: skip);
  });
}
