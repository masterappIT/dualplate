// 即時找卡邊（階段 2b）：把伺服器 api/src/card-face.js 的找邊方法逐行改寫成純 Dart，在鏡頭預覽畫面上跑。
//
// 伺服器做法（照搬）：外圈（每邊 2%）背景色的中位數 → 每點和背景的色差 → 色差大於門檻的點算作卡 →
// 在中間一段行（列）裏，每一列（行）屬於卡的比例 → 從外往內第一個連續 3 格過半的位置就是卡邊；
// 上下兩段、左右兩段的卡邊位置差算出傾斜角度。
//
// 預覽畫面這邊：只取對準框外擴 6% 的範圍（和截出的 2274×1445 同一範圍），縮到伺服器分析解像度的一半（569×361），
// 再判斷每條卡邊有沒有對齊框線、傾斜多少、框內清楚與否。四邊都對齊、不歪、清楚，才算「可以拍了」。
// 全部是純 Dart，可在單元測試直接驗證；鏡頭畫面在背景 isolate 裏處理（[EdgeWorker]），不卡住預覽。
import 'dart:async';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';
import 'card_capture.dart';
import 'card_stage.dart';

// ── 伺服器 card-face.js 的常數 ──

/// 伺服器分析時把 2274×1445 縮小的倍數（card-face.js SCALE = 2，分析圖 1137×722）
const int serverEdgeScale = 2;

/// 預覽分析用伺服器分析解像度的一半：2274×1445 縮小 4 倍，569×361
const int liveEdgeScale = 4;
final int liveEdgeW = _jsRound(cardFullW / liveEdgeScale).toInt(); // 569
final int liveEdgeH = _jsRound(cardFullH / liveEdgeScale).toInt(); // 361

/// 卡的長寬比（card-face.js RATIO = 1015 / 645）
const double cardRatio = 1015 / 645;

/// 背景太淺（亮度 > 200，白桌）時伺服器不找邊、改用框內（card-face.js）；預覽上也不標示對齊
const double brightBackground = 200;

/// 找到的四邊範圍內，屬於卡的點要有九成（card-face.js：白卡放白桌時只有文字分得出，邊界不可靠）
const double insideMin = 0.9;

// ── 預覽上的判斷門檻（2b 新定，理由見各常數說明）──

/// 卡邊在框線以內多遠仍算對齊：框內寬（或高）的 4%。
/// 569 寬的分析圖裏框內約 508 像素，4% 約 20 像素，畫面上（框寬 362pt）約 14pt。
/// 卡邊在框內 4% 內，伺服器裁出的卡面縮放不到一成，辨識按位置讀字仍讀得到。
const double edgeAlignTolerance = 0.04;

/// 卡邊超出框線多遠仍算對齊：只容許 1%（階段 5b 真機結果）。
/// 截圖只在框外多截 6%；2b 原本框外也容許 4%，真機上卡上邊超出框線約 3.6% 時已轉綠自動拍，
/// 截圖上方只剩約 2% 背景，伺服器找錯卡的上邊、切進字裏，編號、商號、口岸都讀不到。
/// 同一張卡放回框外留足背景後，編號、口岸、序號都讀對。
const double edgeOutsideTolerance = 0.01;

/// 自動拍可接受的傾斜角度（度）。伺服器會把 8° 以內的傾斜轉正，但轉正要重新取樣、字會變軟；
/// 3° 時卡的上邊在中間四成寬度內只偏約 10 像素（分析圖），仍在對齊範圍內。
const double liveMaxTilt = 3.0;

/// 框內清楚與否：灰階拉普拉斯變異數的門檻（只看框內、再內縮一成，避開卡邊和框外桌面）。
/// 定法：4 張實卡樣本縮到 569×361 分析圖後，清楚時約 1700–3100；高斯模糊半徑 1 像素（分析圖）時 490–920，
/// 2 像素時 60–134，3 像素時 13–29。門檻定在 150：模糊 2 像素以上（約等於手震或沒對焦）全部不過，
/// 模糊 1 像素以內全部通過且仍有約 3 倍餘量（真鏡頭預覽比掃描軟，留餘量免得永遠不自動拍）。
/// 樣本是掃描檔不是預覽畫面，真手機預覽的數值 2d 要核對（除錯版會在記錄裏印出）。
const double sharpThreshold = 150;

/// 自動拍前「可以拍了」要連續維持多久（中途有一張不是就重新計時）。
/// Android 模擬器上每秒找邊約 6–9.5 次，600 毫秒約等於連續 4–6 張都合格：手拿着卡掠過框、或偶然一張剛好對齊都不會拍；
/// 銀行、證件類 App 的自動拍大多在 0.5–1 秒之間，再長用戶要一直舉着手機、手更易抖。真手機上的感覺 2d 核對。
const Duration autoShotHold = Duration(milliseconds: 600);

double _jsRound(double v) => (v + 0.5).floorToDouble(); // JS Math.round

// ── 逐行照搬 card-face.js ──

/// card-face.js analyse() 的結果：每點是不是卡（[mask]）和背景色
class EdgeMap {
  EdgeMap(this.w, this.h, this.mask, this.background);
  final int w, h;
  final Uint8List mask;
  final List<int> background;
}

/// card-face.js analyse()：[rgb] 每點 3 字節，[w]×[h]
EdgeMap analyseEdges(Uint8List rgb, int w, int h) {
  final ring = math.max(2, _jsRound(w * 0.02).toInt());
  final samples = <int>[];
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (x < ring || y < ring || x >= w - ring || y >= h - ring) samples.add((y * w + x) * 3);
    }
  }
  int median(int channel) {
    final values = Int32List(samples.length);
    for (var i = 0; i < samples.length; i++) {
      values[i] = rgb[samples[i] + channel];
    }
    values.sort();
    return values[values.length >> 1];
  }

  final background = [median(0), median(1), median(2)];
  final b0 = background[0], b1 = background[1], b2 = background[2];
  double distance(int i) {
    final d0 = rgb[i] - b0, d1 = rgb[i + 1] - b1, d2 = rgb[i + 2] - b2;
    return math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
  }

  final ringDistances = Float64List(samples.length);
  for (var i = 0; i < samples.length; i++) {
    ringDistances[i] = distance(samples[i]);
  }
  ringDistances.sort();
  final noise = ringDistances[(samples.length * 0.9).floor()];
  final threshold = math.max(40.0, noise * 1.5);
  final mask = Uint8List(w * h);
  for (var i = 0; i < w * h; i++) {
    mask[i] = distance(i * 3) > threshold ? 1 : 0;
  }
  return EdgeMap(w, h, mask, background);
}

/// card-face.js profile()：某一段行（[vertical]）或列裏，每一列（或行）屬於卡的比例
Float64List edgeProfile(EdgeMap map, bool vertical, double from, double to) {
  final w = map.w, h = map.h, mask = map.mask;
  final length = vertical ? w : h;
  final out = Float64List(length);
  final a = _jsRound(from).toInt(), b = _jsRound(to).toInt();
  final span = math.max(1, b - a);
  for (var i = 0; i < length; i++) {
    var count = 0;
    for (var j = a; j < b; j++) {
      count += vertical ? mask[j * w + i] : mask[i * w + j];
    }
    out[i] = count / span;
  }
  return out;
}

/// card-face.js edge()：從外往內找第一個連續 3 格都過半的位置；找不到或貼着圖邊（卡超出外圈）回傳 null
int? edgeIndex(List<double> values, bool fromEnd) {
  final n = values.length;
  final step = fromEnd ? -1 : 1;
  for (var k = 0; k < n / 2; k++) {
    final i = fromEnd ? n - 1 - k : k;
    var all = true;
    for (var d = 0; d < 3; d++) {
      final j = i + d * step;
      if (j < 0 || j >= n || values[j] < 0.5) {
        all = false;
        break;
      }
    }
    if (all) return k == 0 ? null : i;
  }
  return null;
}

/// 四條卡邊的位置（分析圖的像素；right、bottom 是卡最後一個像素）
class EdgePositions {
  const EdgePositions({this.left, this.top, this.right, this.bottom});
  final int? left, top, right, bottom;
  bool get complete => left != null && top != null && right != null && bottom != null;
  @override
  String toString() => 'EdgePositions(left: $left, top: $top, right: $right, bottom: $bottom)';
}

/// card-face.js edges()：預設只看中間四成（0.3 至 0.7）的行和列
EdgePositions findEdges(EdgeMap map, [List<double> band = const [0.3, 0.7]]) {
  final rows = edgeProfile(map, true, map.h * band[0], map.h * band[1]);
  final cols = edgeProfile(map, false, map.w * band[0], map.w * band[1]);
  return EdgePositions(left: edgeIndex(rows, false), right: edgeIndex(rows, true), top: edgeIndex(cols, false), bottom: edgeIndex(cols, true));
}

/// card-face.js tilt()：卡的傾斜角度（度，順時針為正）；少於兩條邊量得到時回傳 0
double findTilt(EdgeMap map) {
  final a = findEdges(map, const [0.3, 0.45]), b = findEdges(map, const [0.55, 0.7]);
  final gapY = map.h * 0.25, gapX = map.w * 0.25;
  final angles = <double>[];
  if (a.left != null && b.left != null) angles.add(math.atan((a.left! - b.left!) / gapY));
  if (a.right != null && b.right != null) angles.add(math.atan((a.right! - b.right!) / gapY));
  if (a.top != null && b.top != null) angles.add(math.atan((b.top! - a.top!) / gapX));
  if (a.bottom != null && b.bottom != null) angles.add(math.atan((b.bottom! - a.bottom!) / gapX));
  if (angles.length < 2) return 0;
  final degrees = angles.map((angle) => angle * 180 / math.pi).toList()..sort();
  return degrees[degrees.length >> 1];
}

// ── 預覽上的判斷 ──

/// 一張預覽畫面的找邊結果
class CardEdges {
  const CardEdges({this.left = false, this.top = false, this.right = false, this.bottom = false, this.tilt = 0, this.sharpness = 0});
  static const none = CardEdges();

  /// 四邊各自有沒有對齊框線
  final bool left, top, right, bottom;

  /// 傾斜角度（度，順時針為正）
  final double tilt;

  /// 框內灰階拉普拉斯變異數，越大越清楚
  final double sharpness;

  bool get aligned => left && top && right && bottom;
  bool get level => tilt.abs() <= liveMaxTilt;
  bool get sharp => sharpness >= sharpThreshold;

  /// 四邊都對齊、不歪、清楚：可以拍了
  bool get ready => aligned && level && sharp;

  @override
  bool operator ==(Object other) =>
      other is CardEdges && other.left == left && other.top == top && other.right == right && other.bottom == bottom && other.tilt == tilt && other.sharpness == sharpness;
  @override
  int get hashCode => Object.hash(left, top, right, bottom, tilt, sharpness);
  @override
  String toString() => 'CardEdges(left: $left, top: $top, right: $right, bottom: $bottom, tilt: ${tilt.toStringAsFixed(2)}, sharpness: ${sharpness.toStringAsFixed(1)})';
}

/// 框線在分析圖上的位置（連續座標）：左邊 x = w × 6% ÷ 112%，右邊 x = w − 左邊；上下同理
({double left, double top, double right, double bottom}) frameLines(int w, int h) {
  final k = cardMargin / (1 + 2 * cardMargin);
  return (left: w * k, top: h * k, right: w - w * k, bottom: h - h * k);
}

/// 框內（再內縮 [inset]）灰階的拉普拉斯變異數（4 鄰點）
double sharpnessOf(Uint8List rgb, int w, int h, {double inset = 0.1}) {
  final lines = frameLines(w, h);
  final iw = lines.right - lines.left, ih = lines.bottom - lines.top;
  final x0 = math.max(1, (lines.left + iw * inset).round()), x1 = math.min(w - 1, (lines.right - iw * inset).round());
  final y0 = math.max(1, (lines.top + ih * inset).round()), y1 = math.min(h - 1, (lines.bottom - ih * inset).round());
  if (x1 <= x0 || y1 <= y0) return 0;
  final gray = Float64List(w * h);
  for (var y = y0 - 1; y <= y1; y++) {
    for (var x = x0 - 1; x <= x1; x++) {
      final i = (y * w + x) * 3;
      gray[y * w + x] = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
    }
  }
  var sum = 0.0, sumSq = 0.0, n = 0;
  for (var y = y0; y < y1; y++) {
    for (var x = x0; x < x1; x++) {
      final p = y * w + x;
      final lap = gray[p - 1] + gray[p + 1] + gray[p - w] + gray[p + w] - 4 * gray[p];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  final mean = sum / n;
  return sumSq / n - mean * mean;
}

/// 在框外擴 6% 的分析圖（[rgb]，[w]×[h]，和截圖同一範圍）上找邊，判斷四邊有沒有對齊框線
CardEdges detectCardEdges(Uint8List rgb, int w, int h) {
  final sharpness = sharpnessOf(rgb, w, h);
  final map = analyseEdges(rgb, w, h);
  final bg = map.background;
  // 白桌：伺服器不找邊，預覽上也不標示對齊（仍可按快門）
  if (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2] > brightBackground) return CardEdges(sharpness: sharpness);
  final found = findEdges(map), tilt = findTilt(map);
  final lines = frameLines(w, h);
  final frameW = lines.right - lines.left, frameH = lines.bottom - lines.top;
  final inX = frameW * edgeAlignTolerance, inY = frameH * edgeAlignTolerance;
  final outX = frameW * edgeOutsideTolerance, outY = frameH * edgeOutsideTolerance;
  // 卡和桌面分得清才可靠（伺服器同一檢查）：四邊都找到時，範圍內九成要是卡
  if (found.complete) {
    var inside = 0;
    for (var y = found.top!; y <= found.bottom!; y++) {
      for (var x = found.left!; x <= found.right!; x++) {
        inside += map.mask[y * w + x];
      }
    }
    final area = (found.right! - found.left! + 1) * (found.bottom! - found.top! + 1);
    if (inside / area < insideMin) return CardEdges(tilt: tilt, sharpness: sharpness);
  }
  // inward：框線往卡中心的方向為正。框內最多 inside，框外最多 outside
  bool near(int? at, double line, {required int inward, required double inside, required double outside}) {
    if (at == null) return false;
    final d = (at - line) * inward;
    return d <= inside && d >= -outside;
  }
  return CardEdges(
    left: near(found.left, lines.left, inward: 1, inside: inX, outside: outX),
    right: near(found.right == null ? null : found.right! + 1, lines.right, inward: -1, inside: inX, outside: outX),
    top: near(found.top, lines.top, inward: 1, inside: inY, outside: outY),
    bottom: near(found.bottom == null ? null : found.bottom! + 1, lines.bottom, inward: -1, inside: inY, outside: outY),
    tilt: tilt,
    sharpness: sharpness,
  );
}

// ── 鏡頭畫面 → 分析圖 ──

/// 鏡頭畫面的像素格式：Android YUV420（三個平面）、iOS BGRA（一個平面）；rgb 給測試和開發示範用
enum FramePixels { yuv420, bgra8888, rgb }

/// 一張鏡頭畫面（相機 image stream 的 CameraImage 換成純資料，可送到背景 isolate）
class PreviewFrame {
  const PreviewFrame({required this.width, required this.height, required this.format, required this.planes, required this.rowStrides, required this.pixelStrides, this.rotation = 0});
  final int width, height;
  final FramePixels format;
  final List<Uint8List> planes;
  final List<int> rowStrides, pixelStrides;

  /// 畫面要順時針轉多少度才是直向（Android 鏡頭的 sensorOrientation，通常 90）
  final int rotation;

  bool get turned => rotation == 90 || rotation == 270;

  /// 轉成直向後的寬高
  int get uprightW => turned ? height : width;
  int get uprightH => turned ? width : height;

  /// 每點 3 字節的 RGB 畫面（測試、開發示範用）
  factory PreviewFrame.rgb(Uint8List rgb, int width, int height) =>
      PreviewFrame(width: width, height: height, format: FramePixels.rgb, planes: [rgb], rowStrides: [width * 3], pixelStrides: const [3]);
}

/// 從鏡頭畫面取出框外擴 6% 的範圍，縮成 [outW]×[outH] 的 RGB 分析圖（每點 3 字節）。
///
/// [inner] 是直向畫面座標的框內範圍（card_stage.dart shootRect 的結果）；外擴的方法和 cropCard 相同。
/// 每個輸出點取對應範圍內最多 3×3 個點的平均（縮小時順便去雜訊），落在畫面外的部分當白色（和截圖一樣）。
Uint8List sampleMargin(PreviewFrame frame, SourceRect inner, {int? outW, int? outH}) {
  final ow = outW ?? liveEdgeW, oh = outH ?? liveEdgeH;
  final mx = inner.width * cardMargin, my = inner.height * cardMargin;
  final sx = inner.x - mx, sy = inner.y - my, sw = inner.width + mx * 2, sh = inner.height + my * 2;
  final stepX = sw / ow, stepY = sh / oh;
  final nx = stepX.round().clamp(1, 3), ny = stepY.round().clamp(1, 3);
  final pw = frame.uprightW, ph = frame.uprightH, rw = frame.width, rh = frame.height;
  // 每一列的直向 x（取樣點），落在畫面外記 -1
  final cols = Int32List(ow * nx);
  for (var ox = 0; ox < ow; ox++) {
    for (var j = 0; j < nx; j++) {
      final u = sx + (ox + (j + 0.5) / nx) * stepX;
      cols[ox * nx + j] = u < 0 || u >= pw ? -1 : u.floor();
    }
  }
  final rows = Int32List(oh * ny);
  for (var oy = 0; oy < oh; oy++) {
    for (var j = 0; j < ny; j++) {
      final v = sy + (oy + (j + 0.5) / ny) * stepY;
      rows[oy * ny + j] = v < 0 || v >= ph ? -1 : v.floor();
    }
  }
  final out = Uint8List(ow * oh * 3);
  final p0 = frame.planes[0], s0 = frame.rowStrides[0], d0 = frame.pixelStrides[0];
  final p1 = frame.planes.length > 1 ? frame.planes[1] : p0, s1 = frame.rowStrides.length > 1 ? frame.rowStrides[1] : 0, d1 = frame.pixelStrides.length > 1 ? frame.pixelStrides[1] : 0;
  final p2 = frame.planes.length > 2 ? frame.planes[2] : p0, s2 = frame.rowStrides.length > 2 ? frame.rowStrides[2] : 0, d2 = frame.pixelStrides.length > 2 ? frame.pixelStrides[2] : 0;
  final format = frame.format, rotation = frame.rotation;
  final count = nx * ny;
  var o = 0;
  for (var oy = 0; oy < oh; oy++) {
    for (var ox = 0; ox < ow; ox++, o += 3) {
      var r = 0.0, g = 0.0, b = 0.0;
      for (var jy = 0; jy < ny; jy++) {
        final py = rows[oy * ny + jy];
        for (var jx = 0; jx < nx; jx++) {
          final px = cols[ox * nx + jx];
          if (px < 0 || py < 0) {
            r += 255;
            g += 255;
            b += 255;
            continue;
          }
          // 直向座標換回原始畫面座標
          int rx, ry;
          switch (rotation) {
            case 90:
              rx = py;
              ry = rh - 1 - px;
            case 180:
              rx = rw - 1 - px;
              ry = rh - 1 - py;
            case 270:
              rx = rw - 1 - py;
              ry = px;
            default:
              rx = px;
              ry = py;
          }
          switch (format) {
            case FramePixels.yuv420:
              final yy = p0[ry * s0 + rx * d0].toDouble();
              final cu = p1[(ry >> 1) * s1 + (rx >> 1) * d1] - 128.0;
              final cv = p2[(ry >> 1) * s2 + (rx >> 1) * d2] - 128.0;
              r += _clamp(yy + 1.402 * cv);
              g += _clamp(yy - 0.344136 * cu - 0.714136 * cv);
              b += _clamp(yy + 1.772 * cu);
            case FramePixels.bgra8888:
              final i = ry * s0 + rx * d0;
              b += p0[i];
              g += p0[i + 1];
              r += p0[i + 2];
            case FramePixels.rgb:
              final i = ry * s0 + rx * d0;
              r += p0[i];
              g += p0[i + 1];
              b += p0[i + 2];
          }
        }
      }
      out[o] = (r / count + 0.5).toInt();
      out[o + 1] = (g / count + 0.5).toInt();
      out[o + 2] = (b / count + 0.5).toInt();
    }
  }
  return out;
}

double _clamp(double v) => v < 0 ? 0 : v > 255 ? 255 : v;

/// 一張鏡頭畫面從取樣到判斷（背景 isolate 裏執行）
CardEdges detectInFrame(PreviewFrame frame, SourceRect inner) => detectCardEdges(sampleMargin(frame, inner), liveEdgeW, liveEdgeH);

// ── 背景執行 ──

/// 在背景 isolate 裏找邊：一次只處理一張，處理中收到的新畫面直接丟掉（[busy] 時呼叫方不送）。
/// 開一個常駐的 isolate，免得每張畫面都重開；[close] 後不可再用。
class EdgeWorker {
  EdgeWorker._(this._isolate, this._send, this._receive) {
    _receive.listen((message) {
      final pending = _pending;
      _pending = null;
      if (pending == null || pending.isCompleted) return;
      if (message is List) {
        pending.complete(CardEdges(left: message[0] as bool, top: message[1] as bool, right: message[2] as bool, bottom: message[3] as bool, tilt: message[4] as double, sharpness: message[5] as double));
      } else {
        pending.complete(null);
      }
    });
  }

  final Isolate _isolate;
  final SendPort _send;
  final ReceivePort _receive;
  Completer<CardEdges?>? _pending;
  bool _closed = false;

  bool get busy => _pending != null;

  static Future<EdgeWorker> start() async {
    final setup = ReceivePort();
    final isolate = await Isolate.spawn(_main, setup.sendPort, debugName: 'card-edges');
    final send = await setup.first as SendPort; // first 收到後自動關閉 setup
    final results = ReceivePort();
    send.send(results.sendPort);
    return EdgeWorker._(isolate, send, results);
  }

  /// 送一張畫面去找邊；正在處理上一張或已關閉時回傳 null
  Future<CardEdges?> detect(PreviewFrame frame, SourceRect inner) {
    if (_closed || _pending != null) return Future.value(null);
    final pending = _pending = Completer<CardEdges?>();
    _send.send([
      frame.width,
      frame.height,
      frame.format.index,
      [for (final p in frame.planes) TransferableTypedData.fromList([p])],
      frame.rowStrides,
      frame.pixelStrides,
      frame.rotation,
      [inner.x, inner.y, inner.width, inner.height],
    ]);
    return pending.future;
  }

  void close() {
    if (_closed) return;
    _closed = true;
    _pending?.complete(null);
    _pending = null;
    _receive.close();
    _isolate.kill(priority: Isolate.immediate);
  }

  static void _main(SendPort setup) {
    final commands = ReceivePort();
    setup.send(commands.sendPort);
    SendPort? results;
    commands.listen((message) {
      if (message is SendPort) {
        results = message;
        return;
      }
      final m = message as List;
      try {
        final frame = PreviewFrame(
          width: m[0] as int,
          height: m[1] as int,
          format: FramePixels.values[m[2] as int],
          planes: [for (final p in m[3] as List) (p as TransferableTypedData).materialize().asUint8List()],
          rowStrides: (m[4] as List).cast<int>(),
          pixelStrides: (m[5] as List).cast<int>(),
          rotation: m[6] as int,
        );
        final r = (m[7] as List).cast<double>();
        final e = detectInFrame(frame, SourceRect(r[0], r[1], r[2], r[3]));
        results?.send([e.left, e.top, e.right, e.bottom, e.tilt, e.sharpness]);
      } catch (_) {
        results?.send(null);
      }
    });
  }
}
