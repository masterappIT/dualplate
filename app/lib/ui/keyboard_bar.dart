// 鍵盤上方的「⌃ ⌄ 完成」列：現有 App 是 WKWebView，iOS 在網頁輸入框的鍵盤上自帶這條列（uni-app softinputNavBar auto）。
// Flutter 沒有，這裏自己畫一條貼在鍵盤頂上：⌃ ⌄ 在同頁輸入框之間跳（按畫面位置由上到下、由左到右），「完成」收起鍵盤。
// 只在 iOS、有輸入框聚焦時顯示（安卓 WebView 沒有）。有軟鍵盤時貼在鍵盤頂上；接硬件鍵盤（沒有軟鍵盤）時貼在畫面底部，
// 和現有 App 一樣蓋住底部安全區。顯示時把下面頁面看到的 viewInsets.bottom 加上列高，
// 頁面按 viewInsets 留空間時自然讓出列的位置，聚焦的輸入框也不會被列擋住。
// 用法：把整頁包在 KeyboardBarArea 裏。
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'tokens.dart';

class KeyboardBarArea extends StatefulWidget {
  const KeyboardBarArea({super.key, required this.child, this.platform});
  final Widget child;
  final TargetPlatform? platform; // 測試用；預設 defaultTargetPlatform
  @override
  State<KeyboardBarArea> createState() => _KeyboardBarAreaState();
}

class _KeyboardBarAreaState extends State<KeyboardBarArea> {
  final scope = FocusScopeNode(debugLabel: 'keyboard-bar');

  @override
  void initState() {
    super.initState();
    FocusManager.instance.addListener(_changed);
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_changed);
    scope.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  // 本頁所有輸入框（EditableText 裏的 Focus），按畫面位置排序
  List<FocusNode> fields() {
    final nodes = scope.traversalDescendants.where((n) => n.canRequestFocus && n.context != null && n.context!.findAncestorWidgetOfExactType<EditableText>() != null).toList();
    nodes.sort((a, b) {
      final ra = a.rect, rb = b.rect;
      if ((ra.top - rb.top).abs() > 1) return ra.top.compareTo(rb.top);
      return ra.left.compareTo(rb.left);
    });
    return nodes;
  }

  FocusNode? get current {
    final f = FocusManager.instance.primaryFocus;
    return f != null && f.ancestors.contains(scope) ? f : null;
  }

  void move(int step) {
    final list = fields(), now = current;
    final i = now == null ? -1 : list.indexOf(now);
    final j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    list[j].requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final keyboard = media.viewInsets.bottom;
    final now = current;
    final ios = (widget.platform ?? defaultTargetPlatform) == TargetPlatform.iOS;
    final show = ios && now != null;
    final list = show ? fields() : const <FocusNode>[];
    final i = now == null ? -1 : list.indexOf(now);
    return Stack(children: [
      MediaQuery(
        data: show ? media.copyWith(viewInsets: media.viewInsets.copyWith(bottom: keyboard + KeyboardBarStyle.height)) : media,
        child: FocusScope(node: scope, child: widget.child),
      ),
      if (show)
        Positioned(
          left: 0,
          right: 0,
          bottom: keyboard,
          height: KeyboardBarStyle.height,
          child: KeyboardBar(
            canUp: i > 0,
            canDown: i >= 0 && i < list.length - 1,
            onUp: () => move(-1),
            onDown: () => move(1),
            onDone: () => FocusManager.instance.primaryFocus?.unfocus(),
          ),
        ),
    ]);
  }
}

class KeyboardBar extends StatelessWidget {
  const KeyboardBar({super.key, required this.canUp, required this.canDown, required this.onUp, required this.onDown, required this.onDone});
  final bool canUp, canDown;
  final VoidCallback onUp, onDown, onDone;

  @override
  Widget build(BuildContext context) {
    final zh = PlatformDispatcher.instance.locale.languageCode == 'zh';
    final safe = MediaQuery.paddingOf(context);
    Widget arrow(Key key, bool up, bool on, VoidCallback tap) => GestureDetector(
          key: key,
          behavior: HitTestBehavior.opaque,
          onTap: on ? tap : null,
          child: SizedBox(
            width: KeyboardBarStyle.itemW,
            height: KeyboardBarStyle.height,
            child: Center(child: CustomPaint(size: const Size(KeyboardBarStyle.chevronW, KeyboardBarStyle.chevronH), painter: _Chevron(up, on ? KeyboardBarStyle.tint : KeyboardBarStyle.disabled))),
          ),
        );
    return Container(
      decoration: const BoxDecoration(color: KeyboardBarStyle.bg, border: Border(top: BorderSide(color: KeyboardBarStyle.line, width: 0))),
      padding: EdgeInsets.only(left: KeyboardBarStyle.sidePad + safe.left, right: KeyboardBarStyle.sidePad + safe.right),
      child: Row(children: [
        arrow(const ValueKey('keyboard-up'), true, canUp, onUp),
        const SizedBox(width: KeyboardBarStyle.itemGap),
        arrow(const ValueKey('keyboard-down'), false, canDown, onDown),
        const Spacer(),
        GestureDetector(
          key: const ValueKey('keyboard-done'),
          behavior: HitTestBehavior.opaque,
          onTap: onDone,
          child: Container(
            height: KeyboardBarStyle.height,
            padding: const EdgeInsets.symmetric(horizontal: KeyboardBarStyle.donePad),
            alignment: Alignment.center,
            child: Text(zh ? '完成' : 'Done',
                style: const TextStyle(fontSize: KeyboardBarStyle.doneSize, fontWeight: FontWeight.w600, color: KeyboardBarStyle.tint, fontFamily: fontFamily, fontFamilyFallback: fontFallback, decoration: TextDecoration.none)),
          ),
        ),
      ]),
    );
  }
}

class _Chevron extends CustomPainter {
  _Chevron(this.up, this.color);
  final bool up;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final s = KeyboardBarStyle.chevronStroke / 2, w = size.width, h = size.height;
    final (yEdge, yMid) = up ? (h - s, s) : (s, h - s);
    final path = Path()
      ..moveTo(s, yEdge)
      ..lineTo(w / 2, yMid)
      ..lineTo(w - s, yEdge);
    canvas.drawPath(
        path,
        Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = KeyboardBarStyle.chevronStroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..isAntiAlias = true);
  }

  @override
  bool shouldRepaint(_Chevron old) => old.up != up || old.color != color;
}
