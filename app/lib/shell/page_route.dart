// 換頁動畫：對應 uni-app App 端預設的 pop-in／pop-out（uni-app-plus ANI_SHOW 'pop-in'、ANI_DURATION 300）。
// iOS：新頁從右邊滑入；上一頁同時左移 25% 並蓋上 20% 黑色；返回時倒過來（數值按現有 App 錄影量度）。
// Android：照 DCloud SDK 的 dcloud_page_open／close 動畫：上一頁左移 25% 並變淡到 0.6，返回 360ms，沒有陰影。
// iOS 可從左邊緣右滑返回（pages.json 沒有關掉 popGesture，App 端預設 'close'）；Android 沒有右滑返回。
// 彈窗（dialogs.dart 的確認框、選單）不是 PopInRoute，打開時下面的頁面不移動。
// 彈窗開着時右滑：彈窗蓋住整個畫面，手勢到不了頁面，所以甚麼都不發生——和現有 App 一樣（2026-11-15 在 16 Pro Max
// 「我的」頁核實：確認框開着時從左邊緣右滑，畫面不變，要按取消）。
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import '../ui/tokens.dart';

class PopInPage<T> extends Page<T> {
  const PopInPage({required this.child, super.key, super.name, super.arguments});
  final Widget child;
  @override
  Route<T> createRoute(BuildContext context) => PopInRoute<T>(page: this);
}

class PopInRoute<T> extends PageRoute<T> {
  PopInRoute({required PopInPage<T> page}) : super(settings: page);

  Widget get _child => (settings as PopInPage<T>).child;

  @override
  Color? get barrierColor => null;
  @override
  String? get barrierLabel => null;
  @override
  bool get maintainState => true;
  static bool get _android => defaultTargetPlatform == TargetPlatform.android;
  @override
  Duration get transitionDuration => _android ? Shell.pageDurationAndroid : Shell.pageDuration;
  @override
  Duration get reverseTransitionDuration => _android ? Shell.pageReverseDurationAndroid : Shell.pageDuration;

  // 只有下一頁也是換頁時，這一頁才跟着左移（彈窗打開時不動）
  @override
  bool canTransitionTo(TransitionRoute<dynamic> nextRoute) => nextRoute is PopInRoute;
  @override
  bool canTransitionFrom(TransitionRoute<dynamic> previousRoute) => previousRoute is PopInRoute;

  @override
  Widget buildPage(BuildContext context, Animation<double> animation, Animation<double> secondaryAnimation) => _child;

  @override
  Widget buildTransitions(BuildContext context, Animation<double> animation, Animation<double> secondaryAnimation, Widget child) {
    final linear = popGestureInProgress; // 手指拖動時跟手，不套曲線
    final swipe = defaultTargetPlatform == TargetPlatform.iOS;
    return PopInTransition(
      primary: animation,
      secondary: secondaryAnimation,
      linear: linear,
      child: swipe ? _BackSwipe(route: this, child: child) : child,
    );
  }

  // 右滑返回：拖動時直接控制這一頁的動畫進度（controller 只可在 route 內使用）
  void _swipeStart() => navigator!.didStartUserGesture();
  void _swipeUpdate(double fraction) => controller!.value -= fraction;
  void _swipeEnd(double velocity) {
    final nav = navigator!;
    final c = controller!;
    // 快速向右甩，或拖過一半，就返回；否則彈回原位
    final forward = velocity.abs() >= 1.0 ? velocity <= 0 : c.value > 0.5;
    const curve = Curves.fastLinearToSlowEaseIn;
    if (forward) {
      final ms = (Shell.pageDuration.inMilliseconds * (1 - c.value)).round();
      c.animateTo(1.0, duration: Duration(milliseconds: math.max(ms, 1)), curve: curve);
    } else {
      nav.pop();
      if (c.isAnimating) {
        final ms = (Shell.pageDuration.inMilliseconds * c.value).round();
        c.animateBack(0.0, duration: Duration(milliseconds: math.max(ms, 1)), curve: curve);
      }
    }
    if (c.isAnimating) {
      late AnimationStatusListener done;
      done = (status) {
        nav.didStopUserGesture();
        c.removeStatusListener(done);
      };
      c.addStatusListener(done);
    } else {
      nav.didStopUserGesture();
    }
  }
}

class PopInTransition extends StatefulWidget {
  const PopInTransition({super.key, required this.primary, required this.secondary, required this.linear, required this.child});
  final Animation<double> primary, secondary;
  final bool linear;
  final Widget child;
  @override
  State<PopInTransition> createState() => _PopInTransitionState();
}

class _PopInTransitionState extends State<PopInTransition> {
  static final _in = Tween(begin: const Offset(1, 0), end: Offset.zero);
  // CurvedAnimation 倒播時用 reverseCurve 的翻轉，所以 Android 的 decelerate 返回時也是先快後慢
  late CurvedAnimation _p, _s;
  bool get _android => defaultTargetPlatform == TargetPlatform.android;

  void _make() {
    final curve = _android ? Shell.pageCurveAndroid : Shell.pageCurve;
    _p = CurvedAnimation(parent: widget.primary, curve: curve, reverseCurve: curve);
    _s = CurvedAnimation(parent: widget.secondary, curve: curve, reverseCurve: curve);
  }

  @override
  void initState() {
    super.initState();
    _make();
  }

  @override
  void didUpdateWidget(PopInTransition old) {
    super.didUpdateWidget(old);
    if (old.primary != widget.primary || old.secondary != widget.secondary) {
      _p.dispose();
      _s.dispose();
      _make();
    }
  }

  @override
  void dispose() {
    _p.dispose();
    _s.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final Animation<double> p = widget.linear ? widget.primary : _p;
    final Animation<double> s = widget.linear ? widget.secondary : _s;
    if (_android) {
      return FadeTransition(
        opacity: s.drive(Tween(begin: 1.0, end: Shell.pageDimAndroid)),
        child: SlideTransition(
          position: s.drive(Tween(begin: Offset.zero, end: const Offset(-Shell.pageParallaxAndroid, 0))),
          child: SlideTransition(position: p.drive(_in), child: widget.child),
        ),
      );
    }
    return SlideTransition(
      position: s.drive(Tween(begin: Offset.zero, end: const Offset(-Shell.pageParallax, 0))),
      child: SlideTransition(
        position: p.drive(_in),
        child: Stack(fit: StackFit.passthrough, children: [
          widget.child,
          // 被下一頁蓋住時變暗（沒有下一頁時完全透明、不擋點擊）
          Positioned.fill(
            child: IgnorePointer(
              child: FadeTransition(
                opacity: s.drive(Tween(begin: 0.0, end: Shell.pageDim)),
                child: const ColoredBox(key: ValueKey('page-dim'), color: Color(0xFF000000)),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

class _BackSwipe extends StatefulWidget {
  const _BackSwipe({required this.route, required this.child});
  final PopInRoute<dynamic> route;
  final Widget child;
  @override
  State<_BackSwipe> createState() => _BackSwipeState();
}

class _BackSwipeState extends State<_BackSwipe> {
  late final HorizontalDragGestureRecognizer _drag;
  bool _active = false;

  @override
  void initState() {
    super.initState();
    _drag = HorizontalDragGestureRecognizer(debugOwner: this)
      ..onStart = _start
      ..onUpdate = _update
      ..onEnd = _end
      ..onCancel = _cancel;
  }

  @override
  void dispose() {
    _drag.dispose();
    if (_active) widget.route.navigator?.didStopUserGesture();
    super.dispose();
  }

  double get _width => context.size?.width ?? 1;

  void _down(PointerDownEvent event) {
    if (widget.route.popGestureEnabled) _drag.addPointer(event);
  }

  void _start(DragStartDetails _) {
    _active = true;
    widget.route._swipeStart();
  }

  void _update(DragUpdateDetails d) {
    if (_active) widget.route._swipeUpdate(d.primaryDelta! / _width);
  }

  void _end(DragEndDetails d) {
    if (!_active) return;
    _active = false;
    widget.route._swipeEnd(d.velocity.pixelsPerSecond.dx / _width);
  }

  void _cancel() {
    if (!_active) return;
    _active = false;
    widget.route._swipeEnd(0);
  }

  @override
  Widget build(BuildContext context) {
    final edge = math.max(Shell.swipeEdge, MediaQuery.paddingOf(context).left);
    return Stack(fit: StackFit.passthrough, children: [
      widget.child,
      Positioned(left: 0, width: edge, top: 0, bottom: 0, child: Listener(onPointerDown: _down, behavior: HitTestBehavior.translucent)),
    ]);
  }
}
