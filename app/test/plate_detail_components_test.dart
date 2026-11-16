// 2c 新增的組件：批文卡（ApprovalCard）、開關（UniSwitch）、選擇器（showSelectorPicker、showDatePicker）、載入框（showLoading）、看大圖。
// 一個情況一個測試。
import 'dart:convert';
import 'package:dualplate/business/approval_card.dart';
import 'package:dualplate/ui/image_preview.dart';
import 'package:dualplate/ui/loading.dart';
import 'package:dualplate/ui/pickers.dart';
import 'package:dualplate/ui/uni_switch.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');

// 簡單的外殼：有導航器（選擇器、看大圖要用）和固定的畫面大小
Widget host(Widget child) => WidgetsApp(
      color: const Color(0xFFFFFFFF),
      pageRouteBuilder: <T>(settings, builder) => PageRouteBuilder<T>(settings: settings, pageBuilder: (context, _, _) => builder(context)),
      home: Center(child: SizedBox(width: 376, child: child)),
    );

// 動畫從彈出後的下一幀開始，先 pump 一次再等 300ms
Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

const card = {'cardNumber': '4400123456', 'company': '測試有限公司', 'mainlandPlate': '粵ZA123港', 'validFrom': '2025-12-01', 'validTo': '2026-12-01'};

void main() {
  group('批文卡', () {
    testWidgets('正面：顯示編號和商號，不顯示背面的字', (tester) async {
      await tester.pumpWidget(host(const ApprovalCard(data: card)));
      expect(find.text('4400123456'), findsOneWidget);
      expect(find.text('測試有限公司'), findsOneWidget);
      expect(find.text('内地车牌号:'), findsNothing);
    });

    testWidgets('按 1013:643 的比例', (tester) async {
      await tester.pumpWidget(host(const ApprovalCard(data: card, showControls: false)));
      final size = tester.getSize(find.byType(ApprovalCard));
      expect(size.width / size.height, closeTo(1013 / 643, .01));
    });

    testWidgets('點卡面翻到背面（flipOnTap 預設開），背面顯示有效期', (tester) async {
      await tester.pumpWidget(host(const ApprovalCard(data: card)));
      await tester.tap(find.bySemanticsLabel('批文卡正面，點擊翻到背面'));
      await tester.pump(); // 動畫從下一幀開始
      await tester.pump(const Duration(milliseconds: 700));
      expect(find.text('2025.12.01–2026.12.01'), findsOneWidget);
      expect(find.text('4400123456'), findsNothing);
    });

    testWidgets('翻轉動畫 .65 秒：一半時間時已過 90°（曲線前快後慢）', (tester) async {
      await tester.pumpWidget(host(const ApprovalCard(data: card)));
      await tester.tap(find.bySemanticsLabel('批文卡正面，點擊翻到背面'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.text('内地车牌号:'), findsOneWidget); // cubic-bezier(.22,.67,.22,1)：200ms 時已轉過一半
    });

    testWidgets('flipOnTap 關掉：點卡面不翻，只回報', (tester) async {
      var taps = 0;
      await tester.pumpWidget(host(ApprovalCard(data: card, flipOnTap: false, showControls: false, onCardTap: () => taps++)));
      await tester.tap(find.byType(ApprovalCard));
      await tester.pump(const Duration(milliseconds: 700));
      expect(taps, 1);
      expect(find.text('4400123456'), findsOneWidget);
    });

    testWidgets('外面改 back：翻到背面', (tester) async {
      await tester.pumpWidget(host(const ApprovalCard(data: card, flipOnTap: false, showControls: false)));
      await tester.pumpWidget(host(const ApprovalCard(data: card, back: true, flipOnTap: false, showControls: false)));
      await tester.pump(const Duration(milliseconds: 700));
      expect(find.text('内地车牌号:'), findsOneWidget);
    });

    testWidgets('正面／背面鈕：按「背面」翻過去並回報', (tester) async {
      bool? flipped;
      await tester.pumpWidget(host(ApprovalCard(data: card, onFlip: (v) => flipped = v)));
      expect(find.text('點擊卡面翻轉'), findsOneWidget);
      await tester.tap(find.text('背面'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));
      expect(flipped, isTrue);
      expect(find.text('内地车牌号:'), findsOneWidget);
    });

    testWidgets('詳情頁用法：不顯示正面／背面鈕', (tester) async {
      await tester.pumpWidget(host(const ApprovalCard(data: card, showControls: false)));
      expect(find.text('點擊卡面翻轉'), findsNothing);
    });

    testWidgets('欄位是 null 或數字：照 JS 的寫法顯示（null 空白）', (tester) async {
      await tester.pumpWidget(host(const ApprovalCard(data: {'cardNumber': 123, 'company': null})));
      expect(find.text('123'), findsOneWidget);
      expect(find.text('null'), findsNothing);
    });
  });

  group('開關', () {
    testWidgets('點一下回報新值', (tester) async {
      bool? value;
      await tester.pumpWidget(host(UniSwitch(checked: false, onChanged: (v) => value = v)));
      await tester.tap(find.byType(UniSwitch));
      await tester.pump(const Duration(milliseconds: 400));
      expect(value, isTrue);
    });

    testWidgets('不可按時點了沒有反應', (tester) async {
      bool? value;
      await tester.pumpWidget(host(UniSwitch(checked: false, disabled: true, onChanged: (v) => value = v)));
      await tester.tap(find.byType(UniSwitch));
      await tester.pump();
      expect(value, isNull);
    });

    testWidgets('大小 52×32，右邊留 5', (tester) async {
      await tester.pumpWidget(host(const Align(alignment: Alignment.centerLeft, child: UniSwitch(checked: true))));
      expect(tester.getSize(find.byType(UniSwitch)), const Size(57, 32));
    });
  });

  group('選擇器', () {
    Future<BuildContext> open(WidgetTester tester) async {
      await tester.pumpWidget(host(const SizedBox(height: 10)));
      return tester.element(find.byType(SizedBox).last);
    }

    testWidgets('選項：按「完成」回傳目前的序號（沒有 value 時是第 0 項）', (tester) async {
      final context = await open(tester);
      final result = showSelectorPicker(context, const ['未上牌', '已上牌']);
      await settle(tester);
      expect(find.text('未上牌'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('picker-done')));
      await settle(tester);
      expect(await result, 0);
    });

    testWidgets('選項：按「取消」回傳 null', (tester) async {
      final context = await open(tester);
      final result = showSelectorPicker(context, const ['未上牌', '已上牌']);
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('picker-cancel')));
      await settle(tester);
      expect(await result, isNull);
    });

    testWidgets('選項：點遮罩回傳 null', (tester) async {
      final context = await open(tester);
      final result = showSelectorPicker(context, const ['自用', '空置']);
      await settle(tester);
      await tester.tapAt(const Offset(20, 20));
      await settle(tester);
      expect(await result, isNull);
    });

    testWidgets('日期：三欄加年月日，按「完成」回傳原值', (tester) async {
      final context = await open(tester);
      final result = showDatePicker(context, value: '2026-12-20');
      await settle(tester);
      expect(find.text('2026年'), findsOneWidget);
      expect(find.text('12月'), findsOneWidget);
      expect(find.text('20日'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('picker-done')));
      await settle(tester);
      expect(await result, '2026-12-20');
    });

    testWidgets('日期：沒有值時打開在今天', (tester) async {
      final context = await open(tester);
      final result = showDatePicker(context, now: DateTime(2026, 11, 16));
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('picker-done')));
      await settle(tester);
      expect(await result, '2026-11-16');
    });

    testWidgets('日期：值不是年-月-日時打開在今天', (tester) async {
      final context = await open(tester);
      final result = showDatePicker(context, value: '明年', now: DateTime(2026, 11, 16));
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('picker-done')));
      await settle(tester);
      expect(await result, '2026-11-16');
    });

    testWidgets('日期：遲於 end 時退回 end', (tester) async {
      final context = await open(tester);
      final result = showDatePicker(context, value: '2026-12-20', end: '2026-11-16', now: DateTime(2026, 11, 16));
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('picker-done')));
      await settle(tester);
      expect(await result, '2026-11-16');
    });
  });

  group('載入框', () {
    testWidgets('顯示時擋住下面的點擊', (tester) async {
      var taps = 0;
      await tester.pumpWidget(host(GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => taps++, child: const SizedBox(height: 100, width: 376))));
      showLoading(tester.element(find.byType(GestureDetector)), '正在上傳');
      await settle(tester);
      expect(find.text('正在上傳'), findsOneWidget);
      await tester.tap(find.byType(GestureDetector), warnIfMissed: false);
      expect(taps, 0);
      hideLoading();
      await tester.pump(const Duration(milliseconds: 400));
    });

    testWidgets('收起後立即可以點（淡出時不再擋）', (tester) async {
      var taps = 0;
      await tester.pumpWidget(host(GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => taps++, child: const SizedBox(height: 100, width: 376))));
      showLoading(tester.element(find.byType(GestureDetector)), '正在上傳');
      await settle(tester);
      hideLoading();
      await tester.pump();
      await tester.tap(find.byType(GestureDetector));
      expect(taps, 1);
      await tester.pump(const Duration(milliseconds: 400));
    });

    testWidgets('還沒畫出來就收起：不會留下擋點擊的一層', (tester) async {
      var taps = 0;
      await tester.pumpWidget(host(GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => taps++, child: const SizedBox(height: 100, width: 376))));
      showLoading(tester.element(find.byType(GestureDetector)), '正在上傳');
      hideLoading(); // 同一幀內收起
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('正在上傳'), findsNothing);
      await tester.tap(find.byType(GestureDetector));
      expect(taps, 1);
    });
  });

  group('看大圖', () {
    testWidgets('兩張圖：顯示「1/2」，點一下關閉', (tester) async {
      await tester.pumpWidget(host(const SizedBox(height: 10)));
      previewImages(tester.element(find.byType(SizedBox).last), [_png, _png]);
      await settle(tester);
      expect(find.text('1/2'), findsOneWidget);
      await tester.tap(find.byType(ImagePreview));
      await tester.pump(const Duration(milliseconds: 350)); // 點一下要等過了雙擊的時間才算
      await settle(tester);
      expect(find.byType(ImagePreview), findsNothing);
    });

    testWidgets('一張圖：不顯示張數', (tester) async {
      await tester.pumpWidget(host(const SizedBox(height: 10)));
      previewImages(tester.element(find.byType(SizedBox).last), [_png]);
      await settle(tester);
      expect(find.text('1/1'), findsNothing);
      await tester.tap(find.byType(ImagePreview));
      await tester.pump(const Duration(milliseconds: 350));
      await settle(tester);
    });

    testWidgets('從第二張開始', (tester) async {
      await tester.pumpWidget(host(const SizedBox(height: 10)));
      previewImages(tester.element(find.byType(SizedBox).last), [_png, _png], current: 1);
      await settle(tester);
      expect(find.text('2/2'), findsOneWidget);
      await tester.tap(find.byType(ImagePreview));
      await tester.pump(const Duration(milliseconds: 350));
      await settle(tester);
    });
  });
}
