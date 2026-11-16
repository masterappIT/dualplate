// 載入中：對應 uni.showLoading({ title, mask:true }) 和 uni.hideLoading()。
// App 端由 uni-app 交給原生等待框 plus.nativeUI.showWaiting：有圖示時框 140×112、內距 10、字 16，
// 底色、圓角、淡入淡出和提示（toast.dart）相同；mask:true 時擋住整個畫面的操作（不變暗）。
// 新的提示或載入框出現時舊的立即消失（uni-app 的 hide('')），所以 showToast 前頁面都會先 hideLoading。
import 'dart:math' as math;
import 'package:flutter/widgets.dart';
import 'tokens.dart';

OverlayEntry? _entry;
GlobalKey<_LoadingViewState>? _key;

void showLoading(BuildContext context, String title, {bool mask = true}) {
  _remove();
  final key = GlobalKey<_LoadingViewState>();
  _key = key;
  _entry = OverlayEntry(builder: (_) => _LoadingView(key: key, title: title, mask: mask));
  Overlay.of(context, rootOverlay: true).insert(_entry!);
}

Future<void> hideLoading() async {
  final entry = _entry, key = _key;
  if (entry == null) return;
  _entry = null;
  _key = null;
  // 還沒畫出來（例如請求很快就完成）：直接拿走
  final state = key?.currentState;
  if (state != null) await state.fadeOut();
  entry.remove();
}

bool get loadingShown => _entry != null;

void _remove() {
  final entry = _entry;
  _entry = null;
  _key = null;
  if (entry != null && entry.mounted) entry.remove();
}

class _LoadingView extends StatefulWidget {
  const _LoadingView({super.key, required this.title, required this.mask});
  final String title;
  final bool mask;
  @override
  State<_LoadingView> createState() => _LoadingViewState();
}

class _LoadingViewState extends State<_LoadingView> with TickerProviderStateMixin {
  late final _fade = AnimationController(vsync: this, duration: ToastStyle.fade)..forward();
  late final _spin = AnimationController(vsync: this, duration: const Duration(milliseconds: 1000))..repeat();

  bool closing = false;

  // 收起時立即不再擋點擊（hideLoading 後馬上彈出的確認框要能按），框本身淡出
  Future<void> fadeOut() async {
    if (!mounted) return;
    setState(() => closing = true);
    await _fade.reverse().orCancel.catchError((_) {});
  }

  @override
  void dispose() {
    _fade.dispose();
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final box = Center(
      child: FadeTransition(
        opacity: _fade,
        child: Container(
          width: LoadingStyle.width,
          height: LoadingStyle.height,
          padding: const EdgeInsets.all(ToastStyle.padding),
          decoration: BoxDecoration(color: ToastStyle.bg, borderRadius: BorderRadius.circular(ToastStyle.radius)),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            SizedBox.square(dimension: LoadingStyle.spinner, child: CustomPaint(painter: _Spinner(_spin))),
            const SizedBox(height: 8),
            Text(widget.title, maxLines: 2, textAlign: TextAlign.center, style: ts(ToastStyle.fs, color: ToastStyle.fg, height: ToastStyle.line)),
          ]),
        ),
      ),
    );
    // mask：透明的一層擋住下面的點擊
    return widget.mask && !closing ? Stack(children: [const Positioned.fill(child: AbsorbPointer(child: SizedBox.expand())), box]) : IgnorePointer(child: box);
  }
}

// iOS 系統轉圈（UIActivityIndicatorView）：12 條短線，每 1/12 秒前進一格，越後面越淡
class _Spinner extends CustomPainter {
  _Spinner(this.spin) : super(repaint: spin);
  final Animation<double> spin;
  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero), r = size.width / 2;
    final step = (spin.value * 12).floor();
    final paint = Paint()
      ..strokeCap = StrokeCap.round
      ..strokeWidth = r * .2;
    for (var i = 0; i < 12; i++) {
      final a = (i - step) * math.pi * 2 / 12 - math.pi / 2;
      final alpha = ((12 - ((i - step) % 12 + 12) % 12) / 12).clamp(.25, 1.0);
      paint.color = LoadingStyle.spinnerColor.withValues(alpha: alpha);
      final d = Offset(math.cos(a), math.sin(a));
      canvas.drawLine(c + d * r * .5, c + d * r * .9, paint);
    }
  }

  @override
  bool shouldRepaint(_Spinner old) => false;
}
