// 提示：對應 mobile/ 的 uni.showToast({ title, icon: 'none', duration })（87 處，全部是 icon:'none'，沒有用 Wot 的 toast）。
// App 端由 uni-app 交給原生等待框（plus.nativeUI.showWaiting），數值和出處見 tokens.dart 的 ToastStyle。
// 行為照 uni-app-plus 的 _showToast／hide：
//   - 螢幕正中，不跟鍵盤移動；不擋下面的操作（modal:false），返回鍵照常傳給頁面（back:'transmit'）；
//   - 新提示出現時，舊的立即消失（hide('')）；
//   - duration 預設 1500 毫秒，到時自動關閉。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'tokens.dart';

_Toast? _current;

void showToast(BuildContext context, String title, {Duration duration = ToastStyle.duration}) => showToastOn(Overlay.of(context, rootOverlay: true), title, duration: duration);

// 頁面先關掉、稍後才提示時用（3c 新增公司：返回後 400ms 才提示）：先記下根浮層
void showToastOn(OverlayState overlay, String title, {Duration duration = ToastStyle.duration}) {
  if (!overlay.mounted) return;
  _current?.remove();
  final toast = _Toast(title, duration);
  _current = toast;
  overlay.insert(toast.entry);
}

// 對應 uni.hideToast()
void hideToast() => _current?.close();

class _Toast {
  _Toast(this.title, this.duration) {
    entry = OverlayEntry(builder: (_) => _ToastView(key: _key, title: title));
    _timer = Timer(duration, close);
  }
  final String title;
  final Duration duration;
  final _key = GlobalKey<_ToastViewState>();
  late final OverlayEntry entry;
  late final Timer _timer;
  bool _removed = false;

  // 到時或 hideToast：淡出後移走
  Future<void> close() async {
    _timer.cancel();
    if (_removed) return;
    await _key.currentState?.fadeOut();
    remove();
  }

  // 被新提示取代：立即移走
  void remove() {
    _timer.cancel();
    if (_removed) return;
    _removed = true;
    entry.remove();
    if (identical(_current, this)) _current = null;
  }
}

class _ToastView extends StatefulWidget {
  const _ToastView({super.key, required this.title});
  final String title;
  @override
  State<_ToastView> createState() => _ToastViewState();
}

class _ToastViewState extends State<_ToastView> with SingleTickerProviderStateMixin {
  late final _fade = AnimationController(vsync: this, duration: ToastStyle.fade)..forward();

  Future<void> fadeOut() => _fade.reverse().orCancel.catchError((_) {});

  @override
  void dispose() {
    _fade.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    return IgnorePointer(
      child: Center(
        child: FadeTransition(
          opacity: _fade,
          child: Container(
            constraints: BoxConstraints(maxWidth: width - 2 * ToastStyle.padding),
            padding: const EdgeInsets.all(ToastStyle.padding),
            decoration: BoxDecoration(color: ToastStyle.bg, borderRadius: BorderRadius.circular(ToastStyle.radius)),
            child: Text(widget.title, textAlign: TextAlign.center, style: ts(ToastStyle.fs, color: ToastStyle.fg, height: ToastStyle.line)),
          ),
        ),
      ),
    );
  }
}
