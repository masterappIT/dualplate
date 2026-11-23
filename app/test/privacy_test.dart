// 安卓第一次打開的條款同意框（lib/core/privacy.dart、lib/shell/launch_view.dart PrivacyDialog）：
// 文字逐字對照 test/fixtures/android_privacy.json（以前 DCloud 版的 mobile/src/androidPrivacy.json，階段 6 刪除時搬來這裏）；同意狀態按 version 記下。一個情況一個測試。
import 'dart:convert';
import 'dart:io';
import 'package:dualplate/core/external.dart' show debugLaunchUrl;
import 'package:dualplate/core/privacy.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/shell/launch_view.dart';
import 'package:flutter/gestures.dart' show TapGestureRecognizer;
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

final Map<String, dynamic> source = jsonDecode(File('test/fixtures/android_privacy.json').readAsStringSync());

// <a href="x">t</a> → (t, x)；<br/> 分行
List<List<PrivacySpan>> parse(String html) => html.split('<br/>').map((line) {
      final spans = <PrivacySpan>[];
      var rest = line;
      final link = RegExp(r'<a href="([^"]+)">([^<]+)</a>');
      while (true) {
        final m = link.firstMatch(rest);
        if (m == null) break;
        if (m.start > 0) spans.add((text: rest.substring(0, m.start), link: null));
        spans.add((text: m[2]!, link: m[1]));
        rest = rest.substring(m.end);
      }
      if (rest.isNotEmpty) spans.add((text: rest, link: null));
      return spans;
    }).toList();

Future<void> start([Map<String, Object> prefs = const {}]) async {
  FlutterSecureStorage.setMockInitialValues({});
  SharedPreferences.setMockInitialValues(Map.of(prefs));
  await Session.load();
}

Future<List<String>> show(WidgetTester tester, PrivacyPrompt prompt, List<String> taps) async {
  final pressed = <String>[];
  await tester.pumpWidget(Directionality(
    textDirection: TextDirection.ltr,
    child: PrivacyDialog(prompt: prompt, onAccept: () => pressed.add('accept'), onRefuse: () => pressed.add('refuse'), onLink: pressed.add),
  ));
  return pressed;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('文字照抄 androidPrivacy.json', () {
    test('版本', () => expect(privacyVersion, source['version']));
    test('第一個框的標題', () => expect(privacyFirst.title, source['title']));
    test('第一個框的內容和連結', () => expect(privacyFirst.message, parse(source['message'])));
    test('第一個框的同意鍵', () => expect(privacyFirst.accept, source['buttonAccept']));
    test('第一個框的不同意鍵', () => expect(privacyFirst.refuse, source['buttonRefuse']));
    test('再問一次的標題', () => expect(privacySecond.title, source['second']['title']));
    test('再問一次的內容和連結', () => expect(privacySecond.message, parse(source['second']['message'])));
    test('再問一次的同意鍵', () => expect(privacySecond.accept, source['second']['buttonAccept']));
    test('再問一次的退出鍵', () => expect(privacySecond.refuse, source['second']['buttonRefuse']));
    test('返回鍵不退出（backToExit false）', () => expect(source['backToExit'], isFalse));
  });

  group('樣式照抄 androidPrivacy.json', () {
    String hex(Color c) => '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';
    test('圓角', () => expect('${PrivacyStyle.radius.toInt()}px', source['styles']['borderRadius']));
    test('標題顏色', () => expect(hex(PrivacyStyle.title), source['styles']['title']['color']));
    test('內容顏色', () => expect(hex(PrivacyStyle.content), source['styles']['content']['color']));
    test('同意鍵顏色', () => expect(hex(PrivacyStyle.accept), source['styles']['buttonAccept']['color']));
    test('不同意鍵顏色', () => expect(hex(PrivacyStyle.refuse), source['styles']['buttonRefuse']['color']));
  });

  group('同意狀態', () {
    test('第一次打開：要問', () async {
      await start();
      expect(privacyNeeded(), isTrue);
    });

    test('同意後：不再問', () async {
      await start();
      privacyAgreed();
      await Session.flush();
      await Session.load();
      expect(privacyNeeded(), isFalse);
    });

    test('同意的是舊版本：要再問', () async {
      await start({'androidPrivacyAgreed': '0'});
      expect(privacyNeeded(), isTrue);
    });

    test('退出登入不影響同意狀態', () async {
      await start({'androidPrivacyAgreed': privacyVersion});
      Session.clear();
      await Session.flush();
      await Session.load();
      expect(privacyNeeded(), isFalse);
    });
  });

  group('同意框畫面', () {
    testWidgets('第一個框：標題和兩個按鈕', (tester) async {
      await show(tester, privacyFirst, []);
      expect(find.text('服務條款及私隱聲明'), findsOneWidget);
      expect(find.text('同意並繼續'), findsOneWidget);
      expect(find.text('不同意'), findsOneWidget);
    });

    testWidgets('按同意並繼續', (tester) async {
      final pressed = await show(tester, privacyFirst, []);
      await tester.tap(find.text('同意並繼續'));
      expect(pressed, ['accept']);
    });

    testWidgets('按不同意', (tester) async {
      final pressed = await show(tester, privacyFirst, []);
      await tester.tap(find.text('不同意'));
      expect(pressed, ['refuse']);
    });

    testWidgets('第一個框：後面是變暗的深綠 #041813', (tester) async {
      await show(tester, privacyFirst, []);
      expect(find.byWidgetPredicate((w) => w is ColoredBox && w.color.toARGB32() == 0xFF041813), findsOneWidget);
    });

    testWidgets('再問一次：後面和第一次一樣是變暗的深綠 #041813', (tester) async {
      await show(tester, privacySecond, []);
      expect(find.byWidgetPredicate((w) => w is ColoredBox && w.color.toARGB32() == 0xFF041813), findsOneWidget);
    });

    testWidgets('再問一次：不再是深灰 #141414', (tester) async {
      await show(tester, privacySecond, []);
      expect(find.byWidgetPredicate((w) => w is ColoredBox && w.color.toARGB32() == 0xFF141414), findsNothing);
    });

    testWidgets('再問一次：標題', (tester) async {
      await show(tester, privacySecond, []);
      expect(find.text('需要你的同意'), findsOneWidget);
    });

    testWidgets('再問一次：退出鍵照條款原文「退出 App」', (tester) async {
      await show(tester, privacySecond, []);
      expect(find.text('退出 App'), findsOneWidget);
    });

    testWidgets('再問一次：退出鍵不轉成大寫「退出 APP」', (tester) async {
      await show(tester, privacySecond, []);
      expect(find.text('退出 APP'), findsNothing);
    });

    testWidgets('再問一次：按退出 App', (tester) async {
      final pressed = await show(tester, privacySecond, []);
      await tester.tap(find.text('退出 App'));
      expect(pressed, ['refuse']);
    });
  });

  group('條款連結', () {
    tearDown(() => debugLaunchUrl = null);

    test('交給系統瀏覽器打開（launchExternal）', () async {
      final opened = <Uri>[];
      debugLaunchUrl = (uri) async {
        opened.add(uri);
        return true;
      };
      PrivacyDialog.openLink('https://dualplate.masterappinc.com/#/pages/terms/terms');
      await Future<void>.delayed(Duration.zero);
      expect(opened, [Uri.parse('https://dualplate.masterappinc.com/#/pages/terms/terms')]);
    });

    test('打不開時不報錯', () async {
      debugLaunchUrl = (uri) async => false;
      PrivacyDialog.openLink('https://dualplate.masterappinc.com/#/pages/terms/terms');
      await Future<void>.delayed(Duration.zero);
    });

    testWidgets('框裏的連結：點了交給 onLink', (tester) async {
      final pressed = await show(tester, privacyFirst, []);
      final link = privacyFirst.message.expand((l) => l).firstWhere((s) => s.link != null);
      final text = tester.widget<RichText>(find.byType(RichText).at(1));
      var hit = false;
      text.text.visitChildren((span) {
        if (span is TextSpan && span.text == link.text) {
          (span.recognizer as TapGestureRecognizer).onTap!();
          hit = true;
          return false;
        }
        return true;
      });
      expect(hit, isTrue);
      expect(pressed, [link.link]);
    });
  });
}
