// 批文卡對準框的計算部分，逐項照 mobile/src/lib/card-stage.js 和 CardCapture.vue 的 layout()：
// 對準框位置、鏡頭畫面和相片的座標換算、相片拖動縮放、截取框內卡面（每邊外擴 6%，固定 2274×1445 JPEG，品質 0.9）。
// 只用純 Dart（截圖不經畫面），可以在單元測試裏直接驗證尺寸和位置。伺服器 api/src/card-face.js 再在這張圖裏找卡的真正邊界。
import 'dart:convert';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' show Size;
import 'package:image/image.dart' as img;
import '../ui/tokens.dart';
import 'card_capture.dart';

/// JPEG 品質：card-stage.js 的 canvas.toDataURL('image/jpeg', 0.9)
const int cardJpegQuality = 90;

/// 畫面座標的矩形（對準框）
class FrameBox {
  const FrameBox(this.left, this.top, this.width, this.height);
  final double left, top, width, height;
  double get right => left + width;
  double get bottom => top + height;
  @override
  String toString() => 'FrameBox($left, $top, $width, $height)';
}

/// 原圖座標的矩形（未外擴 6% 的框內範圍）
class SourceRect {
  const SourceRect(this.x, this.y, this.width, this.height);
  final double x, y, width, height;
  @override
  String toString() => 'SourceRect($x, $y, $width, $height)';
}

double _jsRound(double v) => (v + 0.5).floorToDouble(); // JS Math.round

/// CardCapture.vue 的 layout()：框寬 min(w - 40, 560)，高按 1015:645；左右置中；
/// 框頂 max(120 + 狀態列高度, 置中再上移 40)。[window] 是網頁可用範圍（安卓不含底部導航列）。
FrameBox cardFrame(Size window, double safeTop) {
  final w = window.width, h = window.height;
  final width = math.min(w - CaptureStyle.frameInset, CaptureStyle.frameSideMax);
  final height = _jsRound(width * 645 / 1015);
  return FrameBox(
    _jsRound((w - width) / 2),
    math.max(CaptureStyle.frameTopMin + safeTop, _jsRound((h - height) / 2) - CaptureStyle.frameLift),
    width,
    height,
  );
}

/// card-stage.js shoot()：鏡頭畫面以 object-fit:cover 鋪滿 [box]，把畫面上的框換成原圖（[imageW]×[imageH]）座標。
///
/// 原生相機的預覽和拍出的相片比例可能不同（例如預覽 16:9、相片 4:3，預覽是相片置中裁出的一部分）。
/// [previewAspect]（直向的寬÷高）有值時，先把相片置中裁成預覽的比例，再按 cover 換算，畫面上看到的範圍和截出的範圍才會一樣。
/// 不傳時等於網頁版（截圖來源就是預覽畫面本身）。
SourceRect shootRect(Size box, int imageW, int imageH, FrameBox f, {double? previewAspect}) {
  double vw = imageW.toDouble(), vh = imageH.toDouble(), cx = 0, cy = 0;
  if (previewAspect != null && previewAspect > 0) {
    if (vw / vh > previewAspect) {
      final w = vh * previewAspect;
      cx = (vw - w) / 2;
      vw = w;
    } else {
      final h = vw / previewAspect;
      cy = (vh - h) / 2;
      vh = h;
    }
  }
  final scale = math.max(box.width / vw, box.height / vh);
  final ox = (box.width - vw * scale) / 2, oy = (box.height - vh * scale) / 2;
  return SourceRect(cx + (f.left - ox) / scale, cy + (f.top - oy) / scale, f.width / scale, f.height / scale);
}

/// 相片在畫面上的位置和縮放（card-stage.js 的 view：x、y 是相片左上角的畫面座標，s 是縮放，min 是最小縮放）
class StageView {
  StageView({required this.x, required this.y, required this.s, required this.min});
  double x, y, s, min;

  /// card-stage.js placeImage()：相片先放大到剛好蓋滿框，置中；最小縮放為一半
  factory StageView.place(FrameBox f, int naturalW, int naturalH) {
    final s = math.max(f.width / naturalW, f.height / naturalH);
    return StageView(s: s, min: s * 0.5, x: f.left + (f.width - naturalW * s) / 2, y: f.top + (f.height - naturalH * s) / 2);
  }

  /// card-stage.js zoomAt()：以 (cx, cy) 為中心縮放到 s，限制在最小縮放的 1 至 12 倍
  void zoomAt(double cx, double cy, double next) {
    next = math.min(math.max(next, min), min * 12);
    x = cx - (cx - x) * next / s;
    y = cy - (cy - y) * next / s;
    s = next;
  }

  /// card-stage.js confirm()：畫面上的框換成相片原圖座標
  SourceRect confirmRect(FrameBox f) => SourceRect((f.left - x) / s, (f.top - y) / s, f.width / s, f.height / s);
}

/// card-stage.js crop()：框（每邊外擴 6%）內的原圖畫到 2274×1445 的截圖上，超出原圖的部分填白色。
///
/// [rgba] 是原圖像素，每點 4 字節 RGBA，顏色已乘 alpha（dart:ui `ImageByteFormat.rawRgba` 的格式；不透明的圖不受影響）。
/// 取樣用雙線性（canvas drawImage 預設 imageSmoothingQuality 'low'），透明的部分疊在白底上。
img.Image cropCard(Uint8List rgba, int width, int height, SourceRect r) {
  final outW = cardFullW, outH = cardFullH;
  final mx = r.width * cardMargin, my = r.height * cardMargin;
  final sx = r.x - mx, sy = r.y - my, sw = r.width + mx * 2, sh = r.height + my * 2;
  final kx = outW / sw, ky = outH / sh;
  final out = Uint8List(outW * outH * 3)..fillRange(0, outW * outH * 3, 255);
  // 每一列、每一行的取樣位置（輸出像素中心換回原圖座標）；落在原圖外的保持白色
  final colOk = List<bool>.filled(outW, false);
  final colA = Int32List(outW), colB = Int32List(outW), colW = Float64List(outW);
  for (var ox = 0; ox < outW; ox++) {
    final u = sx + (ox + 0.5) / kx;
    if (u < 0 || u >= width) continue;
    colOk[ox] = true;
    final p = (u - 0.5).clamp(0.0, width - 1.0);
    final a = p.floor();
    colA[ox] = a * 4;
    colB[ox] = math.min(a + 1, width - 1) * 4;
    colW[ox] = p - a;
  }
  for (var oy = 0; oy < outH; oy++) {
    final v = sy + (oy + 0.5) / ky;
    if (v < 0 || v >= height) continue;
    final q = (v - 0.5).clamp(0.0, height - 1.0);
    final b = q.floor();
    final row0 = b * width * 4, row1 = math.min(b + 1, height - 1) * width * 4;
    final wy = q - b, iy = 1 - wy;
    var o = oy * outW * 3;
    for (var ox = 0; ox < outW; ox++, o += 3) {
      if (!colOk[ox]) continue;
      final wx = colW[ox], ix = 1 - wx;
      final p00 = row0 + colA[ox], p01 = row0 + colB[ox], p10 = row1 + colA[ox], p11 = row1 + colB[ox];
      final w00 = ix * iy, w01 = wx * iy, w10 = ix * wy, w11 = wx * wy;
      final alpha = rgba[p00 + 3] * w00 + rgba[p01 + 3] * w01 + rgba[p10 + 3] * w10 + rgba[p11 + 3] * w11;
      final white = 255 - alpha;
      for (var c = 0; c < 3; c++) {
        final value = rgba[p00 + c] * w00 + rgba[p01 + c] * w01 + rgba[p10 + c] * w10 + rgba[p11 + c] * w11 + white;
        out[o + c] = value < 0 ? 0 : value > 255 ? 255 : (value + 0.5).toInt();
      }
    }
  }
  return img.Image.fromBytes(width: outW, height: outH, bytes: out.buffer, numChannels: 3);
}

/// 截取並編碼成 data URL（`data:image/jpeg;base64,...`），和 canvas.toDataURL('image/jpeg', 0.9) 同一格式
String cropCardDataUrl(Uint8List rgba, int width, int height, SourceRect r) =>
    'data:image/jpeg;base64,${base64Encode(img.encodeJpg(cropCard(rgba, width, height, r), quality: cardJpegQuality))}';

/// 在背景執行截圖和 JPEG 編碼（原圖可能有幾千萬字節，不卡住畫面）
Future<String> cropCardInBackground(Uint8List rgba, int width, int height, SourceRect r) {
  final data = TransferableTypedData.fromList([rgba]);
  return Isolate.run(() => cropCardDataUrl(data.materialize().asUint8List(), width, height, r));
}
