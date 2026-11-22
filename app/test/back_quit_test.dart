// 安卓分頁和第一頁的返回鍵（lib/shell/back_quit.dart）：照 uni-app-plus 的 quit()——第一次按提示「再按一次退出應用」，2 秒內再按就退出。
// 提示固定繁體、用 App 自己的提示（ui/toast.dart），不跟手機語言（管理者 2026-11-23 決定）。
import 'package:dualplate/shell/back_quit.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

Future<BuildContext> pumpHost(WidgetTester tester) async {
  late BuildContext ctx;
  await tester.pumpWidget(MediaQuery(
    data: const MediaQueryData(size: Size(390, 844)),
    child: Directionality(
      textDirection: TextDirection.ltr,
      child: Overlay(initialEntries: [
        OverlayEntry(builder: (context) {
          ctx = context;
          return const SizedBox.expand();
        }),
      ]),
    ),
  ));
  return ctx;
}

void main() {
  late int quits;
  late DateTime now;

  setUp(() {
    quits = 0;
    now = DateTime(2026, 11, 22, 10);
    BackQuit.quitApp = () => quits++;
    BackQuit.now = () => now;
    BackQuit.reset();
  });

  tearDown(() => TestWidgetsFlutterBinding.instance.platformDispatcher.clearLocaleTestValue());

  group('提示文字', () {
    test('固定繁體「再按一次退出應用」', () => expect(quitText, '再按一次退出應用'));

    testWidgets('手機是英文也顯示繁體', (tester) async {
      tester.platformDispatcher.localeTestValue = const Locale('en', 'US');
      final ctx = await pumpHost(tester);
      BackQuit.press(ctx);
      await tester.pump();
      expect(find.text('再按一次退出應用'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('手機是簡體也顯示繁體', (tester) async {
      tester.platformDispatcher.localeTestValue = const Locale('zh', 'CN');
      final ctx = await pumpHost(tester);
      BackQuit.press(ctx);
      await tester.pump();
      expect(find.text('再按一次退出應用'), findsOneWidget);
      expect(find.text('再按一次退出应用'), findsNothing);
      await tester.pump(const Duration(seconds: 3));
    });
  });

  group('App 自己的提示', () {
    testWidgets('提示在 App 的浮層裏（不是原生 toast）', (tester) async {
      final ctx = await pumpHost(tester);
      BackQuit.press(ctx);
      await tester.pump();
      expect(find.descendant(of: find.byType(Overlay), matching: find.text(quitText)), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('1.9 秒時還在', (tester) async {
      final ctx = await pumpHost(tester);
      BackQuit.press(ctx);
      await tester.pump(const Duration(milliseconds: 1900));
      expect(find.text(quitText), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('2 秒後消失', (tester) async {
      final ctx = await pumpHost(tester);
      BackQuit.press(ctx);
      await tester.pump(BackQuit.toastTime);
      await tester.pump(const Duration(seconds: 1));
      expect(find.text(quitText), findsNothing);
    });
  });

  group('按返回鍵', () {
    testWidgets('第一次：提示，不退出', (tester) async {
      final ctx = await pumpHost(tester);
      BackQuit.press(ctx);
      await tester.pump();
      expect(find.text(quitText), findsOneWidget);
      expect(quits, 0);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('2 秒內再按：退出', (tester) async {
      final ctx = await pumpHost(tester);
      BackQuit.press(ctx);
      now = now.add(const Duration(milliseconds: 1500));
      BackQuit.press(ctx);
      expect(quits, 1);
      await tester.pump(const Duration(seconds: 3));
    });

    testWidgets('超過 2 秒才再按：重新提示，不退出', (tester) async {
      final ctx = await pumpHost(tester);
      BackQuit.press(ctx);
      await tester.pump(const Duration(milliseconds: 2100));
      now = now.add(const Duration(milliseconds: 2100));
      BackQuit.press(ctx);
      await tester.pump();
      expect(quits, 0);
      expect(find.text(quitText), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
    });
  });
}
