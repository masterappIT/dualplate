// 頁面的 onShow 和頁面跳轉：對應 uni-app 的 onShow、uni.switchTab、uni.navigateTo（階段 3a）。
// onShow：現有 App 每次顯示頁面都會呼叫——第一次打開、切換到這個分頁、從上面的頁面返回、App 回到前景。
// Flutter 的分頁各自保留（StatefulShellRoute），不會重建，所以聽 go_router 的目前網址：網址變回本頁時當作 onShow。
// 測試裏沒有 go_router 時，只在第一次顯示時呼叫。
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../ui/back_gate.dart';
import '../ui/base.dart';

mixin PageShow<T extends StatefulWidget> on State<T> {
  // 本頁的網址路徑，例如 '/index'
  String get showPath;
  // 每次顯示都會呼叫（照 onShow(load)）
  void onShow();

  GoRouter? _router;
  String? _last;
  // 本頁第一次顯示時的完整網址（連查詢參數）。同一路徑可以疊幾頁（/scope 上面再開 /scope?id=…），
  // 只看路徑會分不出是哪一頁，所以記下自己的網址來比較
  String? _mine;
  late final AppLifecycleListener _life = AppLifecycleListener(onResume: () {
    if (mounted && pageVisible) onShow();
  });

  String? get _location {
    try {
      final config = _router?.routerDelegate.currentConfiguration;
      return config == null ? null : visibleLocation(config);
    } catch (_) {
      return null;
    }
  }

  // 本頁是不是正在顯示（沒有 go_router 時當作是）
  bool get pageVisible => _router == null || _location == (_mine ?? showPath);

  @override
  void initState() {
    super.initState();
    _life;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final location = _location;
      _mine = location != null && Uri.parse(location).path == showPath ? location : showPath;
      _last = location;
      onShow();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final router = GoRouter.maybeOf(context);
    if (router == _router) return;
    _router?.routerDelegate.removeListener(_check);
    _router = router;
    router?.routerDelegate.addListener(_check);
  }

  void _check() {
    final location = _location;
    if (location == _last) return;
    final was = _last;
    _last = location;
    final mine = _mine;
    if (mounted && mine != null && location == mine && was != mine && was != null) onShow();
  }

  @override
  void dispose() {
    _router?.routerDelegate.removeListener(_check);
    _life.dispose();
    super.dispose();
  }
}

// 畫面最上層的頁面網址（路徑加查詢參數）。不可用 currentConfiguration.uri：go_router 的 push 不改 uri（optionURLReflectsImperativeAPIs 預設關），
// 推入 /notifications 後 uri 仍是底下的 /index，返回時 uri 沒有變化，聽不出「回到本頁」。
// 所以沿最後一個 match 走到最深一層：推入的頁面是 ImperativeRouteMatch，它自己的 matches.uri 是推入時的完整網址；
// 不是推入的（分頁、go 打開的頁面）就是 currentConfiguration.uri。
String? visibleLocation(RouteMatchList config) {
  if (config.matches.isEmpty) return null;
  RouteMatchBase m = config.matches.last;
  while (m is ShellRouteMatch && m.matches.isNotEmpty) {
    m = m.matches.last;
  }
  final uri = m is ImperativeRouteMatch ? m.matches.uri : config.uri;
  return Uri(path: uri.path.isEmpty ? '/' : uri.path, query: uri.query.isEmpty ? null : uri.query).toString();
}

// 畫面最上層的頁面路徑（不含查詢參數）：AppNav.currentPath 用
String? visiblePath(RouteMatchList config) {
  final location = visibleLocation(config);
  return location == null ? null : Uri.parse(location).path;
}

// 返回先關本頁的浮層：對應 lib/back-close.js 的 closeOnBack（使用導覽、批文卡預覽）。
// 浮層開着時，Android 返回鍵（和導航列返回箭頭）先關浮層，不離開頁面。
// 頁面內容在彈窗區（DialogArea）的導航器裏，ModalRoute.of(context) 是彈窗區自己的底層；要登記在所在頁面的路由上。
mixin BackClose<T extends StatefulWidget> on State<T> {
  bool get backOpen;
  void backClose();

  late final _BackEntry _entry = _BackEntry(this);
  ModalRoute<dynamic>? _route;

  static ModalRoute<dynamic>? pageRouteOf(BuildContext context) {
    final nav = Navigator.maybeOf(context);
    return (nav == null ? null : ModalRoute.of(nav.context)) ?? ModalRoute.of(context);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = pageRouteOf(context);
    if (route == _route) return;
    _route?.unregisterPopEntry(_entry);
    if (_route != null) BackGate.remove(_route!, _entry.canPop);
    _route = route;
    route?.registerPopEntry(_entry);
    if (route != null) BackGate.add(route, _entry.canPop);
  }

  // 每次畫面更新後同步「可以返回」（不在 build 裏改，免得通知路由時正在建畫面）
  void syncBack() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _entry.canPop.value = !backOpen;
      });

  @override
  void dispose() {
    _route?.unregisterPopEntry(_entry);
    if (_route != null) BackGate.remove(_route!, _entry.canPop);
    _entry.canPop.dispose();
    super.dispose();
  }
}

class _BackEntry extends PopEntry<Object?> {
  _BackEntry(this.owner);
  final BackClose owner;
  final canPop = ValueNotifier<bool>(true);
  @override
  ValueListenable<bool> get canPopNotifier => canPop;
  @override
  void onPopInvokedWithResult(bool didPop, Object? result) {
    if (!didPop && owner.backOpen) owner.backClose();
  }
}

// 四個分頁（pages.json tabBar）
const tabPaths = ['/index', '/vehicles', '/companies', '/me'];

// 伺服器給的連結是 uni-app 的頁面路徑（/pages/plate-detail/plate-detail?id=…），換成 Flutter 的網址（/plate-detail?id=…）
String appPath(String link) => link.replaceFirstMapped(RegExp(r'^/pages/([^/?]+)/\1(?=$|\?)'), (m) => '/${m[1]}');

// 通知、待辦的連結：連結正好是分頁就 switchTab，否則 navigateTo。
// uni.navigateTo 不能打開分頁（帶查詢參數的分頁網址也一樣），會靜靜失敗；這裏照樣甚麼都不做
void openAppLink(BuildContext context, String link) {
  final path = appPath(link);
  if (tabPaths.contains(path)) return context.go(path);
  if (tabPaths.contains(Uri.parse(path).path)) return;
  context.push(path);
}

// 首頁按「正常／快到期／已逾期」時交給牌照頁的篩選（uni.setStorageSync('plateFilter', …)，牌照頁讀了就刪）
abstract final class VehiclesFilter {
  static String? preset;
}

// .section-head 的內容（標題＋右邊連結），不帶上下外距：外距 28／12 由頁面按外距合併處理
class SectionRow extends StatelessWidget {
  const SectionRow({super.key, required this.title, this.trailing});
  final String title;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Row(children: [
        Expanded(child: SectionTitle(title, bare: true)),
        if (trailing != null) ...[const SizedBox(width: 12), trailing!],
      ]);
}
