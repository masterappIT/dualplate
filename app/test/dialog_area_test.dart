// 彈窗遮罩範圍（階段 1e）：現有 App 的彈窗在 WebView 裏，只蓋頁面內容（導航列以下、分頁列以上；子頁到螢幕最底）。
// 畫面按 iPhone 16 Pro Max：440×956，頂部安全區 62、底部 34。一個情況一個測試。
import 'package:dualplate/main.dart';
import 'package:dualplate/ui/dialogs.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

const _w = 440.0, _h = 956.0, _top = 62.0, _bottom = 34.0;
const _overlay = Color(0xA6000000);

void phone(WidgetTester tester) {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = const Size(_w * 3, _h * 3);
  tester.view.padding = const FakeViewPadding(top: _top * 3, bottom: _bottom * 3);
  tester.view.viewPadding = const FakeViewPadding(top: _top * 3, bottom: _bottom * 3);
  addTearDown(tester.view.reset);
}

Future<void> openTabs(WidgetTester tester) async {
  phone(tester);
  await tester.pumpWidget(const DualplateApp(initialLocation: '/index', demoTabs: true));
  await tester.pumpAndSettle();
}

Future<void> openDemo(WidgetTester tester) async {
  await openTabs(tester);
  await tester.tap(find.text('打開示範子頁'));
  await tester.pumpAndSettle();
}

Future<void> openSheet(WidgetTester tester) async {
  await tester.tap(find.text('底部選單'));
  await tester.pump(const Duration(milliseconds: 300)); // dialogs.dart：上一個選單收起後等 300ms
  await tester.pumpAndSettle();
}

// 在「我的」分頁開確認框（分頁頁面沒有按鈕，直接用頁面的 context 呼叫，和 me.vue 的「退出登入」一樣）
Future<Future<String>> askOnMe(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('tab-3')));
  await tester.pump();
  final result = ask(tester.element(find.byType(DialogArea).hitTestable().first), title: '退出登入', msg: '確定要退出嗎？', ok: '退出', cancel: '取消');
  await tester.pumpAndSettle();
  return result;
}

Finder get overlay => find.byWidgetPredicate((w) => w is ColoredBox && w.color == _overlay);
Rect rectOf(WidgetTester tester, Finder f) => tester.getRect(f);
double get tabTop => _h - _bottom - Shell.tabHeight;
const navBottom = _top + Shell.navHeight;

// 選單（.wd-action-sheet）：Container 本身含外邊距，白色外框是它裏面的 DecoratedBox
Finder get sheetContainer => find.ancestor(of: find.text('有變動？'), matching: find.byWidgetPredicate((w) => w is Container && w.margin != null)).first;
Finder get sheetBox => find.descendant(of: sheetContainer, matching: find.byType(DecoratedBox)).first;

void main() {
  testWidgets('分頁頁面的確認框：遮罩頂在導航列底，不蓋狀態列和導航列', (tester) async {
    await openTabs(tester);
    await askOnMe(tester);
    expect(rectOf(tester, overlay).top, navBottom);
  });

  testWidgets('分頁頁面的確認框：遮罩底在分頁列頂，不蓋分頁列', (tester) async {
    await openTabs(tester);
    await askOnMe(tester);
    expect(rectOf(tester, overlay).bottom, tabTop);
  });

  testWidgets('分頁頁面的確認框在導航列和分頁列之間的正中', (tester) async {
    await openTabs(tester);
    await askOnMe(tester);
    final box = find.ancestor(of: find.text('確定要退出嗎？'), matching: find.byWidgetPredicate((w) => w is Container && w.constraints?.maxWidth == 300)).first;
    expect(tester.getCenter(box).dy, closeTo((navBottom + tabTop) / 2, 0.5));
    expect(tester.getCenter(box).dx, _w / 2);
  });

  testWidgets('子頁的確認框：遮罩從導航列底蓋到畫面最底（包括底部安全區）', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('確認框'));
    await tester.pumpAndSettle();
    expect(rectOf(tester, overlay), const Rect.fromLTRB(0, navBottom, _w, _h));
  });

  testWidgets('確認框開着時按分頁列可以切到別的分頁，那一頁沒有彈窗', (tester) async {
    await openTabs(tester);
    await askOnMe(tester);
    await tester.tap(find.byKey(const ValueKey('tab-1')));
    await tester.pump();
    expect(find.text('我的牌照'), findsOneWidget);
    expect(find.text('退出登入'), findsNothing); // 確認框跟「我的」一起隱藏
    expect(overlay.hitTestable(), findsNothing);
  });

  testWidgets('切走再切回「我的」，確認框仍開着，按取消回傳 cancel', (tester) async {
    await openTabs(tester);
    final result = await askOnMe(tester);
    await tester.tap(find.byKey(const ValueKey('tab-1')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('tab-3')));
    await tester.pump();
    expect(find.text('確定要退出嗎？'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(await result, 'cancel');
    expect(find.text('確定要退出嗎？'), findsNothing);
  });

  testWidgets('分頁頁面的選單在分頁列之上，底距分頁列 10', (tester) async {
    await openTabs(tester);
    await openSheet(tester);
    expect(rectOf(tester, sheetBox).bottom, tabTop - 10);
    expect(rectOf(tester, overlay).bottom, tabTop);
  });

  testWidgets('子頁的選單底距畫面底 = 底部安全區 34 + 10', (tester) async {
    await openDemo(tester);
    await openSheet(tester);
    expect(rectOf(tester, sheetBox).bottom, _h - _bottom - 10);
    expect(rectOf(tester, overlay).bottom, _h);
  });

  testWidgets('選單左右各留 10、四角圓角 16', (tester) async {
    await openDemo(tester);
    await openSheet(tester);

    final r = rectOf(tester, sheetBox);
    expect(r.left, 10);
    expect(r.right, _w - 10);
    final box = tester.widget<Container>(sheetContainer);
    expect((box.decoration! as BoxDecoration).borderRadius, BorderRadius.circular(16));
  });

  testWidgets('選單的遮罩也不蓋導航列', (tester) async {
    await openDemo(tester);
    await openSheet(tester);
    expect(rectOf(tester, overlay).top, navBottom);
  });

  testWidgets('選單滑入一半時不會畫到分頁列上（彈窗區有裁切）', (tester) async {
    await openTabs(tester);
    await tester.tap(find.text('底部選單'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(rectOf(tester, sheetBox).bottom, greaterThan(tabTop)); // 還在滑入，外框伸到分頁列的位置
    final clip = find.ancestor(of: sheetBox, matching: find.byType(ClipRect));
    expect(clip, findsWidgets);
    expect(rectOf(tester, clip.first).bottom, tabTop);
    await tester.pumpAndSettle();
  });

  testWidgets('彈窗開着時導航列和分頁列照常可按（遮罩不擋）', (tester) async {
    await openTabs(tester);
    await openSheet(tester);
    expect(find.byKey(const ValueKey('tab-2')).hitTestable(), findsOneWidget);
    expect(find.text('車牌管家').hitTestable(), findsOneWidget);
  });

  testWidgets('子頁選單開着時按導航列返回箭頭：先關選單，留在子頁，結果為 -1', (tester) async {
    await openDemo(tester);
    await openSheet(tester);
    await tester.tap(find.byKey(const ValueKey('nav-back')));
    await tester.pumpAndSettle();
    expect(find.text('有變動？'), findsNothing);
    expect(find.text('示範子頁'), findsOneWidget);
    expect(find.text('結果：選了 -1'), findsOneWidget);
  });

  testWidgets('子頁確認框開着時按導航列返回箭頭：先關確認框，留在子頁，結果為 modal', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('確認框'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('nav-back')));
    await tester.pumpAndSettle();
    expect(find.text('刪除這張牌照？'), findsNothing);
    expect(find.text('示範子頁'), findsOneWidget);
    expect(find.text('結果：modal'), findsOneWidget);
  });

  testWidgets('關了彈窗後再按返回箭頭才離開子頁', (tester) async {
    await openDemo(tester);
    await openSheet(tester);
    await tester.tap(find.byKey(const ValueKey('nav-back')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('nav-back')));
    await tester.pumpAndSettle();
    expect(find.text('示範子頁'), findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
  });

  // 計劃第七節管理者決定（2026-11-22）：鎖定提示框只能按確認鍵關，返回鍵、返回箭頭、iOS 右滑都不會離開
  testWidgets('鎖定提示框開着時按導航列返回箭頭：提示框和子頁都留着', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('鎖定提示框'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('nav-back')));
    await tester.pumpAndSettle();
    expect(find.text('必須更新'), findsOneWidget);
    expect(find.text('示範子頁'), findsOneWidget);
  });

  testWidgets('鎖定提示框開着時按 Android 返回鍵：提示框和子頁都留着', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('鎖定提示框'));
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('必須更新'), findsOneWidget);
    expect(find.text('示範子頁'), findsOneWidget);
  });

  testWidgets('鎖定提示框按確認鍵後，返回鍵照常離開子頁', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('鎖定提示框'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('更新'));
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('示範子頁'), findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
  });

  testWidgets('鎖定提示框點遮罩關不了', (tester) async {
    await openDemo(tester);
    await tester.tap(find.text('鎖定提示框'));
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(20, navBottom + 40));
    await tester.pumpAndSettle();
    expect(find.text('必須更新'), findsOneWidget);
  });

  testWidgets('彈窗開着時換頁：選單跟着子頁，不留在下一頁上', (tester) async {
    await openDemo(tester);
    await openSheet(tester);
    await tester.binding.handlePopRoute(); // 關選單
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute(); // 離開子頁
    await tester.pumpAndSettle();
    expect(overlay, findsNothing);
    expect(find.text('車牌管家'), findsOneWidget);
  });

  testWidgets('分頁頁面選單開着時切分頁，返回鍵不會關到看不見的選單', (tester) async {
    await openTabs(tester);
    await openSheet(tester);
    await tester.tap(find.byKey(const ValueKey('tab-1')));
    await tester.pump();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('tab-0')));
    await tester.pump();
    expect(find.text('有變動？'), findsOneWidget); // 首頁的選單仍開着
  });

  testWidgets('沒有彈窗區的頁面（組件樣板頁）彈窗仍蓋整個畫面', (tester) async {
    phone(tester);
    await tester.pumpWidget(const DualplateApp());
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('確認框'), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('確認框'));
    await tester.pumpAndSettle();
    expect(rectOf(tester, overlay), const Rect.fromLTWH(0, 0, _w, _h));
  });
  testWidgets('iOS 右滑一半時，選單和遮罩跟着子頁向右移，上一頁沒有遮罩', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openDemo(tester);
    await openSheet(tester);
    final g = await tester.startGesture(const Offset(5, 300));
    await g.moveBy(const Offset(20, 0)); // 先過拖動門檻
    await tester.pump();
    final sheet = rectOf(tester, sheetBox).left, mask = rectOf(tester, overlay).left;
    await g.moveBy(const Offset(150, 0));
    await tester.pump();
    expect(rectOf(tester, sheetBox).left, closeTo(sheet + 150, 0.5));
    expect(rectOf(tester, overlay).left, closeTo(mask + 150, 0.5));
    await g.up();
    await tester.pumpAndSettle();
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iOS 選單開着時右滑沒過一半而且慢慢放手：頁面和選單都留着，選單仍可按取消', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openDemo(tester);
    await openSheet(tester);
    final g = await tester.startGesture(const Offset(5, 300));
    for (var i = 0; i < 10; i++) {
      await g.moveBy(const Offset(10, 0));
      await tester.pump(const Duration(milliseconds: 50));
    }
    await tester.pump(const Duration(milliseconds: 300));
    await g.up();
    await tester.pumpAndSettle();
    expect(find.text('示範子頁'), findsOneWidget);
    expect(find.text('有變動？'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(find.text('結果：選了 -1'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iOS 右滑：鎖定提示框打開時，提示框和子頁都留着', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openDemo(tester);
    await tester.tap(find.text('鎖定提示框'));
    await tester.pumpAndSettle();
    await tester.dragFrom(const Offset(5, 300), const Offset(400, 0));
    await tester.pumpAndSettle();
    expect(find.text('必須更新'), findsOneWidget);
    expect(find.text('示範子頁'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iOS 右滑：分頁頁面的選單打開時不動，選單留着', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openTabs(tester);
    await openSheet(tester);
    await tester.dragFrom(const Offset(5, 300), const Offset(400, 0));
    await tester.pumpAndSettle();
    expect(find.text('有變動？'), findsOneWidget);
    expect(find.text('車牌管家'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('iOS 右滑返回後再開子頁，彈窗區是新的，沒有留下舊選單', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await openDemo(tester);
    await openSheet(tester);
    await tester.dragFrom(const Offset(5, 300), const Offset(400, 0));
    await tester.pumpAndSettle();
    await tester.tap(find.text('打開示範子頁'));
    await tester.pumpAndSettle();
    expect(find.text('有變動？'), findsNothing);
    await tester.binding.handlePopRoute(); // 沒有彈窗，返回鍵直接離開子頁
    await tester.pumpAndSettle();
    expect(find.text('車牌管家'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });
}
