// 確認框和底部選單：對應 mobile/src/lib/choice.js（Wot 的 wd-message-box、wd-action-sheet，外觀按 App.vue 的 --wot-* 變量和 .choice-sheet 覆寫）。
// 數值取自 wot-design-uni 1.14 原始碼（components/wd-message-box、wd-action-sheet、wd-button、wd-transition、common/abstracts/variable.scss），
// 不用系統原生對話框（管理者規定，見 docs/design-system.md）。
// ask() 回傳 'confirm'、'cancel'（按了取消鍵）或 'modal'（點了框外或返回鍵）；choose() 回傳選中序號，取消回傳 -1。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'tokens.dart';

const _overlay = Color(0xA6000000); // --wot-overlay-bg rgba(0,0,0,.65)
const _duration = Duration(milliseconds: 300); // wd-popup 預設 300ms，ease
const _ease = Motion.ease;

// 確認框 -------------------------------------------------------------------------------------------

Future<String> ask(BuildContext context, {required String title, String msg = '', String ok = '確認', String cancel = '取消', bool danger = false}) =>
    _messageBox<String>(context, title: title, msg: msg, buttons: [(cancel, _BtnType.info, 'cancel'), (ok, danger ? _BtnType.error : _BtnType.primary, 'confirm')], dismissValue: 'modal', dismissible: true);

// locked：只能按確認鍵（例如必須更新），點框外關不了；返回鍵照常返回頁面（和現有 App 一樣）
Future<void> notice(BuildContext context, {required String title, String msg = '', String ok = '知道了', bool locked = false}) =>
    _messageBox<void>(context, title: title, msg: msg, buttons: [(ok, _BtnType.primary, null)], dismissValue: null, dismissible: !locked);

enum _BtnType { primary, info, error }

Future<T> _messageBox<T>(BuildContext context, {required String title, required String msg, required List<(String, _BtnType, T)> buttons, required T dismissValue, required bool dismissible}) async {
  final result = await Navigator.of(context, rootNavigator: true).push<T>(PageRouteBuilder<T>(
    opaque: false,
    barrierDismissible: dismissible,
    barrierColor: const Color(0x00000000),
    transitionDuration: _duration,
    reverseTransitionDuration: _duration,
    pageBuilder: (context, animation, _) => PopScope(
      canPop: dismissible,
      // 鎖定的提示框：點框外關不了；但返回鍵（iOS 右滑）和現有 App 一樣照常返回頁面——
      // choice.js 沒有把鎖定提示框登記到 back-close.js，返回鍵直接離開頁面（負責人 2026-11-15 決定照舊，記入計劃第七節）
      onPopInvokedWithResult: dismissible
          ? null
          : (didPop, _) {
              if (didPop) return;
              final router = Router.maybeOf(context)?.routerDelegate; // 關掉提示框後，再照常返回一次（等於再按一次返回鍵）
              Navigator.of(context).pop(dismissValue);
              if (router != null) Future.microtask(router.popRoute);
            },
      child: _MessageBox<T>(animation: animation, title: title, msg: msg, buttons: buttons, onModal: dismissible ? () => Navigator.of(context).pop(dismissValue) : null),
    ),
  ));
  return result ?? dismissValue;
}

class _MessageBox<T> extends StatelessWidget {
  const _MessageBox({required this.animation, required this.title, required this.msg, required this.buttons, this.onModal});
  final Animation<double> animation;
  final String title, msg;
  final List<(String, _BtnType, T)> buttons;
  final VoidCallback? onModal;
  @override
  Widget build(BuildContext context) {
    final curve = CurvedAnimation(parent: animation, curve: _ease, reverseCurve: _ease);
    final actions = <Widget>[];
    for (var i = 0; i < buttons.length; i++) {
      if (i > 0) actions.add(const SizedBox(width: 16));
      final (text, type, value) = buttons[i];
      actions.add(Expanded(child: _WotButton(text: text, type: type, onTap: () => Navigator.of(context).pop(value))));
    }
    return Stack(children: [
      Positioned.fill(child: GestureDetector(onTap: onModal, child: FadeTransition(opacity: curve, child: const ColoredBox(color: _overlay)))),
      Center(
        child: FadeTransition(
          opacity: curve,
          child: ScaleTransition(
            scale: Tween(begin: .8, end: 1.0).animate(curve),
            child: Container(
              width: 300,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(color: C.card, borderRadius: BorderRadius.circular(R.panel)),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 25, 24, 0),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    if (title.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 5, bottom: 10), child: Text(title, textAlign: TextAlign.center, style: ts(18, weight: FontWeight.w500, height: 20 / 18))),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 264),
                      child: SingleChildScrollView(child: Text(msg, textAlign: TextAlign.center, style: ts(Fs.body, color: C.ink2, height: 20 / Fs.body))),
                    ),
                  ]),
                ),
                Padding(padding: const EdgeInsets.all(24), child: Row(children: actions)),
              ]),
            ),
          ),
        ),
      ),
    ]);
  }
}

// wd-button medium（高 36、左右 16、字 14 一般粗細、圓角 4，choice.js 傳 round:false）；按下時蓋一層 15% 黑
class _WotButton extends StatefulWidget {
  const _WotButton({required this.text, required this.type, required this.onTap});
  final String text;
  final _BtnType type;
  final VoidCallback onTap;
  @override
  State<_WotButton> createState() => _WotButtonState();
}

class _WotButtonState extends State<_WotButton> {
  bool down = false;
  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (widget.type) {
      _BtnType.primary => (C.jade, const Color(0xFFFFFFFF)),
      _BtnType.error => (C.overdue, const Color(0xFFFFFFFF)),
      _BtnType.info => (const Color(0xFFF0F0F0), const Color(0xFF000000)),
    };
    return GestureDetector(
      onTapDown: (_) => setState(() => down = true),
      onTapUp: (_) => setState(() => down = false),
      onTapCancel: () => setState(() => down = false),
      onTap: widget.onTap,
      child: Container(
        height: 36,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(R.control)),
        foregroundDecoration: BoxDecoration(color: Color.fromRGBO(0, 0, 0, down ? .15 : 0), borderRadius: BorderRadius.circular(R.control)),
        child: Center(child: Text(widget.text, softWrap: false, overflow: TextOverflow.visible, style: ts(Fs.body, color: fg, height: 1))),
      ),
    );
  }
}

// 底部選單（.choice-sheet）-------------------------------------------------------------------------

class ChoiceItem {
  const ChoiceItem(this.title, [this.sub = '']);
  final String title, sub;
}

DateTime _closedAt = DateTime.fromMillisecondsSinceEpoch(0);

// 選項可以是 String 或 ChoiceItem
Future<int> choose(BuildContext context, String title, List<Object> items) async {
  // 上一個選單剛收起（例如連續兩層選單），等動畫完成再打開，避免畫面閃動
  final wait = 300 - DateTime.now().difference(_closedAt).inMilliseconds;
  if (wait > 0) await Future<void>.delayed(Duration(milliseconds: wait));
  if (!context.mounted) return -1;
  final list = items.map((e) => e is ChoiceItem ? e : ChoiceItem('$e')).toList();
  final result = await Navigator.of(context, rootNavigator: true).push<int>(PageRouteBuilder<int>(
    opaque: false,
    barrierDismissible: true,
    barrierColor: const Color(0x00000000),
    transitionDuration: _duration,
    reverseTransitionDuration: _duration,
    pageBuilder: (context, animation, _) => _Sheet(animation: animation, title: title, items: list),
  ));
  _closedAt = DateTime.now();
  return result ?? -1;
}

class _Sheet extends StatelessWidget {
  const _Sheet({required this.animation, required this.title, required this.items});
  final Animation<double> animation;
  final String title;
  final List<ChoiceItem> items;
  @override
  Widget build(BuildContext context) {
    final curve = CurvedAnimation(parent: animation, curve: _ease, reverseCurve: _ease);
    final media = MediaQuery.of(context);
    void close([int index = -1]) => Navigator.of(context).pop(index);
    return Stack(children: [
      Positioned.fill(child: GestureDetector(onTap: close, child: FadeTransition(opacity: curve, child: const ColoredBox(color: _overlay)))),
      Align(
        alignment: Alignment.bottomCenter,
        child: SlideTransition(
          position: Tween(begin: const Offset(0, 1), end: Offset.zero).animate(curve),
          child: Container(
            width: media.size.width >= 780 ? 640 : double.infinity,
            decoration: const BoxDecoration(color: C.card, borderRadius: BorderRadius.vertical(top: Radius.circular(R.panel))),
            // wd-popup 底部安全區＋ .wd-action-sheet{padding-bottom:1px}
            padding: EdgeInsets.only(bottom: media.padding.bottom + 1),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (title.isNotEmpty)
                SizedBox(
                  height: 56,
                  child: Stack(children: [
                    Padding(padding: const EdgeInsets.fromLTRB(16, 0, 48, 0), child: Align(alignment: Alignment.centerLeft, child: Text(title, style: ts(18, weight: w800, height: 1)))),
                    // wd-action-sheet__close：「add」圖示轉 -45° 成 ×，top 25、right 15、16px、rgba(0,0,0,.65)
                    Positioned(top: 25 - 4, right: 15 - 4, child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: close, child: const Padding(padding: EdgeInsets.all(4), child: _CloseIcon()))),
                  ]),
                ),
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: media.size.height * .5),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (var i = 0; i < items.length; i++) _Action(item: items[i], onTap: () => close(i))]),
                ),
              ),
              _Cancel(onTap: close),
            ]),
          ),
        ),
      ),
    ]);
  }
}

class _CloseIcon extends StatelessWidget {
  const _CloseIcon();
  @override
  Widget build(BuildContext context) => CustomPaint(size: const Size(16, 16), painter: _CrossPainter());
}

class _CrossPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size s) {
    final p = Paint()..color = const Color(0xA6000000)..strokeWidth = 1.5..strokeCap = StrokeCap.round;
    canvas.drawLine(Offset(s.width * .2, s.height * .2), Offset(s.width * .8, s.height * .8), p);
    canvas.drawLine(Offset(s.width * .8, s.height * .2), Offset(s.width * .2, s.height * .8), p);
  }
  @override
  bool shouldRepaint(_CrossPainter old) => false;
}

// .choice-sheet 的選項：左對齊卡片，最少高 48、下距 8、內距 12 14、細線、圓角 8；按下時紙色底
class _Action extends StatefulWidget {
  const _Action({required this.item, required this.onTap});
  final ChoiceItem item;
  final VoidCallback onTap;
  @override
  State<_Action> createState() => _ActionState();
}

class _ActionState extends State<_Action> {
  bool down = false;
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTapDown: (_) => setState(() => down = true),
        onTapUp: (_) => setState(() => down = false),
        onTapCancel: () => setState(() => down = false),
        onTap: widget.onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(color: down ? C.paper : C.card, border: Border.all(color: C.rule), borderRadius: BorderRadius.circular(R.card)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(widget.item.title, style: ts(Fs.h, weight: w700, height: 1.4)),
            if (widget.item.sub.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(widget.item.sub, style: ts(Fs.meta, color: C.ink2, height: 1.5))),
          ]),
        ),
      );
}

// 取消鍵：寬度扣去左右 16、下距 16、高 44、淺綠底綠字、16px 粗 700、圓角 4；按下時紙色底
class _Cancel extends StatefulWidget {
  const _Cancel({required this.onTap});
  final VoidCallback onTap;
  @override
  State<_Cancel> createState() => _CancelState();
}

class _CancelState extends State<_Cancel> {
  bool down = false;
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTapDown: (_) => setState(() => down = true),
        onTapUp: (_) => setState(() => down = false),
        onTapCancel: () => setState(() => down = false),
        onTap: widget.onTap,
        child: Container(
          height: 44,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          decoration: BoxDecoration(color: down ? C.paper : C.jadeSoft, borderRadius: BorderRadius.circular(R.control)),
          child: Center(child: Text('取消', style: ts(Fs.h, weight: w700, color: C.jade, height: 1))),
        ),
      );
}
