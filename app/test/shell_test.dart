// 外殼（階段 1c）：導航列、底部分頁、換頁、返回鍵先關彈窗。一個情況一個測試。
import 'package:dualplate/main.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> openTabs(WidgetTester tester) async {
  await tester.pumpWidget(const DualplateApp(initialLocation: '/index'));
  await tester.pumpAndSettle();
}

Future<void> openDemo(WidgetTester tester) async {
  await openTabs(tester);
  await tester.tap(find.text('打開示範子頁'));
  await tester.pumpAndSettle();
  expect(find.text('示範子頁'), findsOneWidget);
}

Future<void> pressBack(WidgetTester tester) async {
  await tester.binding.handlePopRoute();
  await tester.pumpAndSettle();
}

Color tabTextColor(WidgetTester tester, String label) => tester.widget<Text>(find.text(label)).style!.color!;

void main() {
  testWidgets('樣板頁的入口打開外殼首頁', (tester) async {
    await tester.pumpWidget(const DualplateApp());
    await tester.tap(find.text('打開外殼（底部分頁和示範子頁）'));
    await tester.pumpAndSettle();
    expect(find.text('車牌管家'), findsOneWidget);
    for (final t in ['首頁', '牌照', '公司', '我的']) {
      expect(find.text(t), findsOneWidget);
    }
  });

  testWidgets('分頁列高 50、白底，首頁選中為翠綠、其他為灰綠', (tester) async {
    await openTabs(tester);
    expect(tester.getSize(find.byKey(const ValueKey('tab-bar'))).height, Shell.tabHeight);
    expect(tabTextColor(tester, '首頁'), C.tabSelected);
    expect(tabTextColor(tester, '牌照'), C.tabText);
    final icon = tester.widget<Image>(find.descendant(of: find.byKey(const ValueKey('tab-0')), matching: find.byType(Image)));
    expect((icon.image as AssetImage).assetName, 'assets/tabbar/home-selected.png');
    expect(tester.getSize(find.descendant(of: find.byKey(const ValueKey('tab-0')), matching: find.byType(Image))), const Size(24, 24));
  });

  testWidgets('分頁圖示頂距分頁列頂 6.5，文字行緊接圖示下方', (tester) async {
    await openTabs(tester);
    final top = tester.getTopLeft(find.byKey(const ValueKey('tab-bar'))).dy;
    final icon = find.descendant(of: find.byKey(const ValueKey('tab-0')), matching: find.byType(Image));
    expect(tester.getTopLeft(icon).dy - top, closeTo(6.5, 0.01));
    expect(tester.getTopLeft(find.text('首頁')).dy - tester.getBottomLeft(icon).dy, closeTo(1 / 3, 0.01));
  });

  testWidgets('按「牌照」切到我的牌照，標題和選中顏色跟着變', (tester) async {
    await openTabs(tester);
    await tester.tap(find.text('牌照'));
    await tester.pump();
    expect(find.text('我的牌照'), findsOneWidget);
    expect(tabTextColor(tester, '牌照'), C.tabSelected);
    expect(tabTextColor(tester, '首頁'), C.tabText);
  });

  testWidgets('四個分頁的標題照 pages.json', (tester) async {
    await openTabs(tester);
    const titles = {'牌照': '我的牌照', '公司': '我的公司', '我的': '我的', '首頁': '車牌管家'};
    for (final MapEntry(key: tab, value: title) in titles.entries) {
      await tester.tap(find.byKey(ValueKey('tab-${['首頁', '牌照', '公司', '我的'].indexOf(tab)}')));
      await tester.pump();
      expect(find.text(title), findsWidgets);
    }
  });

  testWidgets('切換分頁沒有動畫，一幀內完成', (tester) async {
    await openTabs(tester);
    await tester.tap(find.text('公司'));
    await tester.pump();
    expect(tester.hasRunningAnimations, isFalse);
    expect(find.text('我的公司'), findsOneWidget);
  });

  testWidgets('分頁頁面沒有返回箭頭', (tester) async {
    await openTabs(tester);
    expect(find.byKey(const ValueKey('nav-back')), findsNothing);
  });

  testWidgets('導航列高 44、標題 17px 一般粗細黑字置中', (tester) async {
    await openTabs(tester);
    final title = find.text('車牌管家');
    final style = tester.widget<Text>(title).style!;
    expect(style.fontSize, 17);
    expect(style.fontWeight, FontWeight.w400);
    expect(style.color, const Color(0xFF000000));
    final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
    expect(tester.getCenter(title).dx, closeTo(screen.width / 2, 0.5));
    expect(tester.getCenter(title).dy, closeTo(Shell.navHeight / 2, 1));
  });

  testWidgets('導航列標題比置中高 1/3pt（1e 對照現有 App 截圖）', (tester) async {
    await openTabs(tester);
    final title = find.text('車牌管家');
    final line = tester.getSize(title).height;
    expect(tester.getTopLeft(title).dy, closeTo((Shell.navHeight - line) / 2 - 1 / 3, 0.001));
  });

  testWidgets('子頁蓋住分頁列，有返回箭頭', (tester) async {
    await openDemo(tester);
    expect(find.byKey(const ValueKey('nav-back')), findsOneWidget);
    expect(find.byKey(const ValueKey('tab-bar')).hitTestable(), findsNothing);
  });

  testWidgets('按返回箭頭回到上一頁', (tester) async {
    await openDemo(tester);
    await tester.tap(find.byKey(const ValueKey('nav-back')));
    await tester.pumpAndSettle();
    expect(find.text('示範子頁'), findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
  });

  testWidgets('換頁從右邊滑入，300ms 完成', (tester) async {
    await openTabs(tester);
    await tester.tap(find.text('打開示範子頁'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    final x = tester.getTopLeft(find.text('示範子頁')).dx;
    expect(x, greaterThan(100)); // 一半時間時還在右邊
    await tester.pump(const Duration(milliseconds: 151));
    expect(tester.hasRunningAnimations, isFalse);
    final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
    expect(tester.getCenter(find.text('示範子頁')).dx, closeTo(screen.width / 2, 0.5));
  });

  testWidgets('換頁時上一頁同時向左移', (tester) async {
    await openTabs(tester);
    final before = tester.getTopLeft(find.text('車牌管家')).dx;
    await tester.tap(find.text('打開示範子頁'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    expect(tester.getTopLeft(find.text('車牌管家')).dx, lessThan(before));
  });

  testWidgets('彈窗打開時下面的頁面不移動', (tester) async {
    await openDemo(tester);
    final before = tester.getTopLeft(find.text('示範子頁'));
    await tester.tap(find.text('確認框'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    expect(tester.getTopLeft(find.text('示範子頁')), before);
    await tester.pumpAndSettle();
  });

  testWidgets('Android 返回鍵：沒有彈窗時回到上一頁', (tester) async {
    await openDemo(tester);
    await pressBack(tester);
    expect(find.text('示範子頁'), findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
  });

  testWidgets('Android 返回鍵：確認框打開時先關確認框，留在子頁，結果為 modal', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('確認框'));
    await tester.pumpAndSettle();
    expect(find.text('刪除這張牌照？'), findsOneWidget);
    await pressBack(tester);
    expect(find.text('刪除這張牌照？'), findsNothing);
    expect(find.text('示範子頁'), findsOneWidget);
    expect(find.text('結果：modal'), findsOneWidget);
  });

  testWidgets('Android 返回鍵：底部選單打開時先關選單，留在子頁，結果為 -1', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('底部選單'));
    await tester.pump(const Duration(milliseconds: 300)); // dialogs.dart：上一個選單收起後等 300ms（用真實時鐘）
    await tester.pumpAndSettle();
    expect(find.text('有變動？'), findsOneWidget);
    await pressBack(tester);
    expect(find.text('有變動？'), findsNothing);
    expect(find.text('示範子頁'), findsOneWidget);
    expect(find.text('結果：選了 -1'), findsOneWidget);
  });

  testWidgets('Android 返回鍵：分頁頁面上的選單打開時先關選單，留在分頁', (tester) async {
    await openTabs(tester);
    await tester.tap(find.text('底部選單'));
    await tester.pump(const Duration(milliseconds: 300)); // dialogs.dart：上一個選單收起後等 300ms（用真實時鐘）
    await tester.pumpAndSettle();
    expect(find.text('有變動？'), findsOneWidget);
    await pressBack(tester);
    expect(find.text('有變動？'), findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
  });

  testWidgets('Android 返回鍵：再按一次才離開子頁', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('確認框'));
    await tester.pumpAndSettle();
    await pressBack(tester);
    expect(find.text('示範子頁'), findsOneWidget);
    await pressBack(tester);
    expect(find.text('示範子頁'), findsNothing);
  });

  testWidgets('Android 沒有右滑返回', (tester) async {
    await openDemo(tester);
    await tester.dragFrom(const Offset(5, 400), const Offset(300, 0));
    await tester.pumpAndSettle();
    expect(find.text('示範子頁'), findsOneWidget);
  });

  testWidgets('iOS 從左邊緣右滑返回上一頁', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openDemo(tester);
    await tester.dragFrom(const Offset(5, 400), const Offset(600, 0)); // 測試畫面寬 800，拖過一半
    await tester.pumpAndSettle();
    expect(find.text('示範子頁'), findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iOS 右滑沒過一半而且慢慢放手，留在子頁', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openDemo(tester);
    final g = await tester.startGesture(const Offset(5, 400));
    for (var i = 0; i < 10; i++) {
      await g.moveBy(const Offset(10, 0));
      await tester.pump(const Duration(milliseconds: 50));
    }
    await tester.pump(const Duration(milliseconds: 300));
    await g.up();
    await tester.pumpAndSettle();
    expect(find.text('示範子頁'), findsOneWidget);
    expect(tester.getTopLeft(find.byKey(const ValueKey('nav-back'))).dx, 0);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iOS 不在左邊緣開始的右滑不會返回', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openDemo(tester);
    await tester.dragFrom(const Offset(100, 400), const Offset(250, 0));
    await tester.pumpAndSettle();
    expect(find.text('示範子頁'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iOS 分頁頁面右滑不會離開', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openTabs(tester);
    await tester.dragFrom(const Offset(5, 400), const Offset(300, 0));
    await tester.pumpAndSettle();
    expect(find.text('車牌管家'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  // 1e：現有 App 子頁的彈窗開着時，iOS 原生右滑連頁面一起返回（1c 原本定為甚麼都不發生，負責人按 1e 實測改正）
  testWidgets('iOS 右滑：子頁確認框打開時，頁面連確認框一起返回', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openDemo(tester);
    await tester.tap(find.text('確認框'));
    await tester.pumpAndSettle();
    await tester.dragFrom(const Offset(5, 400), const Offset(600, 0));
    await tester.pumpAndSettle();
    expect(find.text('刪除這張牌照？'), findsNothing);
    expect(find.text('示範子頁'), findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iOS 右滑：子頁底部選單打開時，頁面連選單一起返回', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openDemo(tester);
    await tester.tap(find.text('底部選單'));
    await tester.pump(const Duration(milliseconds: 300)); // dialogs.dart：上一個選單收起後等 300ms（用真實時鐘）
    await tester.pumpAndSettle();
    await tester.dragFrom(const Offset(5, 300), const Offset(600, 0));
    await tester.pumpAndSettle();
    expect(find.text('有變動？'), findsNothing);
    expect(find.text('示範子頁'), findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('Android 返回鍵：鎖定提示框打開時，提示框和子頁一起關掉（和現有 App 一樣）', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('鎖定提示框'));
    await tester.pumpAndSettle();
    expect(find.text('必須更新'), findsOneWidget);
    await pressBack(tester);
    expect(find.text('必須更新'), findsNothing);
    expect(find.text('示範子頁'), findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
  });

  testWidgets('鎖定提示框點框外仍關不了', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('鎖定提示框'));
    await tester.pumpAndSettle();
    // 1e：遮罩只蓋內容區，(20, 20) 是導航列的返回箭頭；改點導航列下面、框外的遮罩
    await tester.tapAt(const Offset(20, Shell.navHeight + 100));
    await tester.pumpAndSettle();
    expect(find.text('必須更新'), findsOneWidget);
  });

  testWidgets('Android 換頁：上一頁左移 25% 並變淡到 0.6，300ms 完成', (tester) async {
    await openTabs(tester);
    await tester.tap(find.text('打開示範子頁'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 299)); // 300ms 時上一頁已被蓋住、移出畫面，量 299ms
    final fades = tester.widgetList<FadeTransition>(find.ancestor(of: find.text('車牌管家', skipOffstage: false), matching: find.byType(FadeTransition)));
    expect(fades.any((f) => (f.opacity.value - 0.6).abs() < 0.002), isTrue);
    final slides = tester.widgetList<SlideTransition>(find.ancestor(of: find.text('車牌管家', skipOffstage: false), matching: find.byType(SlideTransition)));
    expect(slides.any((t) => (t.position.value.dx + 0.25).abs() < 0.002), isTrue);
    await tester.pump(const Duration(milliseconds: 2));
    expect(tester.hasRunningAnimations, isFalse);
  });

  testWidgets('Android 返回換頁 360ms 完成', (tester) async {
    await openDemo(tester);
    await tester.binding.handlePopRoute();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 320));
    expect(tester.hasRunningAnimations, isTrue);
    await tester.pump(const Duration(milliseconds: 41));
    expect(tester.hasRunningAnimations, isFalse);
    expect(find.text('示範子頁'), findsNothing);
  });

  testWidgets('iOS 換頁：上一頁左移 25%、蓋上 20% 黑色，300ms 完成', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openTabs(tester);
    await tester.tap(find.text('打開示範子頁'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 299)); // 300ms 時上一頁已被蓋住、移出畫面，量 299ms
    final dims = tester.widgetList<FadeTransition>(find.ancestor(of: find.byKey(const ValueKey('page-dim'), skipOffstage: false), matching: find.byType(FadeTransition)));
    expect(dims.any((f) => (f.opacity.value - 0.2).abs() < 0.002), isTrue);
    final slides = tester.widgetList<SlideTransition>(find.ancestor(of: find.text('車牌管家', skipOffstage: false), matching: find.byType(SlideTransition)));
    expect(slides.any((t) => (t.position.value.dx + 0.25).abs() < 0.002), isTrue);
    await tester.pump(const Duration(milliseconds: 2));
    expect(tester.hasRunningAnimations, isFalse);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iOS 換頁一半時，新頁位置照 easeInOut（150ms 時在正中）', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openTabs(tester);
    await tester.tap(find.text('打開示範子頁'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));
    final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
    expect(tester.getTopLeft(find.byKey(const ValueKey('nav-back'))).dx, closeTo(screen.width / 2, 1));
    await tester.pumpAndSettle();
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('頁面停定後變暗層完全透明', (tester) async {
    await openDemo(tester);
    for (final f in tester.widgetList<FadeTransition>(find.ancestor(of: find.byKey(const ValueKey('page-dim')), matching: find.byType(FadeTransition)))) {
      expect(f.opacity.value, 0);
    }
  });

  testWidgets('返回箭頭在導航列左邊 7pt 開始', (tester) async {
    await openDemo(tester);
    final arrow = find.descendant(of: find.byKey(const ValueKey('nav-back')), matching: find.byType(CustomPaint));
    expect(tester.getTopLeft(arrow).dx, Shell.backInset);
  });

  testWidgets('連開兩頁，返回一次只退一頁', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('再開一頁'));
    await tester.pumpAndSettle();
    expect(find.text('示範子頁', skipOffstage: false), findsNWidgets(2));
    await pressBack(tester);
    expect(find.text('示範子頁'), findsOneWidget);
  });
}
