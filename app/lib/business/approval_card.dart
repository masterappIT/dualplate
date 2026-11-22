// 批文卡：照抄 mobile/src/components/ApprovalCard.vue（AGENTS.md：批文卡的呈現不得改動）。
// 卡面底圖是 static/approval-card/front.svg、back.svg 用 Chrome 照原尺寸 2 倍轉成的 PNG（assets/approval_card/，轉法見 tool/card_png.sh）；
// 文字層的位置、字號全部是卡寬的百分比（CSS 的 cqw），用 LayoutBuilder 按卡寬換算。
// 卡上的字是批文卡原件的印刷字（簡體），照原組件不改。
// 階段 5b 管理者決定（2026-11-23，「文字不夠真實」）：字體、粗細、字距改成照真卡，位置不變——
//   正面：欄名改細宋體、字均勻拉開到冒號對齊；簽發機關改細字；商號最多兩行；内承单位和商號一樣大。
//   背面：資料和欄名改黑體（iOS 蘋方、Android 系統黑體），欄名字均勻拉開到冒號對齊。
//   現有 App 和網頁的 ApprovalCard.vue 不改。
// 翻面：perspective 1200px，rotateY 180°，.65s cubic-bezier(.22,.67,.22,1)；背面 backface-visibility:hidden。
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import '../ui/tokens.dart';
import 'css.dart';

// 卡面的固定字（tool/song_subset.py 從這裏收集宋體子集的粗體字）
const approvalCardTitle = '粤港澳机动车辆往来及驾驶人驾车批准通知书';
const approvalCardIssuer = '广东省公安厅交通管理局';
const approvalCardWarning = '驾驶人仅允许驾驶与本人驾驶证准驾车型相符车辆';
const approvalCardLabels = [
  '编　　号:', '商　　号:', '内承单位:', '通行口岸:', '签发机关:',
  '内地车牌号:', '港澳车牌号:', '驾　驶　人:', '1.', '2.', '3.', '现批文号:', '原批文号:', '颜　　色:', '座位/吨位:', '请予办理:', '有　效　期:', '备　　注:',
];

class ApprovalCard extends StatefulWidget {
  const ApprovalCard({super.key, required this.data, this.back = false, this.flipOnTap = true, this.tapLabel = '', this.showControls = true, this.onCardTap, this.onFlip, this.face = const ApprovalFace()});
  final Map data;
  final bool back;
  final bool flipOnTap;
  final String tapLabel;
  // 牌照詳情頁用 :deep(.flip-controls){display:none} 藏起正面／背面鈕
  final bool showControls;
  final VoidCallback? onCardTap;
  final ValueChanged<bool>? onFlip;
  // 卡面圓角和陰影：預設照 .approval-face；牌照頁的卡疊用 :deep(.approval-face) 另給（3a）
  final ApprovalFace face;

  // validity(a,b)：兩個都有用「-」連起，日期的「-」換成「.」。
  // 階段 5b 管理者決定（2026-11-23）：照真卡用短的「-」（原組件是長的「–」，蘋方裏顯示得像「一」）
  static String date(Object? value) => (value == null ? '' : '$value').replaceAll('-', '.');
  static String validity(Object? a, Object? b) {
    bool has(Object? v) => v != null && '$v'.isNotEmpty;
    return has(a) && has(b) ? '${date(a)}-${date(b)}' : date(has(a) ? a : b);
  }

  @override
  State<ApprovalCard> createState() => _ApprovalCardState();
}

class _ApprovalCardState extends State<ApprovalCard> with SingleTickerProviderStateMixin {
  // CSS transition：每次切換由「目前顯示的角度」轉到新角度（0 或 1＝180°），時長 .65s，套 cubic-bezier。
  // 不可用 late 延遲初始化：詳情頁沒有在畫面上讀 flipped，第一次讀會是在收到新的 back 之後，翻轉就被略過
  bool flipped = false;
  double from = 0, to = 0;
  late final AnimationController run;

  @override
  void initState() {
    super.initState();
    flipped = widget.back;
    from = to = widget.back ? 1 : 0;
    run = AnimationController(vsync: this, duration: ApprovalCardStyle.flip, value: 1);
  }

  double get shown => from + (to - from) * ApprovalCardStyle.flipCurve.transform(run.value);

  @override
  void didUpdateWidget(ApprovalCard old) {
    super.didUpdateWidget(old);
    if (old.back != widget.back) _show(widget.back);
  }

  @override
  void dispose() {
    run.dispose();
    super.dispose();
  }

  void _show(bool back) {
    if (back == flipped) return;
    flipped = back;
    from = shown;
    to = back ? 1 : 0;
    // prefers-reduced-motion 時沒有動畫
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      run.value = 1;
    } else {
      run.forward(from: 0);
    }
    setState(() {});
  }

  void _toggle() {
    if (widget.flipOnTap) {
      _show(!flipped);
      widget.onFlip?.call(flipped);
    }
    widget.onCardTap?.call();
  }

  @override
  Widget build(BuildContext context) {
    final unit = rpxUnit(context);
    final stage = Semantics(
      button: true,
      label: widget.tapLabel.isNotEmpty ? widget.tapLabel : flipped ? '批文卡背面，點擊翻到正面' : '批文卡正面，點擊翻到背面',
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _toggle,
        child: AspectRatio(
          aspectRatio: ApprovalCardStyle.ratio,
          child: AnimatedBuilder(
            animation: run,
            builder: (context, _) => _FlipStage(turn: shown, front: _Face(back: false, data: widget.data, unit: unit, face: widget.face), back: _Face(back: true, data: widget.data, unit: unit, face: widget.face)),
          ),
        ),
      ),
    );
    if (!widget.showControls) return stage;
    // .approval-preview{display:grid;gap:12rpx}
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      stage,
      SizedBox(height: 12 * unit),
      _Controls(unit: unit, back: flipped, onSide: (back) {
        _show(back);
        widget.onFlip?.call(back);
      }),
    ]);
  }
}

// .approval-face 的圓角和陰影（rpx）。預設 13rpx、0 3rpx 10rpx #1b304030
class ApprovalFace {
  const ApprovalFace({this.radiusRpx = ApprovalCardStyle.radiusRpx, this.shadowYRpx = ApprovalCardStyle.shadowYRpx, this.shadowBlurRpx = ApprovalCardStyle.shadowBlurRpx, this.shadow = ApprovalCardStyle.shadow});
  final double radiusRpx, shadowYRpx, shadowBlurRpx;
  final Color shadow;
}

// turn：0 正面、1 背面（180°）
class _FlipStage extends StatelessWidget {
  const _FlipStage({required this.turn, required this.front, required this.back});
  final double turn;
  final Widget front, back;
  @override
  Widget build(BuildContext context) {
    final angle = math.pi * turn;
    final showBack = angle > math.pi / 2;
    // CSS 的 z 指向觀看者，Flutter 的 z 指向螢幕裏面：CSS rotateY(θ) 等於 Flutter 的 rotateY(-θ)
    final m = Matrix4.identity()
      ..setEntry(3, 2, 1 / ApprovalCardStyle.perspective)
      ..rotateY(-angle);
    // 背面本身先轉 180°（.approval-face--back{transform:rotateY(180deg)}），轉過一半才看到（backface-visibility:hidden）
    final face = showBack ? Transform(alignment: Alignment.center, transform: Matrix4.identity()..rotateY(math.pi), child: back) : front;
    return Transform(alignment: Alignment.center, transform: m, child: face);
  }
}

class _Face extends StatelessWidget {
  const _Face({required this.back, required this.data, required this.unit, required this.face});
  final bool back;
  final Map data;
  final double unit;
  final ApprovalFace face;
  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(face.radiusRpx * unit);
    return Container(
      decoration: BoxDecoration(
        color: ApprovalCardStyle.faceBg,
        borderRadius: radius,
        boxShadow: [BoxShadow(offset: Offset(0, face.shadowYRpx * unit), blurRadius: face.shadowBlurRpx * unit, color: face.shadow)],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: LayoutBuilder(builder: (context, box) {
          final cq = box.maxWidth / 100; // 1cqw
          return Stack(fit: StackFit.expand, children: [
            Image.asset(back ? 'assets/approval_card/back.png' : 'assets/approval_card/front.png', fit: BoxFit.fill, filterQuality: FilterQuality.medium, semanticLabel: back ? '批文卡背面' : '批文卡正面'),
            ...(back ? _backLayer(cq, box.maxWidth, box.maxHeight) : _frontLayer(cq, box.maxWidth, box.maxHeight)),
          ]);
        }),
      ),
    );
  }

  String _v(String key) {
    final v = data[key];
    return v == null ? '' : '$v';
  }

  List<Widget> _frontLayer(double cq, double w, double h) {
    // 正面欄名：細宋體，字均勻拉開到欄名欄 93% 寬，冒號上下對齊（真卡「编　　号:」「内 承 单 位:」）
    _Cell label(String t, double dy, [double size = 2.85]) => _Cell.label(t, basis: .169, size: cq * size, dy: dy, spreadFill: .93);
    return [
      // .card-title
      Positioned(
        left: w * .164,
        top: h * .088,
        width: w * .79,
        child: ClipRect(child: _text(approvalCardTitle, cq * 3.65, ApprovalCardStyle.title, weight: _w750, spacing: cq * .03, align: TextAlign.center)),
      ),
      _row(w, h, cq, left: .049, width: .91, top: .234, minHeight: cq * 5, align: _Align.start, children: [
        label('编　　号:', cq * 1.25),
        _Cell.value(_v('cardNumber'), size: cq * 4.45, font: _Font.arial, bold: true, spacing: cq * .5),
      ]),
      _row(w, h, cq, left: .049, width: .91, top: .344, align: _Align.start, children: [
        label('商　　号:', cq * .2),
        // 真卡的長商號換到第二行，第二行對齊資料欄
        _Cell.value(_v('company'), size: cq * 3.15, lines: 2, lineHeight: 1.5),
      ]),
      _row(w, h, cq, left: .049, width: .91, top: .593, align: _Align.start, children: [
        label('内承单位:', cq * .2),
        _Cell.value(_v('contractor'), size: cq * 3.15),
      ]),
      _row(w, h, cq, left: .049, width: .91, top: .769, align: _Align.start, children: [
        label('通行口岸:', cq * .2),
        _Cell.value(_v('crossing'), size: cq * 3.3),
      ]),
      _row(w, h, cq, left: .049, width: .91, top: .873, align: _Align.baseline, children: [
        label('签发机关:', cq * .2, 2.45),
        _Cell.label(approvalCardIssuer, size: cq * 2.45, dy: cq * .2, flex: true),
        _Cell.value(_v('serial'), basis: .19, size: cq * 3.15, font: _Font.arial, bold: true, spacing: cq * .2, dy: cq * .3, right: true),
      ]),
    ];
  }

  List<Widget> _backLayer(double cq, double w, double h) {
    // 背面欄名：藍色黑體，字均勻拉開到同組最長欄名的寬度，冒號上下對齊（真卡「驾　驶　人:」「请 予 办 理:」）
    _Cell label(String t, double basis, String spreadTo) => _Cell.label(t, basis: basis, size: cq * 2.85, dy: cq * .2, font: _Font.hei, spreadTo: spreadTo);
    _Cell value(String t, double size, {int lines = 1, double lineHeight = ApprovalCardStyle.lineHeight}) => _Cell.value(t, size: size, font: _Font.hei, lines: lines, lineHeight: lineHeight);
    const leftRef = '内地车牌号:', rightRef = '座位/吨位:';
    Widget left(double top, List<_Cell> cells) => _row(w, h, cq, left: .042, width: .47, top: top, children: cells);
    Widget right(double top, String t, String key, {double basis = .307}) =>
        _row(w, h, cq, left: .544, width: .435, top: top, children: [label(t, basis, rightRef), value(_v(key), cq * 3.05)]);
    Widget wide(double top, String t, _Cell v) => _row(w, h, cq, left: .042, width: .935, top: top, children: [label(t, .18, leftRef), v]);
    _Cell index(String t) => _Cell.label(t, basis: .086, size: cq * 2.85, dy: cq * .2, font: _Font.hei);
    _Cell spacer() => _Cell.label('', basis: .356, size: cq * 3.2, font: _Font.hei);
    return [
      left(.076, [label('内地车牌号:', .356, leftRef), value(_v('mainlandPlate'), cq * 3.3)]),
      left(.172, [label('港澳车牌号:', .356, leftRef), value(_v('localPlate'), cq * 3.3)]),
      left(.268, [label('驾　驶　人:', .356, leftRef), index('1.'), value(_v('driver1'), cq * 3.3)]),
      left(.364, [spacer(), index('2.'), value(_v('driver2'), cq * 3.3)]),
      left(.46, [spacer(), index('3.'), value(_v('driver3'), cq * 3.3)]),
      right(.076, '现批文号:', 'currentApproval'),
      right(.172, '原批文号:', 'previousApproval'),
      right(.268, '颜　　色:', 'color', basis: .348),
      right(.364, '座位/吨位:', 'seats', basis: .348),
      wide(.538, '请予办理:', value(_v('purpose'), cq * 3.3)),
      wide(.671, '有　效　期:', value(ApprovalCard.validity(data['validFrom'], data['validTo']), cq * 3.3)),
      // 真卡備注兩行之間比較疏；兩行的高度仍在底部提示之上
      wide(.771, '备　　注:', value(_v('notes'), cq * 3.05, lines: 2, lineHeight: 1.5)),
      // .card-warning
      Positioned(
        left: w * .18,
        top: h * .931,
        width: w * .74,
        child: ClipRect(child: _text(approvalCardWarning, cq * 2.05, ApprovalCardStyle.warning, weight: _w650, align: TextAlign.center)),
      ),
    ];
  }

  Widget _row(double w, double h, double cq, {required double left, required double width, required double top, double minHeight = 0, _Align align = _Align.baseline, required List<_Cell> children}) {
    final rowW = w * width;
    final cells = <Widget>[];
    for (final c in children) {
      final color = c.isLabel ? ApprovalCardStyle.label : ApprovalCardStyle.value;
      final weight = c.font == _Font.hei ? ApprovalCardStyle.heiWeight : c.bold ? FontWeight.w700 : FontWeight.w400;
      Widget t;
      if (c.lines > 1) {
        // 可換行的資料（商號、備注）：最多 c.lines 行，多出的裁掉；行距加大時第一行仍在原位
        t = Transform.translate(
          offset: Offset(0, -(c.lineHeight - ApprovalCardStyle.lineHeight) / 2 * c.size),
          child: _text(c.text, c.size, color, weight: weight, font: c.font, lines: c.lines, height: c.lineHeight),
        );
      } else {
        final spread = c.spreadFill != null && c.basis != null ? rowW * c.basis! * c.spreadFill! : c.spreadTo != null && c.spreadTo != c.text ? _measure(c.spreadTo!, c.size, weight, c.font) : null;
        t = spread != null
            // 不可比欄名欄寬（例如「现批文号:」的欄比「座位/吨位:」的窄）
            ? _spread(c.text, c.basis != null ? math.min(spread, rowW * c.basis!) : spread, c.size, color, weight, c.font)
            : ClipRect(child: _text(c.text, c.size, color, weight: weight, spacing: c.spacing, font: c.font, align: c.right ? TextAlign.right : TextAlign.left));
      }
      if (c.dy != 0) t = Transform.translate(offset: Offset(0, c.dy), child: t);
      if (c.basis != null) {
        cells.add(SizedBox(width: rowW * c.basis!, child: t));
      } else {
        cells.add(Expanded(child: t)); // .card-value{flex:1}
      }
    }
    return Positioned(
      left: w * left,
      top: h * top,
      width: rowW,
      child: ClipRect(
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: minHeight),
          child: Row(
            crossAxisAlignment: align == _Align.baseline ? CrossAxisAlignment.baseline : CrossAxisAlignment.start,
            textBaseline: TextBaseline.alphabetic,
            children: cells,
          ),
        ),
      ),
    );
  }

  // 欄名的字均勻排在 width 寬裏，冒號貼着最後一個字（真卡「内 承 单 位:」）
  Widget _spread(String text, double width, double size, Color color, FontWeight weight, _Font font) {
    final chars = text.replaceAll(RegExp(r'[\s\u3000]'), '').split('');
    final units = chars.length > 1 && chars.last == ':' ? [...chars.sublist(0, chars.length - 2), '${chars[chars.length - 2]}:'] : chars;
    // 字本身已比 width 寬（例如字型不同）：不拉開，照原字排，多出的裁掉
    // 每個字的寬按畫出來的取整（Text 的寬會進位），否則合計可能比 width 多零點幾而溢出
    final natural = units.fold<double>(0, (sum, u) => sum + _measure(u, size, weight, font).ceilToDouble());
    if (units.length < 2 || natural >= width) return ClipRect(child: _text(text, size, color, weight: weight, font: font));
    // 外面的欄名欄是固定寬（tight），要先放鬆，SizedBox 的寬才生效
    return Align(
      alignment: Alignment.centerLeft,
      child: SizedBox(
        width: width,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [for (final u in units) _text(u, size, color, weight: weight, font: font)],
        ),
      ),
    );
  }

  double _measure(String text, double size, FontWeight weight, _Font font) {
    final painter = TextPainter(text: TextSpan(text: text, style: _style(size, ApprovalCardStyle.label, weight, null, font, ApprovalCardStyle.lineHeight)), textDirection: TextDirection.ltr, textScaler: TextScaler.noScaling)..layout();
    final width = painter.width;
    painter.dispose();
    return width;
  }

  // 卡面的「宋體」：見 tokens.dart 的 ApprovalCardStyle（兩個平台都用打包的 Noto Serif SC 子集；iOS 缺字落到蘋方）
  static bool get _ios => defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.macOS;
  static const _serif = ApprovalCardStyle.song;
  static List<String> get _serifFallback => _ios ? ApprovalCardStyle.songFallbackIos : const [];
  // CSS 的字重配對：650、750 都先找更粗的字重——Noto Serif SC 子集只有 Bold 700
  static const _w650 = FontWeight.w700;
  static const _w750 = FontWeight.w700;

  static TextStyle _style(double size, Color color, FontWeight weight, double? spacing, _Font font, double height) => TextStyle(
        fontSize: size,
        height: height,
        leadingDistribution: TextLeadingDistribution.even,
        color: color,
        fontWeight: weight,
        letterSpacing: spacing,
        fontFamily: switch (font) { _Font.arial => ApprovalCardStyle.arial, _Font.song => _serif, _Font.hei => _ios ? ApprovalCardStyle.heiIos : ApprovalCardStyle.heiAndroid },
        // 黑體不接頁面的後備字型（頁面的是繁體 PingFang TC、Noto Sans TC），卡上是簡體字
        fontFamilyFallback: switch (font) { _Font.arial => [...ApprovalCardStyle.arialFallback, ..._serifFallback], _Font.song => _serifFallback, _Font.hei => const [] },
        locale: font == _Font.hei ? ApprovalCardStyle.heiLocale : null,
        decoration: TextDecoration.none,
      );

  Widget _text(String text, double size, Color color, {FontWeight weight = FontWeight.w400, double? spacing, TextAlign align = TextAlign.left, _Font font = _Font.song, int lines = 1, double height = ApprovalCardStyle.lineHeight}) => Text(
        text,
        maxLines: lines,
        softWrap: lines > 1,
        overflow: TextOverflow.clip,
        textAlign: align,
        textScaler: TextScaler.noScaling,
        style: _style(size, color, weight, spacing, font, height),
      );
}

enum _Align { start, baseline }

// 卡面三種字：宋體（正面）、黑體（背面）、Arial（正面的編號、流水號）
enum _Font { song, hei, arial }

class _Cell {
  _Cell.label(this.text, {this.basis, required this.size, this.dy = 0, this.flex = false, this.font = _Font.song, this.spreadTo, this.spreadFill})
      : isLabel = true,
        bold = false,
        spacing = null,
        right = false,
        lines = 1,
        lineHeight = ApprovalCardStyle.lineHeight;
  _Cell.value(this.text, {this.basis, required this.size, this.font = _Font.song, this.bold = false, this.spacing, this.dy = 0, this.right = false, this.lines = 1, this.lineHeight = ApprovalCardStyle.lineHeight})
      : isLabel = false,
        flex = false,
        spreadTo = null,
        spreadFill = null;
  final String text;
  final double? basis; // flex-basis：所在行寬的百分比
  final double size;
  final double? spacing;
  final double dy; // transform:translateY
  final bool isLabel, bold, right, flex;
  final _Font font;
  final int lines;
  final double lineHeight;
  // 欄名字均勻拉開：拉到 spreadTo 這個欄名的寬度，或欄名欄寬的 spreadFill 倍
  final String? spreadTo;
  final double? spreadFill;
}

// .flip-controls：正面／背面兩個圓角鈕，右邊「點擊卡面翻轉」
class _Controls extends StatelessWidget {
  const _Controls({required this.unit, required this.back, required this.onSide});
  final double unit;
  final bool back;
  final ValueChanged<bool> onSide;
  @override
  Widget build(BuildContext context) {
    Widget btn(String text, bool active, bool side) => Semantics(
          button: true,
          selected: active,
          child: GestureDetector(
            onTap: () => onSide(side),
            child: Container(
              constraints: BoxConstraints(minWidth: 68 * unit),
              height: 34 * unit,
              padding: EdgeInsets.symmetric(horizontal: 14 * unit),
              decoration: BoxDecoration(
                color: active ? ApprovalCardStyle.ctrlOn : ApprovalCardStyle.ctrlBg,
                border: Border.all(color: active ? ApprovalCardStyle.ctrlOn : ApprovalCardStyle.ctrlBorder),
                borderRadius: BorderRadius.circular(999 * unit),
              ),
              child: Center(widthFactor: 1, child: Text(text, style: ts(13 * unit, weight: FontWeight.w600, color: active ? ApprovalCardStyle.ctrlOnText : ApprovalCardStyle.ctrlText, height: 1))),
            ),
          ),
        );
    return Row(children: [
      btn('正面', !back, false),
      SizedBox(width: 8 * unit),
      btn('背面', back, true),
      const Spacer(),
      Text('點擊卡面翻轉', style: ts(12 * unit, color: ApprovalCardStyle.hint)),
    ]);
  }
}
