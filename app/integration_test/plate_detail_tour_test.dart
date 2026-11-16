// 在模擬器上自動操作牌照詳情頁，給截圖和現有 App 並排對照用（階段 2c）。印出 SHOT:名稱 時由外面的指令截圖。
// 只連本機自己開的 API（--dart-define=API_BASE=http://localhost:…），帳號和牌照只經 --dart-define 傳入：
//   cd app && flutter test integration_test/plate_detail_tour_test.dart -d <udid> \
//     --dart-define=API_BASE=http://localhost:4199 --dart-define=DP_EMAIL=… --dart-define=DP_PASS=… --dart-define=DP_PLATE=… \
//     --dart-define=DP_PREFIX=self --dart-define=DP_WRITE=1
// DP_WRITE=1 時也走寫入流程（今天已過關、改到期日、只保存正本等），只可對本機 API 用；沒有 API_BASE 時拒絕執行。
import 'package:dualplate/business/approval_card.dart';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/plate_detail/doc_photo.dart';
import 'package:dualplate/pages/plate_detail/plate_detail_page.dart';
import 'package:dualplate/ui/uni_switch.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const email = String.fromEnvironment('DP_EMAIL');
const password = String.fromEnvironment('DP_PASS');
const plateId = String.fromEnvironment('DP_PLATE');
const prefix = String.fromEnvironment('DP_PREFIX', defaultValue: 'f');
const write = String.fromEnvironment('DP_WRITE') == '1';
const tour = String.fromEnvironment('DP_TOUR', defaultValue: 'full');
const localApi = String.fromEnvironment('API_BASE');

// 一張小小的 JPEG（灰色 8×8），拍卡和證件相片的替身：本機 API 只保存，不讀正式資料
const fakePhoto =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAIAAgBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('牌照詳情各狀態', (tester) async {
    if (!localApi.startsWith('http://localhost')) {
      fail('只可連本機 API（--dart-define=API_BASE=http://localhost:…）');
    }
    Future<void> wait(int ms) => tester.pump(Duration(milliseconds: ms));
    Future<void> shot(String name, {int before = 700}) async {
      await wait(before);
      // ignore: avoid_print
      print('SHOT:$prefix-$name');
      await wait(1500);
    }

    Future<bool> tap(Finder f, [int after = 900]) async {
      if (f.evaluate().isEmpty) {
        // ignore: avoid_print
        print('MISSING:$f');
        return false;
      }
      // 已在畫面內就原位點（現有 App 的點擊工具也不會先捲動）
      final y = tester.getCenter(f.first).dy;
      if (y < 110 || y > 900) {
        await tester.ensureVisible(f.first);
        await wait(200);
      }
      await tester.tap(f.first, warnIfMissed: false);
      await wait(after);
      return true;
    }

    Future<void> tapText(String text, [int after = 900]) =>
        tap(find.text(text), after);
    Future<void> tapLast(String text, [int after = 900]) async {
      await tester.tap(find.text(text).last, warnIfMissed: false);
      await wait(after);
    }

    // 把某段文字捲到距內容頂 [top] 的位置（現有 App 截圖用手指拖，位置對不準；並排時按元件裁切對齊）
    // [back]：再往回捲幾點（現有 App 的截圖「其他資料」墨跡頂在 128pt，Flutter 捲到頂是 109.67pt，差 18.33）
    Future<void> scrollTo(
      String text, {
      double alignment = 0,
      double back = 0,
    }) async {
      final f = find.text(text).first;
      await Scrollable.ensureVisible(tester.element(f), alignment: alignment);
      if (back != 0) {
        final pos = Scrollable.of(tester.element(f)).position;
        pos.jumpTo(pos.pixels - back);
      }
      await wait(400);
    }

    await Session.load();
    clearSession();
    await Session.flush();
    final login = await api('/login', 'POST', {
      'email': email,
      'password': password,
    });
    saveSession(Map<String, dynamic>.from(login as Map));
    await Session.flush();
    PlateDetailPage.capture = (context, {required side}) async => fakePhoto;
    debugPickDocPhoto = (context) async => fakePhoto;

    await tester.pumpWidget(
      DualplateApp(initialLocation: '/plate-detail?id=$plateId'),
    );
    await shot('loading', before: 30); // 剛打開、資料未到
    await wait(2500);
    await shot('top');

    if (tour == 'top') return;
    if (tour != 'write') {
      await scrollTo('其他資料', back: 18.33);
      await shot('folds');
      for (final (key, title) in const [
        ('deadlines', '到期項目'),
        ('crossing', '90 天過關'),
      ]) {
        await tapText(title);
        await shot(key);
        await tapText(title);
      }
      await tapText('批文卡');
      await shot('card');
      // 不捲動，直接點卡面（現有 App 也是原位點）
      await tester.tap(find.byType(ApprovalCard), warnIfMissed: false);
      await wait(1200);
      await shot('card-back');
      await tapText('正面', 1200);
      await tapText('修改內容');
      await shot('card-edit');
      await tapText('取消');
      await tapText('上傳新批文卡');
      await shot('sheet-face');
      await tapLast('取消');
      await tapText('批文卡');
      await scrollTo('其他資料', back: 18.33); // 編輯框的「取消」在畫面外時捲動過，捲回和現有 App 一樣的位置
      for (final (key, title) in const [
        ('vehicle', '車輛與證件'),
        ('drivers', '司機'),
        ('usage', '出租'),
        ('holder', '持牌公司'),
        ('requests', '辦理記錄'),
      ]) {
        await tapText(title);
        await shot(key);
        await tapText(title);
      }
      await tapText('牌照資料');
      await shot('plate');
      await tapText('修改牌照資料 ›');
      await scrollTo('牌照資料', alignment: .45);
      await shot('plate-edit');
      // 選擇器：上牌狀態
      await tap(find.text(installWordShown()).last);
      await shot('picker-install');
      await tap(find.byKey(const ValueKey('picker-cancel')));
      await tapText('收起資料修改');
      await tapText('牌照資料');

      // 有變動？
      await scrollTo('有變動？', alignment: .5);
      await tapText('有變動？');
      await shot('sheet-changes');
      await tapLast('我已經自己辦好', 1300);
      await shot('sheet-done-self');
      await tapLast('取消');

      // 到期項目的日期選擇器（填日期／修改）
      await scrollTo('其他資料');
      await tapText('到期項目');
      if (find.text('填日期').evaluate().isNotEmpty) {
        await tapText('填日期');
        await shot('picker-date');
        await tap(find.byKey(const ValueKey('picker-cancel')));
      }
      await tapText('到期項目');
    }
    if (!write) return;
    await scrollTo('其他資料', back: 18.33);
    // ── 寫入流程（只對本機 API）──
    // 90 天過關：開啟、今天已過關（印章）
    await tapText('90 天過關');
    if (find.text('今天已過關').evaluate().isEmpty) {
      await tap(find.byType(UniSwitch), 400);
      await shot('crossing-toggle-toast', before: 100);
      await wait(1500);
    }
    await shot('crossing-before');
    if (find.text('今天已過關').evaluate().isNotEmpty) {
      await tapText('今天已過關', 200);
      await shot('crossing-stamp', before: 200);
    }
    await tapText('90 天過關');
    // 批文卡：拍卡（替身）上傳並讀取 → 欄位狀態、提示
    await tapText('批文卡');
    await tapText('上傳新批文卡');
    await tapLast('正面', 300);
    await shot('card-uploading', before: 100);
    await wait(4000);
    await shot('card-read');
    // 已有正本：第二層選單、只保存正本
    await scrollTo('上傳新批文卡', alignment: .5);
    await tapText('上傳新批文卡');
    await tapLast('背面', 1300);
    await shot('sheet-mode');
    await tapLast('只保存正本', 300);
    await wait(3000);
    await shot('card-saved');
    if (find.text('查看正本').evaluate().isNotEmpty) {
      await tapText('查看正本', 2500);
      await shot('original');
      await tester.tapAt(const Offset(220, 480));
      await wait(800);
    }
    // 修改內容 → 改港澳車牌 → 問換車
    await tapText('修改內容');
    final local = find
        .byWidgetPredicate(
          (w) => w is EditableText && w.controller.text == (plateLocal ?? ''),
        )
        .evaluate();
    if (local.isNotEmpty) {
      (local.last.widget as EditableText).controller.text = 'ZZ9999';
      await wait(300);
      await tapText('儲存批文卡內容');
      await shot('ask-change');
      await tester.tapAt(const Offset(220, 300)); // 點框外取消
      await wait(800);
    }
  });
}

String? get plateLocal => const String.fromEnvironment('DP_LOCAL').isEmpty
    ? null
    : const String.fromEnvironment('DP_LOCAL');

// 修改牌照資料裏「上牌狀態」選擇框現在顯示的字
String installWordShown() =>
    const String.fromEnvironment('DP_INSTALL', defaultValue: '未填寫');
