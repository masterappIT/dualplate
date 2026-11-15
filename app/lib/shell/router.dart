// 頁面跳轉（go_router）：底部四個分頁用 StatefulShellRoute（切換不重建、各自保留狀態）；
// 其他頁面開在最上層導航器，蓋住分頁列（和 uni-app navigateTo 一樣）。
// 路徑沿用 pages.json 的頁面名稱。啟動頁由 main.dart 決定：未登入開登入頁（/login），已登入開首頁分頁（/index）；
// 組件樣板頁（/sample）只在開發時用 --dart-define=START=/sample 打開。
// 頁面跳轉經 core/api.dart 的 AppNav（401 打開登入頁、條款頁），在這裏接上 GoRouter。
// 返回時先關彈窗（mobile/src/lib/back-close.js）：Android 返回鍵由 go_router 先交給最上層導航器，
// 打開中的確認框、選單先被關掉（等於點了框外），不離開頁面；鎖定提示框例外，和現有 App 一樣照常返回頁面（dialogs.dart）。
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../core/api.dart';
import '../pages/login/login_page.dart';
import '../ui/base.dart';
import '../ui/dialogs.dart';
import '../ui/sample.dart';
import 'nav_bar.dart';
import 'page_route.dart';
import 'tab_bar.dart';

// 各分頁標題照 pages.json navigationBarTitleText
const tabPages = [('/index', '車牌管家'), ('/vehicles', '我的牌照'), ('/companies', '我的公司'), ('/me', '我的')];

GoRouter buildRouter({String initialLocation = '/sample'}) {
  final root = GlobalKey<NavigatorState>(debugLabel: 'root');
  final router = GoRouter(
    navigatorKey: root,
    initialLocation: initialLocation,
    routes: [
      GoRoute(path: '/sample', pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const SamplePage())),
      // 分頁只經 uni.switchTab／reLaunch 進入，現有 App 不播換頁動畫（showWebview 'none'）；之後在上面開的頁面照常左移
      StatefulShellRoute.indexedStack(
        pageBuilder: (context, state, shell) => _TabsPage(key: state.pageKey, child: TabsShell(shell)),
        branches: [
          for (final (path, title) in tabPages)
            StatefulShellBranch(routes: [
              GoRoute(path: path, pageBuilder: (context, state) => NoTransitionPage(key: state.pageKey, child: TabPlaceholder(title: title, path: path))),
            ]),
        ],
      ),
      GoRoute(path: '/demo', parentNavigatorKey: root, pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const ShellDemoPage())),
      // 登入頁：沒有導航列（navigationStyle custom）。啟動時未登入直接打開；登入失效（401）時從當前頁面打開
      GoRoute(path: '/login', parentNavigatorKey: root, pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const LoginPage())),
      // 服務條款、申請使用在階段 3d 才做，先放只有標題的空頁（標題照 pages.json）
      GoRoute(path: '/terms', parentNavigatorKey: root, pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const AppPage(title: '服務條款及私隱聲明'))),
      GoRoute(path: '/signup', parentNavigatorKey: root, pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const AppPage(title: '申請使用'))),
    ],
  );
  AppNav.currentPath = () => router.routerDelegate.currentConfiguration.uri.path;
  AppNav.push = (path) => router.push(path);
  AppNav.reLaunch = router.go;
  return router;
}

// 分頁外殼：進入時不播動畫；其他頁面蓋在上面時照 PopInRoute 左移、變暗
class _TabsPage extends PopInPage<void> {
  const _TabsPage({required super.child, super.key});
  @override
  Route<void> createRoute(BuildContext context) => _TabsRoute(page: this);
}

class _TabsRoute extends PopInRoute<void> {
  _TabsRoute({required super.page});
  @override
  Duration get transitionDuration => Duration.zero;
}

// 分頁內容先放空頁（階段 3a 換成真正的頁面）；首頁暫時放進入示範子頁的入口，只在開發時用
class TabPlaceholder extends StatelessWidget {
  const TabPlaceholder({super.key, required this.title, required this.path});
  final String title, path;
  @override
  Widget build(BuildContext context) => AppPage(
        title: title,
        child: path != '/index'
            ? null
            : PageBody(children: [
                Btn('打開示範子頁', kind: BtnKind.line, onTap: () => context.push('/demo')),
                const SizedBox(height: 12),
                Btn('底部選單', kind: BtnKind.line, onTap: () => choose(context, '有變動？', const ['換車', '換司機'])),
              ]),
      );
}

// 示範子頁：看換頁動畫、返回箭頭、右滑返回和返回先關彈窗（只在開發時用）
class ShellDemoPage extends StatefulWidget {
  const ShellDemoPage({super.key});
  @override
  State<ShellDemoPage> createState() => _ShellDemoPageState();
}

class _ShellDemoPageState extends State<ShellDemoPage> {
  String last = '';
  @override
  Widget build(BuildContext context) => AppPage(
        title: '示範子頁',
        child: PageBody(children: [
          Btn('確認框', kind: BtnKind.line, onTap: () async {
            final r = await ask(context, title: '刪除這張牌照？', msg: '刪除後不能復原。', ok: '刪除', danger: true);
            setState(() => last = r);
          }),
          const SizedBox(height: 12),
          Btn('底部選單', kind: BtnKind.line, onTap: () async {
            final r = await choose(context, '有變動？', const [ChoiceItem('換車', '車輛有變，更新車牌和車輛資料'), ChoiceItem('換司機', '加入或移除司機'), '其他']);
            setState(() => last = '選了 $r');
          }),
          const SizedBox(height: 12),
          Btn('鎖定提示框', kind: BtnKind.line, onTap: () => notice(context, title: '必須更新', msg: '請更新到最新版本。', ok: '更新', locked: true)),
          const SizedBox(height: 12),
          Btn('再開一頁', kind: BtnKind.line, onTap: () => context.push('/demo')),
          if (last.isNotEmpty) Subtle('結果：$last'),
        ]),
      );
}
