// 在 iOS 模擬器上自動操作外殼，給錄影和截圖用（階段 1c）。印出 SHOT:名稱 時由外面的指令截圖。
// 執行：cd app && flutter test integration_test/shell_demo_test.dart -d <udid>
import 'package:dualplate/main.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('外殼示範：分頁、換頁、返回、右滑、返回先關彈窗', (tester) async {
    Future<void> wait(int ms) async {
      await tester.pump(Duration(milliseconds: ms));
    }

    Future<void> shot(String name) async {
      await wait(600);
      // ignore: avoid_print
      print('SHOT:$name');
      await wait(1800);
    }

    Future<void> tap(Finder f) async {
      await tester.tap(f);
      await wait(900);
    }

    Future<void> swipeFromEdge() async {
      await tester.timedDragFrom(const Offset(4, 420), const Offset(260, 0), const Duration(milliseconds: 450));
      await wait(1000);
    }

    await tester.pumpWidget(const DualplateApp());
    await wait(1500);
    await shot('01-sample');
    await tap(find.text('打開外殼（底部分頁和示範子頁）'));
    await shot('02-tab-index');
    await tap(find.text('牌照'));
    await shot('03-tab-vehicles');
    await tap(find.text('公司'));
    await shot('04-tab-companies');
    await tap(find.text('我的'));
    await shot('05-tab-me');
    await tap(find.text('首頁'));

    // 換頁和返回箭頭
    await tap(find.text('打開示範子頁'));
    await shot('06-demo');
    await tap(find.byKey(const ValueKey('nav-back')));
    // 右滑返回
    await tap(find.text('打開示範子頁'));
    await swipeFromEdge();
    // 確認框開着時右滑：先關確認框
    await tap(find.text('打開示範子頁'));
    await tap(find.text('確認框'));
    await shot('07-demo-ask');
    await swipeFromEdge();
    await shot('08-demo-after-swipe-ask');
    // 選單開着時右滑：先關選單
    await tap(find.text('底部選單'));
    await shot('09-demo-choose');
    await swipeFromEdge();
    await shot('10-demo-after-swipe-choose');
    await tap(find.byKey(const ValueKey('nav-back')));
    await wait(1000);
  });
}
