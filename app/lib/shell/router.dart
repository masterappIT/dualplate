// 頁面跳轉（go_router）：底部四個分頁用 StatefulShellRoute（切換不重建、各自保留狀態）；
// 其他頁面開在最上層導航器，蓋住分頁列（和 uni-app navigateTo 一樣）。
// 路徑沿用 pages.json 的頁面名稱。階段 1 期間啟動後先打開組件樣板頁（/sample）。
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../ui/base.dart';
import '../ui/dialogs.dart';
import '../ui/sample.dart';
import 'back_close.dart';
import 'nav_bar.dart';
import 'page_route.dart';
import 'tab_bar.dart';

// 各分頁標題照 pages.json navigationBarTitleText
const tabPages = [('/index', '車牌管家'), ('/vehicles', '我的牌照'), ('/companies', '我的公司'), ('/me', '我的')];

GoRouter buildRouter({required Layers layers, String initialLocation = '/sample'}) {
  final root = GlobalKey<NavigatorState>(debugLabel: 'root');
  return GoRouter(
    navigatorKey: root,
    initialLocation: initialLocation,
    observers: [layers],
    routes: [
      GoRoute(path: '/sample', pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const SamplePage())),
      StatefulShellRoute.indexedStack(
        pageBuilder: (context, state, shell) => PopInPage(key: state.pageKey, child: TabsShell(shell)),
        branches: [
          for (final (path, title) in tabPages)
            StatefulShellBranch(routes: [
              GoRoute(path: path, pageBuilder: (context, state) => NoTransitionPage(key: state.pageKey, child: TabPlaceholder(title: title, path: path))),
            ]),
        ],
      ),
      GoRoute(path: '/demo', parentNavigatorKey: root, pageBuilder: (context, state) => PopInPage(key: state.pageKey, child: const ShellDemoPage())),
    ],
  );
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
