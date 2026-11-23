// 線上客服（docs/tasks/support-masterbox-plan.md 第 2 部分）：網址內容、帶入的資料、哪些畫面有客服卡、「問客服」預填句子、客服頁返回。一個情況一個測試。
// 伺服器用 MockClient 代替（不連正式網站）；測試環境沒有原生的內嵌網頁，客服頁用 SupportPage.debugView 畫出要打開的網址。
import 'dart:convert';
import 'package:dualplate/business/support.dart';
import 'package:dualplate/business/support_card.dart';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/close_account/close_account_logic.dart';
import 'package:dualplate/pages/plate_delete/plate_delete_page.dart';
import 'package:dualplate/pages/support/support_page.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

// 把網址 # 後面的內容解回 JSON（和 deploy/web/support/index.html 的讀法一樣：補回 = 再 base64 解碼）
Map<String, dynamic> decodePayload(String payload) {
  var b64 = payload;
  while (b64.length % 4 != 0) {
    b64 += '=';
  }
  return jsonDecode(utf8.decode(base64Url.decode(b64))) as Map<String, dynamic>;
}

Map<String, dynamic> payloadOf(String url) => url.contains('#') ? decodePayload(url.split('#').last) : {};

late List<http.Request> sent;
late Map<String, dynamic> overview;
late Object? profile;
late List<dynamic> plates;

http.Response reply(Object? body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

Future<http.Response> handle(http.Request r) async {
  sent.add(r);
  final path = r.url.path.replaceFirst('/api', '');
  if (path == '/my/terms') return reply({'mode': 'prompt', 'published': false});
  if (path == '/my/overview') return reply(overview);
  if (path == '/my/profile') return profile == null ? reply({'error': '伺服器暫時出錯'}, 500) : reply(profile);
  if (path == '/plate-assets') return reply(plates);
  if (path == '/requests') return reply([]);
  if (path == '/my/fees') return reply({'outstanding': {}, 'items': []});
  if (path == '/public/contact') return reply({'whatsapp': '+85366714829', 'whatsappLink': 'https://wa.me/85366714829', 'wechatId': 'abc', 'wechatQr': '', 'wecomLink': ''});
  if (path == '/my/plates/p1/delete') {
    return reply({'allowed': false, 'label': '粵Z·A123港', 'error': '這個牌照還有未完成的委託，不能刪除。', 'openRequests': [{'id': 'r1', 'title': '換司機'}], 'companies': []});
  }
  if (path == '/my/account/close') return reply({'allowed': false, 'error': '你還有未完成的委託，暫時不能註銷。', 'openRequests': [{'id': 'r1', 'title': '換司機'}]});
  return reply({'error': '沒有這個接口'}, 404);
}

Map<String, dynamic> custody() => {
      'unreadNotifications': 0,
      'advisor': {'name': '李小姐', 'phone': '+853 6600 1234', 'wechat': ''},
      'serviceMode': '托管',
      'counts': {'pending': 0, 'ok': 0, 'due': 0, 'overdue': 0},
      'plates': [],
      'deadlines': [],
      'todos': [],
      'activeRequests': [],
    };

Map<String, dynamic> self() => {...custody(), 'advisor': {'name': '', 'phone': '', 'wechat': ''}, 'serviceMode': '自管'};

const user = {'id': 'u1', 'customerId': 'c42', 'name': '陳大文', 'email': 'chan@example.com', 'serviceMode': '托管'};

Future<void> open(WidgetTester tester, String location, {String mode = '托管', bool signedIn = true}) async {
  tester.view.physicalSize = const Size(1320, 2868);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'flutter.welcomeGuide:u1': 1});
  await Session.load();
  Session.debugSet(token: signedIn ? 't' : null, user: signedIn ? {...user, 'serviceMode': mode} : null, mode: signedIn ? mode : null);
  await tester.pumpWidget(DualplateApp(initialLocation: location));
  await settle(tester);
}

Future<void> settle(WidgetTester tester, [int times = 8]) async {
  for (var i = 0; i < times; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> tapText(WidgetTester tester, String text) async {
  final f = find.text(text).last;
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f);
  await settle(tester);
}

// 客服頁畫出的網址（SupportPage.debugView）
String shownUrl(WidgetTester tester) => tester.widget<Text>(find.byKey(const ValueKey('support-url'))).data!;

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    sent = [];
    overview = custody();
    profile = {'me': {'name': '陳大文', 'email': 'chan@example.com', 'phone': '+853 6611 2233'}, 'customer': {'name': '陳大文', 'kind': '個人', 'phone': ''}};
    plates = [
      {'id': 'p1', 'mainland_plate': '粵Z·A123港'},
      {'id': 'p2', 'mainland_plate': '粵Z·B456澳'},
    ];
    Api.client = MockClient(handle);
    debugResetApi();
    debugAppVersion = () async => '1.1.0';
    SupportPage.debugView = (url) => Text(url, key: const ValueKey('support-url'));
  });
  tearDown(() {
    debugAppVersion = null;
    SupportPage.debugView = null;
  });

  group('網址內容', () {
    test('只有預填句子：{"text": …}，base64url 沒有 = + /', () {
      final p = supportPayload(text: '我想刪除牌照 粵Z·A123港，但它還有未完成的委託。');
      expect([RegExp(r'[=+/]').hasMatch(p), decodePayload(p)], [false, {'text': '我想刪除牌照 粵Z·A123港，但它還有未完成的委託。'}]);
    });

    test('資料和預填句子一起', () {
      final p = supportPayload(data: {'name': '陳大文', '來自': 'iPhone App 1.1.0'}, text: '你好');
      expect(decodePayload(p), {'data': {'name': '陳大文', '來自': 'iPhone App 1.1.0'}, 'text': '你好'});
    });

    test('沒有資料又沒有預填句子：空字串，網址不加 #', () {
      expect([supportPayload(), supportPayload(data: {}), supportPageUrl('')], ['', '', supportUrl]);
    });

    test('有內容時接在客服頁網址的 # 後面', () => expect(supportPageUrl('abc'), '$supportUrl#abc'));

    test('正式網址是本產品網站的 /support/', () => expect(supportUrl, 'https://dualplate.masterappinc.com/support/'));

    test('App 頁面路徑：預填句子和未登入標記放在查詢參數', () {
      expect([supportPath(), supportPath(public: true), Uri.parse(supportPath(text: '我想註銷帳號，請幫我處理。')).queryParameters['text']], ['/support', '/support?public=1', '我想註銷帳號，請幫我處理。']);
    });
  });

  group('帶入的資料', () {
    Map<String, String> data({Map? u = user, Object? p, Object? o, Object? pl, String source = 'iPhone App 1.1.0'}) => supportData(user: u, profile: p, overview: o, plates: pl, source: source);

    test('托管客戶：照計劃的欄位和順序', () {
      final d = data(p: profile, o: custody(), pl: plates);
      expect(d.entries.map((e) => '${e.key}=${e.value}').toList(), [
        'name=陳大文',
        'email=chan@example.com',
        'phone=+853 6611 2233',
        '客戶編號=c42',
        '後台連結=https://dualplateadmin.masterappinc.com/#/customers/c42',
        '管理方式=托管',
        '顧問=李小姐',
        '牌照=粵Z·A123港、粵Z·B456澳',
        '來自=iPhone App 1.1.0',
      ]);
    });

    test('自管客戶不寫顧問', () => expect(data(p: profile, o: self(), pl: plates).containsKey('顧問'), false));

    test('手機號碼開通的佔位電郵不寫', () => expect(data(u: {...user, 'email': '85366112233@phone.invalid'}).containsKey('email'), false));

    test('接口都讀不到：用登入時存下的名字和管理方式，其他沒有值的不寫', () {
      expect(data(), {'name': '陳大文', 'email': 'chan@example.com', '客戶編號': 'c42', '後台連結': 'https://dualplateadmin.masterappinc.com/#/customers/c42', '管理方式': '托管', '來自': 'iPhone App 1.1.0'});
    });

    test('登入手機沒有時用客戶資料的電話', () {
      expect(data(p: {'me': {'name': '陳大文', 'phone': ''}, 'customer': {'phone': '+852 9123 4567'}})['phone'], '+852 9123 4567');
    });

    test('沒有客戶編號：不寫客戶編號和後台連結', () {
      final d = data(u: {'name': '陳大文'});
      expect([d.containsKey('客戶編號'), d.containsKey('後台連結')], [false, false]);
    });

    test('沒有內地車牌的牌照不列入；沒有牌照時不寫', () {
      expect([data(pl: [{'mainland_plate': ''}, {'mainland_plate': '粵Z·A123港'}])['牌照'], data(pl: []).containsKey('牌照')], ['粵Z·A123港', false]);
    });

    test('每項最多 200 字，去掉前後空白', () {
      final d = data(u: {...user, 'name': '  ${'長' * 250}  '});
      expect(d['name'], '長' * 200);
    });

    test('數字也轉成文字', () => expect(data(u: {...user, 'customerId': 42})['客戶編號'], '42'));

    test('來自：iPhone App、Android App 加版本', () {
      expect([supportSource(ios: true, version: '1.1.0'), supportSource(ios: false, version: '1.1.0'), supportSource(ios: true, version: '')], ['iPhone App 1.1.0', 'Android App 1.1.0', 'iPhone App']);
    });
  });

  group('「問客服」預填句子', () {
    test('刪除牌照：有未完成的委託', () => expect(plateDeleteAsk('粵Z·A123港', true), '我想刪除牌照 粵Z·A123港，但它還有未完成的委託。'));
    test('刪除牌照：沒有未完成的委託', () => expect(plateDeleteAsk('粵Z·A123港', false), '我想刪除牌照 粵Z·A123港，請幫我處理。'));
    test('註銷帳號：有未完成的委託', () => expect(closeAccountAsk(true), '我想註銷帳號，但還有未完成的委託。'));
    test('註銷帳號：沒有未完成的委託', () => expect(closeAccountAsk(false), '我想註銷帳號，請幫我處理。'));
  });

  group('安卓選檔案、換頁', () {
    test('accept 只有相片：開相冊選相片', () => expect([acceptKind(['image/*']), acceptKind(['image/png,image/jpeg']), acceptKind(['.jpg', '.png'])], List.filled(3, AcceptKind.image)));
    test('accept 是相片和影片（MasterBox「相片和影片」）：開相冊選相片或影片', () => expect([acceptKind(['image/*,video/*']), acceptKind(['image/*', 'video/mp4'])], List.filled(2, AcceptKind.media)));
    test('accept 有其他檔案或沒寫：用檔案選擇器', () => expect([acceptKind(['image/*', 'application/pdf']), acceptKind([]), acceptKind(['']), acceptKind(['video/*,.pdf'])], List.filled(4, AcceptKind.file)));
    test('客服頁留在內嵌網頁，其他網址不是', () {
      expect([isSupportPage(supportUrl), isSupportPage('$supportUrl#abc'), isSupportPage('https://masterboxapp.masterappinc.com/terms'), isSupportPage('https://dualplate.masterappinc.com/')], [true, true, false, false]);
    });
  });

  group('哪些畫面有客服卡', () {
    testWidgets('自管「我的」：線上客服卡取代「聯絡我們」', (tester) async {
      overview = self();
      await open(tester, '/me', mode: '自管');
      expect(['線上客服', supportIntro, '聯絡客服', '聯絡我們', '在 app 內發訊息'].map((t) => find.text(t).evaluate().length).toList(), [1, 1, 1, 0, 0]);
    });

    testWidgets('自管「我的」：客服卡在「委託我們辦理」卡下面', (tester) async {
      overview = self();
      await open(tester, '/me', mode: '自管');
      expect(tester.getTopLeft(find.text('線上客服')).dy > tester.getTopLeft(find.text('委託我們辦理')).dy, true);
    });

    testWidgets('托管「我的」：顧問卡照舊，下面加線上客服卡', (tester) async {
      await open(tester, '/me');
      expect([find.text('你的顧問').evaluate().length, find.text('線上客服').evaluate().length, tester.getTopLeft(find.text('線上客服')).dy > tester.getTopLeft(find.text('你的顧問')).dy], [1, 1, true]);
    });

    testWidgets('「我的」沒有 WhatsApp、微信渠道按鈕', (tester) async {
      overview = self();
      await open(tester, '/me', mode: '自管');
      expect([find.textContaining('WhatsApp').evaluate().length, find.textContaining('微信').evaluate().length], [0, 0]);
    });

    testWidgets('登入頁：「忘記密碼？」是未登入版客服卡', (tester) async {
      await open(tester, '/login', signedIn: false);
      expect(['忘記密碼？', '發訊息給客服，我們幫你重設。', '聯絡客服'].map((t) => find.text(t).evaluate().length).toList(), [1, 1, 1]);
    });

    testWidgets('申請使用頁（送出後）：未登入版客服卡', (tester) async {
      await open(tester, '/signup', signedIn: false);
      await settle(tester);
      // 沒有條款時顯示「暫時不能在網上申請」和客服卡
      expect(['暫時不能在網上申請', '請按下面「聯絡客服」找我們，我們會為你開通帳戶。', '線上客服', supportPublicIntro, '聯絡客服'].map((t) => find.text(t).evaluate().length).toList(), [1, 1, 1, 1, 1]);
    });
  });

  group('打開客服頁', () {
    testWidgets('已登入按「聯絡客服」：帶入客戶資料，沒有預填句子', (tester) async {
      await open(tester, '/me');
      await tapText(tester, '聯絡客服');
      expect(payloadOf(shownUrl(tester)), {
        'data': {
          'name': '陳大文',
          'email': 'chan@example.com',
          'phone': '+853 6611 2233',
          '客戶編號': 'c42',
          '後台連結': 'https://dualplateadmin.masterappinc.com/#/customers/c42',
          '管理方式': '托管',
          '顧問': '李小姐',
          '牌照': '粵Z·A123港、粵Z·B456澳',
          '來自': 'Android App 1.1.0',
        },
      });
    });

    testWidgets('iPhone：來自寫 iPhone App 和版本', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      await open(tester, '/me');
      await tapText(tester, '聯絡客服');
      final from = (payloadOf(shownUrl(tester))['data'] as Map)['來自'];
      debugDefaultTargetPlatformOverride = null;
      expect(from, 'iPhone App 1.1.0');
    });

    testWidgets('我的資料讀不到：照樣打開，少寫電話', (tester) async {
      profile = null;
      await open(tester, '/me');
      await tapText(tester, '聯絡客服');
      final data = payloadOf(shownUrl(tester))['data'] as Map;
      expect([data['name'], data.containsKey('phone')], ['陳大文', false]);
    });

    testWidgets('登入頁按「聯絡客服」：不帶資料（客服頁清掉舊資料）', (tester) async {
      await open(tester, '/login', signedIn: false);
      await tapText(tester, '聯絡客服');
      expect([shownUrl(tester), sent.where((r) => r.url.path.startsWith('/api/my/')).length], [supportUrl, 0]);
    });

    testWidgets('未登入版卡就算還留著登入狀態也不帶資料', (tester) async {
      await open(tester, '/support?public=1');
      expect([shownUrl(tester), sent.where((r) => r.url.path.startsWith('/api/my/profile')).length], [supportUrl, 0]);
    });

    testWidgets('刪除牌照被擋：「問客服」預填第一句', (tester) async {
      overview = self();
      await open(tester, '/plate-delete?id=p1', mode: '自管');
      expect(find.text('聯絡我們'), findsNothing);
      await tapText(tester, '問客服');
      expect(payloadOf(shownUrl(tester))['text'], '我想刪除牌照 粵Z·A123港，但它還有未完成的委託。');
    });

    testWidgets('註銷帳號被擋：「問客服」預填第一句', (tester) async {
      overview = self();
      await open(tester, '/close-account', mode: '自管');
      expect(find.text('聯絡我們'), findsNothing);
      await tapText(tester, '問客服');
      expect(payloadOf(shownUrl(tester))['text'], '我想註銷帳號，但還有未完成的委託。');
    });

    testWidgets('客服頁：標題「線上客服」、右上「完成」，沒有返回箭頭', (tester) async {
      await open(tester, '/me');
      await tapText(tester, '聯絡客服');
      expect([find.text('線上客服').evaluate().length, find.byKey(const ValueKey('support-done')).evaluate().length, find.byKey(const ValueKey('nav-back')).evaluate().length], [1, 1, 0]);
    });

    testWidgets('按「完成」回到原頁', (tester) async {
      await open(tester, '/me');
      await tapText(tester, '聯絡客服');
      await tester.tap(find.byKey(const ValueKey('support-done')));
      await settle(tester);
      expect([find.byKey(const ValueKey('support-url')).evaluate().length, find.text('聯絡客服').evaluate().length], [0, 1]);
    });

    testWidgets('對話關上（網頁送 close）回到原頁', (tester) async {
      await open(tester, '/me');
      await tapText(tester, '聯絡客服');
      tester.state<SupportPageState>(find.byType(SupportPage)).done();
      await settle(tester);
      expect(find.byKey(const ValueKey('support-url')), findsNothing);
    });

    testWidgets('「完成」連按兩下只關一頁', (tester) async {
      await open(tester, '/me');
      await tapText(tester, '聯絡客服');
      final state = tester.state<SupportPageState>(find.byType(SupportPage));
      state.done();
      state.done();
      await settle(tester);
      expect(find.text('聯絡客服'), findsOneWidget);
    });
  });

  test('SupportCard 預設是已登入版', () => expect(const SupportCard().public, false));
}
