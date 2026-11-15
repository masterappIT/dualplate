// 在 iOS 模擬器上自動操作外殼，給錄影和截圖用（階段 1c；1e 加彈窗遮罩範圍）。印出 SHOT:名稱 時由外面的指令截圖。
// 執行：cd app && flutter test integration_test/shell_demo_test.dart -d <udid>
import 'package:dualplate/main.dart';
import 'package:dualplate/ui/dialogs.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('外殼示範：分頁、換頁、返回、右滑、彈窗開着時右滑、彈窗遮罩範圍', (tester) async {
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
    // 確認框開着時右滑：子頁連確認框一起返回（1e 按現有 App 實測改正）
    await tap(find.text('打開示範子頁'));
    await tap(find.text('確認框'));
    await shot('07-demo-ask');
    await swipeFromEdge();
    await shot('08-demo-after-swipe-ask');
    // 選單開着時右滑：子頁連選單一起返回
    await tap(find.text('打開示範子頁'));
    await tap(find.text('底部選單'));
    await shot('09-demo-choose');
    await swipeFromEdge();
    await shot('10-demo-after-swipe-choose');

    // 1e：分頁頁面「我的」開確認框（和現有 App 的「退出登入」同一句），遮罩只蓋內容區；開着時切分頁再切回
    await tap(find.text('我的'));
    final asked = ask(tester.element(find.byType(DialogArea).hitTestable().first), title: '退出登入', msg: '確定要退出嗎？', ok: '退出', cancel: '取消');
    await wait(900);
    await shot('11-me-ask');
    await tap(find.text('牌照'));
    await shot('12-vehicles-while-ask');
    await tap(find.text('我的'));
    await shot('13-me-return');
    await tap(find.text('取消'));
    await asked;
    // 分頁頁面上的底部選單：在分頁列之上
    await tap(find.text('首頁'));
    await tap(find.text('底部選單'));
    await shot('14-index-sheet');
    await tap(find.text('取消'));
    // 子頁的底部選單：底距安全區 10；開着時按返回箭頭先關選單，再按才返回
    await tap(find.text('打開示範子頁'));
    await tap(find.text('底部選單'));
    await shot('15-demo-sheet');
    await tap(find.byKey(const ValueKey('nav-back')));
    await shot('16-demo-after-back');
    await tap(find.byKey(const ValueKey('nav-back')));
    await wait(1000);
  });
}
