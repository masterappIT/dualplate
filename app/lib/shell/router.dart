// 頁面跳轉（go_router）：底部四個分頁用 StatefulShellRoute（切換不重建、各自保留狀態）；
// 其他頁面開在最上層導航器，蓋住分頁列（和 uni-app navigateTo 一樣）。
// 路徑沿用 pages.json 的頁面名稱。啟動頁由 main.dart 決定：未登入開登入頁（/login），已登入開首頁分頁（/index）；
// 組件樣板頁（/sample）只在開發時用 --dart-define=START=/sample 打開。
// 頁面跳轉經 core/api.dart 的 AppNav（401 打開登入頁、條款頁），在這裏接上 GoRouter。
// 返回時先關彈窗（mobile/src/lib/back-close.js）：Android 返回鍵由 go_router 先交給最上層導航器，
// 打開中的確認框、選單先被關掉（等於點了框外），不離開頁面；鎖定提示框擋住返回，只能按確認鍵關（dialogs.dart）。
// 分頁和第一頁（啟動時的登入頁）沒有上一頁：安卓返回鍵「再按一次退出」（back_quit.dart，階段 4）。
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../business/page_show.dart';
import '../core/api.dart';
import '../pages/billing/billing_page.dart';
import '../pages/close_account/close_account_page.dart';
import '../pages/companies/companies_page.dart';
import '../pages/company_new/company_new_page.dart';
import '../pages/deadlines/deadlines_page.dart';
import '../pages/index/index_page.dart';
import '../pages/login/login_page.dart';
import '../pages/me/me_page.dart';
import '../pages/messages/messages_page.dart';
import '../pages/notifications/notifications_page.dart';
import '../pages/plate_create/plate_create_page.dart';
import '../pages/plate_delete/plate_delete_page.dart';
import '../pages/plate_detail/plate_detail_page.dart';
import '../pages/profile/profile_page.dart';
import '../pages/rental/rental_page.dart';
import '../pages/rental_new/rental_new_page.dart';
import '../pages/reports/reports_page.dart';
import '../pages/request_detail/request_detail_page.dart';
import '../pages/requests/requests_page.dart';
import '../pages/scope/scope_page.dart';
import '../pages/self_change/self_change_page.dart';
import '../pages/signup/signup_page.dart';
import '../pages/support/support_page.dart';
import '../pages/terms/terms_page.dart';
import '../pages/vehicles/vehicles_page.dart';
import '../ui/tokens.dart';
import '../ui/base.dart';
import '../ui/dialogs.dart';
import '../ui/sample.dart';
import 'back_quit.dart';
import 'nav_bar.dart';
import 'system_bars.dart';
import 'page_route.dart';
import 'tab_bar.dart';

// 各分頁標題照 pages.json navigationBarTitleText
const tabPages = [('/index', '車牌管家'), ('/vehicles', '我的牌照'), ('/companies', '我的公司'), ('/me', '我的')];

// 分頁的真正頁面（階段 3a 實作）
final Map<String, Widget Function()> _tabBuilders = {
  '/index': () => const IndexPage(),
  '/vehicles': () => const VehiclesPage(),
  '/companies': () => const CompaniesPage(),
  '/me': () => const MePage(),
};

// 開在分頁上面的頁面（階段 3a–3d 實作）。路徑照 pages.json 頁面名稱；查詢參數原樣交給頁面。
// 3-0 全部先放佔位頁，各批只替換自己的頁面檔，不改這張表。
final Map<String, Widget Function(Map<String, String> q)> _pageBuilders = {
  '/deadlines': (q) => DeadlinesPage(query: q),
  '/notifications': (q) => NotificationsPage(query: q),
  '/plate-create': (q) => PlateCreatePage(query: q),
  '/plate-delete': (q) => PlateDeletePage(query: q),
  '/self-change': (q) => SelfChangePage(query: q),
  '/requests': (q) => RequestsPage(query: q),
  '/request-detail': (q) => RequestDetailPage(query: q),
  '/scope': (q) => ScopePage(query: q),
  '/rental': (q) => RentalPage(query: q),
  '/rental-new': (q) => RentalNewPage(query: q),
  '/billing': (q) => BillingPage(query: q),
  '/reports': (q) => ReportsPage(query: q),
  '/messages': (q) => MessagesPage(query: q),
  '/profile': (q) => ProfilePage(query: q),
  '/company-new': (q) => CompanyNewPage(query: q),
  '/signup': (q) => SignupPage(query: q),
  '/terms': (q) => TermsPage(query: q),
  '/close-account': (q) => CloseAccountPage(query: q),
  // 線上客服（docs/tasks/support-masterbox-plan.md）：內嵌網頁打開 MasterBox 對話
  '/support': (q) => SupportPage(query: q),
};

// 外殼示範：分頁顯示空頁，首頁放進入示範子頁的入口（只在開發時用：樣板頁「打開外殼」和 shell_test）。
// 真正的分頁頁面要讀 API，外殼的換頁、返回測試不依賴它們。
bool demoTabs = false;

GoRouter buildRouter({String initialLocation = '/sample'}) {
  final root = GlobalKey<NavigatorState>(debugLabel: 'root');
  final router = GoRouter(
    navigatorKey: root,
    initialLocation: initialLocation,
    routes: [
      GoRoute(path: '/sample', pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const SamplePage())),
      // 分頁只經 uni.switchTab／reLaunch 進入，現有 App 不播換頁動畫（showWebview 'none'）；之後在上面開的頁面照常左移
      StatefulShellRoute.indexedStack(
        pageBuilder: (context, state, shell) => _TabsPage(key: state.pageKey, child: QuitOnBack(child: TabsShell(shell))),
        branches: [
          for (final (path, title) in tabPages)
            StatefulShellBranch(routes: [
              GoRoute(path: path, pageBuilder: (context, state) => NoTransitionPage(key: state.pageKey, child: demoTabs ? TabPlaceholder(title: title, path: path) : _tabBuilders[path]!())),
            ]),
        ],
      ),
      GoRoute(path: '/demo', parentNavigatorKey: root, pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const ShellDemoPage())),
      // 登入頁：沒有導航列（navigationStyle custom）。啟動時未登入直接打開；登入失效（401）時從當前頁面打開
      GoRoute(path: '/login', parentNavigatorKey: root, pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const QuitOnBack(child: BottomStrip(color: C.paper, child: LoginPage())))),
      // 牌照詳情（階段 2c）：/plate-detail?id=…（new=1 是登記現有批文卡的入口）。開發時：--dart-define=START=/plate-detail?id=<牌照 id>
      GoRoute(
        path: '/plate-detail',
        parentNavigatorKey: root,
        pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: PlateDetailPage(id: state.uri.queryParameters['id'] ?? '', creating: state.uri.queryParameters['new'] == '1')),
      ),
      for (final MapEntry(key: path, value: build) in _pageBuilders.entries)
        GoRoute(path: path, parentNavigatorKey: root, pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: build(state.uri.queryParameters))),
    ],
  );
  // 目前看得見的頁面路徑。不用 currentConfiguration.uri：push 不改 uri，推入登入頁、條款頁後仍是底下的頁面（見 business/page_show.dart 的 visiblePath）
  AppNav.currentPath = () => visiblePath(router.routerDelegate.currentConfiguration) ?? '';
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

// 外殼示範用的分頁空頁（demoTabs）；首頁放進入示範子頁的入口，只在開發時用
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
