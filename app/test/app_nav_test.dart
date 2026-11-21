// shell/router.dart 接上的 AppNav.currentPath：要是目前看得見的頁面路徑。
// go_router 的 push 不改 currentConfiguration.uri（推入的頁面顯示時仍是底下的頁面），所以改用 visiblePath。
// 影響 core/api.dart 的兩個判斷：401 時「不在登入頁才打開登入頁」、openTerms 的「已在條款頁」。一個情況一個測試。
import 'dart:convert';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/login/login_page.dart';
import 'package:dualplate/pages/terms/terms_page.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

late List<String> relaunched;
late int status;

http.Response reply(Object? body, int code) => http.Response.bytes(utf8.encode(jsonEncode(body)), code, headers: {'content-type': 'application/json'});

// 登入頁有一直在跑的動畫，不能用 pumpAndSettle；換頁 300–360ms，等 400ms
Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

// 每個測試結尾：等提示框、openTerms 的 1.5 秒計時器走完
Future<void> finish(WidgetTester tester) => tester.pump(const Duration(seconds: 2));

Future<void> openTabs(WidgetTester tester) async {
  await tester.pumpWidget(const DualplateApp(initialLocation: '/index', demoTabs: true));
  await settle(tester);
  final reLaunch = AppNav.reLaunch;
  AppNav.reLaunch = (p) {
    relaunched.add(p);
    reLaunch(p);
  };
}

Future<void> push(WidgetTester tester, String path) async {
  AppNav.push(path);
  await settle(tester);
}

Future<void> pressBack(WidgetTester tester) async {
  await tester.binding.handlePopRoute();
  await settle(tester);
}

// 401：清掉登入資料、打開登入頁，然後拋出錯誤
Future<void> get401(WidgetTester tester) async {
  status = 401;
  try {
    await api('/my/overview');
  } catch (_) {}
  await settle(tester);
}

void main() {
  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
    await Session.load();
    Session.debugSet(token: 'tok', user: {'id': 'u1'});
    relaunched = [];
    status = 200;
    // 假伺服器：登入頁讀聯絡方式等一律回空內容；get401 時回 401
    Api.client = MockClient((_) async => status == 401 ? reply({'error': '請先登入'}, 401) : reply({}, 200));
    debugResetApi();
  });

  tearDown(debugResetApi);

  group('currentPath', () {
    testWidgets('分頁上：分頁的路徑', (tester) async {
      await openTabs(tester);
      expect(AppNav.currentPath(), '/index');
      await finish(tester);
    });

    testWidgets('推入頁面後：那一頁的路徑', (tester) async {
      await openTabs(tester);
      await push(tester, '/terms');
      expect(AppNav.currentPath(), '/terms');
      await finish(tester);
    });

    testWidgets('從推入的頁面返回後：底下分頁的路徑（不再是剛才那一頁）', (tester) async {
      await openTabs(tester);
      await push(tester, '/terms');
      await pressBack(tester);
      expect(AppNav.currentPath(), '/index');
      await finish(tester);
    });

    testWidgets('兩層推入後返回一層：中間那頁的路徑', (tester) async {
      await openTabs(tester);
      await push(tester, '/scope');
      await push(tester, '/terms');
      await pressBack(tester);
      expect(AppNav.currentPath(), '/scope');
      await finish(tester);
    });

    testWidgets('帶查詢參數的頁面：只取路徑', (tester) async {
      await openTabs(tester);
      await push(tester, '/requests?service=renewal');
      expect(AppNav.currentPath(), '/requests');
      await finish(tester);
    });
  });

  group('401 打開登入頁', () {
    testWidgets('在分頁上收到 401：打開登入頁', (tester) async {
      await openTabs(tester);
      await get401(tester);
      expect(find.byType(LoginPage), findsOneWidget);
      await finish(tester);
    });

    testWidgets('從登入頁返回後再收到 401：仍會打開登入頁', (tester) async {
      await openTabs(tester);
      await push(tester, '/login');
      await pressBack(tester);
      expect(find.byType(LoginPage), findsNothing);
      await get401(tester);
      expect(find.byType(LoginPage), findsOneWidget);
      await finish(tester);
    });

    testWidgets('已在登入頁時收到 401：不再疊開一個登入頁', (tester) async {
      await openTabs(tester);
      await push(tester, '/login');
      await get401(tester);
      expect(find.byType(LoginPage, skipOffstage: false), findsOneWidget);
      await finish(tester);
    });
  });

  group('條款頁判斷', () {
    testWidgets('看過條款頁返回後，強制條款仍會轉到條款頁', (tester) async {
      await openTabs(tester);
      await push(tester, '/terms');
      await pressBack(tester);
      openTerms(true);
      await settle(tester);
      expect([relaunched, AppNav.currentPath(), find.byType(TermsPage).evaluate().length], [['/terms'], '/terms', 1]);
      await finish(tester);
    });

    testWidgets('已在條款頁時，強制條款不再轉頁', (tester) async {
      await openTabs(tester);
      await push(tester, '/terms');
      openTerms(true);
      await settle(tester);
      expect(relaunched, isEmpty);
      await finish(tester);
    });

    testWidgets('看過條款頁返回後，提示條款按「查看」仍會打開條款頁', (tester) async {
      await openTabs(tester);
      await push(tester, '/terms');
      await pressBack(tester);
      openTerms(false);
      await settle(tester);
      expect([AppNav.currentPath(), find.byType(TermsPage).evaluate().length], ['/terms', 1]);
      await finish(tester);
    });
  });
}
