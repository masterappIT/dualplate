// 牌照詳情頁內用的小組件：對應 plate-detail.vue <style scoped> 的類別（.line、.line-title、.fold-head 等），
// 以及網頁排版裏 Flutter 沒有的「上下外距合併」（CSS margin collapsing）。數值照抄，顏色字號只用 tokens.dart。
import 'package:flutter/material.dart' show Material, MaterialType, TextField, InputDecoration, InputBorder;
import 'package:flutter/widgets.dart';
import '../../ui/base.dart';
import '../../ui/tokens.dart';

// ── 外距合併 ──────────────────────────────────────────────────────────────────────────
// 網頁的區塊上下相鄰時，上一塊的 margin-bottom 和下一塊的 margin-top 合併：正數取最大，負數取最小，兩者相加。
// 沒有框線和內距的外層（例如 v-if 的 <view>、.fold-body）的外距也和裏面第一塊、最後一塊合併。
// Blk 記下一塊的上下外距（可以是幾個值，合併時才計算）。
class Blk {
  Blk(this.child, {double top = 0, double bottom = 0}) : top = [top], bottom = [bottom];
  Blk._(this.child, this.top, this.bottom);
  final Widget child;
  final List<double> top, bottom;
}

double collapse(Iterable<double> margins) {
  var pos = 0.0, neg = 0.0;
  for (final m in margins) {
    if (m > pos) pos = m;
    if (m < neg) neg = m;
  }
  return pos + neg;
}

// 沒有框線和內距的外層：把它的外距併進第一塊和最後一塊（沒有內容時，上下外距合在一起）
List<Blk> wrapBlk(List<Blk> inner, {double top = 0, double bottom = 0}) {
  if (inner.isEmpty) return [Blk._(const SizedBox.shrink(), [top, bottom], const [])];
  final out = [...inner];
  out[0] = Blk._(out[0].child, [top, ...out[0].top], out[0].bottom);
  final last = out.length - 1;
  out[last] = Blk._(out[last].child, out[last].top, [...out[last].bottom, bottom]);
  return out;
}

// 一連串區塊（父層有內距，第一塊的上外距和最後一塊的下外距不會穿出去）
class Blocks extends StatelessWidget {
  const Blocks(this.blocks, {super.key});
  final List<Blk> blocks;
  @override
  Widget build(BuildContext context) {
    final children = <Widget>[];
    List<double> pending = const [];
    for (var i = 0; i < blocks.length; i++) {
      final gap = collapse([...pending, ...blocks[i].top]);
      // 負數合計（例如 .fold-body 的 -4 沒有正數可抵）在本頁不會出現：負外距都跟在 12 或 16 的外距後面
      if (gap > 0) children.add(SizedBox(height: gap));
      children.add(blocks[i].child);
      pending = blocks[i].bottom;
    }
    final end = collapse(pending);
    if (end > 0) children.add(SizedBox(height: end));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: children);
  }
}

// ── 文字 ──────────────────────────────────────────────────────────────────────────────
// .line-title：16、700、行高 1.4、ink
class LineTitle extends StatelessWidget {
  const LineTitle(this.text, {super.key, this.maxLines});
  final String text;
  final int? maxLines;
  @override
  Widget build(BuildContext context) => Text(text, maxLines: maxLines, style: ts(Fs.h, weight: w700, height: 1.4));
}

// .line-sub：上距 2、14、行高 1.5、ink-2（頁內樣式，和 App.vue 的 .list-sub 上距 4 不同）
class LineSub extends StatelessWidget {
  const LineSub(this.text, {super.key, this.top = 2, this.tabular = false, this.align = TextAlign.left});
  final String text;
  final double top;
  final bool tabular;
  final TextAlign align;
  @override
  Widget build(BuildContext context) {
    var style = ts(Fs.body, color: C.ink2);
    if (tabular) style = style.copyWith(fontFeatures: const [FontFeature.tabularFigures()], letterSpacing: Fs.body * .04);
    return Padding(padding: EdgeInsets.only(top: top), child: Text(text, textAlign: align, style: style));
  }
}

// .pill.pending-tag：在文字行裏，上距 4
class PendingTag extends StatelessWidget {
  const PendingTag({super.key});
  @override
  Widget build(BuildContext context) => const Padding(padding: EdgeInsets.only(top: 4), child: Align(alignment: Alignment.centerLeft, widthFactor: 1, child: Pill('已修改，待核對', tone: Tone.amber)));
}

// .link（可點）
class Link extends StatelessWidget {
  const Link(this.text, {super.key, this.onTap, this.color = C.jade, this.align = TextAlign.left, this.hidden = false, this.minWidth = 0});
  final String text;
  final VoidCallback? onTap;
  final Color color;
  final TextAlign align;
  final bool hidden;
  final double minWidth;
  @override
  Widget build(BuildContext context) {
    Widget t = Text(text, softWrap: false, textAlign: align, style: ts(Fs.body, weight: w700, color: color));
    if (minWidth > 0) t = ConstrainedBox(constraints: BoxConstraints(minWidth: minWidth), child: t);
    if (hidden) return Visibility.maintain(visible: false, child: t);
    return GestureDetector(behavior: HitTestBehavior.opaque, onTap: onTap, child: t);
  }
}

// ── 卡片 ──────────────────────────────────────────────────────────────────────────────
// .list-card（可加 .warn-card）：按下時底色變 jade-soft（:active 蓋過 .warn-card 的底色，框線不變）
class DetailListCard extends StatefulWidget {
  const DetailListCard({super.key, required this.child, this.onTap, this.warn = false});
  final Widget child;
  final VoidCallback? onTap;
  final bool warn;
  @override
  State<DetailListCard> createState() => _DetailListCardState();
}

class _DetailListCardState extends State<DetailListCard> {
  bool down = false;
  void set(bool v) {
    if (down != v && mounted) setState(() => down = v);
  }

  @override
  Widget build(BuildContext context) {
    final tap = widget.onTap;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: tap == null ? null : (_) => set(true),
      onTapUp: tap == null ? null : (_) => set(false),
      onTapCancel: tap == null ? null : () => set(false),
      onTap: tap,
      child: AnimatedContainer(
        duration: Motion.fast,
        curve: Motion.ease,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: down ? C.jadeSoft : widget.warn ? C.warnBg : C.card,
          border: Border.all(color: widget.warn ? C.warnBorder : C.rule),
          borderRadius: BorderRadius.circular(R.card),
        ),
        child: DefaultTextStyle(style: ts(Fs.body), child: widget.child),
      ),
    );
  }
}

// .card（.warn-card）；外距由 Blocks 處理
class DCard extends StatelessWidget {
  const DCard({super.key, required this.child, this.warn = false, this.padding = const EdgeInsets.all(16), this.onTap});
  final Widget child;
  final bool warn;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final box = CardBox(warn: warn, padding: padding, margin: EdgeInsets.zero, child: child);
    return onTap == null ? box : GestureDetector(behavior: HitTestBehavior.opaque, onTap: onTap, child: box);
  }
}

// .list-card.row.fold-head：標題（16、700）＋右對齊摘要（14、ink-2、一行省略）＋ › 或 ⌃
class FoldHead extends StatelessWidget {
  const FoldHead({super.key, required this.title, required this.summary, this.open, this.onTap});
  final String title, summary;
  final bool? open; // null：沒有展開狀態（委託內容），一律 ›
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => DetailListCard(
        onTap: onTap,
        child: Row(children: [
          Text(title, softWrap: false, style: ts(Fs.h, weight: w700)),
          const SizedBox(width: 12),
          Expanded(child: Text(summary, maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis, textAlign: TextAlign.right, style: ts(Fs.body, color: C.ink2))),
          const SizedBox(width: 12),
          Text(open == true ? '⌃' : '›', style: ts(Fs.h, color: C.ink3, height: 1)),
        ]),
      );
}

// .line：一行（左右排列、置中、間距 12、上下 12、底線；最後一行沒有底線）
class Line extends StatelessWidget {
  const Line({super.key, required this.children, this.last = false, this.top = false, this.onTap});
  final List<Widget> children;
  final bool last, top; // top：.doc-line 頂端對齊
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final spaced = <Widget>[];
    for (final c in children) {
      if (spaced.isNotEmpty) spaced.add(const SizedBox(width: 12));
      spaced.add(c);
    }
    final box = Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.rule))),
      child: Row(crossAxisAlignment: top ? CrossAxisAlignment.start : CrossAxisAlignment.center, children: spaced),
    );
    return onTap == null ? box : GestureDetector(behavior: HitTestBehavior.opaque, onTap: onTap, child: box);
  }
}

// .row（space-between、置中、間距 12）
class SpacedRow extends StatelessWidget {
  const SpacedRow({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final spaced = <Widget>[];
    for (final c in children) {
      if (spaced.isNotEmpty) spaced.add(const SizedBox(width: 12));
      spaced.add(c);
    }
    return Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: spaced);
  }
}

// .date-edit：日期徽章＋「修改」等連結，間距 8
class DateEdit extends StatelessWidget {
  const DateEdit({super.key, this.date, this.link = '', this.hiddenLink = false, this.onTap});
  final Widget? date;
  final String link;
  final bool hiddenLink;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final row = Row(mainAxisSize: MainAxisSize.min, children: [
      ?date,
      if (date != null && link.isNotEmpty) const SizedBox(width: 8),
      // .date-edit .link{min-width:3em;text-align:right}
      if (link.isNotEmpty) Link(link, hidden: hiddenLink, minWidth: Fs.body * 3, align: TextAlign.right),
    ]);
    return onTap == null ? row : GestureDetector(behavior: HitTestBehavior.opaque, onTap: onTap, child: row);
  }
}

// ── 按鈕和輸入 ────────────────────────────────────────────────────────────────────────
// 可不可按的按鈕：不可按時是 uni-button[disabled] 的灰底淡字，再加 opacity .55（見 tokens.dart 的 UniDisabled）
class DBtn extends StatelessWidget {
  const DBtn(this.text, {super.key, this.kind = BtnKind.primary, this.onTap, this.solid = false, this.enabled = true, this.expand = true});
  final String text;
  final BtnKind kind;
  final VoidCallback? onTap;
  final bool solid, enabled, expand;
  @override
  Widget build(BuildContext context) {
    if (enabled) return Btn(text, kind: kind, onTap: onTap, solid: solid, expand: expand);
    final (height, size) = switch (kind) { BtnKind.primary => (H.primary, Fs.h), BtnKind.secondary => (H.secondary, Fs.h), BtnKind.small => (H.small, Fs.body), BtnKind.line => (H.secondary, Fs.body) };
    final box = Opacity(
      opacity: Motion.disabledOpacity,
      child: Container(
        height: height,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(color: UniDisabled.bg, borderRadius: BorderRadius.circular(R.control), border: kind == BtnKind.line ? Border.all(color: C.rule) : null),
        child: Center(widthFactor: 1, child: Text(text, softWrap: false, style: ts(size, weight: w700, color: UniDisabled.text, height: 1))),
      ),
    );
    return expand ? box : Align(alignment: Alignment.centerLeft, widthFactor: 1, child: box);
  }
}

// .field.picker：外觀同輸入框，左邊文字、右邊 ›；點了打開選擇器
class PickerBox extends StatelessWidget {
  const PickerBox({super.key, required this.text, this.gray = false, this.chev = true, this.onTap});
  final String text;
  final bool gray, chev;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: H.field),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: C.card, border: Border.all(color: C.rule), borderRadius: BorderRadius.circular(R.control)),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Flexible(child: Text(text, style: ts(Fs.h, color: gray ? C.ink3 : C.ink))),
            if (chev) const Chev(),
          ]),
        ),
      );
}

// .field-label，可帶 .field-status（請核對：橙；未能辨識：紅）
class StatusLabel extends StatelessWidget {
  const StatusLabel(this.text, {super.key, this.status = '', this.failed = false, this.top = 16});
  final String text, status;
  final bool failed;
  final double top;
  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(top: top, bottom: 8),
        child: Text.rich(
          TextSpan(text: text, children: [
            if (status.isNotEmpty) ...[
              const WidgetSpan(child: SizedBox(width: 8)),
              TextSpan(text: status, style: ts(Fs.cap, weight: w700, color: failed ? C.overdue : C.due)),
            ],
          ]),
          style: ts(Fs.body, weight: w700, color: C.ink2),
        ),
      );
}

// <textarea class="field notes">：高 96，文字由頂端開始；聚焦樣式同輸入框
class TextArea extends StatefulWidget {
  const TextArea({super.key, required this.controller, this.placeholder = '', this.onChanged});
  final TextEditingController controller;
  final String placeholder;
  final ValueChanged<String>? onChanged;
  @override
  State<TextArea> createState() => _TextAreaState();
}

class _TextAreaState extends State<TextArea> {
  final focus = FocusNode();
  @override
  void initState() {
    super.initState();
    focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final on = focus.hasFocus;
    return AnimatedContainer(
      duration: Motion.fast,
      curve: Motion.ease,
      height: PlateDetailStyle.notesHeight,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: C.card,
        border: Border.all(color: on ? C.jade : C.rule),
        borderRadius: BorderRadius.circular(R.control),
        boxShadow: on ? const [BoxShadow(color: Color(0x73F2C230), spreadRadius: 3)] : null,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: TextField(
          controller: widget.controller,
          focusNode: focus,
          maxLines: null,
          expands: true,
          onChanged: widget.onChanged,
          cursorColor: C.jade,
          textAlignVertical: TextAlignVertical.top,
          style: ts(Fs.h, height: 1.5),
          decoration: InputDecoration(isCollapsed: true, border: InputBorder.none, hintText: widget.placeholder, hintStyle: ts(Fs.h, color: const Color(0xFF808080), height: 1.5)),
        ),
      ),
    );
  }
}

// .inline-editor（車輛、司機）／.card-editor（批文卡）：紙色底、圓角 8、左右下 12
class EditorBox extends StatelessWidget {
  const EditorBox({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        decoration: BoxDecoration(color: C.paper, borderRadius: BorderRadius.circular(R.card)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      );
}

// .editor-actions：兩個等寬小按鈕（取消、儲存），上距 16
class EditorActions extends StatelessWidget {
  const EditorActions({super.key, required this.onCancel, required this.save, required this.onSave, this.saving = false});
  final VoidCallback onCancel, onSave;
  final String save;
  final bool saving;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Row(children: [
          Expanded(child: DBtn('取消', kind: BtnKind.small, onTap: onCancel)),
          const SizedBox(width: 8),
          Expanded(child: DBtn(save, kind: BtnKind.small, solid: true, enabled: !saving, onTap: onSave)),
        ]),
      );
}

// .more：整行可點，上下 12、綠字 14 粗體置中
class MoreLink extends StatelessWidget {
  const MoreLink(this.text, {super.key, this.onTap});
  final String text;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(text, textAlign: TextAlign.center, style: ts(Fs.body, weight: w700, color: C.jade))),
      );
}

// .undated-title：13、700、ink-3
class UndatedTitle extends StatelessWidget {
  const UndatedTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Text(text, style: ts(Fs.meta, weight: w700, color: C.ink3));
}

// .num：等寬數字、字距 .04em（字號跟所在位置，預設 14）
class NumText extends StatelessWidget {
  const NumText(this.text, {super.key, this.color = C.ink});
  final String text;
  final Color color;
  @override
  Widget build(BuildContext context) =>
      Text(text, style: ts(Fs.body, color: color).copyWith(fontFeatures: const [FontFeature.tabularFigures()], letterSpacing: Fs.body * .04));
}

// .plate-missing：440:140、紙色底、1px 虛線框、圓角 4，「未提供號碼」
class PlateMissing extends StatelessWidget {
  const PlateMissing({super.key});
  @override
  Widget build(BuildContext context) => AspectRatio(
        aspectRatio: PlateDetailStyle.plateMissingRatio,
        child: CustomPaint(
          painter: _DashedBox(),
          child: Center(child: Text('未提供號碼', style: ts(Fs.cap, color: C.ink3))),
        ),
      );
}

class _DashedBox extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final r = RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(PlateDetailStyle.missingRadius));
    canvas.drawRRect(r, Paint()..color = C.paper);
    final line = Paint()
      ..color = C.rule
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    // Chrome／WebKit 的 1px dashed：線段約 3、間隔約 3
    final path = Path()..addRRect(r.deflate(.5));
    for (final m in path.computeMetrics()) {
      for (double d = 0; d < m.length; d += 6) {
        canvas.drawPath(m.extractPath(d, (d + 3).clamp(0, m.length)), line);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBox old) => false;
}

// 粵澳路線的澳門號牌：現有 App 沒有用 MacauPlate，另寫了 .physical-plate.macau（計劃第七節已記錄，照舊）
class MacauBlock extends StatelessWidget {
  const MacauBlock(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => AspectRatio(
        aspectRatio: PlateDetailStyle.macauRatio,
        child: Container(
          decoration: BoxDecoration(color: PlateDetailStyle.macauBg, borderRadius: BorderRadius.circular(PlateDetailStyle.macauRadius)),
          alignment: Alignment.center,
          child: Text(text,
              softWrap: false,
              overflow: TextOverflow.visible,
              style: ts(Fs.title, weight: w800, color: PlateDetailStyle.macauText).copyWith(fontFamily: plateArialFont, fontFamilyFallback: plateArialFallback)),
        ),
      );
}

// .ticket-rule 本身佔 1px，上下 16 的外距交給 Blocks 和鄰近外距合併（base.dart 的 TicketRule 把 16 做成內距）
class BareTicketRule extends StatelessWidget {
  const BareTicketRule({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox(height: 1, child: OverflowBox(minHeight: 33, maxHeight: 33, child: TicketRule()));
}
