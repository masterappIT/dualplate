// 印章：雙線圓章，完成類狀態用。play 為 true 時播「蓋章」動效：放大 → 壓下 → 墨色落定。
// 照抄 mobile/src/components/StampMark.vue。
import 'dart:math' as math;
import 'package:flutter/widgets.dart';
import '../ui/tokens.dart';
import 'css.dart';

class StampMark extends StatefulWidget {
  const StampMark({super.key, this.text = '已辦好', this.tone = 'ok', this.play = false});
  final String text;
  final String tone; // ok、jade、overdue；其他值沒有對應類別，沿用頁面字色
  final bool play;

  static Color colorOf(String tone) => switch (tone) { 'ok' => C.ok, 'jade' => C.jade, 'overdue' => C.overdue, _ => C.ink };

  // animation: stamp .52s cubic-bezier(.2,.9,.25,1.2) both
  static const duration = Duration(milliseconds: 520);
  static const curve = Cubic(.2, .9, .25, 1.2);
  static const restOpacity = .88;

  // CSS 的 animation-timing-function 用在每兩個關鍵影格之間：
  // scale 0%:1.9 → 55%:.92 → 75%:1.04 → 100%:1；opacity 0%:0 → 55%:1 → 100%:.88（75% 沒寫 opacity）
  static double _seg(double t, List<(double, double)> frames) {
    for (var i = 0; i < frames.length - 1; i++) {
      final (a, va) = frames[i];
      final (b, vb) = frames[i + 1];
      if (t <= b) return va + (vb - va) * curve.transform(((t - a) / (b - a)).clamp(0.0, 1.0));
    }
    return frames.last.$2;
  }

  static double scaleAt(double t) => _seg(t, const [(0, 1.9), (.55, .92), (.75, 1.04), (1, 1)]);
  // 曲線會衝過頭（y 到 1.2），瀏覽器把 opacity 限制在 0–1
  static double opacityAt(double t) => _seg(t, const [(0, 0), (.55, 1), (1, restOpacity)]).clamp(0.0, 1.0);

  @override
  State<StampMark> createState() => _StampMarkState();
}

class _StampMarkState extends State<StampMark> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: StampMark.duration, value: 1);

  @override
  void initState() {
    super.initState();
    if (widget.play) _c.forward(from: 0);
  }

  @override
  void didUpdateWidget(StampMark old) {
    super.didUpdateWidget(old);
    if (widget.play && !old.play) _c.forward(from: 0);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = StampMark.colorOf(widget.tone);
    // prefers-reduced-motion:reduce 時不播
    final animate = widget.play && !MediaQuery.disableAnimationsOf(context);
    // .stamp：56×56 圓、padding 3、2px 邊框；.ring：1px 邊框；字 12、900、字距 1
    final stamp = Container(
      width: 56,
      height: 56,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: color, width: 2)),
      child: Container(
        alignment: Alignment.center,
        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: color, width: 1)),
        child: Text(widget.text,
            maxLines: 1,
            softWrap: false,
            overflow: TextOverflow.visible,
            textScaler: TextScaler.noScaling,
            style: ts(Fs.cap, weight: FontWeight.w900, color: color, letterSpacing: 1).copyWith(fontFamily: appSystemFont)),
      ),
    );
    return Semantics(
      label: widget.text,
      excludeSemantics: true,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, child) {
          final t = animate ? _c.value : 1.0;
          return Opacity(
            opacity: animate ? StampMark.opacityAt(t) : StampMark.restOpacity,
            child: Transform(
              alignment: Alignment.center,
              transform: Matrix4.rotationZ(-12 * math.pi / 180)..multiply(Matrix4.diagonal3Values(StampMark.scaleAt(t), StampMark.scaleAt(t), 1)),
              child: child,
            ),
          );
        },
        child: stamp,
      ),
    );
  }
}
