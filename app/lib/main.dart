// 跨境車牌管家 iOS／Android App（Flutter，docs/tasks/flutter-app-plan.md）。
// 啟動：先讀登入狀態，再經啟動畫面（shell/launch_view.dart，照 pages/launch/launch.vue 和 lib/launch.js）打開登入頁或首頁分頁。
// 開發時看組件樣板頁：flutter run --dart-define=START=/sample
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'business/app_update.dart' show UpdatePlatform;
import 'business/company_editor.dart';
import 'core/session.dart';
import 'pages/companies/companies_page.dart';
import 'shell/launch_view.dart';
import 'shell/router.dart';
import 'shell/system_bars.dart';
import 'ui/base.dart';
import 'ui/tokens.dart';

const _devStart = String.fromEnvironment('START');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // 「我的公司」的修改公司資料表單（階段 3c）；測試直接建 DualplateApp 時不經這裏，3a 的佔位測試照舊
  CompaniesPage.editor = CompanyEditor.builder;
  await setupSystemBars();
  await UpdatePlatform.load(); // 安卓 App 內更新：已安裝的版本
  try {
    await Session.load();
  } catch (_) {
    // 讀不到登入資料（例如 Keychain 暫時不能用）：當作未登入
  }
  if (_devStart.isNotEmpty) return runApp(DualplateApp(initialLocation: _devStart));
  // 啟動畫面（階段 4，shell/launch_view.dart）：iOS 第一幀等啟動圖載入好才畫，和原生啟動畫面接上
  if (defaultTargetPlatform == TargetPlatform.iOS) FirstFrame.defer();
  runApp(LaunchGate(app: (next) => DualplateApp(initialLocation: next)));
}

String startLocation() => _devStart.isNotEmpty ? _devStart : signedIn ? '/index' : '/login';

class DualplateApp extends StatefulWidget {
  const DualplateApp({super.key, this.initialLocation = '/sample', this.demoTabs = false});
  final String initialLocation;
  // 分頁顯示外殼示範空頁（shell/router.dart demoTabs，只在測試外殼時用）
  final bool demoTabs;
  @override
  State<DualplateApp> createState() => _DualplateAppState();
}

class _DualplateAppState extends State<DualplateApp> {
  late final GoRouter router = buildRouter(initialLocation: widget.initialLocation);

  @override
  void initState() {
    super.initState();
    demoTabs = widget.demoTabs;
  }

  @override
  void dispose() {
    router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
        title: '跨境車牌管家',
        debugShowCheckedModeBanner: false,
        routerConfig: router,
        // 紙色墊底：Android 換頁時上一頁變淡，透出的是頁面底色（uni-app animationAlphaBGColor = backgroundColor #F7F6F1）
        // 安卓底部導航列那一條按頁面底色配按鍵深淺（shell/system_bars.dart，階段 4）
        builder: (context, child) => navBarDefault(ColoredBox(color: C.paper, child: child!)),
        // 繁體字形：不指定時部分 Android 手機會用簡體或日文字形
        locale: const Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant', countryCode: 'HK'),
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        supportedLocales: const [Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant', countryCode: 'HK')],
        // 不用 Material 外觀：關掉水波紋和高亮，底色用紙色
        theme: ThemeData(
          useMaterial3: true,
          scaffoldBackgroundColor: C.paper,
          splashFactory: NoSplash.splashFactory,
          highlightColor: Colors.transparent,
          splashColor: Colors.transparent,
          textSelectionTheme: selectionTheme,
        ),
      );
}
