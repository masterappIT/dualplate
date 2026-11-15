// 三款仿真車牌：照抄 mobile/src/components/MainlandPlate.vue、HongKongPlate.vue、MacauPlate.vue（負責人按管理者意見的設計，
// AGENTS.md 受保護；比例和字形必須照舊）。
// width 和原組件一樣以 rpx 計（預設 600），其餘尺寸都按它的比例；widthPx 給登入頁用（login.vue 把 px 用 toRpx 換成 rpx）。
// textScale 只縮字；relief 加立體壓印效果（字和框凸起、邊緣斜角、反光），登入頁的樣板用；預設是平面圖。
// 原組件 margin:0 auto（在一般區塊裏置中）：呼叫處要置中時自己包 Center。
import 'dart:math' as math;
import 'package:flutter/widgets.dart';
import '../ui/tokens.dart';
import 'css.dart';

// 原組件的 px(ratio) = (width*ratio).toFixed(1) + 'rpx'
class _Scale {
  _Scale(BuildContext context, double width, double? widthPx)
      : unit = rpxUnit(context),
        w = widthPx == null ? width : widthPx * 10000 / upx2px(10000, rpxUnit(context));
  final double unit, w;
  double px(double ratio) => fixed1(w * ratio) * unit;
  double rpx(double v) => v * unit;
}

const _darkGradient = LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [PlateC.darkTop, PlateC.darkMid, PlateC.darkBottom], stops: [0, .45, 1]);
const _hkGradient = LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [PlateC.hkTop, PlateC.hkMid, PlateC.hkBottom], stops: [0, .55, 1]);
// 鉚釘、螺絲：radial-gradient(circle at 35% 35%, 淺 , 深 70%)；circle 的預設半徑是到最遠角（0.65√2 個直徑）
RadialGradient _rivet(Color light, Color dark) => RadialGradient(center: const Alignment(-.3, -.3), radius: .65 * math.sqrt2, colors: [light, dark], stops: const [0, .7]);

// 反光 .sheen：linear-gradient(160deg, 白 a0 0%, 白 a1 34%, 透明 36%)
class _SheenPainter extends CustomPainter {
  _SheenPainter(this.a, this.b);
  final Color a, b;
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(rect, Paint()..shader = cssLinear(160, [a, b, PlateC.white0], const [0, .34, .36], size).createShader(rect));
  }
  @override
  bool shouldRepaint(_SheenPainter old) => old.a != a || old.b != b;
}

// 一個車牌字：line-height:1、white-space:nowrap、transform:scaleX、-webkit-text-stroke（先填色後描邊）、text-shadow；
// 字比字位寬時兩邊平均溢出（flex 置中、overflow:visible）。
class _Glyph extends StatelessWidget {
  const _Glyph(this.char, {required this.family, required this.fallback, required this.size, required this.color, required this.stroke, required this.scaleX, required this.shadows});
  final String char, family;
  final List<String> fallback;
  final double size, stroke, scaleX;
  final Color color;
  final List<CssShadow> shadows;

  TextStyle _style({Color? color, Paint? foreground, List<Shadow>? shadows}) => TextStyle(
        fontFamily: family,
        fontFamilyFallback: fallback,
        fontSize: size,
        fontWeight: FontWeight.w700,
        height: 1,
        leadingDistribution: TextLeadingDistribution.even,
        color: color,
        foreground: foreground,
        shadows: shadows,
        decoration: TextDecoration.none,
      );

  @override
  Widget build(BuildContext context) {
    Text t(TextStyle s) => Text(char, style: s, maxLines: 1, softWrap: false, textScaler: TextScaler.noScaling);
    return OverflowBox(
      maxWidth: double.infinity,
      maxHeight: double.infinity,
      child: Transform(
        alignment: Alignment.center,
        transform: Matrix4.diagonal3Values(scaleX, 1, 1),
        child: Stack(children: [
          t(_style(color: color, shadows: cssTextShadows(shadows))),
          if (stroke > 0)
            t(_style(foreground: Paint()
              ..style = PaintingStyle.stroke
              ..strokeWidth = stroke
              ..color = color)),
        ]),
      ),
    );
  }
}

// 外框：外陰影、漸變底、內陰影畫在盒子上；裏面的東西按 overflow:hidden 和圓角裁切
Widget _plateBox({required double width, required double height, required double radius, required Gradient gradient, required List<CssShadow> shadows, required List<Widget> children}) => SizedBox(
      width: width,
      height: height,
      child: CustomPaint(
        painter: CssBoxPainter(radius: radius, gradient: (_) => gradient, shadows: shadows),
        child: ClipRRect(borderRadius: BorderRadius.circular(radius), child: Stack(clipBehavior: Clip.none, children: children)),
      ),
    );

Widget _round(double left, double? top, double? bottom, double size, Gradient g, Color ring, double ringWidth) => Positioned(
      left: left,
      top: top,
      bottom: bottom,
      width: size,
      height: size,
      child: CssBox(painter: CssBoxPainter(circle: true, gradient: (_) => g, shadows: [CssShadow(0, 0, ring, spread: ringWidth)])),
    );

// ───────────────────────── 內地牌 ─────────────────────────
// 按 GA 36—2018 港澳入出境號牌 440×140 mm：七個 45×90 mm 字、間隔 12 mm，第二字後 34 mm 放分隔點。
class MainlandPlate extends StatelessWidget {
  const MainlandPlate({super.key, this.plate = '', this.width = 600, this.widthPx, this.textScale = 1, this.relief = false});
  final String plate;
  final double width;
  final double? widthPx;
  final double textScale;
  final bool relief;

  static const _mm = 440.0;
  static const _lefts = [15.5, 72.5, 151.5, 208.5, 265.5, 322.5, 379.5];

  // 大寫、去掉空格和 ·•.-、開頭簡體「粤」改「粵」
  static String normalize(String plate) => plate.toUpperCase().replaceAll(RegExp(r'[\s·•.\-]'), '').replaceFirst(RegExp('^粤'), '粵');
  // 粵 + 一個字母 + 四個字母或數字 + 港／澳，共七字；不符合時整串置中顯示
  static List<String> charsOf(String text) {
    final m = RegExp(r'^([粵])([A-Z])([A-Z0-9]{4})([港澳])$').firstMatch(text);
    return m == null ? const [] : [m[1]!, m[2]!, ...m[3]!.split(''), m[4]!];
  }

  static bool _isHan(String c) => RegExp('[一-鿿]').hasMatch(c);

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final s = _Scale(context, width, widthPx);
        final w = math.min(s.px(1), box.maxWidth), h = s.px(140 / _mm), radius = s.px(.015);
        final text = normalize(plate), chars = charsOf(text);
        final shadows = relief
            ? [CssShadow(s.px(.014), s.px(.024), PlateC.black55), CssShadow(s.px(.004), 0, PlateC.black), CssShadow(s.px(.006), 0, PlateC.white32, inset: true), CssShadow(-s.px(.007), 0, PlateC.black70, inset: true)]
            : [CssShadow(s.rpx(3), s.rpx(8), PlateC.black28), CssShadow(s.rpx(1), 0, PlateC.white18, inset: true)];
        final raised = relief ? [CssShadow(-s.px(.004), 0, PlateC.white45), CssShadow(s.px(.008), s.px(.008), PlateC.black95)] : [CssShadow(s.rpx(1), 0, PlateC.white20)];
        final rimInset = s.px(.008);
        return Semantics(
          label: '內地車牌 $text',
          excludeSemantics: true,
          child: _plateBox(width: w, height: h, radius: radius, gradient: _darkGradient, shadows: shadows, children: [
            Positioned(
              left: rimInset,
              top: rimInset,
              right: rimInset,
              bottom: rimInset,
              child: CssBox(
                  painter: CssBoxPainter(
                      radius: s.px(.01),
                      borderWidth: s.px(.005),
                      borderColor: PlateC.rim,
                      shadows: relief ? [CssShadow(s.px(.006), s.px(.007), PlateC.black90), CssShadow(s.px(.006), s.px(.007), PlateC.black90, inset: true)] : const [])),
            ),
            if (relief) Positioned.fill(child: CustomPaint(painter: _SheenPainter(PlateC.white20, PlateC.white06))),
            for (final (left, top) in const [(.182, true), (.796, true), (.182, false), (.796, false)])
              _round(w * left - s.px(.009), top ? h * .065 : null, top ? null : h * .065, s.px(.018), _rivet(PlateC.rivetLight, PlateC.rivetDark), PlateC.rivetRing, s.rpx(1)),
            if (chars.length == 7) ...[
              for (final (i, c) in chars.indexed)
                Positioned(
                  left: _lefts[i] / _mm * w,
                  width: 45 / _mm * w,
                  top: h * .179,
                  height: h * .643,
                  child: Center(
                    child: _isHan(c)
                        ? _Glyph(c, family: plateHanFont, fallback: plateHanFallback, size: s.px(.197 * textScale), color: PlateC.whiteText, stroke: s.px(.0025 * textScale), scaleX: .56, shadows: raised)
                        : _Glyph(c, family: plateLatinFont, fallback: plateLatinFallback, size: s.px(.277 * textScale), color: PlateC.whiteText, stroke: s.px(.0034 * textScale), scaleX: .66, shadows: raised),
                  ),
                ),
              Positioned(
                left: w * .3057 - s.px(.0115),
                top: h * .5 - s.px(.0115),
                width: s.px(.023),
                height: s.px(.023),
                child: CssBox(painter: CssBoxPainter(circle: true, color: PlateC.whiteText)),
              ),
            ] else
              Positioned.fill(
                child: Center(
                  child: Text(text,
                      maxLines: 1,
                      softWrap: false,
                      overflow: TextOverflow.visible,
                      textScaler: TextScaler.noScaling,
                      style: ts(s.px(.1), weight: w700, color: PlateC.whiteText).copyWith(fontFamily: appSystemFont)),
                ),
              ),
          ]),
        );
      });
}

// ───────────────────────── 香港牌 ─────────────────────────
// 《道路交通（車輛登記及領牌）規例》附表 4 後牌：520×111 mm 黃色反光底黑字，字高約 79 mm、寬 50 mm、
// 字距 11 mm，字母組和數字組之間較寬。
class HongKongPlate extends StatelessWidget {
  const HongKongPlate({super.key, this.plate = '', this.width = 600, this.widthPx, this.textScale = 1, this.relief = false});
  final String plate;
  final double width;
  final double? widthPx;
  final double textScale;
  final bool relief;

  static const _plate = 520.0, _char = 52.0, _gap = 10.0, _groupGap = 30.0;

  static String normalize(String plate) => plate.toUpperCase().replaceAll(RegExp(r'\s+'), '');

  // 每個字的 left 和 width（佔車牌寬的比例）：0–2 個字母一組、1–4 個數字一組，置中；其他字串整串一組
  static List<({String char, double left, double width})> slotsOf(String text) {
    final m = RegExp(r'^([A-Z]{0,2})([0-9]{1,4})$').firstMatch(text);
    final groups = m != null ? [m[1]!, m[2]!].where((g) => g.isNotEmpty).toList() : [text];
    final chars = [
      for (final (g, group) in groups.indexed)
        for (final (i, c) in group.split('').indexed) (char: c, gapBefore: i == 0 ? (g == 0 ? 0.0 : _groupGap) : _gap),
    ];
    final total = chars.fold(0.0, (sum, c) => sum + _char + c.gapBefore);
    var x = (_plate - total) / 2;
    final out = <({String char, double left, double width})>[];
    for (final c in chars) {
      x += c.gapBefore;
      out.add((char: c.char, left: x / _plate, width: _char / _plate));
      x += _char;
    }
    return out;
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final s = _Scale(context, width, widthPx);
        final w = math.min(s.px(1), box.maxWidth), h = s.px(111 / _plate), radius = s.px(.013);
        final text = normalize(plate);
        final shadows = relief
            ? [CssShadow(s.px(.01), s.px(.016), PlateC.black50), CssShadow(s.px(.003), 0, PlateC.hkShade90), CssShadow(s.px(.004), 0, PlateC.white75, inset: true), CssShadow(-s.px(.005), 0, PlateC.hkShade55, inset: true)]
            : [CssShadow(s.rpx(3), s.rpx(8), PlateC.black22), CssShadow(s.rpx(1), 0, PlateC.white55, inset: true)];
        final raised = relief ? [CssShadow(-s.px(.003), 0, PlateC.white60), CssShadow(s.px(.005), s.px(.005), PlateC.hkShade60)] : const <CssShadow>[];
        final screw = s.px(.018);
        return Semantics(
          label: '香港車牌 $text',
          excludeSemantics: true,
          child: _plateBox(width: w, height: h, radius: radius, gradient: _hkGradient, shadows: shadows, children: [
            Positioned.fill(child: CssBox(painter: CssBoxPainter(radius: s.px(.013), borderWidth: s.rpx(2), borderColor: PlateC.hkEdge))),
            if (relief) Positioned.fill(child: CustomPaint(painter: _SheenPainter(PlateC.white40, PlateC.white12))),
            _round(w * .05, h * .09, null, screw, _rivet(PlateC.screwLight, PlateC.screwDark), PlateC.screwRing, s.rpx(1)),
            _round(w - w * .05 - screw, h * .09, null, screw, _rivet(PlateC.screwLight, PlateC.screwDark), PlateC.screwRing, s.rpx(1)),
            for (final slot in slotsOf(text))
              Positioned(
                left: slot.left * w,
                width: slot.width * w,
                top: h * .1,
                height: h * .8,
                child: Center(
                    child: _Glyph(slot.char,
                        family: plateArialFont, fallback: plateArialFallback, size: s.px(.225 * textScale), color: PlateC.hkText, stroke: s.px(.005 * textScale), scaleX: .86, shadows: raised)),
              ),
          ]),
        );
      });
}

// ───────────────────────── 澳門牌 ─────────────────────────
// 畫法同香港牌：黑底白字，三組字用短橫分開（MA-12-34），銀色細框；大小、字號、字距、描邊和香港牌相同（520×111）。
class MacauPlate extends StatelessWidget {
  const MacauPlate({super.key, this.plate = '', this.width = 600, this.widthPx, this.textScale = 1, this.relief = false});
  final String plate;
  final double width;
  final double? widthPx;
  final double textScale;
  final bool relief;

  static const _plate = 520.0, _char = 52.0, _gap = 10.0, _dash = 18.0;

  static String normalize(String plate) => plate.toUpperCase().replaceAll(RegExp(r'[\s\-]'), '');
  static List<String> groupsOf(String text) {
    final m = RegExp(r'^([A-Z]{1,2})(\d{2})(\d{2})$').firstMatch(text);
    return m == null ? [text] : [m[1]!, m[2]!, m[3]!];
  }

  // 顯示用（aria-label）：MA-12-34
  static String shown(String plate) => groupsOf(normalize(plate)).join('-');

  // 每格的 left、width（比例）；dash 為 true 時是短橫
  static List<({String char, bool dash, double left, double width})> slotsOf(String text) {
    final items = [
      for (final (g, group) in groupsOf(text).indexed) ...[
        if (g > 0) (char: '', dash: true, size: _dash),
        for (final c in group.split('')) (char: c, dash: false, size: _char),
      ],
    ];
    var total = 0.0;
    for (final (i, item) in items.indexed) { total += item.size + (i > 0 ? _gap : 0); }
    var x = (_plate - total) / 2;
    final out = <({String char, bool dash, double left, double width})>[];
    for (final (i, item) in items.indexed) {
      if (i > 0) x += _gap;
      out.add((char: item.char, dash: item.dash, left: x / _plate, width: item.size / _plate));
      x += item.size;
    }
    return out;
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final s = _Scale(context, width, widthPx);
        final w = math.min(s.px(1), box.maxWidth), h = s.px(111 / _plate), radius = s.px(.013);
        final text = normalize(plate);
        final shadows = relief
            ? [CssShadow(s.px(.01), s.px(.016), PlateC.black55), CssShadow(s.px(.003), 0, PlateC.black), CssShadow(s.px(.004), 0, PlateC.white30, inset: true), CssShadow(-s.px(.005), 0, PlateC.black70, inset: true)]
            : [CssShadow(s.rpx(3), s.rpx(8), PlateC.black28), CssShadow(s.rpx(1), 0, PlateC.white18, inset: true)];
        final raised = relief ? [CssShadow(-s.px(.003), 0, PlateC.white45), CssShadow(s.px(.005), s.px(.005), PlateC.black95)] : const <CssShadow>[];
        final edge = s.px(.012), screw = s.px(.016);
        return Semantics(
          label: '澳門車牌 ${groupsOf(text).join('-')}',
          excludeSemantics: true,
          child: _plateBox(width: w, height: h, radius: radius, gradient: _darkGradient, shadows: shadows, children: [
            Positioned(
              left: edge,
              top: edge,
              right: edge,
              bottom: edge,
              child: CssBox(
                  painter: CssBoxPainter(
                      radius: s.px(.009),
                      borderWidth: s.px(.004),
                      borderColor: PlateC.moEdge,
                      shadows: relief ? [CssShadow(s.px(.004), s.px(.005), PlateC.black90), CssShadow(s.px(.004), s.px(.005), PlateC.black90, inset: true)] : const [])),
            ),
            if (relief) Positioned.fill(child: CustomPaint(painter: _SheenPainter(PlateC.white20, PlateC.white06))),
            _round(w * .04, h * .12, null, screw, _rivet(PlateC.rivetLight, PlateC.rivetDark), PlateC.rivetRing, s.rpx(1)),
            _round(w - w * .04 - screw, h * .12, null, screw, _rivet(PlateC.rivetLight, PlateC.rivetDark), PlateC.rivetRing, s.rpx(1)),
            for (final slot in slotsOf(text))
              Positioned(
                left: slot.left * w,
                width: slot.width * w,
                top: h * .1,
                height: h * .8,
                child: Center(
                  child: slot.dash
                      ? SizedBox(
                          width: slot.width * w,
                          height: s.px(.016),
                          child: CssBox(
                              painter: CssBoxPainter(
                                  radius: s.rpx(1), color: PlateC.whiteText, shadows: relief ? [CssShadow(s.px(.005), s.px(.005), PlateC.black95)] : const [])))
                      : _Glyph(slot.char,
                          family: plateArialFont, fallback: plateArialFallback, size: s.px(.225 * textScale), color: PlateC.whiteText, stroke: s.px(.005 * textScale), scaleX: .86, shadows: raised),
                ),
              ),
          ]),
        );
      });
}
