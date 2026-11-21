// 批文卡：照抄 mobile/src/components/ApprovalCard.vue（AGENTS.md：批文卡的呈現不得改動）。
// 卡面底圖是 static/approval-card/front.svg、back.svg 用 Chrome 照原尺寸 2 倍轉成的 PNG（assets/approval_card/，轉法見 tool/card_png.sh）；
// 文字層的位置、字號全部是卡寬的百分比（CSS 的 cqw），用 LayoutBuilder 按卡寬換算。
// 卡上的字是批文卡原件的印刷字（簡體），照原組件不改。
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

  // validity(a,b)：兩個都有用「–」連起，日期的「-」換成「.」
  static String date(Object? value) => (value == null ? '' : '$value').replaceAll('-', '.');
  static String validity(Object? a, Object? b) {
    bool has(Object? v) => v != null && '$v'.isNotEmpty;
    return has(a) && has(b) ? '${date(a)}–${date(b)}' : date(has(a) ? a : b);
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

  List<Widget> _frontLayer(double cq, double w, double h) => [
        // .card-title
        Positioned(
          left: w * .164,
          top: h * .088,
          width: w * .79,
          child: ClipRect(child: _text(approvalCardTitle, cq * 3.65, ApprovalCardStyle.title, weight: _w750, spacing: cq * .03, align: TextAlign.center)),
        ),
        _row(w, h, cq, left: .049, width: .91, top: .234, minHeight: cq * 5, align: _Align.start, children: [
          _Cell.label('编　　号:', basis: .169, size: cq * 2.85, spacing: cq * .5, dy: cq * 1.25),
          _Cell.value(_v('cardNumber'), size: cq * 4.45, arial: true, bold: true, spacing: cq * .5),
        ]),
        _row(w, h, cq, left: .049, width: .91, top: .344, align: _Align.start, children: [
          _Cell.label('商　　号:', basis: .169, size: cq * 2.85, spacing: cq * .5, dy: cq * .2),
          _Cell.value(_v('company'), size: cq * 3.15),
        ]),
        _row(w, h, cq, left: .049, width: .91, top: .593, align: _Align.start, children: [
          _Cell.label('内承单位:', basis: .169, size: cq * 2.85, dy: cq * .2),
          _Cell.value(_v('contractor'), size: cq * 3.5),
        ]),
        _row(w, h, cq, left: .049, width: .91, top: .769, align: _Align.start, children: [
          _Cell.label('通行口岸:', basis: .169, size: cq * 2.85, dy: cq * .2),
          _Cell.value(_v('crossing'), size: cq * 3.3),
        ]),
        _row(w, h, cq, left: .049, width: .91, top: .873, align: _Align.baseline, children: [
          _Cell.label('签发机关:', basis: .169, size: cq * 2.45, dy: cq * .2),
          _Cell.label(approvalCardIssuer, size: cq * 2.45, dy: cq * .2, flex: true),
          _Cell.value(_v('serial'), basis: .19, size: cq * 3.15, arial: true, bold: true, spacing: cq * .2, dy: cq * .3, right: true),
        ]),
      ];

  List<Widget> _backLayer(double cq, double w, double h) {
    // .back-row{font-size:3.2cqw}：空的 .driver-spacer 按這個字號佔一行
    _Cell label(String t, double basis) => _Cell.label(t, basis: basis, size: cq * 2.85, dy: cq * .2);
    Widget left(double top, List<_Cell> cells) => _row(w, h, cq, left: .042, width: .47, top: top, children: cells);
    Widget right(double top, String t, String key, {double basis = .307}) =>
        _row(w, h, cq, left: .544, width: .435, top: top, children: [label(t, basis), _Cell.value(_v(key), size: cq * 3.05)]);
    Widget wide(double top, String t, _Cell value) => _row(w, h, cq, left: .042, width: .935, top: top, children: [label(t, .18), value]);
    _Cell index(String t) => _Cell.label(t, basis: .086, size: cq * 2.85, dy: cq * .2);
    _Cell spacer() => _Cell.label('', basis: .356, size: cq * 3.2);
    return [
      left(.076, [label('内地车牌号:', .356), _Cell.value(_v('mainlandPlate'), size: cq * 3.3)]),
      left(.172, [label('港澳车牌号:', .356), _Cell.value(_v('localPlate'), size: cq * 3.3)]),
      left(.268, [label('驾　驶　人:', .356), index('1.'), _Cell.value(_v('driver1'), size: cq * 3.3)]),
      left(.364, [spacer(), index('2.'), _Cell.value(_v('driver2'), size: cq * 3.3)]),
      left(.46, [spacer(), index('3.'), _Cell.value(_v('driver3'), size: cq * 3.3)]),
      right(.076, '现批文号:', 'currentApproval'),
      right(.172, '原批文号:', 'previousApproval'),
      right(.268, '颜　　色:', 'color', basis: .348),
      right(.364, '座位/吨位:', 'seats', basis: .348),
      wide(.538, '请予办理:', _Cell.value(_v('purpose'), size: cq * 3.3)),
      wide(.671, '有　效　期:', _Cell.value(ApprovalCard.validity(data['validFrom'], data['validTo']), size: cq * 3.3)),
      wide(.771, '备　　注:', _Cell.value(_v('notes'), size: cq * 3.05, wrap: true)),
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
      Widget t = c.wrap
          // .note-value：可換行，line-height 1.1，最多 2.2em（兩行），多出的裁掉
          ? ConstrainedBox(constraints: BoxConstraints(maxHeight: c.size * 2.2), child: ClipRect(child: _text(c.text, c.size, ApprovalCardStyle.value, wrap: true, height: 1.1)))
          : ClipRect(child: _text(c.text, c.size, c.isLabel ? ApprovalCardStyle.label : ApprovalCardStyle.value,
              weight: c.isLabel ? _w650 : c.bold ? FontWeight.w700 : FontWeight.w400, spacing: c.spacing, arial: c.arial, align: c.right ? TextAlign.right : TextAlign.left));
      if (c.dy != 0) t = Transform.translate(offset: Offset(0, c.dy), child: t);
      if (c.basis != null) {
        cells.add(SizedBox(width: rowW * c.basis!, child: t));
      } else if (c.flex) {
        cells.add(Expanded(child: t));
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

  // 卡面的「宋體」：見 tokens.dart 的 ApprovalCardStyle（iOS 照現有 App 落到 Times＋蘋方；Android 用打包的 Noto Serif SC 子集）
  static bool get _ios => defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.macOS;
  static String get _serif => _ios ? ApprovalCardStyle.iosLatin : ApprovalCardStyle.androidSong;
  static List<String> get _serifFallback => _ios ? ApprovalCardStyle.iosHan : const [];
  // CSS 的字重配對：650、750 都先找更粗的字重——Times 用 Bold 700；蘋方最粗是 Semibold，Noto Serif SC 子集只有 Bold
  static const _w650 = FontWeight.w700;
  static const _w750 = FontWeight.w700;

  Widget _text(String text, double size, Color color, {FontWeight weight = FontWeight.w400, double? spacing, TextAlign align = TextAlign.left, bool arial = false, bool wrap = false, double height = ApprovalCardStyle.lineHeight}) => Text(
        text,
        maxLines: wrap ? null : 1,
        softWrap: wrap,
        overflow: TextOverflow.clip,
        textAlign: align,
        textScaler: TextScaler.noScaling,
        style: TextStyle(
          fontSize: size,
          height: height,
          leadingDistribution: TextLeadingDistribution.even,
          color: color,
          fontWeight: weight,
          letterSpacing: spacing,
          fontFamily: arial ? ApprovalCardStyle.arial : _serif,
          fontFamilyFallback: arial ? [...ApprovalCardStyle.arialFallback, ..._serifFallback] : _serifFallback,
          decoration: TextDecoration.none,
        ),
      );
}

enum _Align { start, baseline }

class _Cell {
  _Cell.label(this.text, {this.basis, required this.size, this.spacing, this.dy = 0, this.flex = false})
      : isLabel = true,
        arial = false,
        bold = false,
        right = false,
        wrap = false;
  _Cell.value(this.text, {this.basis, required this.size, this.arial = false, this.bold = false, this.spacing, this.dy = 0, this.right = false, this.wrap = false})
      : isLabel = false,
        flex = false;
  final String text;
  final double? basis; // flex-basis：所在行寬的百分比
  final double size;
  final double? spacing;
  final double dy; // transform:translateY
  final bool isLabel, arial, bold, right, wrap, flex;
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
