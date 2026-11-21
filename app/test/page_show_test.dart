// lib/business/page_show.dart：onShow（第一次顯示、切換分頁、從上面的頁面返回）、返回先關浮層、連結換算。一個情況一個測試。
import 'package:dualplate/business/page_show.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

final shows = <String, int>{};

class _Probe extends StatefulWidget {
  const _Probe(this.path, {this.label});
  final String path;
  // 計數用的名稱：同一路徑疊幾頁時用完整網址分開（預設是路徑）
  final String? label;
  @override
  State<_Probe> createState() => _ProbeState();
}

class _ProbeState extends State<_Probe> with PageShow {
  @override
  String get showPath => widget.path;
  @override
  void onShow() => shows[widget.label ?? widget.path] = (shows[widget.label ?? widget.path] ?? 0) + 1;
  @override
  Widget build(BuildContext context) => Text(widget.path, textDirection: TextDirection.ltr);
}

// 和 shell/router.dart 同樣結構：分頁用 StatefulShellRoute，其他頁開在最上層導航器
GoRouter _router() {
  final root = GlobalKey<NavigatorState>();
  return GoRouter(navigatorKey: root, initialLocation: '/index', routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, shell) => shell,
      branches: [
        for (final p in ['/index', '/vehicles'])
          StatefulShellBranch(routes: [GoRoute(path: p, builder: (context, state) => _Probe(p))]),
      ],
    ),
    GoRoute(path: '/notifications', parentNavigatorKey: root, builder: (context, state) => const _Probe('/notifications')),
    GoRoute(path: '/plate-detail', parentNavigatorKey: root, builder: (context, state) => const _Probe('/plate-detail')),
    GoRoute(path: '/scope', parentNavigatorKey: root, builder: (context, state) => _Probe('/scope', label: state.uri.toString())),
  ]);
}

Future<GoRouter> _pump(WidgetTester tester) async {
  shows.clear();
  final router = _router();
  await tester.pumpWidget(WidgetsApp.router(routerConfig: router, color: const Color(0xFF000000)));
  await tester.pumpAndSettle();
  return router;
}

class _Overlay extends StatefulWidget {
  const _Overlay();
  @override
  State<_Overlay> createState() => _OverlayState();
}

class _OverlayState extends State<_Overlay> with BackClose {
  bool open = true;
  int closed = 0;
  @override
  bool get backOpen => open;
  @override
  void backClose() => setState(() {
        open = false;
        closed++;
      });
  @override
  Widget build(BuildContext context) {
    syncBack();
    return Text(open ? 'open' : 'closed', textDirection: TextDirection.ltr);
  }
}

void main() {
  group('onShow', () {
    testWidgets('第一次顯示時呼叫一次', (tester) async {
      await _pump(tester);
      expect(shows, {'/index': 1});
    });

    testWidgets('切換到另一個分頁時，那個分頁呼叫', (tester) async {
      final router = await _pump(tester);
      router.go('/vehicles');
      await tester.pumpAndSettle();
      expect(shows, {'/index': 1, '/vehicles': 1});
    });

    testWidgets('切回原來的分頁時再呼叫（分頁保留，不重建）', (tester) async {
      final router = await _pump(tester);
      router.go('/vehicles');
      await tester.pumpAndSettle();
      router.go('/index');
      await tester.pumpAndSettle();
      expect(shows['/index'], 2);
    });

    testWidgets('從推入的頁面返回分頁時呼叫（go_router 的 push 不改 uri，不能用 uri）', (tester) async {
      final router = await _pump(tester);
      router.push('/notifications');
      await tester.pumpAndSettle();
      router.pop();
      await tester.pumpAndSettle();
      expect([shows['/index'], shows['/notifications']], [2, 1]);
    });

    testWidgets('兩層推入後返回中間那頁時，中間那頁呼叫', (tester) async {
      final router = await _pump(tester);
      router.push('/notifications');
      await tester.pumpAndSettle();
      router.push('/plate-detail?id=p1');
      await tester.pumpAndSettle();
      router.pop();
      await tester.pumpAndSettle();
      expect([shows['/notifications'], shows['/index']], [2, 1]);
    });

    testWidgets('推入頁面時，底下的分頁不呼叫', (tester) async {
      final router = await _pump(tester);
      router.push('/notifications');
      await tester.pumpAndSettle();
      expect(shows['/index'], 1);
    });

    testWidgets('visiblePath：返回後是底下的分頁路徑', (tester) async {
      final router = await _pump(tester);
      router.push('/notifications');
      await tester.pumpAndSettle();
      expect(visiblePath(router.routerDelegate.currentConfiguration), '/notifications');
      router.pop();
      await tester.pumpAndSettle();
      expect(visiblePath(router.routerDelegate.currentConfiguration), '/index');
    });
  });

  group('onShow：同一路徑不同查詢參數', () {
    testWidgets('從 /scope?id=1 返回 /scope 時，/scope 呼叫', (tester) async {
      final router = await _pump(tester);
      router.push('/scope');
      await tester.pumpAndSettle();
      router.push('/scope?id=1');
      await tester.pumpAndSettle();
      router.pop();
      await tester.pumpAndSettle();
      expect([shows['/scope'], shows['/scope?id=1']], [2, 1]);
    });

    testWidgets('推入 /scope?id=1 時，底下的 /scope 不呼叫', (tester) async {
      final router = await _pump(tester);
      router.push('/scope');
      await tester.pumpAndSettle();
      router.push('/scope?id=1');
      await tester.pumpAndSettle();
      expect([shows['/scope'], shows['/scope?id=1']], [1, 1]);
    });

    testWidgets('/scope?id=1 上面再開 /scope?id=2，返回時只有 /scope?id=1 呼叫', (tester) async {
      final router = await _pump(tester);
      router.push('/scope?id=1');
      await tester.pumpAndSettle();
      router.push('/scope?id=2');
      await tester.pumpAndSettle();
      router.pop();
      await tester.pumpAndSettle();
      expect([shows['/scope?id=1'], shows['/scope?id=2'], shows['/index']], [2, 1, 1]);
    });

    testWidgets('分頁不會多載入：經兩層帶參數的頁面返回首頁，首頁只多呼叫一次', (tester) async {
      final router = await _pump(tester);
      router.push('/scope');
      await tester.pumpAndSettle();
      router.push('/scope?id=1');
      await tester.pumpAndSettle();
      router.pop();
      await tester.pumpAndSettle();
      router.pop();
      await tester.pumpAndSettle();
      expect([shows['/index'], shows['/vehicles']], [2, null]);
    });

    testWidgets('分頁不會多載入：切分頁來回，每次顯示只呼叫一次', (tester) async {
      final router = await _pump(tester);
      for (final p in ['/vehicles', '/index', '/vehicles', '/index']) {
        router.go(p);
        await tester.pumpAndSettle();
      }
      expect([shows['/index'], shows['/vehicles']], [3, 2]);
    });

    testWidgets('App 回到前景：只有最上面那頁呼叫（同一路徑底下那頁不呼叫）', (tester) async {
      final router = await _pump(tester);
      router.push('/scope');
      await tester.pumpAndSettle();
      router.push('/scope?id=1');
      await tester.pumpAndSettle();
      for (final s in [AppLifecycleState.inactive, AppLifecycleState.hidden, AppLifecycleState.paused, AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]) {
        tester.binding.handleAppLifecycleStateChanged(s);
      }
      await tester.pump();
      expect([shows['/scope'], shows['/scope?id=1'], shows['/index']], [1, 2, 1]);
    });

    testWidgets('visibleLocation：推入帶參數的頁面時包括查詢參數', (tester) async {
      final router = await _pump(tester);
      router.push('/scope?id=1');
      await tester.pumpAndSettle();
      expect([visibleLocation(router.routerDelegate.currentConfiguration), visiblePath(router.routerDelegate.currentConfiguration)], ['/scope?id=1', '/scope']);
    });

    testWidgets('visibleLocation：返回後是底下那頁的網址', (tester) async {
      final router = await _pump(tester);
      router.push('/scope');
      await tester.pumpAndSettle();
      router.push('/scope?id=1');
      await tester.pumpAndSettle();
      router.pop();
      await tester.pumpAndSettle();
      expect(visibleLocation(router.routerDelegate.currentConfiguration), '/scope');
    });
  });

  group('返回先關浮層', () {
    testWidgets('浮層開着時返回只關浮層，不離開頁面', (tester) async {
      final root = GlobalKey<NavigatorState>();
      final router = GoRouter(navigatorKey: root, initialLocation: '/a', routes: [
        GoRoute(path: '/a', builder: (context, state) => const Text('a', textDirection: TextDirection.ltr)),
        GoRoute(path: '/b', builder: (context, state) => const _Overlay()),
      ]);
      await tester.pumpWidget(WidgetsApp.router(routerConfig: router, color: const Color(0xFF000000)));
      router.push('/b');
      await tester.pumpAndSettle();
      await root.currentState!.maybePop();
      await tester.pumpAndSettle();
      expect([find.text('closed').evaluate().length, find.text('a').evaluate().length], [1, 0]);
    });

    testWidgets('浮層關了之後返回照常離開頁面', (tester) async {
      final root = GlobalKey<NavigatorState>();
      final router = GoRouter(navigatorKey: root, initialLocation: '/a', routes: [
        GoRoute(path: '/a', builder: (context, state) => const Text('a', textDirection: TextDirection.ltr)),
        GoRoute(path: '/b', builder: (context, state) => const _Overlay()),
      ]);
      await tester.pumpWidget(WidgetsApp.router(routerConfig: router, color: const Color(0xFF000000)));
      router.push('/b');
      await tester.pumpAndSettle();
      await root.currentState!.maybePop();
      await tester.pumpAndSettle();
      await root.currentState!.maybePop();
      await tester.pumpAndSettle();
      expect(find.text('a'), findsOneWidget);
    });
  });

  group('連結', () {
    test('appPath：uni-app 頁面路徑換成 Flutter 網址，保留查詢參數', () {
      expect(appPath('/pages/plate-detail/plate-detail?id=p1'), '/plate-detail?id=p1');
    });

    test('appPath：分頁路徑', () {
      expect(appPath('/pages/vehicles/vehicles'), '/vehicles');
    });

    test('appPath：不是 uni-app 寫法的照舊', () {
      expect(appPath('/requests?service=renewal'), '/requests?service=renewal');
    });

    test('appPath：資料夾和檔名不同的不換', () {
      expect(appPath('/pages/a/b'), '/pages/a/b');
    });
  });
}
