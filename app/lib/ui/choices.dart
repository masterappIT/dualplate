// 單選和勾選：對應現在 App 用的 Wot 組件（wot-design-uni 1.14），數值在 tokens.dart 的 WotChoice。
// mobile/ 的用法只有兩種，這裏只做這兩種：
//   <wd-radio-group shape="dot"> + <wd-radio>：company-new、close-account、rental-new
//   <wd-checkbox shape="square">（單獨使用，不放在 checkbox-group 裏）：signup、plate-delete、rental-new
// 兩者都沒有按下效果（Wot 沒有 :active 樣式），點整行即可選。
import 'package:flutter/widgets.dart';
import 'tokens.dart';

// 單選組 ------------------------------------------------------------------------------------------
//
// .wd-radio 是 flex 一行：文字靠左、圓點靠右（space-between），兩者之間沒有間距；文字 text-align:center（換行時每行置中）。
// 每個 .wd-radio 有 margin-top:10px（第一個也有，Wot 沒有設 is-first）。
// company-new、close-account 的頁面覆寫 :deep(.wd-radio){margin:0;padding:10px 0}，用 rowPadding: 10、rowMargin: 0。
class WdRadioGroup<T> extends StatelessWidget {
  const WdRadioGroup({super.key, required this.value, required this.options, required this.onChanged, this.rowMargin = WotChoice.radioMargin, this.rowPadding = 0});
  final T? value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;
  final double rowMargin, rowPadding;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (v, label) in options)
            Padding(
              padding: EdgeInsets.only(top: rowMargin),
              child: WdRadio(label: label, checked: v == value, padding: rowPadding, onTap: () => onChanged(v)),
            ),
        ],
      );
}

class WdRadio extends StatelessWidget {
  const WdRadio({super.key, required this.label, required this.checked, required this.onTap, this.padding = 0});
  final String label;
  final bool checked;
  final VoidCallback onTap;
  final double padding;

  @override
  Widget build(BuildContext context) => Semantics(
        inMutuallyExclusiveGroup: true,
        checked: checked,
        button: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: padding),
            child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Flexible(child: Text(label, textAlign: TextAlign.center, style: ts(WotChoice.labelFs, color: WotChoice.label, height: WotChoice.labelLine / WotChoice.labelFs))),
              _RadioDot(checked: checked),
            ]),
          ),
        ),
      );
}

// .wd-radio.is-dot .wd-radio__shape：16px 圓、2px 灰邊；選中時底和邊變主題色（沒有過渡，transition:none），
// 中間 8px 白點由 scale(0) 放大到 scale(1)，transform .2s ease-in。
class _RadioDot extends StatelessWidget {
  const _RadioDot({required this.checked});
  final bool checked;
  @override
  Widget build(BuildContext context) => Container(
        width: WotChoice.size,
        height: WotChoice.size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: checked ? C.jade : null,
          border: Border.all(color: checked ? C.jade : WotChoice.border, width: WotChoice.borderWidth),
        ),
        alignment: Alignment.center,
        child: AnimatedScale(
          scale: checked ? 1 : 0,
          duration: WotChoice.duration,
          curve: WotChoice.easeIn,
          child: Container(width: WotChoice.dot, height: WotChoice.dot, decoration: const BoxDecoration(shape: BoxShape.circle, color: WotChoice.check)),
        ),
      );
}

// 勾選 --------------------------------------------------------------------------------------------
//
// .wd-checkbox：16px 方框（圓角 4、2px 灰邊、白底），右邊 9px 是文字（一行，white-space:nowrap，太長時省略）。
// 選中時：底色 background .2s 過渡到主題色，邊框即時變主題色，白色勾號 opacity .2s 淡入。
// 單獨使用時 Wot 算它是最後一個（is-last-child），margin-bottom 為 0。
// .wd-checkbox 是 display:block：放在 .choice-row 裏時整行都可以點（block: true）；
// signup 的 .agree-row 是 flex，勾選框只佔自己的寬度（block: false）。
class WdCheckbox extends StatelessWidget {
  const WdCheckbox({super.key, required this.label, required this.value, required this.onChanged, this.block = true});
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;
  final bool block;

  @override
  Widget build(BuildContext context) {
    final text = Text(label, maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis, style: ts(WotChoice.labelFs, color: WotChoice.label, height: WotChoice.labelLine / WotChoice.labelFs));
    return Semantics(
      checked: value,
      button: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => onChanged(!value),
        child: Row(mainAxisSize: block ? MainAxisSize.max : MainAxisSize.min, children: [
          _CheckBox(checked: value),
          const SizedBox(width: WotChoice.labelGap),
          Flexible(child: text),
        ]),
      ),
    );
  }
}

class _CheckBox extends StatelessWidget {
  const _CheckBox({required this.checked});
  final bool checked;
  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(WotChoice.squareRadius);
    return AnimatedContainer(
      duration: WotChoice.duration,
      curve: Motion.ease,
      width: WotChoice.size,
      height: WotChoice.size,
      decoration: BoxDecoration(color: checked ? C.jade : WotChoice.box, borderRadius: radius),
      // 邊框不在 transition 內，即時改色
      foregroundDecoration: BoxDecoration(border: Border.all(color: checked ? C.jade : WotChoice.border, width: WotChoice.borderWidth), borderRadius: radius),
      alignment: Alignment.center,
      child: AnimatedOpacity(
        opacity: checked ? 1 : 0,
        duration: WotChoice.duration,
        curve: Motion.ease,
        child: const CustomPaint(size: Size.square(WotChoice.icon), painter: _CheckBoldPainter()),
      ),
    );
  }
}

// wd-icons.ttf 的 check-bold（U+E652）字形外框，單位是字型的 1024 格 em，y 軸向上；畫在 14×14 的方塊裏，
// 字形的 em 中心（x 512、y 384）對準方塊中心，和 CSS 把圖示 translate(-50%,-50%) 置中的位置相同。
class _CheckBoldPainter extends CustomPainter {
  const _CheckBoldPainter();
  static final Path _glyph = () {
    double y(double v) => -v;
    return Path()
      ..moveTo(860, y(531))
      ..lineTo(465, y(136))
      ..quadraticBezierTo(449, y(121), 428, y(117))
      ..lineTo(420, y(116))
      ..lineTo(412, y(116))
      ..quadraticBezierTo(385, y(118), 366, y(136))
      ..lineTo(169, y(334))
      ..quadraticBezierTo(150, y(354), 150.5, y(382.5))
      ..quadraticBezierTo(151, y(411), 170.5, y(431))
      ..quadraticBezierTo(190, y(451), 218.5, y(451.5))
      ..quadraticBezierTo(247, y(452), 268, y(432))
      ..lineTo(416, y(285))
      ..lineTo(761, y(630))
      ..quadraticBezierTo(781, y(650), 810, y(650))
      ..quadraticBezierTo(839, y(650), 859.5, y(629.5))
      ..quadraticBezierTo(880, y(609), 880, y(580.5))
      ..quadraticBezierTo(880, y(552), 860, y(531))
      ..close();
  }();

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 1024;
    canvas
      ..save()
      ..translate(size.width / 2, size.height / 2)
      ..scale(s)
      ..translate(-512, 384);
    canvas.drawPath(_glyph, Paint()..color = WotChoice.check..isAntiAlias = true);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_CheckBoldPainter old) => false;
}
