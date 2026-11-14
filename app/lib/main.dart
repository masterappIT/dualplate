// 跨境車牌管家 iOS／Android App（Flutter，docs/tasks/flutter-app-plan.md）。
// 階段 1 進行中：暫時只打開組件樣板頁。
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'ui/base.dart';
import 'ui/sample.dart';
import 'ui/tokens.dart';

void main() => runApp(const DualplateApp());

class DualplateApp extends StatelessWidget {
  const DualplateApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: '跨境車牌管家',
        debugShowCheckedModeBanner: false,
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
        home: const SamplePage(),
      );
}
