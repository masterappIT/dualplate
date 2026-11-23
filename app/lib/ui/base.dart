// 通用組件：每個對應 mobile/src/App.vue 的一個樣式類別，數值照抄（App 按目前 UI 一比一）。
// 類別 → 組件：.page → PageBody、.page-title → PageTitle、.subtle → Subtle、.intro → Intro、.card → CardBox、
// .list-card/.list-title/.list-sub/.list-note → ListCard/ListTitle/ListSub/ListNote、.section-head/.section-title → SectionHead/SectionTitle、
// .link → LinkText、.chev → Chev、.pill → Pill、.who → Who、.chips/.chip → Chips/Chip、.segmented/.seg → Segmented、
// .primary/.secondary/.btn-sm/.btn-line → Btn、.field-label → FieldLabel、.field → Field、.empty → Empty、.kv → Kv、
// .deep → CardBox(deep: true)、.kicker → Kicker、.guilloche → Guilloche、.ticket-rule → TicketRule、.warn-card → CardBox(warn: true)
import 'package:flutter/material.dart' show Material, MaterialType, TextField, InputDecoration, InputBorder, TextSelectionThemeData;
import 'package:flutter/services.dart' show TextInputAction, LengthLimitingTextInputFormatter;
import 'package:flutter/widgets.dart';
import 'tokens.dart';

// .page{padding:16px 16px 96px(+底部安全區)}；寬度 780 以上置中最寬 640（App 不會遇到，照抄以防平板）
class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.children, this.controller});
  final List<Widget> children;
  final ScrollController? controller;
  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    return LayoutBuilder(builder: (context, box) {
      final wide = box.maxWidth >= 780;
      return SingleChildScrollView(
        controller: controller,
        padding: wide ? EdgeInsets.fromLTRB((box.maxWidth - 640) / 2 + 24, 32, (box.maxWidth - 640) / 2 + 24, 120) : EdgeInsets.fromLTRB(16, 16, 16, 96 + bottom),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      );
    });
  }
}

class PageTitle extends StatelessWidget {
  const PageTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(text, style: ts(Fs.title, weight: w800, height: 1.3, color: C.jadeDeep)));
}

class Subtle extends StatelessWidget {
  const Subtle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(text, style: ts(Fs.meta, color: C.ink2, height: 1.6));
}

class Intro extends StatelessWidget {
  const Intro(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(bottom: 16), child: Text(text, style: ts(Fs.body, color: C.ink2, height: 1.6)));
}

// .card / .deep / .warn-card：白底、1px 細線、圓角 8、內距 16、下距 12
class CardBox extends StatelessWidget {
  const CardBox({super.key, required this.child, this.deep = false, this.warn = false, this.guilloche = false, this.padding = const EdgeInsets.all(16), this.margin = const EdgeInsets.only(bottom: 12)});
  final Widget child;
  final bool deep, warn, guilloche;
  final EdgeInsets padding, margin;
  @override
  Widget build(BuildContext context) {
    final bg = deep ? C.jadeDeep : warn ? C.warnBg : C.card;
    final border = deep ? C.jadeDeep : warn ? C.warnBorder : C.rule;
    Widget body = Padding(padding: padding, child: DefaultTextStyle(style: ts(Fs.body, color: deep ? C.onDeep : C.ink), child: child));
    if (guilloche) body = Guilloche(color: deep ? C.onDeep : C.ink, child: body);
    // 只有 .guilloche 有 overflow:hidden；一般 .card 不裁切（票根缺口的外半圈會畫在卡外）
    return Container(
      margin: margin,
      clipBehavior: guilloche ? Clip.antiAlias : Clip.none,
      decoration: BoxDecoration(color: bg, border: Border.all(color: border), borderRadius: BorderRadius.circular(R.card)),
      child: body,
    );
  }
}

// 按下效果：transition .18s ease；有 pressedColor 時換底色（.list-card:active），否則 opacity .9、scale .985（按鈕）
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.child, this.onTap, this.scale = true, this.enabled = true});
  final Widget child;
  final VoidCallback? onTap;
  final bool scale, enabled;
  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool down = false;
  void set(bool v) { if (down != v && mounted) setState(() => down = v); }
  @override
  Widget build(BuildContext context) {
    final active = widget.enabled && widget.onTap != null;
    Widget child = widget.child;
    if (widget.scale) {
      child = AnimatedScale(scale: down ? Motion.pressScale : 1, duration: Motion.fast, curve: Motion.ease,
          child: AnimatedOpacity(opacity: !widget.enabled ? Motion.disabledOpacity : down ? Motion.pressOpacity : 1, duration: Motion.fast, curve: Motion.ease, child: child));
    }
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: active ? (_) => set(true) : null,
      onTapUp: active ? (_) => set(false) : null,
      onTapCancel: active ? () => set(false) : null,
      onTap: active ? widget.onTap : null,
      child: _PressedScope(down: down, child: child),
    );
  }
}

class _PressedScope extends InheritedWidget {
  const _PressedScope({required this.down, required super.child});
  final bool down;
  static bool of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<_PressedScope>()?.down ?? false;
  @override
  bool updateShouldNotify(_PressedScope old) => old.down != down;
}

// .list-card：同 .card；按下時底色變 --jade-soft
class ListCard extends StatelessWidget {
  const ListCard({super.key, required this.child, this.onTap, this.margin = const EdgeInsets.only(bottom: 12)});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets margin;
  @override
  Widget build(BuildContext context) => Pressable(
        onTap: onTap,
        scale: false,
        child: Builder(builder: (context) {
          final down = _PressedScope.of(context);
          return AnimatedContainer(
            duration: Motion.fast,
            curve: Motion.ease,
            margin: margin,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: down ? C.jadeSoft : C.card, border: Border.all(color: C.rule), borderRadius: BorderRadius.circular(R.card)),
            child: child,
          );
        }),
      );
}

class ListTitle extends StatelessWidget {
  const ListTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(text, style: ts(Fs.h, weight: w700, height: 1.4));
}

class ListSub extends StatelessWidget {
  const ListSub(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 4), child: Text(text, style: ts(Fs.body, color: C.ink2)));
}

enum NoteTone { red, amber, green, gray, none }

const _noteColor = {NoteTone.red: C.overdue, NoteTone.amber: C.due, NoteTone.green: C.ok, NoteTone.gray: C.ink3, NoteTone.none: C.ink};

class ListNote extends StatelessWidget {
  const ListNote(this.text, {super.key, this.tone = NoteTone.none});
  final String text;
  final NoteTone tone;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 4), child: Text(text, style: ts(Fs.meta, weight: w700, color: _noteColor[tone]!)));
}

// .chev：列表右邊的「›」
class Chev extends StatelessWidget {
  const Chev({super.key});
  @override
  Widget build(BuildContext context) => Text('›', style: ts(Fs.h, color: C.ink3, height: 1));
}

// .section-title：margin 28 0 12；放在 .section-head 裏時沒有外距，右邊通常是 .link
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.bare = false});
  final String text;
  final bool bare;
  @override
  Widget build(BuildContext context) {
    final t = Text(text, style: ts(Fs.h, weight: w800, height: 1.4, color: C.jadeDeep));
    return bare ? t : Padding(padding: const EdgeInsets.only(top: 28, bottom: 12), child: t);
  }
}

class SectionHead extends StatelessWidget {
  const SectionHead({super.key, required this.title, this.trailing});
  final String title;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 28, bottom: 12),
        child: Row(children: [Expanded(child: SectionTitle(title, bare: true)), if (trailing != null) ...[const SizedBox(width: 12), trailing!]]),
      );
}

class LinkText extends StatelessWidget {
  const LinkText(this.text, {super.key, this.onTap});
  final String text;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(behavior: HitTestBehavior.opaque, onTap: onTap, child: Text(text, softWrap: false, style: ts(Fs.body, weight: w700, color: C.jade)));
}

// .pill：只包住文字；綠（預設）、amber、gray、red、blue
enum Tone { green, amber, gray, red, blue }

const _pillColors = {
  Tone.green: (C.okBg, C.ok),
  Tone.amber: (C.dueBg, C.due),
  Tone.gray: (C.mutedBg, C.ink2),
  Tone.red: (C.overdueBg, C.overdue),
  Tone.blue: (C.activeBg, C.active),
};

// lib/api.js 的 tone 字串（'red'、'amber'、''…）→ Tone；空字串是預設綠
Tone toneOf(String? name) => switch (name) { 'amber' => Tone.amber, 'gray' => Tone.gray, 'red' => Tone.red, 'blue' => Tone.blue, _ => Tone.green };

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = Tone.green});
  final String text;
  final Tone tone;
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _pillColors[tone]!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(R.pill)),
      child: SizedBox(height: 18, child: Center(widthFactor: 1, child: Text(text, softWrap: false, style: ts(Fs.cap, weight: w700, color: fg, height: 18 / Fs.cap)))),
    );
  }
}

// .who：客戶自理的灰色小標
class Who extends StatelessWidget {
  const Who(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Align(
          alignment: Alignment.centerLeft,
          widthFactor: 1,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            decoration: BoxDecoration(color: C.mutedBg, borderRadius: BorderRadius.circular(R.control)),
            child: Text(text, style: ts(Fs.cap, weight: w700, color: C.ink2, height: 20 / Fs.cap)),
          ),
        ),
      );
}

// .chips：換行排列、間距 8、上 12 下 16；.chip 高 36、左右 14、全圓角
class Chips extends StatelessWidget {
  const Chips({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 12, bottom: 16), child: Wrap(spacing: 8, runSpacing: 8, children: children));
}

class Chip extends StatelessWidget {
  const Chip(this.text, {super.key, this.active = false, this.onTap});
  final String text;
  final bool active;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: Motion.fast,
          curve: Motion.ease,
          height: H.chip,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(color: active ? C.jade : C.mutedBg, borderRadius: BorderRadius.circular(R.pill)),
          child: Center(widthFactor: 1, child: Text(text, style: ts(Fs.body, weight: w700, color: active ? const Color(0xFFFFFFFF) : C.ink2))),
        ),
      );
}

// .segmented：灰底、內距 4、間距 4、圓角 8；.seg 高 36、圓角 4；選中白底綠字加陰影。inline 時不撐滿
class Segmented<T> extends StatelessWidget {
  const Segmented({super.key, required this.options, required this.value, required this.onChanged, this.inline = false});
  final List<(T, String)> options;
  final T value;
  final ValueChanged<T> onChanged;
  final bool inline;
  @override
  Widget build(BuildContext context) {
    final segs = <Widget>[];
    for (final (v, label) in options) {
      if (segs.isNotEmpty) segs.add(const SizedBox(width: 4));
      final on = v == value;
      final seg = GestureDetector(
        onTap: () => onChanged(v),
        child: Container(
          height: H.seg,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(color: on ? C.card : null, borderRadius: BorderRadius.circular(R.control), boxShadow: on ? Shadows.seg : null),
          child: Center(child: Text(label, softWrap: false, style: ts(Fs.body, weight: w700, color: on ? C.jade : C.ink2))),
        ),
      );
      segs.add(inline ? seg : Expanded(child: seg));
    }
    final box = Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: C.mutedBg, borderRadius: BorderRadius.circular(R.card)),
      child: Row(mainAxisSize: inline ? MainAxisSize.min : MainAxisSize.max, children: segs),
    );
    return inline ? Align(alignment: Alignment.centerLeft, widthFactor: 1, child: box) : box;
  }
}

// 按鈕：主要 48（撐滿、實心綠，danger 紅）、次要 44（淺綠底綠字）、行內小按鈕 40（淺綠，solid 時實心）、線框 44（白底細線）
enum BtnKind { primary, secondary, small, line }

class Btn extends StatelessWidget {
  const Btn(this.text, {super.key, this.kind = BtnKind.primary, this.onTap, this.danger = false, this.solid = false, this.enabled = true, this.expand, this.trailing});
  final String text;
  // 文字後面的小東西（例如「聯絡客服」的未讀數），間距 8；沒有時照舊
  final Widget? trailing;
  final BtnKind kind;
  final VoidCallback? onTap;
  final bool danger, solid, enabled;
  final bool? expand;
  @override
  Widget build(BuildContext context) {
    const white = Color(0xFFFFFFFF);
    final (bg, fg, height, size) = switch (kind) {
      BtnKind.primary => (danger ? C.overdue : C.jade, white, H.primary, Fs.h),
      BtnKind.secondary => (C.jadeSoft, C.jade, H.secondary, Fs.h),
      BtnKind.small => (solid ? C.jade : C.jadeSoft, solid ? white : C.jade, H.small, Fs.body),
      BtnKind.line => (C.card, C.jade, H.secondary, Fs.body),
    };
    final box = Container(
      height: height,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(R.control), border: kind == BtnKind.line ? Border.all(color: C.rule) : null),
      child: Center(
        widthFactor: 1,
        child: trailing == null
            ? Text(text, softWrap: false, style: ts(size, weight: w700, color: fg, height: 1))
            : Row(mainAxisSize: MainAxisSize.min, children: [Text(text, softWrap: false, style: ts(size, weight: w700, color: fg, height: 1)), const SizedBox(width: 8), trailing!]),
      ),
    );
    final full = expand ?? kind == BtnKind.primary;
    return Pressable(onTap: onTap, enabled: enabled, child: full ? box : Align(alignment: Alignment.centerLeft, widthFactor: 1, child: box));
  }
}

class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 16, bottom: 8), child: Text(text, style: ts(Fs.body, weight: w700, color: C.ink2)));
}

// .field：白底、細線、圓角 4、最少高 48、內距 12、字 16；聚焦時綠框加 3px 牌照黃光暈 rgba(242,194,48,.45)
class Field extends StatefulWidget {
  const Field({super.key, this.controller, this.placeholder, this.obscure = false, this.keyboardType, this.maxLines = 1, this.onChanged, this.onSubmitted, this.enabled = true, this.focusNode, this.textInputAction, this.autofillHints, this.maxLength});
  final TextEditingController? controller;
  final String? placeholder;
  final bool obscure, enabled;
  final TextInputType? keyboardType;
  final int? maxLines;
  final ValueChanged<String>? onChanged, onSubmitted;
  final FocusNode? focusNode;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  // maxlength：超出的字打不進去（不提示）；3c 加，預設不限
  final int? maxLength;
  @override
  State<Field> createState() => _FieldState();
}

class _FieldState extends State<Field> {
  late final FocusNode focus = widget.focusNode ?? FocusNode();
  @override
  void initState() { super.initState(); focus.addListener(() => setState(() {})); }
  @override
  void dispose() { if (widget.focusNode == null) focus.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final on = focus.hasFocus;
    return AnimatedContainer(
      duration: Motion.fast,
      curve: Motion.ease,
      constraints: const BoxConstraints(minHeight: H.field),
      decoration: BoxDecoration(
        color: C.card,
        border: Border.all(color: on ? C.jade : C.rule),
        borderRadius: BorderRadius.circular(R.control),
        boxShadow: on ? const [BoxShadow(color: Color(0x73F2C230), spreadRadius: 3)] : null,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      alignment: Alignment.centerLeft,
      // TextField 要有 Material 祖先；用透明的，不畫任何底色或陰影
      child: Material(type: MaterialType.transparency, child: TextField(
        controller: widget.controller,
        focusNode: focus,
        obscureText: widget.obscure,
        enabled: widget.enabled,
        keyboardType: widget.keyboardType,
        textInputAction: widget.textInputAction,
        autofillHints: widget.autofillHints,
        inputFormatters: widget.maxLength == null ? null : [LengthLimitingTextInputFormatter(widget.maxLength)],
        maxLines: widget.obscure ? 1 : widget.maxLines,
        onChanged: widget.onChanged,
        onSubmitted: widget.onSubmitted,
        cursorColor: C.jade,
        style: ts(Fs.h, height: 1.5),
        decoration: InputDecoration(
          isCollapsed: true,
          // .field 是 border-box：最少高 48 已含上下框線。Container 會把 1px 框線加在 48 外面（共 50），所以上下各少 1（3b 2026-11-21 量現有 App 核實）
          contentPadding: const EdgeInsets.symmetric(vertical: 11),
          border: InputBorder.none,
          hintText: widget.placeholder,
          hintStyle: ts(Fs.h, color: const Color(0xFF808080), height: 1.5),
        ),
      )),
    );
  }
}

// TextField 選取顏色：照網頁版預設不另外設；這裏只把游標拖柄改成通行綠
const selectionTheme = TextSelectionThemeData(cursorColor: C.jade, selectionHandleColor: C.jade, selectionColor: Color(0x330F5C4A));

class Empty extends StatelessWidget {
  const Empty(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24), child: Text(text, textAlign: TextAlign.center, style: ts(Fs.body, color: C.ink3, height: 1.6)));
}

// .kv：兩欄（標籤自動寬、值佔餘下）、行距 8、欄距 16；窄螢幕也保留標籤
class Kv extends StatelessWidget {
  const Kv(this.rows, {super.key});
  final List<(String, Widget)> rows;
  @override
  Widget build(BuildContext context) => Table(
        columnWidths: const {0: IntrinsicColumnWidth(), 1: FlexColumnWidth()},
        defaultVerticalAlignment: TableCellVerticalAlignment.top,
        children: [
          for (var i = 0; i < rows.length; i++)
            TableRow(children: [
              Padding(padding: EdgeInsets.only(right: 16, bottom: i == rows.length - 1 ? 0 : 8), child: Text(rows[i].$1, softWrap: false, style: ts(Fs.body, color: C.ink3))),
              Padding(padding: EdgeInsets.only(bottom: i == rows.length - 1 ? 0 : 8), child: DefaultTextStyle(style: ts(Fs.body), child: rows[i].$2)),
            ]),
        ],
      );
}

class Kicker extends StatelessWidget {
  const Kicker(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(text, style: ts(Fs.cap, weight: w700, color: C.plateYellow, letterSpacing: 2));
}

// .guilloche：兩組錯位同心細線（線寬 1、間距 7，圓心 30%,40% 和 70%,60%），範圍向外延伸 40%，透明度 .07
class Guilloche extends StatelessWidget {
  const Guilloche({super.key, required this.child, this.color = C.ink});
  final Widget child;
  final Color color;
  @override
  Widget build(BuildContext context) => CustomPaint(painter: _GuillochePainter(color), child: child);
}

class _GuillochePainter extends CustomPainter {
  _GuillochePainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    // inset:-40% → 畫布範圍為元素的 1.8 倍，圓心按這個範圍的百分比
    final w = size.width * 1.8, h = size.height * 1.8, ox = -size.width * .4, oy = -size.height * .4;
    final paint = Paint()
      ..color = color.withValues(alpha: .07)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    canvas.save();
    canvas.clipRect(Offset.zero & size);
    for (final (fx, fy) in [(.3, .4), (.7, .6)]) {
      final c = Offset(ox + w * fx, oy + h * fy);
      // repeating-radial-gradient 的 farthest-corner 半徑
      final far = [Offset(ox, oy), Offset(ox + w, oy), Offset(ox, oy + h), Offset(ox + w, oy + h)].map((p) => (p - c).distance).reduce((a, b) => a > b ? a : b);
      for (double r = .5; r < far; r += 7) { canvas.drawCircle(c, r, paint); }
    }
    canvas.restore();
  }
  @override
  bool shouldRepaint(_GuillochePainter old) => old.color != color;
}

// .ticket-rule：虛線（左右伸出卡片內距 16）加兩側 16px 半圓缺口；深綠卡上虛線較淡、缺口無邊框
class TicketRule extends StatelessWidget {
  const TicketRule({super.key, this.deep = false});
  final bool deep;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: SizedBox(height: 1, width: double.infinity, child: CustomPaint(painter: _TicketPainter(deep))),
      );
}

class _TicketPainter extends CustomPainter {
  _TicketPainter(this.deep);
  final bool deep;
  @override
  void paint(Canvas canvas, Size size) {
    // 元素左右各伸出 16（margin:16px -16px），虛線畫在頂邊；Chrome 的 1px dashed 線段長約 3、間隔約 3
    final left = -16.0, right = size.width + 16;
    final line = Paint()..color = deep ? const Color(0x40E3EFEA) : C.rule..strokeWidth = 1;
    for (double x = left; x < right; x += 6) { canvas.drawLine(Offset(x, .5), Offset((x + 3).clamp(left, right), .5), line); }
    final fill = Paint()..color = C.paper;
    final stroke = Paint()..color = C.rule..style = PaintingStyle.stroke..strokeWidth = 1;
    // ::before left:-9px、::after right:-9px，top:-8px，16×16（含 1px 邊框，box-sizing:border-box）
    for (final cx in [left - 9 + 8, right + 9 - 8]) {
      final c = Offset(cx, -8 + 8);
      canvas.drawCircle(c, 8, fill);
      if (!deep) canvas.drawCircle(c, 7.5, stroke);
    }
  }
  @override
  bool shouldRepaint(_TicketPainter old) => old.deep != deep;
}
