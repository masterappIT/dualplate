// 在模擬器上自動走一遍組件樣板頁，方便截圖（模擬器沒有點按工具）。不是測試：檔名不以 _test.dart 結尾，flutter test 不會執行。
// 用法：flutter run -d <模擬器> -t test/tour/sample_tour.dart
// 每到一個要截圖的畫面，印出「SHOT 名稱」並停 2.5 秒，由外面的腳本用 xcrun simctl io <模擬器> screenshot 截圖；走完印出「TOUR DONE」。
import 'package:dualplate/main.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('組件樣板頁巡覽', (tester) async {
    Future<void> wait(int ms) => tester.runAsync(() => Future<void>.delayed(Duration(milliseconds: ms)));
    Future<void> settle([int ms = 600]) async {
      await tester.pumpAndSettle();
      await wait(ms);
      await tester.pump();
    }

    Future<void> shot(String name) async {
      await tester.pump();
      debugPrint('SHOT $name');
      await wait(2500);
    }

    Future<void> tap(Finder f) async {
      await tester.ensureVisible(f);
      await settle(300);
      await tester.tap(f);
      await tester.pump();
    }

    // 巡覽框架預設把畫面縮成 800×600，改回 iPhone 17 Pro 的實際尺寸和安全區（402×874 點、3 倍、上 62 下 34）
    tester.view.devicePixelRatio = 3;
    tester.view.physicalSize = const Size(402 * 3, 874 * 3);
    tester.view.padding = const FakeViewPadding(top: 62 * 3, bottom: 34 * 3);
    tester.view.viewPadding = const FakeViewPadding(top: 62 * 3, bottom: 34 * 3);
    await tester.binding.setSurfaceSize(const Size(402, 874));
    await tester.pumpWidget(const DualplateApp());
    await settle(1500);

    // 1. 整頁從上到下
    final position = tester.state<ScrollableState>(find.byType(Scrollable).first).position;
    final step = position.viewportDimension * .8;
    var i = 1;
    for (var y = 0.0;; y += step) {
      position.jumpTo(y.clamp(0, position.maxScrollExtent));
      await settle(400);
      await shot('page-${(i++).toString().padLeft(2, '0')}');
      if (y >= position.maxScrollExtent) break;
    }

    // 2. 確認框、提示框、底部選單
    await tap(find.text('確認框'));
    await settle();
    await shot('ask');
    final pressOk = await tester.startGesture(tester.getCenter(find.text('刪除')));
    await settle(200);
    await shot('ask-pressed');
    await pressOk.moveBy(const Offset(0, 200));
    await pressOk.up();
    await settle(300);
    await tester.tap(find.text('取消'));
    await settle();

    await tap(find.text('提示框'));
    await settle();
    await shot('notice');
    await tester.tap(find.text('知道了'));
    await settle();

    await tap(find.text('底部選單'));
    await settle();
    await shot('sheet');
    final pressItem = await tester.startGesture(tester.getCenter(find.text('換車')));
    await settle(200);
    await shot('sheet-pressed');
    await pressItem.moveBy(const Offset(0, -300));
    await pressItem.up();
    await settle(300);
    await tester.tap(find.text('取消'));
    await settle();

    // 3. 單選、勾選：先看未改動，再逐個點選
    await tester.ensureVisible(find.text('香港公司'));
    position.jumpTo((position.pixels + 120).clamp(0, position.maxScrollExtent));
    await settle();
    await shot('choices-before');
    await tester.tap(find.text('澳門公司'));
    await tester.tap(find.text('粵ZA123港 · HK1234').last);
    await tester.tap(find.text('示範貿易有限公司（香港公司）'));
    await tester.pump(const Duration(milliseconds: 100));
    await wait(80);
    await tester.pump();
    await shot('choices-radio-mid');
    await settle();
    await tap(find.text('香港公司 · 示範貿易有限公司'));
    await tester.tap(find.text('陳大文（已登記）'));
    await tester.tap(find.text('我已閱讀並同意'));
    await settle();
    await shot('choices-after');

    // 4. 提示
    await tap(find.text('短提示'));
    await settle(400);
    await shot('toast-short');
    await settle(1800);
    await tester.tap(find.text('長提示'));
    await settle(400);
    await shot('toast-long');
    await settle(1800);
    await tester.tap(find.text('2.6 秒'));
    await settle(400);
    await shot('toast-2600');
    await settle(3000);
    await shot('toast-gone');

    debugPrint('TOUR DONE');
  });
}
