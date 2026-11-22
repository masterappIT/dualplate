// 1b 業務小組件：每個組件、每個重要屬性組合一個具名測試。數值對照 mobile/src/components/ 的原組件。
import 'package:dualplate/business/due_date.dart';
import 'package:dualplate/business/plate_chip.dart';
import 'package:dualplate/business/plates.dart';
import 'package:dualplate/business/stamp_mark.dart';
import 'package:dualplate/ui/sample_business.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

// 和 iPhone 16/17 Pro Max 同寬（440），1rpx = 440/750 px
Widget host(Widget child, {double width = 440, bool reduceMotion = false}) => MediaQuery(
      data: MediaQueryData(size: Size(width, 956), disableAnimations: reduceMotion),
      child: Directionality(textDirection: TextDirection.ltr, child: Align(alignment: Alignment.topLeft, child: child)),
    );

Size sizeOf(WidgetTester t, Type type) => t.getSize(find.byType(type).first);

void main() {
  group('MainlandPlate', () {
    test('號碼整理：大寫、去掉分隔符、粤改粵', () {
      expect(MainlandPlate.normalize('粤z·a1-2.3 港'), '粵ZA123港');
    });
    test('七字號碼拆成七格', () {
      expect(MainlandPlate.charsOf('粵ZA123港'), ['粵', 'Z', 'A', '1', '2', '3', '港']);
      expect(MainlandPlate.charsOf('粵ZB456澳').last, '澳');
    });
    test('格式不符時不拆格', () {
      expect(MainlandPlate.charsOf('粵Z12345'), isEmpty);
      expect(MainlandPlate.charsOf(''), isEmpty);
    });
    testWidgets('預設寬 600rpx，高按 440:140', (t) async {
      await t.pumpWidget(host(const MainlandPlate(plate: '粵ZA123港')));
      final s = sizeOf(t, CustomPaint);
      expect(s.width, closeTo(600 * 440 / 750, .01));
      expect(s.height, closeTo(190.9 * 440 / 750, .01)); // (600*140/440).toFixed(1)
      expect(find.text('粵'), findsWidgets); // 填色一層、描邊一層
      expect(find.bySemanticsLabel('內地車牌 粵ZA123港'), findsOneWidget);
    });
    testWidgets('牌照詳情寬 300rpx', (t) async {
      await t.pumpWidget(host(const MainlandPlate(plate: '粵ZA123港', width: 300)));
      expect(sizeOf(t, CustomPaint).width, closeTo(300 * 440 / 750, .01));
    });
    testWidgets('登入頁用 px 寬 107、立體、字縮 0.8', (t) async {
      await t.pumpWidget(host(const MainlandPlate(plate: '粵Z·A123港', widthPx: 107, textScale: .8, relief: true)));
      // toRpx(107) = 107*10000/floor(10000*440/750)
      final w = 107 * 10000 / 5866;
      expect(sizeOf(t, CustomPaint).width, closeTo(double.parse(w.toStringAsFixed(1)) * 440 / 750, .01));
      final text = t.widget<Text>(find.text('Z').first);
      expect(text.style!.fontSize, closeTo(double.parse((w * .277 * .8).toStringAsFixed(1)) * 440 / 750, .01));
      expect(text.style!.fontFamily, plateLatinFont);
    });
    testWidgets('格式不符時整串置中顯示', (t) async {
      await t.pumpWidget(host(const MainlandPlate(plate: '粵Z12345', width: 400)));
      expect(find.text('粵Z12345'), findsOneWidget);
    });
    testWidgets('父層較窄時寬度不超出（max-width:100%）', (t) async {
      await t.pumpWidget(host(const SizedBox(width: 100, child: MainlandPlate(plate: '粵ZA123港'))));
      expect(sizeOf(t, CustomPaint).width, 100);
    });
  });

  group('HongKongPlate', () {
    test('字母組和數字組之間空 30，組內空 10，整體置中', () {
      final slots = HongKongPlate.slotsOf('HK1234');
      expect(slots.map((s) => s.char).join(), 'HK1234');
      // 總寬 6*52 + 10 + 30 + 3*10 = 382，起點 (520-382)/2 = 69
      expect(slots.first.left * 520, closeTo(69, 1e-9));
      expect((slots[2].left - slots[1].left) * 520, closeTo(52 + 30, 1e-9));
      expect((slots[1].left - slots[0].left) * 520, closeTo(52 + 10, 1e-9));
    });
    test('自訂字串整串一組', () {
      final slots = HongKongPlate.slotsOf('LOVE');
      expect(slots.length, 4);
      expect((slots[3].left - slots[2].left) * 520, closeTo(62, 1e-9));
    });
    test('只有數字', () {
      expect(HongKongPlate.slotsOf('1').single.left * 520, closeTo(234, 1e-9));
    });
    testWidgets('高按 520:111，黑字 Arial', (t) async {
      await t.pumpWidget(host(const HongKongPlate(plate: 'HK 1234', width: 300)));
      expect(sizeOf(t, CustomPaint).height, closeTo(64.0 * 440 / 750, .01)); // (300*111/520).toFixed(1)
      final text = t.widget<Text>(find.text('H').first);
      expect(text.style!.fontFamily, plateArialFont);
      expect(text.style!.color, PlateC.hkText);
      expect(find.bySemanticsLabel('香港車牌 HK1234'), findsOneWidget);
    });
    testWidgets('立體版字有陰影', (t) async {
      await t.pumpWidget(host(const HongKongPlate(plate: 'HK 1234', widthPx: 159, textScale: .8, relief: true)));
      expect(t.widget<Text>(find.text('H').first).style!.shadows, hasLength(2));
    });
  });

  group('MacauPlate', () {
    test('分三組並以短橫顯示', () {
      expect(MacauPlate.shown('ma 12 34'), 'MA-12-34');
      final slots = MacauPlate.slotsOf('MA1234');
      expect(slots.where((s) => s.dash).length, 2);
      expect(slots.length, 8);
    });
    test('一個字母也可以', () {
      expect(MacauPlate.groupsOf('M1234'), ['M', '12', '34']);
    });
    test('格式不符時整串一組', () {
      expect(MacauPlate.groupsOf('XY1'), ['XY1']);
      expect(MacauPlate.slotsOf('XY1').any((s) => s.dash), isFalse);
    });
    testWidgets('白字、讀屏標籤帶短橫', (t) async {
      await t.pumpWidget(host(const MacauPlate(plate: 'MA-12-34', widthPx: 159, textScale: .7, relief: true)));
      expect(t.widget<Text>(find.text('M').first).style!.color, PlateC.whiteText);
      expect(find.bySemanticsLabel('澳門車牌 MA-12-34'), findsOneWidget);
    });
  });

  group('PlateChip', () {
    test('有 region 時按 region', () {
      expect(PlateChip.kindOf('ABC', '內地'), PlateKind.mainland);
      expect(PlateChip.kindOf('粵Z', '香港'), PlateKind.hk);
      expect(PlateChip.kindOf('MA1234', '澳門'), PlateKind.mo);
      expect(PlateChip.kindOf('MA1234', '其他'), PlateKind.unknown);
    });
    test('沒有 region 時自動判斷', () {
      expect(PlateChip.kindOf('粵ZB456澳'), PlateKind.mainland);
      expect(PlateChip.kindOf('MM-12-34'), PlateKind.mo);
      expect(PlateChip.kindOf('M 12 34'), PlateKind.mo);
      expect(PlateChip.kindOf('HK 1234'), PlateKind.hk);
      expect(PlateChip.kindOf('hk1234'), PlateKind.hk);
      expect(PlateChip.kindOf('ABCDEFGHI'), PlateKind.unknown);
    });
    test('空號碼顯示待補充，判斷不了（第七節決定：不再當成內地）', () {
      expect(PlateChip.shownOf('  '), '待補充');
      expect(PlateChip.kindOf(''), PlateKind.unknown);
      expect(PlateChip.kindOf('  '), PlateKind.unknown);
      expect(PlateChip.kindOf('', '香港'), PlateKind.hk);
    });
    testWidgets('內地 md：黑底白字 14、800', (t) async {
      await t.pumpWidget(host(const PlateChip(plate: '粵ZA123港', region: '內地')));
      final style = t.widget<Text>(find.text('粵ZA123港')).style!;
      expect(style.fontSize, Fs.body);
      expect(style.fontWeight, w800);
      expect(style.color, PlateC.chipWhite);
      expect(style.letterSpacing, closeTo(14 * .06, 1e-9));
      expect(find.bySemanticsLabel('內地車牌 粵ZA123港'), findsOneWidget);
    });
    testWidgets('sm：字 12，內距 1/6', (t) async {
      await t.pumpWidget(host(const PlateChip(plate: '粵ZA123港', region: '內地', size: PlateChipSize.sm)));
      expect(t.widget<Text>(find.text('粵ZA123港')).style!.fontSize, Fs.cap);
      expect(t.widget<Padding>(find.byType(Padding).first).padding, const EdgeInsets.symmetric(horizontal: 6, vertical: 1));
    });
    testWidgets('lg：字 16，內距 4/10', (t) async {
      await t.pumpWidget(host(const PlateChip(plate: 'HK1234', region: '香港', size: PlateChipSize.lg)));
      expect(t.widget<Text>(find.text('HK1234')).style!.fontSize, Fs.h);
      expect(t.widget<Padding>(find.byType(Padding).first).padding, const EdgeInsets.symmetric(horizontal: 10, vertical: 4));
    });
    testWidgets('香港黃底黑字', (t) async {
      await t.pumpWidget(host(const PlateChip(plate: 'HK1234', region: '香港')));
      expect(t.widget<Text>(find.text('HK1234')).style!.color, PlateC.chipInk);
    });
    testWidgets('沒有 region 的待補充用中性框', (t) async {
      await t.pumpWidget(host(const PlateChip()));
      expect(t.widget<Text>(find.text('待補充')).style!.color, C.ink3);
      expect(find.bySemanticsLabel('車牌 待補充'), findsOneWidget);
    });
    testWidgets('判斷不了用中性框，字重 700', (t) async {
      await t.pumpWidget(host(const PlateChip(plate: 'AB1234', region: '其他')));
      final style = t.widget<Text>(find.text('AB1234')).style!;
      expect(style.fontWeight, w700);
      expect(style.color, C.ink3);
      expect(find.bySemanticsLabel('車牌 AB1234'), findsOneWidget);
    });
  });

  group('DueDate', () {
    final today = DateTime(2026, 11, 15, 15, 30);
    test('文字：逾期、今天到期、還有', () {
      expect(DueDate.phraseOf(-3), '逾期 3 天');
      expect(DueDate.phraseOf(0), '今天到期');
      expect(DueDate.phraseOf(16), '還有 16 天');
    });
    test('沒有天數時按今天計', () {
      expect(DueDate.daysLeftOf('2026-11-25', null, today), 10);
      expect(DueDate.daysLeftOf('2026-11-14', null, today), -1);
      expect(DueDate.daysLeftOf('2026-11-25', 99, today), 99);
      expect(DueDate.daysLeftOf('', null, today), isNull);
    });
    test('日期無法解析時當作還沒有填日期（第七節決定）', () {
      expect(DueDate.daysLeftOf('2026/11/25', null, today), isNull);
      expect(DueDate.shownDateOf('2026/11/25', null), '');
      expect(DueDate.shownDateOf('2026/11/25', 3), '2026/11/25');
      expect(DueDate.shownDateOf('2026-11-25', null), '2026-11-25');
    });
    testWidgets('日期無法解析時顯示待錄入、灰色、沒有天數', (t) async {
      await t.pumpWidget(host(DueDate(date: '2026/11/25', today: today)));
      expect(find.text('待錄入'), findsOneWidget);
      expect(find.textContaining('NaN'), findsNothing);
      expect(find.textContaining('還有'), findsNothing);
    });
    test('沒有 level 時自動判斷：逾期、30 天內、之後、沒有日期', () {
      expect(DueDate.toneOf('x', -1, ''), 'overdue');
      expect(DueDate.toneOf('x', 30, ''), 'due');
      expect(DueDate.toneOf('x', 31, ''), 'ok');
      expect(DueDate.toneOf('', null, ''), 'muted');
      expect(DueDate.toneOf('x', 100, 'overdue'), 'overdue');
    });
    test('顏色：upcoming 和 ok 同為綠色，不認識的沿用字色', () {
      expect(DueDate.colorOf('overdue'), C.overdue);
      expect(DueDate.colorOf('due'), C.due);
      expect(DueDate.colorOf('upcoming'), C.ok);
      expect(DueDate.colorOf('ok'), C.ok);
      expect(DueDate.colorOf('muted'), C.muted);
      expect(DueDate.colorOf('missing'), C.ink);
    });
    testWidgets('伺服器給的已逾期：紅色條和紅字', (t) async {
      await t.pumpWidget(host(const DueDate(date: '2026-11-01', days: -14, level: 'overdue')));
      expect(find.text('2026-11-01'), findsOneWidget);
      expect(t.widget<Text>(find.text('逾期 14 天')).style!.color, C.overdue);
      final border = (t.widget<Container>(find.byType(Container)).decoration as BoxDecoration).border as Border;
      expect(border.left.color, C.overdue);
      expect(border.left.width, 3);
    });
    testWidgets('日期字 14、700，等寬數字', (t) async {
      await t.pumpWidget(host(const DueDate(date: '2026-12-01', days: 16, level: 'due')));
      final style = t.widget<Text>(find.text('2026-12-01')).style!;
      expect(style.fontSize, Fs.body);
      expect(style.color, C.ink);
      expect(style.fontFeatures, contains(const FontFeature.tabularFigures()));
      expect(t.widget<Text>(find.text('還有 16 天')).style!.fontSize, Fs.meta);
    });
    testWidgets('沒有日期顯示待錄入、灰色、沒有第二行', (t) async {
      await t.pumpWidget(host(const DueDate()));
      expect(t.widget<Text>(find.text('待錄入')).style!.color, C.ink3);
      expect(find.byType(Text), findsOneWidget);
    });
  });

  group('StampMark', () {
    testWidgets('預設：已辦好、綠色、56×56', (t) async {
      await t.pumpWidget(host(const StampMark()));
      expect(t.widget<Text>(find.text('已辦好')).style!.color, C.ok);
      expect(t.getSize(find.byType(Container).first), const Size(56, 56));
      expect(t.widget<Opacity>(find.byType(Opacity)).opacity, StampMark.restOpacity);
    });
    testWidgets('jade 和 overdue 顏色', (t) async {
      await t.pumpWidget(host(const Column(children: [StampMark(text: '已登入', tone: 'jade'), StampMark(tone: 'overdue')])));
      expect(t.widget<Text>(find.text('已登入')).style!.color, C.jade);
      expect(t.widget<Text>(find.text('已辦好')).style!.color, C.overdue);
    });
    test('蓋章關鍵影格：放大 1.9 → 0.92 → 1.04 → 1，透明 0 → 1 → 0.88', () {
      expect(StampMark.scaleAt(0), 1.9);
      expect(StampMark.scaleAt(.55), closeTo(.92, 1e-9));
      expect(StampMark.scaleAt(.75), closeTo(1.04, 1e-9));
      expect(StampMark.scaleAt(1), 1);
      expect(StampMark.opacityAt(0), 0);
      expect(StampMark.opacityAt(.55), closeTo(1, 1e-9));
      expect(StampMark.opacityAt(1), closeTo(.88, 1e-9));
      for (var t = 0.0; t <= 1; t += .01) {
        expect(StampMark.opacityAt(t), inInclusiveRange(0, 1));
      }
    });
    testWidgets('play：0.52 秒內播完，停在 0.88', (t) async {
      await t.pumpWidget(host(const StampMark(text: '已收到', tone: 'jade', play: true)));
      expect(t.widget<Opacity>(find.byType(Opacity)).opacity, 0);
      await t.pump(const Duration(milliseconds: 286)); // 55%
      expect(t.widget<Opacity>(find.byType(Opacity)).opacity, closeTo(1, .01));
      await t.pump(const Duration(milliseconds: 234));
      expect(t.widget<Opacity>(find.byType(Opacity)).opacity, closeTo(.88, 1e-6));
    });
    testWidgets('系統減少動態效果時不播', (t) async {
      await t.pumpWidget(host(const StampMark(play: true), reduceMotion: true));
      expect(t.widget<Opacity>(find.byType(Opacity)).opacity, StampMark.restOpacity);
    });
  });

  testWidgets('樣板頁有業務小組件區塊', (t) async {
    await t.pumpWidget(host(const SingleChildScrollView(child: SizedBox(width: 440, child: SampleBusiness()))));
    expect(find.text('車牌徽章 PlateChip'), findsOneWidget);
    expect(find.text('已登入'), findsOneWidget);
  });
}
