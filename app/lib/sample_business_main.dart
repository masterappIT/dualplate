// 只在開發時用：單獨打開 1b 業務小組件樣板，方便在模擬器截圖對照（不進正式版）。
// flutter build ios --simulator -t lib/sample_business_main.dart --dart-define=OFFSET=0
// OFFSET 是開頭向下捲動的距離（模擬器不能用指令捲動）。
import 'package:flutter/material.dart' show MaterialApp;
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'ui/base.dart';
import 'ui/sample_business.dart';
import 'ui/tokens.dart';

const _offset = int.fromEnvironment('OFFSET');

void main() => runApp(MaterialApp(
      debugShowCheckedModeBanner: false,
      locale: const Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant', countryCode: 'HK'),
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      supportedLocales: const [Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant', countryCode: 'HK')],
      home: ColoredBox(
        color: C.paper,
        child: SafeArea(bottom: false, child: PageBody(controller: ScrollController(initialScrollOffset: _offset.toDouble()), children: const [PageTitle('業務小組件'), SampleBusiness()])),
      ),
    ));
