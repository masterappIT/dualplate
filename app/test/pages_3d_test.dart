// 階段 3d 頁面（申請使用、服務條款、註銷帳號）：送到伺服器的請求內容和主要畫面（假伺服器 MockClient）。每種情況一個測試。
import 'dart:convert';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/login/login_page.dart';
import 'package:dualplate/pages/terms/terms_page.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

// 每個請求記下：方法、路徑、內容
final sent = <(String, String, Object?)>[];
// 路徑 → 回應（狀態, 內容）；沒有的回 {}
Map<String, (int, Object)> routes = {};

Future<http.Response> handle(http.Request r) async {
  final body = r.body.isEmpty ? null : jsonDecode(r.body);
  sent.add((r.method, r.url.path, body));
  final hit = routes['${r.method} ${r.url.path}'] ?? routes[r.url.path] ?? (200, <String, Object>{});
  return http.Response(jsonEncode(hit.$2), hit.$1, headers: {'content-type': 'application/json; charset=utf-8'});
}

Future<void> settle(WidgetTester tester, [int n = 8]) async {
  for (var i = 0; i < n; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

// signedIn 為 false 時未登入（申請使用、從登入頁看條款）
Future<void> open(WidgetTester tester, String location, {bool signedIn = true, Map<String, Object> prefs = const {}}) async {
  tester.view.physicalSize = const Size(1320, 2868);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'flutter.welcomeGuide:u1': 1, ...prefs});
  await Session.load();
  if (signedIn) {
    Session.debugSet(token: 't', user: {'id': 'u1', 'name': '陳先生', 'serviceMode': '自管'}, mode: '自管');
  } else {
    Session.debugSet();
  }
  await tester.pumpWidget(DualplateApp(initialLocation: location));
  await settle(tester);
}

Future<void> tapText(WidgetTester tester, String text) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pump();
  final f = find.text(text).last;
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f, warnIfMissed: false);
  await settle(tester);
}

Iterable<(String, String, Object?)> writes() => sent.where((s) => s.$1 != 'GET');
List<String> lines() => [for (final w in writes()) '${w.$1} ${w.$2} ${jsonEncode(w.$3)}'];
String line(String method, String path, Object? body) => '$method $path ${jsonEncode(body)}';
int gets(String path) => sent.where((s) => s.$1 == 'GET' && s.$2 == path).length;

// 每個測試最後等提示（1.5 秒）和延遲的動作（400–600ms）走完
void testPage(String name, Future<void> Function(WidgetTester tester) body) => testWidgets(name, (tester) async {
      await body(tester);
      await tester.pump(const Duration(seconds: 3));
    });

const publicTerms = {'version': 3, 'publishedAt': '2026-11-04T02:00:00Z', 'terms': '服務條款正文', 'privacy': '私隱聲明正文'};

Map myTerms({bool accepted = false, bool everAccepted = false, String mode = 'prompt', bool published = true}) => {
      'published': published,
      'version': 3,
      'publishedAt': '2026-11-04T02:00:00Z',
      'terms': '服務條款正文',
      'privacy': '私隱聲明正文',
      'accepted': accepted,
      'acceptedAt': accepted ? '2026-11-05T02:00:00Z' : null,
      'everAccepted': everAccepted,
      'mode': mode,
    };

Map closeInfo({bool allowed = true}) => {
      'allowed': allowed,
      'counts': {'plates': 2, 'companies': 1, 'vehicles': 3, 'drivers': 4},
      'reasons': ['不再需要', '改用其他服務', '其他'],
      if (!allowed) 'error': '你還有辦理中的委託，完成或取消後才可以註銷。',
      if (!allowed) 'openRequests': [{'id': 'q1', 'title': '續期粵港牌'}],
    };

// 申請使用表格的輸入框次序：號碼、稱呼、密碼、再輸入一次
Future<void> fillSignup(WidgetTester tester, {String phone = '9123 4567', String name = ' 陳先生 ', String password = 'password-10'}) async {
  final fields = find.byType(EditableText);
  await tester.enterText(fields.at(0), phone);
  await tester.enterText(fields.at(1), name);
  await tester.enterText(fields.at(2), password);
  await tester.enterText(fields.at(3), password);
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    sent.clear();
    routes = {};
    Api.client = MockClient(handle);
    debugResetApi();
  });

  group('申請使用', () {
    setUp(() => routes = {'/api/public/terms': (200, publicTerms)});

    testPage('讀不到條款：顯示「暫時不能在網上申請」，沒有表格', (tester) async {
      routes = {'/api/public/terms': (404, {'error': '未發佈'})};
      await open(tester, '/signup', signedIn: false);
      expect([find.text('暫時不能在網上申請').evaluate().length, find.byType(EditableText).evaluate().length, find.text('已有帳戶？').evaluate().length], [1, 0, 0]);
    });

    testPage('讀到條款：顯示表格和「已有帳戶？」', (tester) async {
      await open(tester, '/signup', signedIn: false);
      expect([find.byType(EditableText).evaluate().length, find.text('提交申請').evaluate().length], [4, 1]);
    });

    testPage('區號照登入頁上次選的', (tester) async {
      await open(tester, '/signup', signedIn: false, prefs: {'flutter.loginArea': '+86'});
      expect([find.text('內地 +86').evaluate().length, find.text('11 位手機號碼').evaluate().length], [1, 1]);
    });

    testPage('未勾選同意：不送，顯示提示', (tester) async {
      await open(tester, '/signup', signedIn: false);
      await fillSignup(tester);
      await tapText(tester, '提交申請');
      expect([writes().length, find.text('請先閱讀並同意服務條款及私隱聲明').evaluate().length], [0, 1]);
    });

    testPage('號碼不足：不送，顯示提示', (tester) async {
      await open(tester, '/signup', signedIn: false);
      await fillSignup(tester, phone: '9123');
      await tapText(tester, '我已閱讀並同意');
      await tapText(tester, '提交申請');
      expect([writes().length, find.text('香港手機號碼應為 8 位').evaluate().length], [0, 1]);
    });

    testPage('送出：POST /public/signup，號碼加區號、稱呼去空格、附條款版本', (tester) async {
      await open(tester, '/signup', signedIn: false);
      await fillSignup(tester);
      await tapText(tester, '我已閱讀並同意');
      await tapText(tester, '提交申請');
      expect(lines(), [line('POST', '/api/public/signup', {'phone': '+85291234567', 'name': '陳先生', 'password': 'password-10', 'acceptTerms': true, 'termsVersion': 3})]);
    });

    testPage('送出成功：顯示「申請已收到」，表格收起', (tester) async {
      await open(tester, '/signup', signedIn: false);
      await fillSignup(tester);
      await tapText(tester, '我已閱讀並同意');
      await tapText(tester, '提交申請');
      expect([find.text('申請已收到').evaluate().length, find.byType(EditableText).evaluate().length, find.text('已有帳戶？').evaluate().length], [1, 0, 0]);
    });

    testPage('伺服器拒絕：顯示伺服器的訊息', (tester) async {
      routes['POST /api/public/signup'] = (400, {'error': '這個號碼已申請，請等候我們聯絡'});
      await open(tester, '/signup', signedIn: false);
      await fillSignup(tester);
      await tapText(tester, '我已閱讀並同意');
      await tapText(tester, '提交申請');
      expect(find.text('這個號碼已申請，請等候我們聯絡'), findsOneWidget);
    });

    testPage('條款剛更新（409）：重新讀條款、取消勾選、再按不送', (tester) async {
      routes['POST /api/public/signup'] = (409, {'error': '條款已更新，請重新閱讀'});
      await open(tester, '/signup', signedIn: false);
      await fillSignup(tester);
      await tapText(tester, '我已閱讀並同意');
      await tapText(tester, '提交申請');
      expect([gets('/api/public/terms'), find.text('條款已更新，請重新閱讀').evaluate().length], [2, 1]);
      await tapText(tester, '提交申請');
      expect([writes().length, find.text('請先閱讀並同意服務條款及私隱聲明').evaluate().length], [1, 1]);
    });

    testPage('按「私隱聲明」打開條款頁的私隱聲明', (tester) async {
      await open(tester, '/signup', signedIn: false);
      await tapText(tester, '私隱聲明');
      expect(find.text('私隱聲明正文'), findsOneWidget);
    });

    testPage('按「返回登入」到登入頁', (tester) async {
      await open(tester, '/signup', signedIn: false);
      await tapText(tester, '返回登入');
      expect(find.byType(LoginPage), findsOneWidget);
    });
  });

  group('服務條款', () {
    testPage('未登入：讀公開條款，沒有同意區', (tester) async {
      routes = {'/api/public/terms': (200, publicTerms)};
      await open(tester, '/terms', signedIn: false);
      expect([gets('/api/public/terms'), find.text('服務條款正文').evaluate().length, find.text('同意並繼續').evaluate().length], [1, 1, 0]);
    });

    testPage('?tab=privacy：先顯示私隱聲明', (tester) async {
      routes = {'/api/public/terms': (200, publicTerms)};
      await open(tester, '/terms?tab=privacy', signedIn: false);
      expect([find.text('私隱聲明正文').evaluate().length, find.text('服務條款正文').evaluate().length], [1, 0]);
    });

    testPage('切換到私隱聲明', (tester) async {
      routes = {'/api/public/terms': (200, publicTerms)};
      await open(tester, '/terms', signedIn: false);
      await tapText(tester, '私隱聲明');
      expect(find.text('私隱聲明正文'), findsOneWidget);
    });

    testPage('版本和發佈日期（香港日期）', (tester) async {
      routes = {'/api/public/terms': (200, publicTerms)};
      await open(tester, '/terms', signedIn: false);
      expect(find.text('第 3 版 · 2026-11-04 發佈'), findsOneWidget);
    });

    testPage('沒有發佈：顯示「服務條款尚未發佈。」', (tester) async {
      routes = {'/api/my/terms': (200, {'published': false})};
      await open(tester, '/terms');
      expect(find.text('服務條款尚未發佈。'), findsOneWidget);
    });

    testPage('登入、已同意：顯示同意日期，沒有同意區', (tester) async {
      routes = {'/api/my/terms': (200, myTerms(accepted: true, everAccepted: true))};
      await open(tester, '/terms');
      expect([find.text('第 3 版 · 2026-11-04 發佈 · 你已於 2026-11-05 同意').evaluate().length, find.text('同意並繼續').evaluate().length], [1, 0]);
    });

    testPage('登入、第一次：「請先閱讀服務條款」和「稍後再看」', (tester) async {
      routes = {'/api/my/terms': (200, myTerms())};
      await open(tester, '/terms');
      expect([find.text('請先閱讀服務條款').evaluate().length, find.text('稍後再看').evaluate().length], [1, 1]);
    });

    testPage('登入、更新後：「服務條款已更新」', (tester) async {
      routes = {'/api/my/terms': (200, myTerms(everAccepted: true))};
      await open(tester, '/terms');
      expect(find.text('服務條款已更新'), findsOneWidget);
    });

    testPage('未勾選：按「同意並繼續」不送', (tester) async {
      routes = {'/api/my/terms': (200, myTerms())};
      await open(tester, '/terms');
      await tapText(tester, '同意並繼續');
      expect(writes(), isEmpty);
    });

    testPage('勾選後同意：POST /my/terms/accept 送版本，之後離開條款頁', (tester) async {
      routes = {'/api/my/terms': (200, myTerms())};
      await open(tester, '/terms');
      await tapText(tester, '我已閱讀並同意服務條款及私隱聲明');
      await tapText(tester, '同意並繼續');
      await tester.pump(const Duration(milliseconds: 700));
      await settle(tester);
      expect([lines(), find.byType(TermsPage).evaluate().length], [
        [line('POST', '/api/my/terms/accept', {'version': 3})],
        0,
      ]);
    });

    testPage('同意時版本已過時（409）：重新讀條款', (tester) async {
      routes = {'/api/my/terms': (200, myTerms()), 'POST /api/my/terms/accept': (409, {'error': '條款已更新'})};
      await open(tester, '/terms');
      await tapText(tester, '我已閱讀並同意服務條款及私隱聲明');
      await tapText(tester, '同意並繼續');
      expect(gets('/api/my/terms'), 2);
    });

    testPage('強制：「請先閱讀並同意」和「不同意，退出登入」', (tester) async {
      routes = {'/api/my/terms': (200, myTerms(mode: 'force', everAccepted: true))};
      await open(tester, '/terms');
      expect([find.text('請先閱讀並同意').evaluate().length, find.text('不同意，退出登入').evaluate().length, find.text('稍後再看').evaluate().length], [1, 1, 0]);
    });

    testPage('強制：「不同意，退出登入」清登入狀態並到登入頁', (tester) async {
      routes = {'/api/my/terms': (200, myTerms(mode: 'force'))};
      await open(tester, '/terms');
      await tapText(tester, '不同意，退出登入');
      expect([getUser(), find.byType(LoginPage).evaluate().length], [null, 1]);
    });
  });

  group('註銷帳號', () {
    setUp(() => routes = {'GET /api/my/account/close': (200, closeInfo())});

    testPage('列出會刪除的數量', (tester) async {
      await open(tester, '/close-account');
      expect([for (final t in ['2 個', '1 間', '3 部', '4 位']) find.text(t).evaluate().length], [1, 1, 1, 1]);
    });

    testPage('有辦理中的委託：顯示原因和委託，沒有密碼欄', (tester) async {
      routes = {'GET /api/my/account/close': (200, closeInfo(allowed: false))};
      await open(tester, '/close-account');
      expect([find.text('你還有辦理中的委託，完成或取消後才可以註銷。').evaluate().length, find.text('續期粵港牌').evaluate().length, find.byType(EditableText).evaluate().length], [1, 1, 0]);
    });

    testPage('讀取失敗：顯示錯誤', (tester) async {
      routes = {'GET /api/my/account/close': (403, {'error': '托管客戶請聯絡顧問'})};
      await open(tester, '/close-account');
      expect(find.text('托管客戶請聯絡顧問'), findsOneWidget);
    });

    testPage('沒填密碼：不送，顯示「請輸入登入密碼」', (tester) async {
      await open(tester, '/close-account');
      await tapText(tester, '註銷帳號');
      expect([writes().length, find.text('請輸入登入密碼').evaluate().length], [0, 1]);
    });

    testPage('確認框按「取消」：不送', (tester) async {
      await open(tester, '/close-account');
      await tester.enterText(find.byType(EditableText).last, 'password-10');
      await tapText(tester, '註銷帳號');
      expect(find.text('確定註銷帳號？'), findsOneWidget);
      await tapText(tester, '取消');
      expect(writes(), isEmpty);
    });

    testPage('沒選原因：只送密碼', (tester) async {
      await open(tester, '/close-account');
      await tester.enterText(find.byType(EditableText).last, 'password-10');
      await tapText(tester, '註銷帳號');
      await tapText(tester, '註銷');
      expect(lines(), [line('POST', '/api/my/account/close', {'password': 'password-10'})]);
    });

    testPage('選「其他」並寫原因：送原因和去空格的文字', (tester) async {
      await open(tester, '/close-account');
      await tapText(tester, '其他');
      await tester.enterText(find.byType(EditableText).first, '  搬走了 ');
      await tester.enterText(find.byType(EditableText).last, 'password-10');
      await tapText(tester, '註銷帳號');
      await tapText(tester, '註銷');
      expect(lines(), [line('POST', '/api/my/account/close', {'password': 'password-10', 'reason': '其他', 'reasonText': '搬走了'})]);
    });

    testPage('只有選「其他」才有原因輸入框', (tester) async {
      await open(tester, '/close-account');
      await tapText(tester, '不再需要');
      expect(find.byType(EditableText), findsOneWidget);
    });

    testPage('註銷成功：清登入狀態並到登入頁', (tester) async {
      await open(tester, '/close-account');
      await tester.enterText(find.byType(EditableText).last, 'password-10');
      await tapText(tester, '註銷帳號');
      await tapText(tester, '註銷');
      expect([getUser(), find.byType(LoginPage).evaluate().length], [null, 1]);
    });

    testPage('密碼錯：顯示伺服器的訊息，仍在本頁', (tester) async {
      routes['POST /api/my/account/close'] = (400, {'error': '密碼不正確'});
      await open(tester, '/close-account');
      await tester.enterText(find.byType(EditableText).last, 'wrong-password');
      await tapText(tester, '註銷帳號');
      await tapText(tester, '註銷');
      expect([find.text('密碼不正確').evaluate().length, getUser()?['id']], [1, 'u1']);
    });

    testPage('送出時才有委託（409）：重新讀取', (tester) async {
      routes['POST /api/my/account/close'] = (409, {'error': '你還有辦理中的委託'});
      await open(tester, '/close-account');
      await tester.enterText(find.byType(EditableText).last, 'password-10');
      await tapText(tester, '註銷帳號');
      await tapText(tester, '註銷');
      expect(gets('/api/my/account/close'), 2);
    });
  });
}
