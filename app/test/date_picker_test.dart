// 日期選擇器（lib/ui/pickers.dart showDatePicker）：3a 修正改成和現有 App 一樣的 iOS 原生日期滾輪（CupertinoPicker 三欄）。
// 一個情況一個測試。（原有的「三欄加年月日」「沒有值時打開在今天」等在 plate_detail_components_test.dart）
import 'package:dualplate/ui/pickers.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

// 440×956（16／17 Pro Max）的外殼，有導航器
Widget host() => MediaQuery(
      data: const MediaQueryData(size: Size(440, 956), padding: EdgeInsets.only(top: 62, bottom: 34)),
      child: WidgetsApp(
        color: const Color(0xFFFFFFFF),
        pageRouteBuilder: <T>(settings, builder) => PageRouteBuilder<T>(settings: settings, pageBuilder: (context, _, _) => builder(context)),
        home: const SizedBox(height: 10),
      ),
    );

Future<Future<String?>> open(WidgetTester tester, {String? value, String? start, String? end}) async {
  tester.view.physicalSize = const Size(1320, 2868);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(host());
  final result = showDatePicker(tester.element(find.byType(SizedBox).last), value: value, start: start, end: end, now: DateTime(2026, 11, 16));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
  return result;
}

Future<String?> done(WidgetTester tester, Future<String?> result) async {
  await tester.tap(find.byKey(const ValueKey('picker-done')));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
  return result;
}

// 把某一欄向上推 rows 行（負數向下），等滾輪停定
Future<void> scroll(WidgetTester tester, String label, int rows) async {
  await tester.drag(find.text(label), Offset(0, -DatePickerStyle.itemExtent * rows));
  await tester.pumpAndSettle();
}

void main() {
  group('外觀', () {
    testWidgets('頂條只有「完成」，沒有「取消」', (tester) async {
      await open(tester, value: '2026-12-16');
      expect([find.byKey(const ValueKey('picker-done')).evaluate().length, find.byKey(const ValueKey('picker-cancel')).evaluate().length], [1, 0]);
    });

    testWidgets('「完成」是系統藍 17pt，靠右', (tester) async {
      await open(tester, value: '2026-12-16');
      final text = tester.widget<Text>(find.descendant(of: find.byKey(const ValueKey('picker-done')), matching: find.byType(Text)));
      expect([text.style!.color, text.style!.fontSize, tester.getTopRight(find.byKey(const ValueKey('picker-done'))).dx], [const Color(0xFF007AFF), 17.0, 440.0]);
    });

    testWidgets('面板在螢幕底：頂條 44 加滾輪 216，不另加底部安全區', (tester) async {
      await open(tester, value: '2026-12-16');
      final top = tester.getTopLeft(find.byKey(const ValueKey('picker-done'))).dy;
      expect([top, tester.getSize(find.byKey(const ValueKey('picker-year'))).height, tester.getBottomLeft(find.byKey(const ValueKey('picker-year'))).dy], [956.0 - 260, 216.0, 956.0]);
    });

    testWidgets('月日不補零：「2026年」「3月」「5日」', (tester) async {
      await open(tester, value: '2026-03-05');
      expect([find.text('2026年'), find.text('3月'), find.text('5日')].map((f) => f.evaluate().length).toList(), [1, 1, 1]);
    });

    testWidgets('月份用阿拉伯數字，不是「十二月」', (tester) async {
      await open(tester, value: '2026-12-16');
      expect([find.text('12月').evaluate().length, find.text('十二月').evaluate().length], [1, 0]);
    });

    testWidgets('年份靠右，月、日靠左（原生滾輪的排法）', (tester) async {
      await open(tester, value: '2026-09-05');
      final year = tester.getRect(find.byKey(const ValueKey('picker-year')));
      final month = tester.getRect(find.byKey(const ValueKey('picker-month')));
      final day = tester.getRect(find.byKey(const ValueKey('picker-day')));
      // 選中行以外的項目（沒有放大）：「2027年」貼欄右邊，「10月」「6日」貼欄左邊（欄左右各多留 columnPad）
      const pad = DatePickerStyle.columnPad;
      expect([
        (tester.getRect(find.text('2027年')).right - (year.right - pad)).abs() < 1,
        (tester.getRect(find.text('10月')).left - (month.left + pad)).abs() < 1,
        (tester.getRect(find.text('6日')).left - (day.left + pad)).abs() < 1,
      ], [true, true, true]);
    });

    testWidgets('不存在的日子變灰：二月的三十日', (tester) async {
      await open(tester, value: '2026-02-27');
      final style = tester.widget<Text>(find.text('30日')).style!;
      expect(style.color, DatePickerStyle.invalid);
    });

    testWidgets('存在的日子是黑字', (tester) async {
      await open(tester, value: '2026-02-27');
      expect(tester.widget<Text>(find.text('28日')).style!.color, DatePickerStyle.text);
    });

    testWidgets('三欄次序是年、月、日', (tester) async {
      await open(tester, value: '2026-12-16');
      final x = [find.text('2026年'), find.text('12月'), find.text('16日')].map((f) => tester.getCenter(f).dx).toList();
      expect(x[0] < x[1] && x[1] < x[2], isTrue);
    });

    testWidgets('選中行是整行寬的灰色圓角底條：左右各留 9、高 34、圓角 8（quaternarySystemFill）', (tester) async {
      await open(tester, value: '2026-12-16');
      final bar = find.byKey(const ValueKey('picker-selection'));
      final d = tester.widget<Container>(bar).decoration! as BoxDecoration;
      final box = tester.getRect(find.descendant(of: bar, matching: find.byType(DecoratedBox)));
      expect([box.left, box.right, box.height, d.color, d.borderRadius], [9.0, 431.0, 34.0, const Color(0x14747480), BorderRadius.circular(8)]);
    });

    testWidgets('選中底條在選中那一行的位置（滾輪正中）', (tester) async {
      await open(tester, value: '2026-12-16');
      expect(tester.getCenter(find.byKey(const ValueKey('picker-selection'))).dy, closeTo(tester.getCenter(find.text('2026年')).dy, 1));
    });

    testWidgets('遮罩約 41% 黑', (tester) async {
      await open(tester, value: '2026-12-16');
      final mask = tester.widget<ColoredBox>(find.descendant(of: find.byKey(const ValueKey('picker-mask')), matching: find.byType(ColoredBox)));
      expect(mask.color, DatePickerStyle.mask);
    });
  });

  group('操作', () {
    testWidgets('點遮罩關閉，回傳 null', (tester) async {
      final result = await open(tester, value: '2026-12-16');
      await tester.tapAt(const Offset(220, 200));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(await result, isNull);
    });

    testWidgets('關閉後選擇器消失', (tester) async {
      await open(tester, value: '2026-12-16');
      await tester.tapAt(const Offset(220, 200));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('picker-year')), findsNothing);
    });

    testWidgets('年份向上推一行，按「完成」回傳下一年', (tester) async {
      final result = await open(tester, value: '2026-12-16');
      await scroll(tester, '2026年', 1);
      expect(await done(tester, result), '2027-12-16');
    });

    testWidgets('月份向下推兩行，按「完成」回傳十月', (tester) async {
      final result = await open(tester, value: '2026-12-16');
      await scroll(tester, '12月', -2);
      expect(await done(tester, result), '2026-10-16');
    });

    testWidgets('日子向上推三行，按「完成」回傳十九日', (tester) async {
      final result = await open(tester, value: '2026-12-16');
      await scroll(tester, '16日', 3);
      expect(await done(tester, result), '2026-12-19');
    });

    testWidgets('三十一日轉到二月：退回二月最後一天', (tester) async {
      final result = await open(tester, value: '2026-01-31');
      await scroll(tester, '1月', 1);
      expect(await done(tester, result), '2026-02-28');
    });

    testWidgets('遲於 end：滾過去會彈回 end', (tester) async {
      final result = await open(tester, value: '2026-11-10', end: '2026-11-16');
      await scroll(tester, '10日', 10);
      expect(await done(tester, result), '2026-11-16');
    });

    testWidgets('早於 start 打開：先退回 start', (tester) async {
      final result = await open(tester, value: '2020-01-01', start: '2026-01-01');
      expect(await done(tester, result), '2026-01-01');
    });

    testWidgets('值是二月三十日：打開在二月最後一天', (tester) async {
      final result = await open(tester, value: '2026-02-30');
      expect(await done(tester, result), '2026-02-28');
    });
  });

  group('parseDay', () {
    test('年-月-日', () => expect(parseDay('2026-12-16'), DateTime(2026, 12, 16)));
    test('月日沒有補零：不算', () => expect(parseDay('2026-1-5'), isNull));
    test('月份 13：不算', () => expect(parseDay('2026-13-01'), isNull));
    test('日子 0：不算', () => expect(parseDay('2026-12-00'), isNull));
    test('null：不算', () => expect(parseDay(null), isNull));
    test('閏年二月三十日：退回二十九日', () => expect(parseDay('2028-02-30'), DateTime(2028, 2, 29)));
    test('dayText 補零', () => expect(dayText(DateTime(2026, 3, 5)), '2026-03-05'));
  });
}
