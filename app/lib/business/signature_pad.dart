// 手寫簽名框：一比一移植 mobile/src/components/SignaturePad.vue（App 端用 Wot 的 wd-signature）。
// 外觀（wd-signature 預設樣式）：白底、1px #C8C9CC 框、圓角 4、高 160、闊度撐滿；下面一行「請在框內簽名／已簽名」＋「重簽」小按鈕。
// 筆畫：#14201B、線寬 2.5、圓頭圓角，每兩點之間畫直線（wd-signature 非筆鋒模式）。
// 輸出：PNG data URL（data:image/png;base64,…），大小是畫布實際像素（邏輯尺寸 × 螢幕像素比，wd-signature 的 exportScale 1），先鋪白底再畫筆畫，
// 和現有 App 送伺服器的格式一樣（伺服器要求 PNG、200 B 至 600 KB）。
// SignaturePad.vue 的 footer 插槽放了空 <view />：wd-signature__footer 仍有 margin-top 8，所以畫布和下一行之間是 8 + 8。
import 'dart:convert';
import 'dart:ui' as ui;
import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import '../ui/base.dart';
import '../ui/tokens.dart';

class SignatureController extends ChangeNotifier {
  final List<List<Offset>> strokes = [];
  Size size = Size.zero;
  double pixelRatio = 1;
  // drawn：放手後才算已簽名（@end="drawn = true"）
  bool drawn = false;

  bool get isEmpty => !drawn;

  void start(Offset p) {
    strokes.add([p]);
    notifyListeners();
  }

  void move(Offset p) {
    if (strokes.isEmpty) return;
    strokes.last.add(p);
    notifyListeners();
  }

  void end() {
    drawn = true;
    notifyListeners();
  }

  void clear() {
    strokes.clear();
    drawn = false;
    notifyListeners();
  }

  // 簽名相片（PNG data URL）
  Future<String> toDataURL() async {
    final png = await renderSignaturePng(strokes, size, pixelRatio);
    return 'data:image/png;base64,${base64Encode(png)}';
  }
}

void paintSignature(Canvas canvas, Size size, List<List<Offset>> strokes) {
  canvas.drawRect(Offset.zero & size, Paint()..color = SignatureStyle.background);
  final pen = Paint()
    ..color = SignatureStyle.pen
    ..strokeWidth = SignatureStyle.lineWidth
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..style = PaintingStyle.stroke;
  for (final s in strokes) {
    for (var i = 1; i < s.length; i++) {
      canvas.drawLine(s[i - 1], s[i], pen);
    }
  }
}

// 畫成 PNG：寬高 = 邏輯尺寸 × 像素比（四捨五入到整數像素）
Future<List<int>> renderSignaturePng(List<List<Offset>> strokes, Size size, double pixelRatio) async {
  final w = (size.width * pixelRatio).round().clamp(1, 100000), h = (size.height * pixelRatio).round().clamp(1, 100000);
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.scale(pixelRatio, pixelRatio);
  paintSignature(canvas, size, strokes);
  final image = await recorder.endRecording().toImage(w, h);
  try {
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    if (data == null) throw StateError('簽名未能儲存，請重簽');
    return data.buffer.asUint8List();
  } finally {
    image.dispose();
  }
}

class SignaturePad extends StatefulWidget {
  const SignaturePad({super.key, required this.controller});
  final SignatureController controller;
  @override
  State<SignaturePad> createState() => _SignaturePadState();
}

class _SignaturePadState extends State<SignaturePad> {
  SignatureController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    c.addListener(_changed);
  }

  @override
  void didUpdateWidget(SignaturePad old) {
    super.didUpdateWidget(old);
    if (old.controller != c) {
      old.controller.removeListener(_changed);
      c.addListener(_changed);
    }
  }

  @override
  void dispose() {
    c.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    c.pixelRatio = MediaQuery.devicePixelRatioOf(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      Container(
        key: const ValueKey('signature-canvas'),
        height: SignatureStyle.height + 2,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(color: SignatureStyle.background, border: Border.all(color: SignatureStyle.border), borderRadius: BorderRadius.circular(R.control)),
        child: LayoutBuilder(builder: (context, box) {
          c.size = Size(box.maxWidth, box.maxHeight);
          // 簽名時不讓頁面捲動（disable-scroll）：手指一按下，拖動手勢就歸簽名框，頁面不會捲動；由按下的位置開始畫
          return RawGestureDetector(
            behavior: HitTestBehavior.opaque,
            gestures: {
              _ClaimPan: GestureRecognizerFactoryWithHandlers<_ClaimPan>(_ClaimPan.new, (r) {
                r
                  ..dragStartBehavior = DragStartBehavior.down
                  ..onStart = ((d) => c.start(d.localPosition))
                  ..onUpdate = ((d) => c.move(d.localPosition))
                  ..onEnd = ((_) => c.end())
                  ..onCancel = c.end;
              }),
            },
            child: CustomPaint(painter: _SignaturePainter(c.strokes, c.strokes.fold(0, (n, s) => n + s.length)), size: Size.infinite),
          );
        }),
      ),
      const SizedBox(height: SignatureStyle.footerGap + 8),
      // .pad-row：左邊提示、右邊「重簽」，間距 12
      Row(children: [
        Expanded(child: Subtle(c.drawn ? '已簽名' : '請在框內簽名')),
        const SizedBox(width: 12),
        Btn('重簽', kind: BtnKind.small, onTap: c.clear),
      ]),
    ]);
  }
}

class _SignaturePainter extends CustomPainter {
  _SignaturePainter(this.strokes, this.points);
  final List<List<Offset>> strokes;
  final int points;
  @override
  void paint(Canvas canvas, Size size) => paintSignature(canvas, size, strokes);
  @override
  bool shouldRepaint(_SignaturePainter old) => true;
}

// 按下就贏得手勢競爭（外面的捲動不會搶走）
class _ClaimPan extends PanGestureRecognizer {
  @override
  void addAllowedPointer(PointerDownEvent event) {
    super.addAllowedPointer(event);
    resolve(GestureDisposition.accepted);
  }
}
