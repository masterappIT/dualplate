// 線上客服的紅點（business/support_unread.dart）：背景客服網頁的開始和收起、未讀數、「我的」分頁和「聯絡客服」按鈕的紅點。一個情況一個測試。
// 伺服器用 MockClient 代替（不連正式網站）；測試環境沒有原生的內嵌網頁，背景網頁用 SupportBackground.debugView 畫出網址，客服頁用 SupportPage.debugView。
import 'dart:convert';
import 'package:dualplate/business/support.dart';
import 'package:dualplate/business/support_card.dart';
import 'package:dualplate/business/support_unread.dart';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/support/support_page.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

late List<http.Request> sent;

http.Response reply(Object? body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

Future<http.Response> handle(http.Request r) async {
  sent.add(r);
  final path = r.url.path.replaceFirst('/api', '');
  if (path == '/my/terms') return reply({'mode': 'prompt', 'published': false});
  if (path == '/my/overview') {
    return reply({'unreadNotifications': 0, 'advisor': {'name': '', 'phone': '', 'wechat': ''}, 'serviceMode': '自管', 'counts': {'pending': 0, 'ok': 0, 'due': 0, 'overdue': 0}, 'plates': [], 'deadlines': [], 'todos': [], 'activeRequests': []});
  }
  if (path == '/my/profile') return reply({'me': {'name': '陳大文', 'phone': '+853 6611 2233'}, 'customer': {}});
  if (path == '/plate-assets') return reply([{'id': 'p1', 'mainland_plate': '粵Z·A123港'}]);
  if (path == '/requests') return reply([]);
  if (path == '/my/fees') return reply({'outstanding': {}, 'items': []});
  return reply({'error': '沒有這個接口'}, 404);
}

const user = {'id': 'u1', 'customerId': 'c42', 'name': '陳大文', 'email': 'chan@example.com', 'serviceMode': '自管'};

Future<void> open(WidgetTester tester, String location, {bool signedIn = true}) async {
  tester.view.physicalSize = const Size(1320, 2868);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'flutter.welcomeGuide:u1': 1});
  await Session.load();
  Session.debugSet(token: signedIn ? 't1' : null, user: signedIn ? user : null, mode: signedIn ? '自管' : null);
  await tester.pumpWidget(DualplateApp(initialLocation: location));
  await settle(tester);
}

Future<void> settle(WidgetTester tester, [int times = 8]) async {
  for (var i = 0; i < times; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

// 背景客服網頁（debugView 畫出的網址）；沒有時是 null
String? backgroundUrl(WidgetTester tester) {
  final f = find.byKey(const ValueKey('background-url'));
  return f.evaluate().isEmpty ? null : tester.widget<Text>(f).data;
}

Map<String, dynamic> payloadOf(String url) {
  var b64 = url.split('#').last;
  while (b64.length % 4 != 0) {
    b64 += '=';
  }
  return jsonDecode(utf8.decode(base64Url.decode(b64))) as Map<String, dynamic>;
}

int profileReads() => sent.where((r) => r.url.path == '/api/my/profile').length;

Finder tabBadge() => find.byKey(const ValueKey('tab-badge'));
Finder buttonDot() => find.byKey(const ValueKey('support-dot'));

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    sent = [];
    Api.client = MockClient(handle);
    debugResetApi();
    debugAppVersion = () async => '1.1.0';
    SupportUnread.debugReset();
    SupportBackground.debugView = (url) => Text(url, key: const ValueKey('background-url'), textDirection: TextDirection.ltr);
    SupportPage.debugView = (url) => Text(url, key: const ValueKey('support-url'));
  });
  tearDown(() {
    debugAppVersion = null;
    SupportBackground.debugView = null;
    SupportPage.debugView = null;
    SupportUnread.debugReset();
  });

  group('未讀數的訊息', () {
    test('「unread:3」是 3', () => expect(parseUnread('unread:3'), 3));
    test('「unread:0」是 0', () => expect(parseUnread('unread:0'), 0));
    test('負數當 0', () => expect(parseUnread('unread:-2'), 0));
    test('不是數字、別的訊息不理', () => expect([parseUnread('unread:x'), parseUnread('ready'), parseUnread('close'), parseUnread('')], [null, null, null, null]));
  });

  group('紅點上的字', () {
    test('1 到 99 照寫', () => expect([badgeText(1), badgeText(99)], ['1', '99']));
    test('超過 99 寫 99+', () => expect([badgeText(100), badgeText(1234)], ['99+', '99+']));
  });

  group('未讀數', () {
    test('背景網頁送來的數字照用', () {
      SupportUnread.report(3);
      expect(SupportUnread.count.value, 3);
    });

    test('打開客服頁：歸零', () async {
      SupportUnread.report(3);
      SupportUnread.viewingStarted();
      await Future<void>.delayed(Duration.zero);
      expect(SupportUnread.count.value, 0);
    });

    test('客服頁開著時不理背景送來的數字', () {
      SupportUnread.viewingStarted();
      SupportUnread.report(5);
      expect(SupportUnread.count.value, 0);
    });

    test('關上客服頁後又照用', () {
      SupportUnread.viewingStarted();
      SupportUnread.viewingEnded();
      SupportUnread.report(2);
      expect(SupportUnread.count.value, 2);
    });
  });

  group('背景客服網頁', () {
    test('網址是客服頁加 ?bg=1', () => expect(supportPageUrl('abc', background: true), '$supportUrl?bg=1#abc'));

    test('背景網址仍算是客服頁（不會被當成外部連結）', () => expect(isSupportPage('$supportUrl?bg=1#abc'), true));

    testWidgets('已登入啟動：開始，帶客戶資料、不帶預填句子', (tester) async {
      await open(tester, '/me');
      final url = backgroundUrl(tester)!;
      final p = payloadOf(url);
      expect([url.startsWith('$supportUrl?bg=1#'), (p['data'] as Map)['客戶編號'], (p['data'] as Map)['來自'], p.containsKey('text')], [true, 'c42', 'Android App 1.1.0', false]);
    });

    testWidgets('未登入（登入頁）：不載入', (tester) async {
      await open(tester, '/login', signedIn: false);
      expect([backgroundUrl(tester), profileReads()], [null, 0]);
    });

    testWidgets('登入成功後開始', (tester) async {
      await open(tester, '/login', signedIn: false);
      saveSession({'token': 't1', 'user': user});
      await settle(tester);
      expect(backgroundUrl(tester)?.startsWith('$supportUrl?bg=1#'), true);
    });

    testWidgets('退出登入：收起、紅點歸零', (tester) async {
      await open(tester, '/me');
      SupportUnread.report(3);
      clearSession();
      await settle(tester);
      expect([backgroundUrl(tester), SupportUnread.count.value], [null, 0]);
    });

    testWidgets('換了人（token 變了）：重新載入，資料是新的人', (tester) async {
      await open(tester, '/me');
      final before = profileReads();
      saveSession({'token': 't2', 'user': {...user, 'customerId': 'c77'}});
      await settle(tester);
      expect([profileReads() > before, (payloadOf(backgroundUrl(tester)!)['data'] as Map)['客戶編號']], [true, 'c77']);
    });

    testWidgets('開始和收起時頁面不會重建（「我的」頁的狀態保留）', (tester) async {
      await open(tester, '/me');
      final page = find.text('線上客服').evaluate().single;
      SupportUnread.report(1);
      await settle(tester);
      expect(find.text('線上客服').evaluate().single, same(page));
    });

    testWidgets('測試環境沒有內嵌網頁又沒有 debugView：不啟動、不讀接口', (tester) async {
      SupportBackground.debugView = null;
      await open(tester, '/me');
      expect([find.byKey(const ValueKey('background-url')).evaluate().length, profileReads()], [0, 0]);
    });

    testWidgets('關上客服頁：重新載入背景網頁', (tester) async {
      await open(tester, '/me');
      final before = profileReads();
      await tester.ensureVisible(find.text('聯絡客服'));
      await tester.tap(find.text('聯絡客服'));
      await settle(tester);
      final opened = profileReads();
      await tester.tap(find.byKey(const ValueKey('support-done')));
      await settle(tester);
      // 打開客服頁讀一次（前景），關上後背景再讀一次
      expect([opened, profileReads()], [before + 1, before + 2]);
    });
  });

  group('紅點', () {
    testWidgets('有未讀：「我的」分頁有紅點和數字', (tester) async {
      await open(tester, '/me');
      SupportUnread.report(3);
      await tester.pump();
      expect([tabBadge().evaluate().length, find.descendant(of: tabBadge(), matching: find.text('3')).evaluate().length], [1, 1]);
    });

    testWidgets('分頁紅點在「我的」的圖示上', (tester) async {
      await open(tester, '/me');
      SupportUnread.report(3);
      await tester.pump();
      expect(find.descendant(of: find.byKey(const ValueKey('tab-3')), matching: tabBadge()), findsOneWidget);
    });

    testWidgets('沒有未讀：分頁和按鈕都沒有紅點', (tester) async {
      await open(tester, '/me');
      expect([tabBadge().evaluate().length, buttonDot().evaluate().length], [0, 0]);
    });

    testWidgets('超過 99：分頁和按鈕都寫 99+', (tester) async {
      await open(tester, '/me');
      SupportUnread.report(120);
      await tester.pump();
      expect([find.descendant(of: tabBadge(), matching: find.text('99+')).evaluate().length, find.descendant(of: buttonDot(), matching: find.text('99+')).evaluate().length], [1, 1]);
    });

    testWidgets('「聯絡客服」按鈕有紅點和數字', (tester) async {
      await open(tester, '/me');
      SupportUnread.report(2);
      await tester.pump();
      expect(find.descendant(of: buttonDot(), matching: find.text('2')), findsOneWidget);
    });

    testWidgets('未登入版的客服卡沒有紅點', (tester) async {
      SupportUnread.report(4);
      await tester.pumpWidget(const Directionality(textDirection: TextDirection.ltr, child: SupportCard(public: true)));
      expect(buttonDot(), findsNothing);
    });

    testWidgets('讀了訊息（unread 0）：紅點拿走', (tester) async {
      await open(tester, '/me');
      SupportUnread.report(3);
      await tester.pump();
      SupportUnread.report(0);
      await tester.pump();
      expect([tabBadge().evaluate().length, buttonDot().evaluate().length], [0, 0]);
    });

    testWidgets('打開客服頁：紅點拿走', (tester) async {
      await open(tester, '/me');
      SupportUnread.report(3);
      await tester.pump();
      await tester.ensureVisible(find.text('聯絡客服'));
      await tester.tap(find.text('聯絡客服'));
      await settle(tester);
      expect(SupportUnread.count.value, 0);
    });

    testWidgets('退出登入後回到登入頁：沒有紅點', (tester) async {
      await open(tester, '/me');
      SupportUnread.report(3);
      clearSession();
      await settle(tester);
      expect(SupportUnread.count.value, 0);
    });
  });
}
