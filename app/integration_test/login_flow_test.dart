// 在模擬器上自動操作登入頁，給截圖、錄影和並排對照用（階段 1d），最後登入測試帳號並進入首頁分頁。
// 印出 SHOT:名稱 時由外面的指令截圖（見 1d 報告的執行方法）。
// 帳號只經 --dart-define 傳入，不寫進任何檔案：
//   cd app && flutter test integration_test/login_flow_test.dart -d <udid> --dart-define=DP_PHONE=<8 位號碼> --dart-define=DP_PASS=<密碼>
// 沒有傳帳號時只截登入頁各狀態，不登入。只登入、不改任何資料；不送錯誤密碼到伺服器（號碼不夠位的錯誤由 App 本機檢查，不會送出）。
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/login/login_page.dart';
import 'package:dualplate/shell/tab_bar.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const phone = String.fromEnvironment('DP_PHONE');
const password = String.fromEnvironment('DP_PASS');

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('登入頁各狀態，然後登入測試帳號', (tester) async {
    Future<void> wait(int ms) => tester.pump(Duration(milliseconds: ms));
    Future<void> shot(String name, {int before = 600}) async {
      await wait(before);
      // ignore: avoid_print
      print('SHOT:$name');
      await wait(1800);
    }

    Future<void> tap(Finder f, [int after = 700]) async {
      await tester.ensureVisible(f);
      await wait(100);
      await tester.tap(f);
      await wait(after);
    }

    // 不經鍵盤直接填字（整合測試用真實鍵盤，不能 enterText）
    void fill(String key, String text) {
      tester.widget<EditableText>(find.descendant(of: find.byKey(ValueKey(key)), matching: find.byType(EditableText))).controller.text = text;
    }

    // 區號改回香港：滾輪往下拉兩行
    Future<void> backToHongKong() async {
      await tap(find.byKey(const ValueKey('login-area')), 600);
      await tester.drag(find.text('內地 +86').last, const Offset(0, 80));
      await wait(800);
      await tap(find.byKey(const ValueKey('picker-done')), 600);
    }

    Future<void> unfocus() async {
      FocusManager.instance.primaryFocus?.unfocus();
      await wait(800);
    }

    // 從未登入開始（只清本機的登入資料）
    await Session.load();
    clearSession();
    Session.rememberLoginArea('+852');
    await Session.flush();
    await tester.pumpWidget(DualplateApp(initialLocation: startLocation()));
    await wait(1500);
    expect(find.byType(LoginPage), findsOneWidget);
    await shot('01-login');

    await tester.drag(find.byType(SingleChildScrollView), const Offset(0, -700));
    await shot('02-login-bottom', before: 1200);
    await tester.drag(find.byType(SingleChildScrollView), const Offset(0, 900));
    await wait(1200);

    await tap(find.text('電郵').first);
    await shot('03-email');
    await tap(find.text('手機號碼').first);

    await tap(find.byKey(const ValueKey('login-area')), 100);
    await shot('04-picker', before: 300);
    await tester.drag(find.text('香港 +852').last, const Offset(0, -80));
    await wait(800);
    await shot('05-picker-mainland', before: 100);
    await tap(find.byKey(const ValueKey('picker-done')), 600);
    await shot('06-mainland');
    await backToHongKong();
    expect(find.text('香港 +852'), findsOneWidget);

    await tap(find.byKey(const ValueKey('login-phone')), 900);
    await shot('07-keyboard-phone');
    await tap(find.byKey(const ValueKey('login-password')), 900);
    await shot('08-keyboard-password');
    await unfocus();

    await tap(find.byKey(const ValueKey('login-button')), 50);
    await shot('09-error-empty', before: 700);

    fill('login-phone', '123');
    fill('login-password', 'x');
    await wait(100);
    await tap(find.byKey(const ValueKey('login-button')), 50);
    await shot('10-error-digits', before: 700);

    if (phone.isEmpty || password.isEmpty) return;
    fill('login-phone', phone);
    fill('login-password', password);
    await wait(300);
    await tap(find.byKey(const ValueKey('login-button')), 0);
    // 送出中、印章要靠錄影看；這裏等轉到首頁
    for (var i = 0; i < 60 && find.byType(TabsShell).evaluate().isEmpty; i++) {
      await wait(250);
    }
    expect(find.byType(TabsShell), findsOneWidget);
    expect(signedIn, isTrue);
    await shot('12-home', before: 1500);
  });
}
