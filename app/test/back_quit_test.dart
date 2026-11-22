// 安卓分頁和第一頁的返回鍵（lib/shell/back_quit.dart）：照 uni-app-plus 的 quit()——第一次按提示「再按一次退出應用」，2 秒內再按就退出。
import 'dart:ui' show Locale;
import 'package:dualplate/shell/back_quit.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  late List<String> toasts;
  late int quits;
  late DateTime now;

  setUp(() {
    toasts = [];
    quits = 0;
    now = DateTime(2026, 11, 22, 10);
    BackQuit.nativeToast = toasts.add;
    BackQuit.quitApp = () => quits++;
    BackQuit.now = () => now;
    BackQuit.reset();
  });

  group('提示文字（uni.app.quit）', () {
    test('繁體（zh-Hant）', () => expect(quitText(const Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hant')), '再按一次退出應用'));
    test('香港（zh-HK）', () => expect(quitText(const Locale('zh', 'HK')), '再按一次退出應用'));
    test('台灣（zh-TW）', () => expect(quitText(const Locale('zh', 'TW')), '再按一次退出應用'));
    test('澳門（zh-MO）', () => expect(quitText(const Locale('zh', 'MO')), '再按一次退出應用'));
    test('簡體（zh-CN）', () => expect(quitText(const Locale('zh', 'CN')), '再按一次退出应用'));
    test('簡體（zh-Hans-HK）', () => expect(quitText(const Locale.fromSubtags(languageCode: 'zh', scriptCode: 'Hans', countryCode: 'HK')), '再按一次退出应用'));
    test('英文', () => expect(quitText(const Locale('en', 'US')), 'Press back button again to exit'));
    test('其他語言用英文', () => expect(quitText(const Locale('ja', 'JP')), 'Press back button again to exit'));
  });

  group('按返回鍵', () {
    testWidgets('第一次：提示，不退出', (tester) async {
      BackQuit.press();
      expect(toasts.length, 1);
      expect(quits, 0);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('2 秒內再按：退出', (tester) async {
      BackQuit.press();
      now = now.add(const Duration(milliseconds: 1500));
      BackQuit.press();
      expect(quits, 1);
      expect(toasts.length, 1);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('超過 2 秒才再按：重新提示，不退出', (tester) async {
      BackQuit.press();
      await tester.pump(const Duration(milliseconds: 2100));
      now = now.add(const Duration(milliseconds: 2100));
      BackQuit.press();
      expect(quits, 0);
      expect(toasts.length, 2);
      await tester.pump(const Duration(seconds: 3));
    });
  });
}
