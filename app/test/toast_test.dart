import 'package:dualplate/ui/toast.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

// 390×844 的畫面；頁面上一個按鈕，用來確認提示不擋操作
Future<BuildContext> pumpHost(WidgetTester tester, {VoidCallback? onPageTap}) async {
  late BuildContext ctx;
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MediaQuery(
    data: const MediaQueryData(size: Size(390, 844)),
    child: Directionality(
      textDirection: TextDirection.ltr,
      child: Overlay(initialEntries: [
        OverlayEntry(builder: (context) {
          ctx = context;
          return GestureDetector(behavior: HitTestBehavior.opaque, onTap: onPageTap, child: const SizedBox.expand());
        }),
      ]),
    ),
  ));
  return ctx;
}

Finder box() => find.ancestor(of: find.byType(Text), matching: find.byWidgetPredicate((w) => w is Container && w.decoration is BoxDecoration)).first;

void main() {
  testWidgets('提示在螢幕正中', (tester) async {
    final ctx = await pumpHost(tester);
    showToast(ctx, '已複製');
    await tester.pump();
    expect(tester.getCenter(box()), const Offset(195, 422));
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('外觀：黑色 70% 底、圓角 10、內距 10、白字 16', (tester) async {
    final ctx = await pumpHost(tester);
    showToast(ctx, '已複製');
    await tester.pump();
    final c = tester.widget<Container>(box());
    final d = c.decoration! as BoxDecoration;
    expect(d.color, const Color(0xB3000000));
    expect(d.borderRadius, BorderRadius.circular(10));
    expect(c.padding, const EdgeInsets.all(10));
    final t = tester.widget<Text>(find.text('已複製'));
    expect(t.style!.fontSize, 16);
    expect(t.style!.color, const Color(0xFFFFFFFF));
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('0.3 秒淡入', (tester) async {
    final ctx = await pumpHost(tester);
    showToast(ctx, '已複製');
    await tester.pump();
    final fade = find.ancestor(of: find.text('已複製'), matching: find.byType(FadeTransition));
    expect(tester.widget<FadeTransition>(fade).opacity.value, 0);
    await tester.pump(const Duration(milliseconds: 150));
    expect(tester.widget<FadeTransition>(fade).opacity.value, closeTo(.5, .01));
    await tester.pump(const Duration(milliseconds: 150));
    expect(tester.widget<FadeTransition>(fade).opacity.value, 1);
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('預設 1.5 秒後開始淡出，淡出後移走', (tester) async {
    final ctx = await pumpHost(tester);
    showToast(ctx, '已複製');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1499));
    expect(find.text('已複製'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1));
    await tester.pump(const Duration(milliseconds: 150));
    expect(find.text('已複製'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('已複製'), findsNothing);
  });

  testWidgets('可指定顯示時間（2.6 秒）', (tester) async {
    final ctx = await pumpHost(tester);
    showToast(ctx, '已記錄，下次請在 2027-03-31 前過關', duration: const Duration(milliseconds: 2600));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 2000));
    expect(find.textContaining('已記錄'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.textContaining('已記錄'), findsNothing);
  });

  testWidgets('新提示出現時舊提示立即消失', (tester) async {
    final ctx = await pumpHost(tester);
    showToast(ctx, '已儲存');
    await tester.pump(const Duration(milliseconds: 500));
    showToast(ctx, '已上傳');
    await tester.pump();
    expect(find.text('已儲存'), findsNothing);
    expect(find.text('已上傳'), findsOneWidget);
    // 舊提示的計時不會把新提示提早關掉
    await tester.pump(const Duration(milliseconds: 1200));
    expect(find.text('已上傳'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 300)); // 1.5 秒到，開始淡出
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('已上傳'), findsNothing);
  });

  testWidgets('提示不擋下面的點按', (tester) async {
    var taps = 0;
    final ctx = await pumpHost(tester, onPageTap: () => taps++);
    showToast(ctx, '已複製');
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tapAt(const Offset(195, 422));
    expect(taps, 1);
    await tester.pump(const Duration(seconds: 3));
  });

  testWidgets('hideToast 淡出後移走', (tester) async {
    final ctx = await pumpHost(tester);
    showToast(ctx, '已複製');
    await tester.pump(const Duration(milliseconds: 500));
    hideToast();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('已複製'), findsNothing);
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets('長文字換行、置中，最寬為螢幕寬減 20', (tester) async {
    final ctx = await pumpHost(tester);
    showToast(ctx, '這張照片無法讀取，請改用相機拍攝或選 JPG、PNG 照片');
    await tester.pump();
    expect(tester.getSize(box()).width, 390 - 2 * ToastStyle.padding);
    expect(tester.widget<Text>(find.textContaining('這張照片')).textAlign, TextAlign.center);
    expect(tester.getSize(find.textContaining('這張照片')).height, greaterThan(ToastStyle.fs * ToastStyle.line));
    await tester.pump(const Duration(seconds: 3));
  });
}
