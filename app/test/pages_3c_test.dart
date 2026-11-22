// 階段 3c 頁面：送到伺服器的請求內容和主要畫面（假伺服器 MockClient）。每種情況一個測試。
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:dualplate/business/company_editor.dart';
import 'package:dualplate/business/signature_pad.dart';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/external.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
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

Future<void> open(WidgetTester tester, String location, {String mode = '托管'}) async {
  tester.view.physicalSize = const Size(1320, 2868);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'flutter.welcomeGuide:u1': 1});
  await Session.load();
  Session.debugSet(token: 't', user: {'id': 'u1', 'name': '李先生', 'serviceMode': mode}, mode: mode);
  await tester.pumpWidget(DualplateApp(initialLocation: location));
  await settle(tester);
}

Future<void> tapText(WidgetTester tester, String text) async {
  // 輸入後先收起鍵盤（測試裏輸入框有焦點時，下一下點擊有時不生效）
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pump();
  final f = find.text(text).last;
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f, warnIfMissed: false);
  await settle(tester);
}

Iterable<(String, String, Object?)> writes() => sent.where((s) => s.$1 != 'GET');
// 寫入請求寫成一行文字比較：「方法 路徑 內容JSON」
List<String> lines() => [for (final w in writes()) '${w.$1} ${w.$2} ${jsonEncode(w.$3)}'];
String line(String method, String path, Object? body) => '$method $path ${jsonEncode(body)}';

// 每個測試最後等提示（1.5 秒）和延遲的提示（400ms）走完
void testPage(String name, Future<void> Function(WidgetTester tester) body) => testWidgets(name, (tester) async {
      await body(tester);
      await tester.pump(const Duration(seconds: 3));
    });

Map rentalDetail({int version = 0, bool signed = false, String body = '出租協議內容', bool canSend = true}) => {
      'id': 'r1',
      'plateId': 'p1',
      'plateLabel': '粵ZA100港 · AB1000',
      'status': '草擬',
      'statusWord': version == 0 ? '未發出協議' : '待承租人確認',
      'handling': 'self',
      'startsOn': '2026-12-01',
      'endsOn': null,
      'lessor': '李先生',
      'renter': {'name': '陳大文', 'phone': '+85261234567', 'vehiclePlate': 'AB1000', 'driver': '黃文軒'},
      'currency': 'HKD',
      'rentAmount': 800000,
      'cycle': 'monthly',
      'dueDay': 5,
      'depositAmount': 0,
      'collectionMode': '直付',
      'procedures': [],
      'invoices': [],
      'canSend': canSend,
      'canCancel': true,
      'signed': false,
      'agreement': {'version': version, 'body': body, if (signed) 'lessorSigned': {'name': '李先生', 'at': '2026-11-22T01:00:00Z'}},
    };

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    sent.clear();
    routes = {};
    Api.client = MockClient(handle);
    debugResetApi();
  });

  group('帳單', () {
    setUp(() {
      routes = {
        '/api/my/fees': (200, {
          'outstanding': {'HKD': 150000},
          'items': [
            {'id': 'f1', 'description': '新辦粵港兩地牌：定金', 'kindLabel': '代辦費', 'currency': 'HKD', 'amount': 100000, 'dueOn': '2026-11-25', 'status': '未收', 'needsConfirm': true},
            {'id': 'f2', 'description': '代墊第三者保險', 'kindLabel': '代墊', 'currency': 'HKD', 'amount': 50000, 'paid': 20000, 'outstanding': 30000, 'dueOn': '2026-11-27', 'status': '部分收'},
          ],
        }),
      };
    });

    testPage('尚未付款合計和要確認的分期', (tester) async {
      await open(tester, '/billing');
      expect([find.text(r'HK$ 1,500').evaluate().length, find.text('請你確認的分期款項').evaluate().length, find.text('已付 HK\$ 200，尚欠 HK\$ 300').evaluate().length], [1, 1, 1]);
    });

    testPage('按「確認金額」送 POST /my/fees/<id>/confirm', (tester) async {
      await open(tester, '/billing');
      await tapText(tester, '確認金額');
      expect(writes().map((w) => '${w.$1} ${w.$2}'), ['POST /api/my/fees/f1/confirm']);
    });

    testPage('「全部」連要確認的也列出', (tester) async {
      await open(tester, '/billing');
      await tapText(tester, '全部');
      expect(find.text('新辦粵港兩地牌：定金'), findsNWidgets(2));
    });
  });

  group('聯絡我們', () {
    testPage('空白不送，顯示「請輸入訊息」', (tester) async {
      routes = {'/api/my/messages': (200, {'canSend': true, 'messages': []})};
      await open(tester, '/messages', mode: '自管');
      await tapText(tester, '發送');
      expect([writes().length, find.text('請輸入訊息').evaluate().length], [0, 1]);
    });

    testPage('發送：POST /my/messages，內容是輸入的原文', (tester) async {
      routes = {
        'GET /api/my/messages': (200, {'canSend': true, 'messages': []}),
        'POST /api/my/messages': (200, {'messages': [{'id': 'm1', 'fromStaff': false, 'body': '你好', 'createdAt': '2026-11-22T01:00:00Z'}]}),
      };
      await open(tester, '/messages', mode: '自管');
      await tester.enterText(find.byType(EditableText).first, '你好');
      await tapText(tester, '發送');
      expect(lines(), [line('POST', '/api/my/messages', {'body': '你好'})]);
    });

    testPage('托管客戶不能發：沒有輸入框', (tester) async {
      routes = {'/api/my/messages': (200, {'canSend': false, 'messages': []})};
      await open(tester, '/messages');
      expect([find.byType(EditableText).evaluate().length, find.text('這裏是我們發給你的訊息。有問題請直接聯絡你的顧問。').evaluate().length], [0, 1]);
    });
  });

  group('我的資料', () {
    setUp(() {
      routes = {
        '/api/my/profile': (200, {
          'me': {'name': '李先生', 'email': 'li@demo.local', 'phone': '+85291110000', 'wechatBound': false},
          'customer': {'name': '李先生（示範）', 'kind': '個人', 'phone': '+85291110000'},
          'otherLogins': [],
          'serviceMode': '托管',
        }),
        '/api/my/pending': (200, []),
        'PATCH /api/my/profile/name': (200, {'name': '李生'}),
        'PATCH /api/my/customer': (200, {'name': '李氏公司', 'kind': '公司', 'phone': '+85291110000'}),
      };
    });

    testPage('改顯示名稱：PATCH /my/profile/name，並更新登入資料的名字', (tester) async {
      await open(tester, '/profile');
      await tester.enterText(find.byType(EditableText).at(0), '李生');
      await tapText(tester, '儲存顯示名稱');
      expect([lines(), getUser()?['name']], [
        [line('PATCH', '/api/my/profile/name', {'name': '李生'})],
        '李生',
      ]);
    });

    testPage('改密碼：新密碼太短，不送', (tester) async {
      await open(tester, '/profile');
      await tester.enterText(find.byType(EditableText).at(1), 'old-pass');
      await tester.enterText(find.byType(EditableText).at(2), 'short');
      await tapText(tester, '更改密碼');
      expect([writes().length, find.text('新密碼至少 10 個字元').evaluate().length], [0, 1]);
    });

    testPage('改密碼：POST /me/password', (tester) async {
      await open(tester, '/profile');
      await tester.enterText(find.byType(EditableText).at(1), 'old-pass');
      await tester.enterText(find.byType(EditableText).at(2), 'new-password-1');
      await tester.enterText(find.byType(EditableText).at(3), 'new-password-1');
      await tapText(tester, '更改密碼');
      expect(lines(), [line('POST', '/api/me/password', {'currentPassword': 'old-pass', 'newPassword': 'new-password-1'})]);
    });

    testPage('委託人改成公司：只送改了的欄位', (tester) async {
      await open(tester, '/profile');
      await tapText(tester, '公司');
      await tester.enterText(find.byType(EditableText).at(4), '李氏公司');
      await tapText(tester, '儲存委託人資料');
      expect(lines(), [line('PATCH', '/api/my/customer', {'name': '李氏公司', 'kind': '公司'})]);
    });

    testPage('托管客戶：沒有「註銷帳號」按鈕', (tester) async {
      await open(tester, '/profile');
      expect(find.text('托管客戶要終止服務和註銷帳號，請聯絡你的顧問。'), findsOneWidget);
    });
  });

  group('新增公司', () {
    setUp(() {
      routes = {
        '/api/my/overview': (200, {
          'plates': [
            {'id': 'p1', 'route': '粵港', 'mainlandPlate': '粵ZA100港', 'localPlate': 'AB1000'},
          ],
        }),
      };
    });

    testPage('沒填名稱：提示，不送', (tester) async {
      await open(tester, '/company-new');
      await tapText(tester, '新增公司');
      expect([writes().length, find.text('請填寫公司名稱').evaluate().length], [0, 1]);
    });

    testPage('送出：POST /my/companies，帶選了的牌照', (tester) async {
      routes['POST /api/my/companies'] = (201, {'id': 'c1'});
      await open(tester, '/company-new');
      await tester.enterText(find.byType(EditableText).first, ' 李氏貿易（香港）有限公司 ');
      await tapText(tester, '粵ZA100港 · AB1000');
      await tapText(tester, '新增公司');
      expect(lines(), [line('POST', '/api/my/companies', {'jurisdiction': '香港', 'name': '李氏貿易（香港）有限公司', 'plateId': 'p1'})]);
    });

    testPage('內地公司名稱有繁體字：顯示簡體建議，按了填入', (tester) async {
      routes['POST /api/my/companies'] = (400, {'error': '內地公司名稱要用簡體字', 'suggestion': '李氏贸易有限公司'});
      await open(tester, '/company-new');
      await tapText(tester, '內地公司');
      await tester.enterText(find.byType(EditableText).first, '李氏貿易有限公司');
      await tapText(tester, '新增公司');
      await tapText(tester, '改用「李氏贸易有限公司」 ›');
      expect([find.text('李氏贸易有限公司').evaluate().length, find.text('內地公司名稱要用簡體字').evaluate().length], [1, 0]);
    });
  });

  group('新增出租', () {
    setUp(() {
      routes = {
        '/api/my/plates/p1/rental-options': (200, {
          'allowed': true,
          'plateLabel': '粵ZA100港 · AB1000',
          'currency': 'HKD',
          'lessors': [
            {'type': 'client', 'id': '', 'label': '李先生', 'hint': '以你本人名義'},
            {'type': 'company', 'id': 'c1', 'label': '李氏1貿易（香港）有限公司', 'hint': '香港公司'},
          ],
          'currentVehicle': 'AB1000',
          'drivers': [{'id': 'd1', 'name': '黃文軒'}],
          'prices': {'vehicle': '由顧問報價', 'driver': '由顧問報價'},
        }),
        'POST /api/my/plates/p1/rentals': (201, rentalDetail()),
        '/api/my/rentals/r1': (200, rentalDetail()),
      };
    });

    testPage('不能新增時顯示原因', (tester) async {
      routes['/api/my/plates/p1/rental-options'] = (200, {'allowed': false, 'reason': '這個牌照已有出租在處理中或出租中', 'plateLabel': 'X'});
      await open(tester, '/rental-new?plate=p1');
      expect([find.text('暫時不能新增出租').evaluate().length, find.text('這個牌照已有出租在處理中或出租中').evaluate().length], [1, 1]);
    });

    testPage('沒填租金：提示，不送', (tester) async {
      await open(tester, '/rental-new?plate=p1');
      await tester.enterText(find.byType(EditableText).at(0), '陳大文');
      await tapText(tester, '新增出租');
      expect(writes().length, 0);
    });

    testPage('自管客戶：沒有「交給我們代理」', (tester) async {
      await open(tester, '/rental-new?plate=p1', mode: '自管');
      expect([find.text('交給我們代理').evaluate().length, find.text('協議和收租').evaluate().length], [0, 1]);
    });

    testPage('新增後打開出租頁', (tester) async {
      await open(tester, '/rental-new?plate=p1');
      final state = tester.state(find.byWidgetPredicate((w) => w.runtimeType.toString() == 'RentalNewPage')) as dynamic;
      state.f
        ..renterName = '陳大文'
        ..startsOn = '2026-12-01'
        ..rent = '8000';
      await tapText(tester, '新增出租');
      await settle(tester);
      expect([writes().map((w) => w.$2).toList(), find.text('出租協議').evaluate().length], [
        ['/api/my/plates/p1/rentals'],
        1,
      ]);
    });
  });

  group('出租', () {
    testPage('第一次發：沒簽名提示，不送', (tester) async {
      routes = {'/api/my/rentals/r1': (200, rentalDetail())};
      await open(tester, '/rental?id=r1');
      await tapText(tester, '發給承租人');
      expect(writes().length, 0);
    });

    testPage('簽了名發出：POST send 帶 PNG 簽名，之後顯示連結', (tester) async {
      routes = {
        '/api/my/rentals/r1/signature-lessor': (404, {}),
        '/api/my/rentals/r1': (200, rentalDetail()),
        'POST /api/my/rentals/r1/send': (200, {...rentalDetail(version: 1, signed: true), 'link': {'url': 'https://x.test/r/abc'}}),
      };
      await open(tester, '/rental?id=r1');
      final pad = find.byKey(const ValueKey('signature-canvas'));
      await tester.ensureVisible(pad);
      await tester.pump();
      await tester.drag(pad, const Offset(120, 30));
      await tester.pump();
      await tester.runAsync(() async {
        await tester.tap(find.text('發給承租人').last, warnIfMissed: false);
        await Future<void>.delayed(const Duration(milliseconds: 500));
      });
      await settle(tester);
      final send = writes().singleWhere((w) => w.$2 == '/api/my/rentals/r1/send');
      expect([(send.$3 as Map)['signature'].toString().startsWith('data:image/png;base64,iVBORw0KGgo'), find.text('https://x.test/r/abc').evaluate().length], [true, 1]);
    });

    testPage('協議沒改、已簽：「重新發送連結」不帶簽名', (tester) async {
      routes = {
        '/api/my/rentals/r1/signature-lessor': (404, {}),
        '/api/my/rentals/r1': (200, rentalDetail(version: 1, signed: true)),
        'POST /api/my/rentals/r1/send': (200, {...rentalDetail(version: 1, signed: true), 'link': {'url': 'https://x.test/r/2'}}),
      };
      await open(tester, '/rental?id=r1');
      await tapText(tester, '重新發送連結');
      expect(lines(), [line('POST', '/api/my/rentals/r1/send', <String, Object>{})]);
    });

    testPage('改了協議再發：先 PUT 協議', (tester) async {
      routes = {
        '/api/my/rentals/r1/signature-lessor': (404, {}),
        '/api/my/rentals/r1': (200, rentalDetail(version: 1, signed: true)),
        'PUT /api/my/rentals/r1/agreement': (200, rentalDetail(version: 1, signed: true, body: '新協議')),
      };
      await open(tester, '/rental?id=r1');
      await tester.enterText(find.byType(EditableText).first, '新協議');
      await tapText(tester, '儲存修改');
      expect(lines(), [line('PUT', '/api/my/rentals/r1/agreement', {'body': '新協議'})]);
    });

    // 計劃第七節管理者決定（2026-11-22）：上傳 PDF、查看 PDF、用 WhatsApp 傳送都做成真的可用
    testPage('上傳 PDF：選了 PDF 後 POST signed 帶檔案內容', (tester) async {
      debugPickPdfs = () async => [(name: '協議.pdf', bytes: Uint8List.fromList([37, 80, 68, 70]), size: 4)];
      addTearDown(() => debugPickPdfs = null);
      routes = {'/api/my/rentals/r1': (200, rentalDetail()), 'POST /api/my/rentals/r1/signed': (200, {...rentalDetail(), 'signed': true})};
      await open(tester, '/rental?id=r1');
      await tapText(tester, '上傳 PDF');
      expect([lines(), find.text('已上傳').evaluate().length], [
        [line('POST', '/api/my/rentals/r1/signed', {'data': base64Encode([37, 80, 68, 70])})],
        1,
      ]);
    });

    testPage('上傳 PDF：沒有選就不送', (tester) async {
      debugPickPdfs = () async => [];
      addTearDown(() => debugPickPdfs = null);
      routes = {'/api/my/rentals/r1': (200, rentalDetail())};
      await open(tester, '/rental?id=r1');
      await tapText(tester, '上傳 PDF');
      expect(writes(), isEmpty);
    });

    testPage('查看 PDF 簽署本：用檢視器打開，不複製', (tester) async {
      final pdf = Uint8List.fromList([37, 80, 68, 70, 45]);
      Api.client = MockClient((r) async {
        sent.add((r.method, r.url.path, null));
        if (r.url.path == '/api/my/rentals/r1/signed') return http.Response.bytes(pdf, 200, headers: {'content-type': 'application/pdf'});
        return http.Response(jsonEncode({...rentalDetail(), 'signed': true}), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      });
      final opened = <(int, String)>[];
      debugOpenPdf = (bytes, name) async {
        opened.add((bytes.length, name));
        return true;
      };
      addTearDown(() => debugOpenPdf = null);
      await open(tester, '/rental?id=r1');
      await tapText(tester, '已上傳，查看 ›');
      expect(opened, [(5, '簽署本.pdf')]);
    });

    testPage('用 WhatsApp 傳送：直接打開 wa.me 連結', (tester) async {
      final opened = <String>[];
      debugLaunchUrl = (uri) async {
        opened.add('$uri');
        return true;
      };
      addTearDown(() => debugLaunchUrl = null);
      routes = {
        '/api/my/rentals/r1/signature-lessor': (404, {}),
        '/api/my/rentals/r1': (200, rentalDetail(version: 1, signed: true)),
        'POST /api/my/rentals/r1/send': (200, {...rentalDetail(version: 1, signed: true), 'link': {'url': 'https://x.test/r/2'}}),
      };
      await open(tester, '/rental?id=r1');
      await tapText(tester, '重新發送連結');
      await tapText(tester, '用 WhatsApp 傳送');
      expect([opened.length, opened.single.startsWith('https://wa.me/?text=')], [1, true]);
    });

    testPage('取消出租：確認後 POST cancel', (tester) async {
      routes = {
        '/api/my/rentals/r1': (200, rentalDetail()),
        'POST /api/my/rentals/r1/cancel': (200, {...rentalDetail(), 'status': '已終止', 'statusWord': '已取消', 'canCancel': false, 'canSend': false}),
      };
      await open(tester, '/rental?id=r1');
      await tapText(tester, '取消這次出租');
      await tapText(tester, '取消出租');
      expect([writes().map((w) => w.$2).toList(), find.text('這次出租已取消').evaluate().length], [
        ['/api/my/rentals/r1/cancel'],
        1,
      ]);
    });
  });

  group('簽名框', () {
    testPage('沒簽：isEmpty、提示「請在框內簽名」', (tester) async {
      final c = SignatureController();
      await tester.pumpWidget(Directionality(textDirection: TextDirection.ltr, child: Center(child: SizedBox(width: 300, child: SignaturePad(controller: c)))));
      expect([c.isEmpty, find.text('請在框內簽名').evaluate().length], [true, 1]);
    });

    testPage('畫了一筆：已簽名', (tester) async {
      final c = SignatureController();
      await tester.pumpWidget(Directionality(textDirection: TextDirection.ltr, child: Center(child: SizedBox(width: 300, child: SignaturePad(controller: c)))));
      await tester.drag(find.byKey(const ValueKey('signature-canvas')), const Offset(100, 20));
      await tester.pump();
      expect([c.isEmpty, find.text('已簽名').evaluate().length], [false, 1]);
    });

    testPage('按「重簽」清空', (tester) async {
      final c = SignatureController();
      await tester.pumpWidget(Directionality(textDirection: TextDirection.ltr, child: Center(child: SizedBox(width: 300, child: SignaturePad(controller: c)))));
      await tester.drag(find.byKey(const ValueKey('signature-canvas')), const Offset(100, 20));
      await tester.pump();
      await tester.tap(find.text('重簽'));
      await tester.pump();
      expect([c.isEmpty, c.strokes.length], [true, 0]);
    });

    test('輸出 PNG：像素大小是邏輯尺寸 × 像素比，白底、深色筆畫', () async {
      final png = await renderSignaturePng([
        [const Offset(10, 10), const Offset(90, 40)],
      ], const Size(100, 50), 3);
      final codec = await ui.instantiateImageCodec(Uint8List.fromList(png));
      final image = (await codec.getNextFrame()).image;
      final pixels = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
      int at(int x, int y) => pixels.getUint32((y * image.width + x) * 4);
      expect([image.width, image.height, png.sublist(0, 4), at(2, 140), at(150, 75) != 0xFFFFFFFF], [300, 150, [0x89, 0x50, 0x4E, 0x47], 0xFFFFFFFF, true]);
    });
  });

  group('修改公司資料', () {
    Future<void> openEditor(WidgetTester tester, Map company, {Future<void> Function()? onSaved}) async {
      tester.view.physicalSize = const Size(1320, 2868);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      SharedPreferences.setMockInitialValues({});
      await Session.load();
      Session.debugSet(token: 't', user: {'id': 'u1', 'serviceMode': '托管'}, mode: '托管');
      await tester.pumpWidget(DualplateApp(key: UniqueKey(), initialLocation: '/sample'));
      await settle(tester, 2);
      final ctx = tester.element(find.byType(Navigator).first);
      Navigator.of(ctx).push(PageRouteBuilder<void>(pageBuilder: (_, _, _) => Overlay(initialEntries: [
            OverlayEntry(builder: (_) => ColoredBox(color: const Color(0xFFFFFFFF), child: SingleChildScrollView(child: CompanyEditor(company: company, onClose: () {}, onSaved: onSaved ?? () async {})))),
          ])));
      await settle(tester, 3);
    }

    testPage('香港公司：有英文名稱和公司編號，沒有納稅人類型', (tester) async {
      await openEditor(tester, {'id': 'c1', 'jurisdiction': '香港', 'name': '李氏'});
      expect([find.text('英文名稱').evaluate().length, find.text('公司編號').evaluate().length, find.text('納稅人類型').evaluate().length], [1, 1, 0]);
    });

    testPage('內地公司：有納稅人類型，登記號碼叫統一社會信用代碼', (tester) async {
      await openEditor(tester, {'id': 'c2', 'jurisdiction': '內地', 'name': '李氏'});
      expect([find.text('納稅人類型').evaluate().length, find.text('統一社會信用代碼').evaluate().length, find.text('英文名稱').evaluate().length], [1, 1, 0]);
    });

    testPage('儲存：PATCH /my/companies/<id>，之後通知頁面', (tester) async {
      var saved = 0;
      await openEditor(tester, {'id': 'c3', 'jurisdiction': '澳門', 'name': '李氏', 'registrationNo': '123'}, onSaved: () async => saved++);
      await tester.tap(find.text('儲存公司資料'));
      await settle(tester);
      expect([lines(), saved], [
        [line('PATCH', '/api/my/companies/c3', {'name': '李氏', 'registrationNo': '123', 'incorporatedOn': ''})],
        1,
      ]);
    });

    testPage('名稱要用簡體字：確認框「套用」把建議填入', (tester) async {
      routes = {'PATCH /api/my/companies/c4': (400, {'error': '要用簡體字', 'suggestion': '李氏贸易'})};
      await openEditor(tester, {'id': 'c4', 'jurisdiction': '內地', 'name': '李氏貿易'});
      await tester.tap(find.text('儲存公司資料'));
      await settle(tester);
      await tester.tap(find.text('套用'));
      await settle(tester);
      expect(find.text('李氏贸易'), findsOneWidget);
    });
  });
}
