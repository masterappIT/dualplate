// 把 mobile/ 組件裏 Flutter 沒有直接對應的 CSS 效果照樣畫出來：rpx 換算、box-shadow（含 inset）、
// 有角度的 linear-gradient、text-shadow 的模糊半徑。只給 lib/business/ 的組件用。
import 'dart:math' as math;
import 'package:flutter/widgets.dart';

// rpx：uni-app App 版把 rpx 換成 rem，根字號 = 視窗寬 / 23.4375，即 1rpx = 視窗寬 / 750，不取整。
// 視窗寬超過 960（rpxCalcMaxDeviceWidth）時按 375 計（uni-app-view 的 Mi()）。
double rpxUnit(BuildContext context) {
  final w = MediaQuery.sizeOf(context).width;
  return (w <= 960 ? w : 375) / 750;
}

// uni.upx2px：結果向下取整（login.vue 的 toRpx 用它把 px 換回 rpx）
double upx2px(double rpx, double unit) {
  if (rpx == 0) return 0;
  final r = (rpx * unit).abs() + 1e-4;
  final v = r.floorToDouble();
  return v == 0 ? .5 : v;
}

// JS 的 (x).toFixed(1) 後再當數字用
double fixed1(double x) => double.parse(x.toStringAsFixed(1));

// 一個 CSS 陰影：x y blur spread color，inset 表示內陰影
class CssShadow {
  const CssShadow(this.dy, this.blur, this.color, {this.dx = 0, this.spread = 0, this.inset = false});
  final double dx, dy, blur, spread;
  final Color color;
  final bool inset;
}

// CSS 的模糊半徑 = 高斯標準差的兩倍
double cssSigma(double blur) => blur / 2;

// text-shadow → Flutter Shadow：Flutter 用 blurRadius*0.57735+0.5 作標準差，要反推才和 CSS 一樣；
// CSS 第一個陰影在最上層，Flutter 先畫的在下層，所以倒序。
List<Shadow> cssTextShadows(List<CssShadow> list) => [
      for (final s in list.reversed)
        Shadow(offset: Offset(s.dx, s.dy), color: s.color, blurRadius: s.blur <= 0 ? 0 : math.max(0.0001, (cssSigma(s.blur) - .5) / .57735)),
    ];

// 有角度的 linear-gradient：角度 0 向上、順時針；漸變線長度 |W·sinθ|+|H·cosθ|，經過中心
LinearGradient cssLinear(double deg, List<Color> colors, List<double> stops, Size size) {
  final a = deg * math.pi / 180;
  final dir = Offset(math.sin(a), -math.cos(a));
  final len = (size.width * math.sin(a)).abs() + (size.height * math.cos(a)).abs();
  final ax = size.width == 0 ? 0.0 : dir.dx * len / size.width, ay = size.height == 0 ? 0.0 : dir.dy * len / size.height;
  return LinearGradient(begin: Alignment(-ax, -ay), end: Alignment(ax, ay), colors: colors, stops: stops);
}

// 外陰影：只畫在盒子外面（CSS 不在盒內畫外陰影）；清單倒序畫，第一個在最上層
void paintOuterShadows(Canvas canvas, RRect box, List<CssShadow> shadows) {
  final outer = shadows.where((s) => !s.inset).toList().reversed;
  if (outer.isEmpty) return;
  canvas.save();
  final big = box.outerRect.inflate(1000);
  canvas.clipPath(Path.combine(PathOperation.difference, Path()..addRect(big), Path()..addRRect(box)));
  for (final s in outer) {
    final paint = Paint()..color = s.color;
    if (s.blur > 0) paint.maskFilter = MaskFilter.blur(BlurStyle.normal, cssSigma(s.blur));
    canvas.drawRRect(_spread(box, s.spread).shift(Offset(s.dx, s.dy)), paint);
  }
  canvas.restore();
}

// 內陰影：畫在內距框（邊框以內）裏、背景之上、邊框和內容之下
void paintInsetShadows(Canvas canvas, RRect padding, List<CssShadow> shadows) {
  final inner = shadows.where((s) => s.inset).toList().reversed;
  if (inner.isEmpty) return;
  canvas.save();
  canvas.clipRRect(padding);
  for (final s in inner) {
    final hole = _spread(padding, -s.spread).shift(Offset(s.dx, s.dy));
    final path = Path.combine(PathOperation.difference, Path()..addRect(padding.outerRect.inflate(s.blur * 2 + s.spread.abs() + 50)), Path()..addRRect(hole));
    final paint = Paint()..color = s.color;
    if (s.blur > 0) paint.maskFilter = MaskFilter.blur(BlurStyle.normal, cssSigma(s.blur));
    canvas.drawPath(path, paint);
  }
  canvas.restore();
}

RRect _spread(RRect r, double s) {
  if (s == 0) return r;
  Radius g(Radius x) => Radius.elliptical(math.max(0, x.x + s), math.max(0, x.y + s));
  return RRect.fromLTRBAndCorners(r.left - s, r.top - s, r.right + s, r.bottom + s,
      topLeft: g(r.tlRadius), topRight: g(r.trRadius), bottomLeft: g(r.blRadius), bottomRight: g(r.brRadius));
}

// 一個絕對定位的 CSS 盒子：背景（顏色或漸變）、圓角、邊框、外陰影、內陰影
class CssBoxPainter extends CustomPainter {
  CssBoxPainter({this.radius = 0, this.color, this.gradient, this.borderWidth = 0, this.borderColor, this.shadows = const [], this.circle = false});
  final double radius, borderWidth;
  final Color? color, borderColor;
  final Gradient Function(Size size)? gradient;
  final List<CssShadow> shadows;
  final bool circle; // border-radius:50%

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final box = circle ? RRect.fromRectAndRadius(rect, Radius.elliptical(size.width / 2, size.height / 2)) : RRect.fromRectAndRadius(rect, Radius.circular(radius));
    paintOuterShadows(canvas, box, shadows);
    if (color != null || gradient != null) {
      final paint = Paint();
      if (gradient != null) {
        paint.shader = gradient!(size).createShader(rect);
      } else {
        paint.color = color!;
      }
      canvas.drawRRect(box, paint);
    }
    final padding = box.deflate(borderWidth);
    paintInsetShadows(canvas, padding, shadows);
    if (borderWidth > 0 && borderColor != null) {
      canvas.drawDRRect(box, padding, Paint()..color = borderColor!);
    }
  }

  @override
  bool shouldRepaint(CssBoxPainter old) => true;
}

// 只為了好寫：一個指定大小、用 CssBoxPainter 畫的盒子
class CssBox extends StatelessWidget {
  const CssBox({super.key, required this.painter, this.child});
  final CssBoxPainter painter;
  final Widget? child;
  @override
  Widget build(BuildContext context) => CustomPaint(painter: painter, child: child ?? const SizedBox.expand());
}

// App.vue 的 font-family 第一項是 -apple-system：英文數字用系統字（SF），中文才落到 PingFang TC。
// '.AppleSystemUIFont' 和 WebView 的 -apple-system 同一個字（2026-11-15 在模擬器比過：短橫形狀、粗細相同；
// 'CupertinoSystemText' 的短橫較長，不用）。Android 沒有這個名字，會照 fontFamilyFallback 往下找。
const appSystemFont = '.AppleSystemUIFont';

// WebView 的行高向下取整到整數 px（2026-11-15 量現有 App 首頁的到期徽章：14px×1.4 的日期行和 13px×1.4 的天數行
// 加 2px 間距共 39px，即 19+2+18；Flutter 不取整時是 39.8）。回傳給 TextStyle.height 的倍數。
double cssLineHeight(double size, double lineHeight) => (size * lineHeight + 1e-6).floorToDouble() / size;
