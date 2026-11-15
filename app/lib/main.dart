// 跨境車牌管家 iOS／Android App（Flutter，docs/tasks/flutter-app-plan.md）。
// 階段 1 進行中：啟動後先打開組件樣板頁；樣板頁有入口進外殼（底部四個分頁和示範子頁）。
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'shell/router.dart';
import 'ui/base.dart';
import 'ui/tokens.dart';

void main() => runApp(const DualplateApp());

class DualplateApp extends StatefulWidget {
  const DualplateApp({super.key, this.initialLocation = '/sample'});
  final String initialLocation;
  @override
  State<DualplateApp> createState() => _DualplateAppState();
}

class _DualplateAppState extends State<DualplateApp> {
  late final GoRouter router = buildRouter(initialLocation: widget.initialLocation);

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
