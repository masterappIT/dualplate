// 跨境車牌管家 iOS／Android App（Flutter，docs/tasks/flutter-app-plan.md）。
// 啟動：先讀登入狀態，未登入開登入頁、已登入開首頁分頁（照 lib/launch.js；預先取首頁資料屬階段 4）。
// 開發時看組件樣板頁：flutter run --dart-define=START=/sample
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'business/company_editor.dart';
import 'core/session.dart';
import 'pages/companies/companies_page.dart';
import 'shell/router.dart';
import 'ui/base.dart';
import 'ui/tokens.dart';

const _devStart = String.fromEnvironment('START');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // 「我的公司」的修改公司資料表單（階段 3c）；測試直接建 DualplateApp 時不經這裏，3a 的佔位測試照舊
  CompaniesPage.editor = CompanyEditor.builder;
  try {
    await Session.load();
  } catch (_) {
    // 讀不到登入資料（例如 Keychain 暫時不能用）：當作未登入
  }
  runApp(DualplateApp(initialLocation: startLocation()));
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
        builder: (context, child) => ColoredBox(color: C.paper, child: child!),
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
