// 首頁鈴鐺：照抄 mobile/src/static/bell.svg（viewBox 24、描邊 #0F5C4A、線寬 2、圓頭圓角，不填色）
import 'package:flutter/widgets.dart';
import '../../ui/tokens.dart';
import '../login/svg_icon.dart' show parseSvgPath;

const bellPaths = ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'];

class BellIcon extends StatelessWidget {
  const BellIcon({super.key, this.size = 20});
  final double size;
  @override
  Widget build(BuildContext context) => SizedBox(width: size, height: size, child: const CustomPaint(painter: _BellPainter()));
}

class _BellPainter extends CustomPainter {
  const _BellPainter();
  static final _paths = [for (final d in bellPaths) parseSvgPath(d)];
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = C.jade
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..isAntiAlias = true;
    canvas
      ..save()
      ..scale(size.width / 24, size.height / 24);
    for (final p in _paths) {
      canvas.drawPath(p, paint);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_BellPainter old) => false;
}
