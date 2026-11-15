// 返回時先關彈窗：對應 mobile/src/lib/back-close.js。
// 確認框、提示框、底部選單（dialogs.dart）都是開在最上層導航器上、沒有頁面設定的路由（pageless route），
// 這裏用 NavigatorObserver 記下打開中的彈窗，不必每個彈窗自己登記。
// - Android 返回鍵：go_router 先問最上層導航器，打開中的彈窗先被關掉（等於點了框外：ask 回傳 'modal'、choose 回傳 -1），
//   不離開頁面；鎖定的提示框（notice locked）關不了，和點框外一樣。
// - iOS 從左邊緣右滑：彈窗打開時先關最上層彈窗，不離開頁面（SwipeCloseLayer）；沒有彈窗時由 page_route.dart 照常右滑返回。
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import '../ui/tokens.dart';

class Layers extends NavigatorObserver {
  final List<Route<dynamic>> _open = [];

  static bool isLayer(Route<dynamic> route) => route.settings is! Page && route is ModalRoute && !route.opaque;

  bool get isOpen => _open.isNotEmpty;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (isLayer(route)) _open.add(route);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => _open.remove(route);

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) => _open.remove(route);

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    _open.remove(oldRoute);
    if (newRoute != null && isLayer(newRoute)) _open.add(newRoute);
  }

  // 關掉最上層彈窗（等於點了框外）；有彈窗回傳 true
  Future<bool> closeTop() async {
    if (_open.isEmpty) return false;
    final nav = _open.last.navigator;
    if (nav == null) return false;
    await nav.maybePop();
    return true;
  }
}

// 放在整個 App 最外層：iOS 上彈窗打開時，從左邊緣向右滑關掉最上層彈窗
class SwipeCloseLayer extends StatefulWidget {
  const SwipeCloseLayer({super.key, required this.layers, required this.child});
  final Layers layers;
  final Widget child;
  @override
  State<SwipeCloseLayer> createState() => _SwipeCloseLayerState();
}

class _SwipeCloseLayerState extends State<SwipeCloseLayer> {
  Offset? _start;
  int? _pointer;

  void _down(PointerDownEvent e) {
    if (defaultTargetPlatform != TargetPlatform.iOS || !widget.layers.isOpen) return;
    if (e.position.dx > Shell.swipeEdge) return;
    _start = e.position;
    _pointer = e.pointer;
  }

  void _move(PointerMoveEvent e) {
    final start = _start;
    if (start == null || e.pointer != _pointer) return;
    final d = e.position - start;
    if (d.dx > kTouchSlop && d.dx > d.dy.abs()) {
      _start = null;
      widget.layers.closeTop();
    }
  }

  void _end(PointerEvent e) {
    if (e.pointer == _pointer) _start = null;
  }

  @override
  Widget build(BuildContext context) =>
      Listener(behavior: HitTestBehavior.translucent, onPointerDown: _down, onPointerMove: _move, onPointerUp: _end, onPointerCancel: _end, child: widget.child);
}
