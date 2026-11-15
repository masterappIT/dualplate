// 登入頁上半的口岸網絡畫布：照搬 mobile/src/lib/ports-canvas.js。
// 節點緩慢呼吸，牌照黃脈衝沿連線往返；登入成功時由中心擴散。減少動態效果時只畫靜態一幀（也不畫擴散）。
// 現有 App 用 requestAnimationFrame 每幀加一（WKWebView 每秒 60 幀）；這裏按經過時間換算成同樣的幀數，逐幀推進脈衝，快慢和現在一樣。
import 'dart:math' as math;
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';
import '../../ui/tokens.dart';

// 外圈五角：深圳灣、沙頭角、拱北、橫琴、皇崗；蓮塘、文錦渡、港珠澳大橋在圈內。第四欄是名字位置（見 ports-canvas.js）
const ports = [
  ('深圳灣', .08, .48, 'above'),
  ('蓮塘', .3, .26, 'above'),
  ('皇崗', .24, .96, ''),
  ('沙頭角', .54, .04, ''),
  ('港珠澳大橋', .52, .74, 'below'),
  ('拱北', .9, .32, ''),
  ('橫琴', .8, .96, ''),
  ('文錦渡', .6, .42, 'right'),
];
const links = [(0, 1), (0, 2), (1, 3), (1, 7), (7, 4), (2, 4), (4, 5), (4, 6), (5, 6), (3, 5), (0, 4)];
const pulseLinks = [0, 2, 4, 5, 6, 7, 9, 10];
const pulseGap = 18.0;

class _Pulse {
  _Pulse(this.link, this.t, this.speed, this.dir);
  final (int, int) link;
  double t, speed;
  int dir;
}

// 畫布的狀態和逐幀計算（和繪圖分開，方便測試）
class PortsModel {
  PortsModel(this.width, this.height, {this.reduced = false, double? top, double? bottom}) {
    final b = bottom ?? height - 48, tp = top ?? height * .44;
    bandBottom = math.min(b, height) - 22;
    bandTop = math.min(math.max(tp + 40, height * .3), bandBottom - 80);
    bandHeight = bandBottom - bandTop;
    for (final (i, index) in pulseLinks.indexed) {
      pulses.add(_Pulse(links[index], .2 + (i * 0.17) % .6, 0.0025 + (i % 3) * 0.0012, i.isOdd ? 1 : -1));
    }
  }
  final double width, height;
  final bool reduced;
  late final double bandTop, bandBottom, bandHeight;
  final pulses = <_Pulse>[];
  int frame = 0, burstAt = 0;

  List<Offset> positions() => [
        for (final (i, (_, x, y, _)) in ports.indexed) Offset(x * width, bandTop + y * bandHeight + math.sin(frame / 90 + i) * (reduced ? 0 : 3)),
      ];

  // 每幀：frame 加一，按新位置推進脈衝（到端點前折返）
  void step() {
    frame++;
    if (reduced) return;
    final pos = positions();
    for (final p in pulses) {
      final a = pos[p.link.$1], b = pos[p.link.$2], d = b - a, gap = math.min(.45, pulseGap / d.distance);
      p.t += p.speed * p.dir;
      if (p.t > 1 - gap || p.t < gap) {
        p.dir *= -1;
        p.t = math.min(1 - gap, math.max(gap, p.t));
      }
    }
    if (burstAt > 0 && frame - burstAt >= 40) burstAt = 0;
  }

  List<Offset> pulsePositions(List<Offset> pos) => [for (final p in pulses) pos[p.link.$1] + (pos[p.link.$2] - pos[p.link.$1]) * p.t];

  // 擴散進度 0–1；沒有擴散時 null
  double? burstProgress() => burstAt == 0 ? null : math.min(1.0, (frame - burstAt) / 40);

  void burst() => burstAt = frame == 0 ? 1 : frame;
}

class PortsController {
  _PortsCanvasState? _state;
  void burst() => _state?._burst();
}

class PortsCanvas extends StatefulWidget {
  const PortsCanvas({super.key, required this.controller, this.top, this.bottom});
  final PortsController controller;
  final double? top, bottom; // 車牌示例底邊、登入卡頂邊（相對畫布）
  @override
  State<PortsCanvas> createState() => _PortsCanvasState();
}

class _PortsCanvasState extends State<PortsCanvas> with SingleTickerProviderStateMixin {
  late final Ticker _ticker = createTicker(_tick);
  final _repaint = ValueNotifier(0);
  PortsModel? _model;
  Duration _start = Duration.zero;
  int _startFrame = 0;

  @override
  void initState() {
    super.initState();
    widget.controller._state = this;
  }

  @override
  void dispose() {
    if (widget.controller._state == this) widget.controller._state = null;
    _ticker.dispose();
    _repaint.dispose();
    super.dispose();
  }

  void _tick(Duration elapsed) {
    final model = _model;
    if (model == null) return;
    final target = _startFrame + (elapsed - _start).inMicroseconds ~/ LoginStyle.frame.inMicroseconds;
    if (target <= model.frame) return;
    while (model.frame < target) {
      model.step();
    }
    _repaint.value++;
  }

  void _burst() {
    final model = _model;
    if (model == null || model.reduced) return; // 減少動態效果時只畫一幀，看不到擴散（和現在一樣）
    model.burst();
    _repaint.value++;
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final reduced = MediaQuery.disableAnimationsOf(context);
        final size = box.biggest;
        final old = _model;
        // 尺寸或可用範圍改變時重新開始（ports-canvas 的 paint() 在視窗大小改變時重畫）
        if (old == null || old.width != size.width || old.height != size.height || old.reduced != reduced || _bandChanged(old)) {
          _model = PortsModel(size.width, size.height, reduced: reduced, top: widget.top, bottom: widget.bottom)..step();
          _ticker.stop();
          if (!reduced) {
            _start = Duration.zero;
            _startFrame = 1;
            _ticker.start();
          }
        }
        return RepaintBoundary(child: CustomPaint(size: size, painter: _PortsPainter(_model!, _repaint)));
      });

  bool _bandChanged(PortsModel m) {
    final fresh = PortsModel(m.width, m.height, top: widget.top, bottom: widget.bottom);
    return fresh.bandTop != m.bandTop || fresh.bandBottom != m.bandBottom;
  }
}

class _PortsPainter extends CustomPainter {
  _PortsPainter(this.model, Listenable repaint) : super(repaint: repaint);
  final PortsModel model;
  static final _labels = <String, TextPainter>{};

  TextPainter _label(String name) => _labels.putIfAbsent(
      name,
      () => TextPainter(
            text: TextSpan(text: name, style: const TextStyle(fontSize: LoginStyle.portLabelSize, fontWeight: FontWeight.w400, color: LoginStyle.portLabel, fontFamily: fontFamily, fontFamilyFallback: fontFallback)),
            textDirection: TextDirection.ltr,
          )..layout());

  @override
  void paint(Canvas canvas, Size size) {
    final m = model, pos = m.positions(), width = m.width;
    final line = Paint()
      ..color = LoginStyle.portLine
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    for (final (a, b) in links) {
      canvas.drawLine(pos[a], pos[b], line);
    }
    if (!m.reduced) {
      for (final p in m.pulsePositions(pos)) {
        canvas.drawCircle(p, 6, Paint()..color = LoginStyle.pulseHalo);
        canvas.drawCircle(p, 2.2, Paint()..color = LoginStyle.pulseDot);
      }
    }
    for (final (i, (name, _, _, place)) in ports.indexed) {
      final p = pos[i], breathe = m.reduced ? 0.0 : math.sin(m.frame / 60 + i * 1.3) * 1.5;
      canvas.drawCircle(p, 11 + breathe, Paint()..color = LoginStyle.nodeHalo);
      canvas.drawCircle(p, 3.5, Paint()..color = LoginStyle.node);
      // fillText 的 y 是基線；靠右的口岸把名字寫在節點左邊
      final text = _label(name), w = text.width, base = text.computeDistanceToActualBaseline(TextBaseline.alphabetic);
      final left = p.dx > width * .7;
      final (x, y) = switch (place) {
        'right' => (p.dx + 16, p.dy + 4),
        'above' => (math.max(p.dx, w / 2 + 4) - w / 2, p.dy - 16),
        'below' => (math.max(p.dx, w / 2 + 4) - w / 2, p.dy + 26),
        _ => (left ? p.dx - 14 - w : p.dx + 14, p.dy - 10),
      };
      text.paint(canvas, Offset(x, y - base));
    }
    final k = m.burstProgress();
    if (k != null) {
      canvas.drawCircle(
        Offset(width / 2, m.height * .7),
        k * math.max(width, m.height),
        Paint()
          ..color = LoginStyle.burstColor.withValues(alpha: 1 - k)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }
  }

  @override
  bool shouldRepaint(_PortsPainter old) => old.model != model;
}
