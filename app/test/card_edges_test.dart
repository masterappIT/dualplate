// 即時找卡邊（lib/business/card_edges.dart）：伺服器 api/src/card-face.js 找邊方法的 Dart 版，以及預覽上的對齊、傾斜、清楚判斷。
// 主要用程式畫的「桌面上一張卡」驗證（不靠樣本）。
// 最後兩組和伺服器比對：要 node 和 api/node_modules/sharp（DP_API_DIR 可指明 api 目錄），找不到就跳過並寫明原因；
// 實卡樣本照 card_stage_test.dart 的做法（DP_CARD_FIXTURES），只在測試中讀取，不印出、不另存，經 stdin 交給 node。
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' show Size;
import 'package:dualplate/business/card_capture.dart';
import 'package:dualplate/business/card_edges.dart';
import 'package:dualplate/business/card_stage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

// 框線在圖上的位置（佔寬或高的比例）：6% ÷ 112%
const k = cardMargin / (1 + 2 * cardMargin);

const desk = [96, 100, 104], cardColor = [238, 232, 205], ink = [60, 60, 60], stamp = [180, 60, 50];

/// 程式畫的鏡頭畫面：灰桌（帶少量雜訊）上一張淺黃卡，卡上幾行深色字條和一個紅印。
/// 卡的位置用佔圖寬高的比例（預設剛好在框線上），[angle] 度順時針旋轉，[blur] 像素高斯模糊。
img.Image scene({int w = 569, int h = 361, double left = k, double top = k, double right = 1 - k, double bottom = 1 - k, double angle = 0, List<int> deskColor = desk, List<int> card = cardColor, int blur = 0, int noise = 6}) {
  final image = img.Image(width: w, height: h);
  var seed = 7;
  int rand() => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % (noise * 2 + 1) - noise;
  for (final p in image) {
    final n = noise == 0 ? 0 : rand();
    p.setRgb(deskColor[0] + n, deskColor[1] + n, deskColor[2] + n);
  }
  final cx = (left + right) / 2 * w, cy = (top + bottom) / 2 * h, cw = (right - left) * w, ch = (bottom - top) * h;
  final a = angle * math.pi / 180;
  // 卡上 (u, v)（0 至 1）換成圖上座標
  img.Point at(double u, double v) {
    final x = (u - 0.5) * cw, y = (v - 0.5) * ch;
    return img.Point(cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a));
  }

  void quad(double u0, double v0, double u1, double v1, List<int> c) =>
      img.fillPolygon(image, vertices: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], color: img.ColorRgb8(c[0], c[1], c[2]));
  quad(0, 0, 1, 1, card);
  for (var i = 0; i < 8; i++) {
    quad(0.08, 0.12 + i * 0.09, 0.08 + 0.3 + (i * 0.173) % 0.35, 0.12 + i * 0.09 + 0.035, ink);
  }
  quad(0.72, 0.15, 0.9, 0.45, stamp);
  return blur > 0 ? img.gaussianBlur(image, radius: blur) : image;
}

Uint8List rgbOf(img.Image image) => image.convert(numChannels: 3).getBytes(order: img.ChannelOrder.rgb);

CardEdges detect(img.Image image) => detectCardEdges(rgbOf(image), image.width, image.height);

// 框內範圍（直向畫面座標）：一張已經是外擴 6% 的圖，框內就是去掉每邊 k 的部分
SourceRect innerOf(int w, int h) => SourceRect(w * k, h * k, w * (1 - 2 * k), h * (1 - 2 * k));

// RGB 轉 YUV420（全幅 BT.601，和 sampleMargin 的換算相反）
({Uint8List y, Uint8List u, Uint8List v}) yuvOf(Uint8List rgb, int w, int h) {
  final y = Uint8List(w * h), u = Uint8List((w ~/ 2) * (h ~/ 2)), v = Uint8List((w ~/ 2) * (h ~/ 2));
  int c(double x) => x.round().clamp(0, 255);
  for (var j = 0; j < h; j++) {
    for (var i = 0; i < w; i++) {
      final p = (j * w + i) * 3, r = rgb[p], g = rgb[p + 1], b = rgb[p + 2];
      y[j * w + i] = c(0.299 * r + 0.587 * g + 0.114 * b);
      if (i.isEven && j.isEven && i ~/ 2 < w ~/ 2 && j ~/ 2 < h ~/ 2) {
        u[(j ~/ 2) * (w ~/ 2) + i ~/ 2] = c(-0.168736 * r - 0.331264 * g + 0.5 * b + 128);
        v[(j ~/ 2) * (w ~/ 2) + i ~/ 2] = c(0.5 * r - 0.418688 * g - 0.081312 * b + 128);
      }
    }
  }
  return (y: y, u: u, v: v);
}

void main() {
  group('固定尺寸', () {
    test('預覽分析圖 569×361，是伺服器分析圖 1137×722 的一半', () {
      expect([liveEdgeW, liveEdgeH], [569, 361]);
      expect((cardFullW / serverEdgeScale).round(), 1137);
      expect((liveEdgeW * 2 - 1137).abs(), lessThanOrEqualTo(1));
      expect((liveEdgeH * 2 - 722).abs(), lessThanOrEqualTo(1));
    });

    test('框線位置：左 6%÷112%、右對稱', () {
      final lines = frameLines(569, 361);
      expect(lines.left, closeTo(569 * 0.06 / 1.12, 1e-9));
      expect(lines.right, closeTo(569 - 569 * 0.06 / 1.12, 1e-9));
      expect(lines.top, closeTo(361 * 0.06 / 1.12, 1e-9));
    });
  });

  group('照搬 card-face.js：edge()', () {
    test('連續 3 格都過半才算卡邊', () {
      expect(edgeIndex([0, 0, 0.6, 0.6, 0.4, 0.6, 0.6, 0.6, 0, 0, 0, 0, 0, 0], false), 5);
    });

    test('剛好一半（0.5）算過半', () {
      expect(edgeIndex([0, 0.5, 0.5, 0.5, 0, 0, 0, 0], false), 1);
    });

    test('第一格就過半（卡超出外圈、貼着圖邊）回傳 null', () {
      expect(edgeIndex([0.9, 0.9, 0.9, 0.9, 0, 0, 0, 0], false), isNull);
    });

    test('從尾端找：回傳卡最後一格的位置', () {
      expect(edgeIndex([0, 0, 0, 0, 0, 0.8, 0.8, 0.8, 0, 0], true), 7);
    });

    test('只找前一半：卡邊在後一半時從頭找不到', () {
      expect(edgeIndex([0, 0, 0, 0, 0, 0, 0.8, 0.8, 0.8, 0], false), isNull);
    });

    test('全部是零時找不到', () {
      expect(edgeIndex(List.filled(20, 0.0), false), isNull);
      expect(edgeIndex(List.filled(20, 0.0), true), isNull);
    });
  });

  group('照搬 card-face.js：analyse()、edges()、tilt()', () {
    test('背景色是外圈的中位數', () {
      final map = analyseEdges(rgbOf(scene(noise: 0)), 569, 361);
      expect(map.background, desk);
    });

    test('和背景色差不到 40 的不算卡', () {
      final map = analyseEdges(rgbOf(scene(noise: 0, card: [desk[0] + 20, desk[1] + 20, desk[2] + 20])), 569, 361);
      expect(map.mask.every((v) => v == 0), isFalse); // 字條和紅印仍分得出
      expect(map.mask[77 * 569 + 284], 0); // 卡紙本身（字條之間）不算
    });

    test('卡剛好在框線上：四邊位置在框線上 ±1 像素', () {
      final found = findEdges(analyseEdges(rgbOf(scene()), 569, 361));
      final lines = frameLines(569, 361);
      expect((found.left! - lines.left).abs(), lessThanOrEqualTo(1));
      expect((found.right! + 1 - lines.right).abs(), lessThanOrEqualTo(1));
      expect((found.top! - lines.top).abs(), lessThanOrEqualTo(1));
      expect((found.bottom! + 1 - lines.bottom).abs(), lessThanOrEqualTo(1));
    });

    test('順時針歪 3°：量得約 +3°', () {
      expect(findTilt(analyseEdges(rgbOf(scene(left: 0.1, right: 0.9, top: 0.12, bottom: 0.88, angle: 3)), 569, 361)), closeTo(3, 0.5));
    });

    test('逆時針歪 3°：量得約 −3°', () {
      expect(findTilt(analyseEdges(rgbOf(scene(left: 0.1, right: 0.9, top: 0.12, bottom: 0.88, angle: -3)), 569, 361)), closeTo(-3, 0.5));
    });

    test('量得到的邊少於兩條時傾斜當 0', () {
      expect(findTilt(analyseEdges(rgbOf(scene(left: -0.2, right: 1.2, top: -0.2, bottom: 1.2, angle: 4)), 569, 361)), 0);
    });
  });

  group('預覽判斷：四邊對齊', () {
    test('卡剛好對準框：四邊都對齊、不歪、清楚，可以拍了', () {
      final e = detect(scene());
      expect([e.left, e.top, e.right, e.bottom], [true, true, true, true]);
      expect(e.tilt.abs(), lessThan(0.5));
      expect(e.sharp, isTrue);
      expect(e.ready, isTrue);
    });

    test('卡比框小一圈（每邊內縮 8%）：四邊都不對齊', () {
      final e = detect(scene(left: k + 0.08, right: 1 - k - 0.08, top: k + 0.08, bottom: 1 - k - 0.08));
      expect([e.left, e.top, e.right, e.bottom], [false, false, false, false]);
      expect(e.ready, isFalse);
    });

    test('卡只有左邊和上邊對齊：其餘兩邊不對齊', () {
      final e = detect(scene(right: 1 - k - 0.1, bottom: 1 - k - 0.1));
      expect([e.left, e.top, e.right, e.bottom], [true, true, false, false]);
      expect(e.ready, isFalse);
    });

    test('卡比框窄（右邊縮進框內寬 8%）：只有右邊不對齊', () {
      final e = detect(scene(right: 1 - k - 0.08 * (1 - 2 * k)));
      expect([e.left, e.top, e.right, e.bottom], [true, true, false, true]);
    });

    test('卡伸進外圈 2%（伺服器取背景色的範圍）：背景色門檻被拉高，不標示對齊（伺服器同樣找不到邊）', () {
      final e = detect(scene(right: 1.0));
      expect(e.aligned, isFalse);
      expect(e.right, isFalse);
    });

    test('卡邊離框線不到容許距離（框內寬 3%）仍算對齊', () {
      final d = 0.03 * (1 - 2 * k);
      final e = detect(scene(left: k - d, right: 1 - k + d, top: k - d, bottom: 1 - k + d));
      expect(e.aligned, isTrue);
    });

    test('卡邊離框線超過容許距離（框內寬 5%）不算對齊', () {
      final d = 0.05 * (1 - 2 * k);
      final e = detect(scene(left: k + d, right: 1 - k - d, top: k + d, bottom: 1 - k - d));
      expect([e.left, e.top, e.right, e.bottom], [false, false, false, false]);
    });

    test('卡比外圈還大（貼着圖邊）：四邊都不對齊', () {
      final e = detect(scene(left: -0.05, right: 1.05, top: -0.05, bottom: 1.05));
      expect([e.left, e.top, e.right, e.bottom], [false, false, false, false]);
    });

    test('卡和桌面同色：找不到邊', () {
      final e = detect(scene(card: desk));
      expect(e.aligned, isFalse);
      expect([e.left, e.top, e.right, e.bottom].contains(true), isFalse);
    });

    test('白桌（背景亮度 > 200）：伺服器不找邊，預覽也不標示對齊', () {
      final e = detect(scene(deskColor: [235, 235, 235], card: [250, 246, 225]));
      expect([e.left, e.top, e.right, e.bottom], [false, false, false, false]);
    });

    test('沒有卡的空桌面：四邊都不對齊', () {
      final e = detect(scene(left: 0.5, right: 0.5, top: 0.5, bottom: 0.5));
      expect(e.aligned, isFalse);
    });
  });

  group('預覽判斷：傾斜', () {
    test('歪 2°（門檻 3° 以內）仍可以拍', () {
      final e = detect(scene(angle: 2));
      expect(e.tilt, closeTo(2, 0.5));
      expect(e.level, isTrue);
      expect(e.ready, isTrue);
    });

    test('歪 5°（超過門檻 3°）：不可以拍', () {
      final e = detect(scene(angle: 5));
      expect(e.tilt, closeTo(5, 0.6));
      expect(e.level, isFalse);
      expect(e.ready, isFalse);
    });
  });

  group('預覽判斷：清楚與否', () {
    test('清楚的卡：拉普拉斯變異數高於門檻', () {
      final e = detect(scene());
      expect(e.sharpness, greaterThan(sharpThreshold));
    });

    test('模糊（高斯 2 像素）：四邊仍對齊，但不清楚，不可以拍', () {
      final e = detect(scene(blur: 2));
      expect(e.aligned, isTrue);
      expect(e.sharp, isFalse);
      expect(e.ready, isFalse);
    });

    test('純色畫面清楚度為 0', () {
      final flat = Uint8List(569 * 361 * 3)..fillRange(0, 569 * 361 * 3, 128);
      expect(sharpnessOf(flat, 569, 361), 0);
    });

    test('只看框內：框外桌面的雜訊不算', () {
      final quiet = scene(card: desk, noise: 0);
      final noisy = scene(card: desk, noise: 0);
      // 只在外圈加強烈的黑白點
      for (final p in noisy) {
        final inside = p.x > 569 * k && p.x < 569 * (1 - k) && p.y > 361 * k && p.y < 361 * (1 - k);
        if (!inside && (p.x + p.y).isEven) p.setRgb(0, 0, 0);
      }
      expect(sharpnessOf(rgbOf(noisy), 569, 361), closeTo(sharpnessOf(rgbOf(quiet), 569, 361), 1e-9));
    });
  });

  group('鏡頭畫面取樣（sampleMargin）', () {
    // 直向鏡頭畫面 1080×1920，iPhone 17 Pro 畫面上的框按 cover 換成畫面座標，卡剛好畫在框上
    const box = Size(402, 874);
    final frameBox = cardFrame(box, 62);
    final inner = shootRect(box, 1080, 1920, frameBox);
    img.Image portrait({double narrower = 0}) {
      final pic = img.Image(width: 1080, height: 1920);
      img.fill(pic, color: img.ColorRgb8(desk[0], desk[1], desk[2]));
      img.fillRect(pic, x1: inner.x.round(), y1: inner.y.round(), x2: (inner.x + inner.width - narrower).round() - 1, y2: (inner.y + inner.height).round() - 1, color: img.ColorRgb8(cardColor[0], cardColor[1], cardColor[2]));
      for (var i = 0; i < 8; i++) {
        final y = (inner.y + inner.height * (0.12 + i * 0.09)).round();
        img.fillRect(pic, x1: (inner.x + inner.width * 0.08).round(), y1: y, x2: (inner.x + inner.width * (0.4 + (i * 0.173) % 0.3)).round(), y2: y + 16, color: img.ColorRgb8(ink[0], ink[1], ink[2]));
      }
      return pic;
    }

    test('輸出 569×361 RGB', () {
      final out = sampleMargin(PreviewFrame.rgb(rgbOf(portrait()), 1080, 1920), inner);
      expect(out.length, 569 * 361 * 3);
    });

    test('直向 RGB 畫面：卡畫在框上時四邊都對齊', () {
      final e = detectInFrame(PreviewFrame.rgb(rgbOf(portrait()), 1080, 1920), inner);
      expect(e.aligned, isTrue);
      expect(e.sharp, isTrue);
    });

    test('卡在畫面上比框窄 60 像素（右邊縮進）：只有右邊不對齊', () {
      final e = detectInFrame(PreviewFrame.rgb(rgbOf(portrait(narrower: 60)), 1080, 1920), inner);
      expect([e.left, e.top, e.right, e.bottom], [true, true, false, true]);
    });

    test('取樣範圍和截圖相同：外擴 6% 後的四角在原畫面的位置', () {
      // 只有外擴範圍左上角一點是紅色：輸出左上角應是紅色，旁邊不是
      final pic = img.Image(width: 1080, height: 1920);
      img.fill(pic, color: img.ColorRgb8(0, 0, 255));
      final sx = (inner.x - inner.width * cardMargin).floor(), sy = (inner.y - inner.height * cardMargin).floor();
      img.fillRect(pic, x1: sx, y1: sy, x2: sx + 3, y2: sy + 3, color: img.ColorRgb8(255, 0, 0));
      final out = sampleMargin(PreviewFrame.rgb(rgbOf(pic), 1080, 1920), inner);
      expect(out.sublist(0, 3), [255, 0, 0]);
      expect(out.sublist(30, 33), [0, 0, 255]);
    });

    test('落在畫面外的部分當白色（和截圖一樣）', () {
      final pic = img.Image(width: 100, height: 100);
      img.fill(pic, color: img.ColorRgb8(0, 0, 255));
      final out = sampleMargin(PreviewFrame.rgb(rgbOf(pic), 100, 100), const SourceRect(-50, -50, 100, 64), outW: 40, outH: 30);
      expect(out.sublist(0, 3), [255, 255, 255]);
      expect(out.sublist((29 * 40 + 39) * 3, (29 * 40 + 39) * 3 + 3), [0, 0, 255]);
    });

    test('Android YUV420、橫向畫面要轉 90°：結果和直向 RGB 相同', () {
      final upright = rgbOf(portrait());
      // 直向 1080×1920 逆時針轉 90° 成為橫向 1920×1080 的原始畫面（順時針轉 90° 才是直向）
      final raw = img.copyRotate(img.Image.fromBytes(width: 1080, height: 1920, bytes: upright.buffer, numChannels: 3), angle: -90);
      expect([raw.width, raw.height], [1920, 1080]);
      final yuv = yuvOf(rgbOf(raw), 1920, 1080);
      final frame = PreviewFrame(width: 1920, height: 1080, format: FramePixels.yuv420, planes: [yuv.y, yuv.u, yuv.v], rowStrides: const [1920, 960, 960], pixelStrides: const [1, 1, 1], rotation: 90);
      final fromYuv = sampleMargin(frame, inner), fromRgb = sampleMargin(PreviewFrame.rgb(upright, 1080, 1920), inner);
      // 卡紙中間一點顏色相同（YUV 換算誤差 ±3）
      final mid = (180 * 569 + 284) * 3;
      for (var c = 0; c < 3; c++) {
        expect((fromYuv[mid + c] - fromRgb[mid + c]).abs(), lessThanOrEqualTo(3));
      }
      expect(detectCardEdges(fromYuv, 569, 361).aligned, isTrue);
    });

    test('YUV420 的 U、V 交錯存放（pixelStride 2，Android 常見）', () {
      final upright = rgbOf(portrait());
      final raw = img.copyRotate(img.Image.fromBytes(width: 1080, height: 1920, bytes: upright.buffer, numChannels: 3), angle: -90);
      final yuv = yuvOf(rgbOf(raw), 1920, 1080);
      // NV12 式：U 平面是 U V U V …，V 平面從第二個字節開始；每行 1920 字節
      final uv = Uint8List(1920 * 540);
      for (var j = 0; j < 540; j++) {
        for (var i = 0; i < 960; i++) {
          uv[j * 1920 + i * 2] = yuv.u[j * 960 + i];
          uv[j * 1920 + i * 2 + 1] = yuv.v[j * 960 + i];
        }
      }
      final frame = PreviewFrame(width: 1920, height: 1080, format: FramePixels.yuv420, planes: [yuv.y, uv, Uint8List.sublistView(uv, 1)], rowStrides: const [1920, 1920, 1920], pixelStrides: const [1, 2, 2], rotation: 90);
      expect(detectInFrame(frame, inner).aligned, isTrue);
    });

    test('轉 270°（前鏡頭或倒裝的鏡頭）：結果和直向相同', () {
      final upright = rgbOf(portrait());
      final raw = img.copyRotate(img.Image.fromBytes(width: 1080, height: 1920, bytes: upright.buffer, numChannels: 3), angle: 90);
      final frame = PreviewFrame(width: 1920, height: 1080, format: FramePixels.rgb, planes: [rgbOf(raw)], rowStrides: const [1920 * 3], pixelStrides: const [3], rotation: 270);
      expect(sampleMargin(frame, inner), sampleMargin(PreviewFrame.rgb(upright, 1080, 1920), inner));
    });

    test('iOS BGRA、每行有補齊字節：結果和 RGB 相同', () {
      final upright = rgbOf(portrait());
      const stride = 1080 * 4 + 64;
      final bgra = Uint8List(stride * 1920);
      for (var y = 0; y < 1920; y++) {
        for (var x = 0; x < 1080; x++) {
          final s = (y * 1080 + x) * 3, d = y * stride + x * 4;
          bgra[d] = upright[s + 2];
          bgra[d + 1] = upright[s + 1];
          bgra[d + 2] = upright[s];
          bgra[d + 3] = 255;
        }
      }
      final frame = PreviewFrame(width: 1080, height: 1920, format: FramePixels.bgra8888, planes: [bgra], rowStrides: const [stride], pixelStrides: const [4]);
      expect(sampleMargin(frame, inner), sampleMargin(PreviewFrame.rgb(upright, 1080, 1920), inner));
    });
  });

  group('背景執行（EdgeWorker）', () {
    const box = Size(402, 874);
    final inner = shootRect(box, 569, 361 * 874 ~/ 402, cardFrame(box, 62));

    test('背景 isolate 的結果和直接計算相同', () async {
      final frame = PreviewFrame.rgb(rgbOf(scene(w: 569, h: 361 * 874 ~/ 402)), 569, 361 * 874 ~/ 402);
      final worker = await EdgeWorker.start();
      addTearDown(worker.close);
      expect(await worker.detect(frame, inner), detectInFrame(frame, inner));
    });

    test('上一張未處理完時，新畫面直接丟掉（回傳 null）', () async {
      final frame = PreviewFrame.rgb(rgbOf(scene()), 569, 361);
      final worker = await EdgeWorker.start();
      addTearDown(worker.close);
      final first = worker.detect(frame, innerOf(569, 361));
      expect(worker.busy, isTrue);
      expect(await worker.detect(frame, innerOf(569, 361)), isNull);
      expect(await first, isNotNull);
      expect(worker.busy, isFalse);
    });

    test('關閉後不再處理（回傳 null）', () async {
      final worker = await EdgeWorker.start();
      worker.close();
      expect(await worker.detect(PreviewFrame.rgb(rgbOf(scene()), 569, 361), innerOf(569, 361)), isNull);
    });
  });

  // ── 和伺服器比對 ──
  final apiDir = Platform.environment['DP_API_DIR'] ?? '../api';
  final sharpDir = '$apiDir/node_modules/sharp';
  String? node;
  try {
    final r = Process.runSync('node', ['--version']);
    if (r.exitCode == 0) node = 'node';
  } catch (_) {}
  final serverSkip = node == null
      ? '找不到 node，無法執行伺服器 card-face.js'
      : !Directory(sharpDir).existsSync()
          ? '找不到 $sharpDir（worktree 和 CI 沒有裝 api 的套件；可用 DP_API_DIR 指明已裝套件的 api 目錄）'
          : null;

  // 把伺服器 card-face.js 的 analyse／edges／tilt 匯出到暫存目錄的副本（只改 sharp 的引用路徑），
  // 用 node 對 stdin 收到的 PNG 執行，回傳縮小後的像素和找邊結果（像素只經記憶體，不存檔）
  Directory? temp;
  Future<Map<String, dynamic>> server(img.Image margin) async {
    temp ??= Directory.systemTemp.createTempSync('dp-card-face-');
    final module = File('${temp!.path}/card-face.mjs');
    if (!module.existsSync()) {
      final require = "import { createRequire } from 'node:module'\nconst sharp = createRequire('${Uri.file(File('$apiDir/package.json').absolute.path)}')('sharp')";
      final source = File('../api/src/card-face.js').readAsStringSync().replaceFirst("import sharp from 'sharp'", require);
      module.writeAsStringSync('$source\nexport { analyse, edges, tilt }\n');
      File('${temp!.path}/run.mjs').writeAsStringSync('''
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { analyse, edges, tilt, MARGIN_W, MARGIN_H } from './card-face.mjs'
const sharp = createRequire('${Uri.file(File('$apiDir/package.json').absolute.path)}')('sharp')
const input = readFileSync(0)
const map = await analyse(input)
const raw = await sharp(input).resize(Math.round(MARGIN_W / 2), Math.round(MARGIN_H / 2), { fit: 'fill' }).removeAlpha().raw().toBuffer()
process.stdout.write(JSON.stringify({ w: map.w, h: map.h, background: map.background, edges: edges(map), tilt: tilt(map), raw: raw.toString('base64') }))
''');
    }
    final p = await Process.start(node!, ['${temp!.path}/run.mjs']);
    p.stdin.add(img.encodePng(margin, level: 1));
    await p.stdin.close();
    final out = await p.stdout.transform(utf8.decoder).join();
    final err = await p.stderr.transform(utf8.decoder).join();
    expect(await p.exitCode, 0, reason: err);
    return jsonDecode(out) as Map<String, dynamic>;
  }

  tearDownAll(() => temp?.deleteSync(recursive: true));

  void sameAsServer(Map<String, dynamic> s) {
    final w = s['w'] as int, h = s['h'] as int;
    final map = analyseEdges(base64Decode(s['raw'] as String), w, h);
    expect(map.background, (s['background'] as List).cast<int>());
    final found = findEdges(map), e = s['edges'] as Map<String, dynamic>;
    expect([found.left, found.top, found.right, found.bottom], [e['left'], e['top'], e['right'], e['bottom']]);
    expect(findTilt(map), closeTo((s['tilt'] as num).toDouble(), 1e-9));
  }

  // 預覽一半解像度的結果和伺服器（1137×722）換算後相差不到 2 像素（預覽座標），傾斜相差不到 0.5°
  void closeToServer(img.Image margin, Map<String, dynamic> s) {
    final small = sampleMargin(PreviewFrame.rgb(rgbOf(margin), margin.width, margin.height), innerOf(margin.width, margin.height));
    final map = analyseEdges(small, liveEdgeW, liveEdgeH);
    final found = findEdges(map), e = s['edges'] as Map<String, dynamic>;
    for (final (mine, theirs) in [(found.left, e['left']), (found.top, e['top'])]) {
      expect(mine == null, theirs == null);
      if (mine != null) expect((mine - (theirs as int) / 2).abs(), lessThanOrEqualTo(2));
    }
    for (final (mine, theirs) in [(found.right, e['right']), (found.bottom, e['bottom'])]) {
      expect(mine == null, theirs == null);
      if (mine != null) expect((mine + 1 - ((theirs as int) + 1) / 2).abs(), lessThanOrEqualTo(2));
    }
    expect(findTilt(map), closeTo((s['tilt'] as num).toDouble(), 0.5));
  }

  group('和伺服器 card-face.js 比對：程式畫的卡（要 node 和 sharp）', () {
    final cases = <String, img.Image Function()>{
      '剛好對準框': () => scene(w: cardFullW, h: cardFullH, noise: 4),
      '比框小一圈': () => scene(w: cardFullW, h: cardFullH, left: 0.15, right: 0.85, top: 0.15, bottom: 0.85, noise: 4),
      '順時針歪 3°': () => scene(w: cardFullW, h: cardFullH, angle: 3, noise: 4),
      '向右偏、超出外圈': () => scene(w: cardFullW, h: cardFullH, left: 0.2, right: 1.1, noise: 4),
    };
    for (final MapEntry(key: name, value: make) in cases.entries) {
      test('$name：同一批像素，Dart 版和伺服器結果完全相同', () async => sameAsServer(await server(make())), skip: serverSkip);
      test('$name：預覽一半解像度和伺服器相差不到 2 像素', () async {
        final margin = make();
        closeToServer(margin, await server(margin));
      }, skip: serverSkip);
    }
  });

  group('和伺服器 card-face.js 比對：實卡樣本（只在測試中讀取）', () {
    final dir = Directory(Platform.environment['DP_CARD_FIXTURES'] ?? '../api/test/fixtures/cards');
    final files = dir.existsSync() ? (dir.listSync().whereType<File>().where((f) => f.path.endsWith('.png') || f.path.endsWith('.jpg')).toList()..sort((a, b) => a.path.compareTo(b.path))) : <File>[];
    final fixtureSkip = files.isEmpty ? '找不到實卡樣本（${dir.path} 沒有 png／jpg；樣本不在 git 裏，可用 DP_CARD_FIXTURES 指明目錄）' : null;
    final skip = serverSkip ?? fixtureSkip;

    // 樣本按 2a 的「從相冊選、不移動直接確認」截成 2274×1445
    img.Image marginOf(File file) {
      final image = img.decodeImage(file.readAsBytesSync())!;
      if (image.width == cardFullW && image.height == cardFullH) return image;
      final f = cardFrame(const Size(402, 874), 62);
      final r = StageView.place(f, image.width, image.height).confirmRect(f);
      return cropCard(image.convert(numChannels: 4).getBytes(order: img.ChannelOrder.rgba), image.width, image.height, r);
    }

    test('每個樣本：同一批像素，Dart 版和伺服器結果完全相同', () async {
      for (final file in files) {
        sameAsServer(await server(marginOf(file)));
      }
    }, skip: skip);

    test('每個樣本：預覽一半解像度和伺服器相差不到 2 像素', () async {
      for (final file in files) {
        final margin = marginOf(file);
        closeToServer(margin, await server(margin));
      }
    }, skip: skip);

    test('每個樣本：清楚度高於門檻，模糊 2 像素（分析圖）後低於門檻', () {
      for (final file in files) {
        final margin = marginOf(file);
        final inner = innerOf(margin.width, margin.height);
        final sharp = sampleMargin(PreviewFrame.rgb(rgbOf(margin), margin.width, margin.height), inner);
        final blurred = img.gaussianBlur(margin.clone(), radius: 2 * liveEdgeScale);
        final soft = sampleMargin(PreviewFrame.rgb(rgbOf(blurred), margin.width, margin.height), inner);
        expect(sharpnessOf(sharp, liveEdgeW, liveEdgeH), greaterThan(sharpThreshold));
        expect(sharpnessOf(soft, liveEdgeW, liveEdgeH), lessThan(sharpThreshold));
      }
    }, skip: fixtureSkip); // 不用伺服器
  });
}
