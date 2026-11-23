// 階段 3a 六頁（首頁、我的牌照、我的公司、到期提醒、我的、通知）和使用導覽、顧問卡、聯絡我們卡：一個情況一個測試。
// 伺服器用 MockClient 代替（不連正式網站）。畫面按 iPhone 17 Pro Max：440×956。
import 'dart:convert';
import 'package:dualplate/business/approval_card.dart';
import 'package:dualplate/business/card_capture.dart';
import 'package:dualplate/business/page_show.dart';
import 'package:dualplate/business/welcome_guide.dart';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/login/login_page.dart';
import 'package:dualplate/pages/notifications/notifications_page.dart';
import 'package:dualplate/pages/plate_create/plate_create_page.dart';
import 'package:dualplate/pages/plate_detail/plate_detail_page.dart';
import 'package:dualplate/pages/request_detail/request_detail_page.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

late List<http.Request> sent;
late Map<String, dynamic> overview, companies;
late List<dynamic> notices, plates, requests, fees;
late Map<String, dynamic> contact;
bool fail = false;

Map<String, dynamic> plateSummary(String id, String mainland, String local, String health, {Map? next}) => {
      'id': id,
      'route': '粵港',
      'mainlandPlate': mainland,
      'localPlate': local,
      'cardNumber': 'GD$id',
      'usageStatus': '自用',
      'installationStatus': '已上牌',
      'holder': '$id 貿易',
      'health': health,
      'next': next,
      'warnings': [],
      'rental': null,
    };

Map<String, dynamic> custodyOverview() => {
      'unreadNotifications': 3,
      'advisor': {'name': '陳嘉欣', 'phone': '+852 9123 4567', 'wechat': 'chen_plate'},
      'customerName': '李先生（示範）',
      'serviceMode': '托管',
      'counts': {'pending': 1, 'ok': 0, 'due': 1, 'overdue': 1},
      'plates': [
        plateSummary('p1', '粵ZA100港', 'AB1000', 'overdue', next: {'name': '批文／指標有效期', 'level': 'overdue', 'daysLeft': -12}),
        plateSummary('p2', '粵ZB107港', 'CD1037', 'due'),
      ],
      'deadlines': [
        {'code': 'hk_br', 'name': '香港商業登記證', 'level': 'overdue', 'handledBy': 'you', 'ownerType': 'company', 'ownerId': 'c1', 'ownerLabel': '李氏3貿易', 'dueOn': '2026-11-16', 'daysLeft': -5, 'plateId': 'p1'},
        {'code': 'approval', 'name': '批文／指標有效期', 'level': 'due', 'handledBy': 'us', 'ownerType': 'plate', 'ownerId': 'p2', 'ownerLabel': '粵ZB107港 · CD1037', 'dueOn': '2026-11-30', 'daysLeft': 9, 'plateId': 'p2'},
      ],
      'todos': [{'title': '提供身份證及車輛登記文件', 'subtitle': '粵ZA100港 · 批文及 CRP 續期', 'requestId': 'r1'}],
      'activeRequests': [
        {'id': 'r1', 'title': '批文及 CRP 續期', 'status': '需要你提供資料', 'stage': '客戶提供身份證及車輛登記文件', 'plate': '粵ZA100港'},
        {'id': 'r2', 'title': '更換司機', 'status': '辦理中', 'stage': '內地批文變更', 'plate': '粵ZB107港'},
        {'id': 'r3', 'title': '香港車輛牌照續期', 'status': '辦理中', 'stage': '', 'plate': ''},
        {'id': 'r4', 'title': '第四項', 'status': '辦理中', 'stage': '', 'plate': ''},
      ],
    };

Map<String, dynamic> emptySelfOverview() => {
      'unreadNotifications': 0,
      'advisor': {'name': '', 'phone': '', 'wechat': ''},
      'customerName': '空白自管（測試）',
      'serviceMode': '自管',
      'counts': {'pending': 0, 'ok': 0, 'due': 0, 'overdue': 0},
      'plates': [],
      'deadlines': [],
      'todos': [],
      'activeRequests': [],
    };

Map<String, dynamic> custodyCompanies() => {
      'groups': [
        {
          'id': 'g1',
          'name': '李氏1組',
          'offshore': [
            {'id': 'c1', 'name': '李氏1貿易（香港）有限公司', 'nameEn': '', 'jurisdiction': '香港', 'registrationNo': '7112345', 'incorporatedOn': '2019-03-11', 'status': '存續'},
          ],
          'mainland': [],
          'plates': [{'id': 'p1', 'label': '粵ZA100港 · AB1000'}],
          'deadlines': [
            {'code': 'hk_br', 'editable': true, 'handledBy': 'you', 'name': '香港商業登記證', 'ownerType': 'company', 'ownerId': 'c1', 'ownerLabel': '李氏1貿易（香港）有限公司', 'dueOn': '2026-12-16', 'daysLeft': 25, 'level': 'due'},
          ],
          'undated': [
            {'code': 'hk_registered_office', 'name': '香港公司註冊地址／秘書服務合約', 'ownerType': 'company', 'ownerId': 'c1', 'ownerLabel': '李氏1貿易（香港）有限公司', 'fill': 'date', 'hint': '在「我的公司」補上地址'},
          ],
        },
      ],
      'ungrouped': [
        {'id': 'c9', 'name': '舊公司有限公司', 'nameEn': 'Old Co', 'jurisdiction': '香港', 'registrationNo': '', 'status': '已註銷', 'deadlines': [], 'undated': []},
      ],
    };

List<dynamic> baseNotices() => [
      {'id': 'n1', 'kind': 'attachment', 'title': '文件需要重交', 'body': '身份證影印本不清楚', 'link': '/pages/request-detail/request-detail?id=r1', 'read': false, 'createdAt': DateTime.now().toUtc().toIso8601String()},
      {'id': 'n2', 'kind': 'deadline', 'title': '批文快到期', 'body': '粵ZB107港', 'link': '', 'read': false, 'createdAt': DateTime.now().toUtc().toIso8601String()},
      {'id': 'n3', 'kind': 'request', 'title': '辦理進度更新', 'body': '', 'link': '', 'read': true, 'createdAt': '2026-01-02T03:00:00.000Z'},
    ];

http.Response reply(Object? body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

Future<http.Response> handle(http.Request r) async {
  sent.add(r);
  final path = r.url.path.replaceFirst('/api', ''), m = r.method;
  if (path == '/my/terms') return reply({'mode': 'prompt', 'published': false});
  if (fail) return reply({'error': '伺服器暫時出錯'}, 500);
  if (path == '/my/overview') return reply(overview);
  if (path == '/my/notifications' && m == 'GET') return reply({'unread': notices.where((n) => n['read'] != true).length, 'items': notices});
  if (path == '/my/notifications/read') {
    final body = jsonDecode(r.body) as Map;
    for (final n in notices) {
      if (body['all'] == true || n['id'] == body['id']) n['read'] = true;
    }
    overview['unreadNotifications'] = notices.where((n) => n['read'] != true).length;
    return reply({'ok': true});
  }
  if (path == '/plate-assets') return reply(plates);
  if (path.startsWith('/plate-assets/')) {
    final id = path.split('/').last;
    return reply({'id': id, 'cardData': {'cardNumber': 'GD$id'}});
  }
  if (path == '/my/companies') return reply(companies);
  if (path == '/my/pending') return reply([{'entityType': 'company', 'entityId': 'c1', 'field': 'name'}]);
  if (path == '/my/filings') return reply([{'companyId': 'c1', 'periods': [{'period': '2026-11', 'status': '未開始'}, {'period': '2026-10', 'status': '已申報'}]}]);
  if (path == '/requests') return reply(requests);
  if (path == '/my/fees') return reply({'outstanding': fees.isEmpty ? {} : {'HKD': 100}, 'items': fees});
  if (path == '/my/contact') return reply(contact);
  if (path == '/my/dates') return reply({'ok': true});
  if (path == '/card-recognize') return reply({'cardData': {'cardNumber': '1088123'}, 'fieldStatus': {}});
  return reply({'error': '沒有這個接口'}, 404);
}

List<String> calls(String method, String path) => sent.where((r) => r.method == method && r.url.path == '/api$path').map((r) => r.body).toList();

Future<void> open(WidgetTester tester, String location, {String mode = '托管', Map<String, Object> prefs = const {}, bool user = true}) async {
  tester.view.physicalSize = const Size(1320, 2868);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  // 使用導覽預設已看過，要看導覽的測試另外清掉
  SharedPreferences.setMockInitialValues({'flutter.welcomeGuide:u1': 1, ...prefs});
  await Session.load();
  Session.debugSet(token: user ? 't' : null, user: user ? {'id': 'u1', 'name': '李先生', 'email': 'li@demo.local', 'serviceMode': mode} : null, mode: mode);
  await tester.pumpWidget(DualplateApp(initialLocation: location));
  await settle(tester);
}

Future<void> settle(WidgetTester tester, [int times = 8]) async {
  for (var i = 0; i < times; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

// 等提示消失
Future<void> finish(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 3));
  await tester.pump(const Duration(seconds: 1));
}

Future<void> tapText(WidgetTester tester, String text, {bool last = false}) async {
  final f = last ? find.text(text).last : find.text(text).first;
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f);
  await settle(tester);
}

Finder textContaining(String part) => find.byWidgetPredicate((w) => w is RichText && w.text.toPlainText().contains(part));

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    sent = [];
    fail = false;
    overview = custodyOverview();
    companies = custodyCompanies();
    notices = baseNotices();
    plates = [
      {'id': 'p1', 'mainland_plate': '粵ZA100港', 'local_plate': 'AB1000', 'route': '粵港', 'installation_status': '已上牌', 'usage_status': '出租中', 'card_number': 'GDp1'},
      {'id': 'p2', 'mainland_plate': '粵ZB107港', 'local_plate': 'CD1037', 'route': '粵港', 'installation_status': '待核對', 'usage_status': '自用', 'card_number': ''},
    ];
    requests = [
      {'id': 'r1', 'title': '批文及 CRP 續期', 'status': '需要你提供資料', 'stage': '客戶提供文件', 'plate_asset_id': 'p1'},
    ];
    fees = [{'id': 'f1'}];
    contact = {'whatsapp': '', 'whatsappLink': '', 'wechatId': '', 'wechatQr': '', 'wecomLink': ''};
    VehiclesFilter.preset = null;
    Api.client = MockClient(handle);
    debugResetApi();
  });

  group('首頁', () {
    testWidgets('深綠主卡：委託人、客戶名、名下牌照數和三個數字', (tester) async {
      await open(tester, '/index');
      expect([find.text('委託人').evaluate().length, find.text('李先生（示範）').evaluate().length, textContaining('名下 2 個兩地牌').evaluate().length], [1, 1, 1]);
    });

    testWidgets('自管客戶的眉標是「自己管理」', (tester) async {
      overview = emptySelfOverview();
      await open(tester, '/index', mode: '自管');
      expect(find.text('自己管理'), findsOneWidget);
    });

    testWidgets('鈴鐺顯示未讀數', (tester) async {
      await open(tester, '/index');
      expect(find.descendant(of: find.byKey(const ValueKey('index-bell')), matching: find.text('3')), findsOneWidget);
    });

    testWidgets('沒有未讀時鈴鐺沒有數字', (tester) async {
      overview['unreadNotifications'] = 0;
      await open(tester, '/index');
      expect(find.descendant(of: find.byKey(const ValueKey('index-bell')), matching: find.byType(Text)), findsNothing);
    });

    testWidgets('另有未填到期日的牌照：托管寫「資料整理中」', (tester) async {
      await open(tester, '/index');
      expect(find.text('另有 1 個牌照資料整理中'), findsOneWidget);
    });

    testWidgets('待辦標題帶數目', (tester) async {
      await open(tester, '/index');
      expect(textContaining('待辦 · 3'), findsOneWidget);
    });

    testWidgets('待辦：要你提供的、你自理的到期事項、要你處理的通知', (tester) async {
      await open(tester, '/index');
      expect([find.text('提供身份證及車輛登記文件').evaluate().length, find.text('香港商業登記證').evaluate().length, find.text('文件需要重交').evaluate().length], [1, 1, 1]);
    });

    testWidgets('我們負責的到期事項不在待辦', (tester) async {
      await open(tester, '/index');
      expect(find.text('批文／指標有效期'), findsNothing);
    });

    testWidgets('辦理中最多列三項', (tester) async {
      await open(tester, '/index');
      expect([find.text('香港車輛牌照續期').evaluate().length, find.text('第四項').evaluate().length], [1, 0]);
    });

    testWidgets('辦理中的步驟改成對客戶說話', (tester) async {
      await open(tester, '/index');
      expect(find.text('等你提供身份證及車輛登記文件'), findsOneWidget);
    });

    testWidgets('托管客戶有「請顧問幫我辦」', (tester) async {
      await open(tester, '/index');
      expect(find.text('請顧問幫我辦'), findsOneWidget);
    });

    testWidgets('托管客戶沒有待辦：「目前不用你做甚麼」', (tester) async {
      overview['todos'] = [];
      overview['deadlines'] = [];
      notices = [];
      await open(tester, '/index');
      expect(find.text('目前不用你做甚麼'), findsOneWidget);
    });

    testWidgets('自管客戶沒有牌照：建立第一個牌照卡和「目前沒有快到期的事項」', (tester) async {
      overview = emptySelfOverview();
      notices = [];
      await open(tester, '/index', mode: '自管');
      expect([find.text('建立你的第一個牌照').evaluate().length, find.text('目前沒有快到期的事項').evaluate().length, find.text('請顧問幫我辦').evaluate().length], [1, 1, 0]);
    });

    testWidgets('按「拍批文卡」打開新增牌照', (tester) async {
      overview = emptySelfOverview();
      notices = [];
      await open(tester, '/index', mode: '自管');
      await tapText(tester, '拍批文卡');
      await settle(tester);
      expect(find.byType(PlateCreatePage), findsOneWidget);
    });

    testWidgets('載入失敗：提示伺服器的錯誤，畫面是初始內容', (tester) async {
      fail = true;
      await open(tester, '/index');
      expect([find.text('伺服器暫時出錯').evaluate().length, find.text('目前不用你做甚麼').evaluate().length, find.text('李先生').evaluate().length], [1, 1, 1]);
      await finish(tester);
    });

    testWidgets('點要你提供資料的待辦：打開辦理詳情', (tester) async {
      await open(tester, '/index');
      await tapText(tester, '提供身份證及車輛登記文件');
      await settle(tester);
      expect(find.byType(RequestDetailPage), findsOneWidget);
    });

    testWidgets('點待辦的通知：標為已讀並從待辦消失', (tester) async {
      await open(tester, '/index');
      await tapText(tester, '文件需要重交');
      await settle(tester);
      expect(calls('POST', '/my/notifications/read'), ['{"id":"n1"}']);
    });

    testWidgets('點公司的到期事項：轉到「我的公司」分頁', (tester) async {
      await open(tester, '/index');
      await tapText(tester, '香港商業登記證');
      await settle(tester);
      expect(find.text('每組公司持有的牌照，以及公司每年要辦的事。'), findsOneWidget);
    });

    testWidgets('按鈴鐺打開通知', (tester) async {
      await open(tester, '/index');
      await tester.tap(find.byKey(const ValueKey('index-bell')));
      await settle(tester);
      expect(find.byType(NotificationsPage), findsOneWidget);
    });

    testWidgets('從通知返回首頁時重新載入（onShow）', (tester) async {
      await open(tester, '/index');
      final before = calls('GET', '/my/overview').length;
      await tester.tap(find.byKey(const ValueKey('index-bell')));
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('nav-back')));
      await settle(tester, 12);
      expect(calls('GET', '/my/overview').length, before + 1);
    });

    testWidgets('按「已逾期」：轉到牌照列表，篩選「需注意」', (tester) async {
      await open(tester, '/index');
      await tapText(tester, '已逾期');
      await settle(tester);
      expect(find.text('搜尋車牌、公司'), findsOneWidget);
    });
  });

  group('使用導覽', () {
    Future<void> openFresh(WidgetTester tester, String mode) async {
      tester.view.physicalSize = const Size(1320, 2868);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      SharedPreferences.setMockInitialValues({});
      await Session.load();
      Session.debugSet(token: 't', user: {'id': 'u1', 'name': '李先生'}, mode: mode);
      await tester.pumpWidget(const DualplateApp(initialLocation: '/index'));
      await settle(tester, 12);
    }

    testWidgets('第一次登入自動出現，托管版第 1 步', (tester) async {
      await openFresh(tester, '托管');
      expect([find.text('第 1 / 3 步').evaluate().length, find.text(custodyGuideSteps[0].$2).evaluate().length], [1, 1]);
    });

    testWidgets('自管客戶看自管版', (tester) async {
      overview = emptySelfOverview();
      await openFresh(tester, '自管');
      expect(find.text(selfGuideSteps[0].$2), findsOneWidget);
    });

    testWidgets('出現後記在本機，下次不再自動出現', (tester) async {
      await openFresh(tester, '托管');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.get('welcomeGuide:u1'), isNotNull);
    });

    testWidgets('「下一步」到第 2 步，最後一步按鈕是「開始使用」', (tester) async {
      await openFresh(tester, '托管');
      await tapText(tester, '下一步');
      await tapText(tester, '下一步');
      expect([find.text('第 3 / 3 步').evaluate().length, find.text('開始使用').evaluate().length], [1, 1]);
    });

    testWidgets('「略過」關閉', (tester) async {
      await openFresh(tester, '托管');
      await tapText(tester, '略過');
      expect(find.byKey(const ValueKey('welcome-guide')), findsNothing);
    });

    testWidgets('點遮罩空白處關閉', (tester) async {
      await openFresh(tester, '托管');
      await tester.tapAt(const Offset(220, 300));
      await settle(tester);
      expect(find.byKey(const ValueKey('welcome-guide')), findsNothing);
    });

    testWidgets('點導覽卡本身不關閉', (tester) async {
      await openFresh(tester, '托管');
      await tester.tap(find.text('第 1 / 3 步'));
      await settle(tester);
      expect(find.byKey(const ValueKey('welcome-guide')), findsOneWidget);
    });
  });

  group('我的牌照', () {
    testWidgets('預設是批文卡疊，每個牌照一張卡', (tester) async {
      await open(tester, '/vehicles');
      expect(find.byType(ApprovalCard), findsNWidgets(2));
    });

    testWidgets('記住上次的看法（列表）', (tester) async {
      await open(tester, '/vehicles', prefs: {'flutter.plateView': 'list'});
      expect(find.text('搜尋車牌、公司'), findsOneWidget);
    });

    testWidgets('切到列表並記在本機', (tester) async {
      await open(tester, '/vehicles');
      await tapText(tester, '列表');
      final prefs = await SharedPreferences.getInstance();
      expect([find.text('搜尋車牌、公司').evaluate().length, prefs.getString('plateView')], [1, 'list']);
    });

    testWidgets('列表卡：持牌公司和用途、下一件事', (tester) async {
      await open(tester, '/vehicles', prefs: {'flutter.plateView': 'list'});
      expect([find.text('p1 貿易 · 自用').evaluate().length, find.text('批文／指標有效期 · 逾期 12 天').evaluate().length], [1, 1]);
    });

    testWidgets('篩選籤寫「名稱數目」，中間沒有空格', (tester) async {
      await open(tester, '/vehicles', prefs: {'flutter.plateView': 'list'});
      expect([textContaining('全部2').evaluate().length, textContaining('需注意2').evaluate().length], [1, 1]);
    });

    testWidgets('搜尋車牌', (tester) async {
      await open(tester, '/vehicles', prefs: {'flutter.plateView': 'list'});
      await tester.enterText(find.byType(EditableText), 'cd10');
      await settle(tester);
      expect([find.text('p2 貿易 · 自用').evaluate().length, find.text('p1 貿易 · 自用').evaluate().length], [1, 0]);
    });

    testWidgets('搜尋沒有結果：「沒有符合條件的牌照」', (tester) async {
      await open(tester, '/vehicles', prefs: {'flutter.plateView': 'list'});
      await tester.enterText(find.byType(EditableText), 'zzz');
      await settle(tester);
      expect(find.text('沒有符合條件的牌照'), findsOneWidget);
    });

    testWidgets('首頁帶來的篩選：改用列表，用完就清掉', (tester) async {
      VehiclesFilter.preset = 'overdue';
      await open(tester, '/vehicles');
      expect([find.text('搜尋車牌、公司').evaluate().length, VehiclesFilter.preset], [1, null]);
    });

    testWidgets('沒有牌照：托管的空白說明', (tester) async {
      plates = [];
      overview['plates'] = [];
      await open(tester, '/vehicles');
      expect(find.text('拍下批文卡正反面交給我們，我們會替你建立檔案。'), findsOneWidget);
    });

    testWidgets('沒有牌照：自管的空白說明，沒有批文卡／列表切換', (tester) async {
      plates = [];
      overview = emptySelfOverview();
      await open(tester, '/vehicles', mode: '自管');
      expect([find.text('按上面的「新增牌照」拍下批文卡，就能建立牌照。').evaluate().length, find.text('列表').evaluate().length], [1, 0]);
    });

    testWidgets('點批文卡打開單張預覽：上牌、使用狀態和編號', (tester) async {
      await open(tester, '/vehicles');
      await tester.tap(find.byType(ApprovalCard).first);
      await settle(tester);
      final focus = find.byKey(const ValueKey('wallet-focus'));
      // 編號在卡面和下面的資料各一次
      expect([focus.evaluate().length, find.text('使用安排中').evaluate().length, find.descendant(of: focus, matching: find.text('GDp1')).evaluate().length], [1, 1, 2]);
    });

    testWidgets('預覽：托管牌照上牌狀態待核對寫「確認中」，沒有編號寫「待核對」', (tester) async {
      await open(tester, '/vehicles');
      await tester.tap(find.byType(ApprovalCard).last, warnIfMissed: false);
      await settle(tester);
      expect([find.text('確認中').evaluate().length, find.text('待核對').evaluate().length], [1, 1]);
    });

    testWidgets('預覽：按「背面」翻到背面', (tester) async {
      await open(tester, '/vehicles');
      await tester.tap(find.byType(ApprovalCard).first);
      await settle(tester);
      await tapText(tester, '背面');
      final card = tester.widget<ApprovalCard>(find.descendant(of: find.byKey(const ValueKey('wallet-focus')), matching: find.byType(ApprovalCard)));
      expect(card.back, true);
    });

    testWidgets('預覽：按 × 關閉', (tester) async {
      await open(tester, '/vehicles');
      await tester.tap(find.byType(ApprovalCard).first);
      await settle(tester);
      await tester.tap(find.byKey(const ValueKey('close-focus')));
      await settle(tester);
      expect(find.byKey(const ValueKey('wallet-focus')), findsNothing);
    });

    testWidgets('預覽：返回鍵先關預覽，不離開分頁', (tester) async {
      await open(tester, '/vehicles');
      await tester.tap(find.byType(ApprovalCard).first);
      await settle(tester);
      await tester.binding.handlePopRoute();
      await settle(tester);
      expect([find.byKey(const ValueKey('wallet-focus')).evaluate().length, find.text('＋ 新增牌照').evaluate().length], [0, 1]);
    });

    testWidgets('預覽：「查看牌照詳情」打開牌照詳情', (tester) async {
      await open(tester, '/vehicles');
      await tester.tap(find.byType(ApprovalCard).first);
      await settle(tester);
      await tapText(tester, '查看牌照詳情');
      await settle(tester);
      expect(find.byType(PlateDetailPage), findsOneWidget);
    });
  });

  group('我的公司', () {
    testWidgets('每組公司：公司名、未填英文名稱（橙）、登記號碼、成立日期', (tester) async {
      await open(tester, '/companies');
      expect([find.text('李氏1貿易（香港）有限公司').evaluate().isNotEmpty, find.text('未填英文名稱').evaluate().length, textContaining('商業登記號碼 7112345').evaluate().length, textContaining('成立日期 2019-03-11').evaluate().length], [true, 1, 1, 1]);
    });

    testWidgets('沒有內地公司：「內地公司資料待補充」', (tester) async {
      await open(tester, '/companies');
      expect(find.text('內地公司資料待補充'), findsOneWidget);
    });

    testWidgets('客戶改過的公司顯示「已修改，待核對」', (tester) async {
      await open(tester, '/companies');
      expect(find.text('已修改，待核對'), findsOneWidget);
    });

    testWidgets('每月報帳最近的月份和狀態', (tester) async {
      await open(tester, '/companies');
      expect([find.text('11月').evaluate().length, find.text('待交資料').evaluate().length, find.text('已申報').evaluate().length], [1, 1, 1]);
    });

    testWidgets('托管客戶有「委託內容 ›」', (tester) async {
      await open(tester, '/companies');
      expect(find.text('委託內容 ›'), findsNWidgets(2));
    });

    testWidgets('自管客戶沒有「委託內容 ›」', (tester) async {
      await open(tester, '/companies', mode: '自管');
      expect(find.text('委託內容 ›'), findsNothing);
    });

    testWidgets('自行辦理的事項：托管客戶標「自行辦理」', (tester) async {
      await open(tester, '/companies');
      expect(find.text('自行辦理'), findsOneWidget);
    });

    testWidgets('還沒有填日期：提示改寫成按「修改公司資料」', (tester) async {
      await open(tester, '/companies');
      expect(find.text('按「修改公司資料」補上地址'), findsOneWidget);
    });

    testWidgets('沒有分組的已註銷公司顯示灰色「已註銷」', (tester) async {
      await open(tester, '/companies');
      expect(find.text('已註銷'), findsOneWidget);
    });

    testWidgets('「修改公司資料 ›」打開表單（3c 前是佔位），文字變「收起」', (tester) async {
      await open(tester, '/companies');
      await tapText(tester, '修改公司資料 ›');
      expect([find.byKey(const ValueKey('company-editor-placeholder')).evaluate().length, find.text('收起').evaluate().length], [1, 1]);
    });

    testWidgets('「收起」關閉表單', (tester) async {
      await open(tester, '/companies');
      await tapText(tester, '修改公司資料 ›');
      await tapText(tester, '收起');
      expect(find.byKey(const ValueKey('company-editor-placeholder')), findsNothing);
    });

    testWidgets('從牌照頁「請補上公司資料」過來：直接打開那間公司的表單，記錄用完就刪', (tester) async {
      await open(tester, '/companies', prefs: {'flutter.editCompany': 'c1'});
      await settle(tester, 6);
      final prefs = await SharedPreferences.getInstance();
      expect([find.byKey(const ValueKey('company-editor-placeholder')).evaluate().length, prefs.getString('editCompany')], [1, null]);
    });

    testWidgets('沒有公司：自管客戶「還沒有公司」和「拍批文卡」', (tester) async {
      companies = {'groups': [], 'ungrouped': []};
      await open(tester, '/companies', mode: '自管');
      expect([find.text('還沒有公司').evaluate().length, find.text('拍批文卡').evaluate().length], [1, 1]);
    });

    testWidgets('沒有公司：托管客戶「由你的顧問整理」', (tester) async {
      companies = {'groups': [], 'ungrouped': []};
      await open(tester, '/companies');
      expect(find.text('公司資料由你的顧問整理後會顯示在這裏。'), findsOneWidget);
    });

    testWidgets('載入失敗：提示錯誤，顯示托管的空白說明', (tester) async {
      fail = true;
      await open(tester, '/companies');
      expect([find.text('伺服器暫時出錯').evaluate().length, find.text('公司資料由你的顧問整理後會顯示在這裏。').evaluate().length], [1, 1]);
      await finish(tester);
    });
  });

  group('到期提醒', () {
    testWidgets('托管客戶的說明', (tester) async {
      await open(tester, '/deadlines');
      expect(find.text('未來半年要辦的事。標了「自行辦理」的由你自己辦，其他由我們在到期前安排。'), findsOneWidget);
    });

    testWidgets('自管客戶的說明', (tester) async {
      await open(tester, '/deadlines', mode: '自管');
      expect(find.text('未來半年要辦的事，都由你自己辦；想交給我們，按「委託我們辦」。'), findsOneWidget);
    });

    testWidgets('按「公司」只列公司事項', (tester) async {
      await open(tester, '/deadlines');
      await tapText(tester, '公司');
      expect([find.text('香港商業登記證').evaluate().length, find.text('批文／指標有效期').evaluate().length], [1, 0]);
    });

    testWidgets('自管客戶自己辦的事項有「委託我們辦 ›」', (tester) async {
      await open(tester, '/deadlines', mode: '自管');
      expect(find.text('委託我們辦 ›'), findsOneWidget);
    });

    testWidgets('托管客戶沒有「委託我們辦 ›」', (tester) async {
      await open(tester, '/deadlines');
      expect(find.text('委託我們辦 ›'), findsNothing);
    });

    testWidgets('沒有事項：「沒有需要留意的到期項目」', (tester) async {
      overview['deadlines'] = [];
      await open(tester, '/deadlines');
      expect(find.text('沒有需要留意的到期項目'), findsOneWidget);
    });

    testWidgets('點牌照事項打開牌照詳情', (tester) async {
      await open(tester, '/deadlines');
      await tapText(tester, '批文／指標有效期');
      await settle(tester);
      expect(find.byType(PlateDetailPage), findsOneWidget);
    });
  });

  group('我的', () {
    testWidgets('名字、電郵和托管客戶的選單', (tester) async {
      await open(tester, '/me');
      expect(['李先生', 'li@demo.local', '委託內容', '帳單', '月報'].map((t) => find.text(t).evaluate().length).toList(), [1, 1, 1, 1, 1]);
    });

    testWidgets('通知未讀數和「有未付款項」', (tester) async {
      await open(tester, '/me');
      expect([find.text('3 則未讀').evaluate().length, find.text('有未付款項').evaluate().length], [1, 1]);
    });

    testWidgets('自管客戶：沒有委託內容和月報；有帳目才顯示帳單', (tester) async {
      overview = emptySelfOverview();
      await open(tester, '/me', mode: '自管');
      expect(['委託內容', '月報', '帳單'].map((t) => find.text(t).evaluate().length).toList(), [0, 0, 1]);
    });

    testWidgets('自管客戶沒有帳目：不顯示帳單', (tester) async {
      overview = emptySelfOverview();
      fees = [];
      await open(tester, '/me', mode: '自管');
      expect(find.text('帳單'), findsNothing);
    });

    testWidgets('辦理記錄用內地車牌標識', (tester) async {
      await open(tester, '/me');
      expect([find.text('批文及 CRP 續期').evaluate().length, find.text('粵ZA100港').evaluate().length], [1, 1]);
    });

    testWidgets('托管客戶沒有辦理記錄：「還沒有辦理記錄」', (tester) async {
      requests = [];
      await open(tester, '/me');
      expect(find.text('還沒有辦理記錄'), findsOneWidget);
    });

    testWidgets('自管客戶沒有辦理記錄：整塊不顯示', (tester) async {
      requests = [];
      overview = emptySelfOverview();
      await open(tester, '/me', mode: '自管');
      expect([find.text('辦理記錄').evaluate().length, find.text('還沒有辦理記錄').evaluate().length], [0, 0]);
    });

    testWidgets('托管客戶：你的顧問（名字、電話、微信、兩個按鈕）', (tester) async {
      await open(tester, '/me');
      expect(['你的顧問', '陳嘉欣', '+852 9123 4567', '微信 chen_plate', '致電', '複製微信號'].map((t) => find.text(t).evaluate().length).toList(), [1, 1, 1, 1, 1, 1]);
    });

    testWidgets('托管客戶沒有顧問資料：「顧問資料整理中」', (tester) async {
      overview['advisor'] = {'name': '', 'phone': '', 'wechat': ''};
      await open(tester, '/me');
      expect(find.text('顧問資料整理中，稍後會在這裏顯示聯絡方式。'), findsOneWidget);
    });

    testWidgets('顧問只有微信：沒有「致電」', (tester) async {
      overview['advisor'] = {'name': '陳嘉欣', 'phone': '', 'wechat': 'chen_plate'};
      await open(tester, '/me');
      expect([find.text('致電').evaluate().length, find.text('複製微信號').evaluate().length], [0, 1]);
    });

    testWidgets('「複製微信號」複製並提示', (tester) async {
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') copied = (call.arguments as Map)['text'] as String;
        return null;
      });
      await open(tester, '/me');
      await tapText(tester, '複製微信號');
      expect([copied, find.text('微信號已複製').evaluate().length], ['chen_plate', 1]);
      await finish(tester);
    });

    testWidgets('「致電」經原生通道撥號，去掉空格', (tester) async {
      Object? dialed;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('dualplate/system'), (call) async {
        if (call.method == 'dial') dialed = call.arguments;
        return null;
      });
      await open(tester, '/me');
      await tapText(tester, '致電');
      expect(dialed, '+85291234567');
    });

    // 客服改用 MasterBox（docs/tasks/support-masterbox-plan.md，管理者 2026-11-23）：「聯絡我們」卡換成線上客服卡；更多情況見 support_test.dart
    testWidgets('自管客戶：委託我們辦理卡和線上客服卡（取代聯絡我們、App 內訊息）', (tester) async {
      overview = emptySelfOverview();
      await open(tester, '/me', mode: '自管');
      expect(['委託我們辦理', '委託我們辦一項', '長期委託（談代理方案）', '線上客服', '聯絡客服', '聯絡我們', '在 app 內發訊息'].map((t) => find.text(t).evaluate().length).toList(), [1, 1, 1, 1, 1, 0, 0]);
    });

    testWidgets('線上客服卡：後台設定了 WhatsApp 也不再顯示', (tester) async {
      overview = emptySelfOverview();
      contact = {'whatsapp': '+85366714829', 'whatsappLink': 'https://wa.me/85366714829', 'wechatId': '', 'wechatQr': '', 'wecomLink': ''};
      await open(tester, '/me', mode: '自管');
      expect([find.text('有問題直接發訊息，可以傳相片和文件。下班後也可以留言，我們上班後回覆。').evaluate().length, find.text('WhatsApp +853 6671 4829').evaluate().length], [1, 0]);
    });

    testWidgets('線上客服卡不再讀 /my/contact', (tester) async {
      overview = emptySelfOverview();
      await open(tester, '/me', mode: '自管');
      expect(calls('GET', '/my/contact').length, 0);
    });

    testWidgets('「使用導覽」重看導覽（即使已看過）', (tester) async {
      await open(tester, '/me');
      await tapText(tester, '使用導覽');
      expect(find.byKey(const ValueKey('welcome-guide')), findsOneWidget);
    });

    testWidgets('退出登入先問確認，按「取消」不退出', (tester) async {
      await open(tester, '/me');
      await tapText(tester, '退出登入');
      expect(find.text('確定要退出嗎？'), findsOneWidget);
      await tapText(tester, '取消', last: true);
      expect(getToken(), 't');
    });

    testWidgets('退出登入按「退出」：清登入狀態並打開登入頁', (tester) async {
      await open(tester, '/me');
      await tapText(tester, '退出登入');
      await tapText(tester, '退出', last: true);
      await settle(tester);
      expect([getToken(), find.byType(LoginPage).evaluate().length], [null, 1]);
    });

    testWidgets('載入失敗：提示錯誤，當作托管顯示', (tester) async {
      fail = true;
      await open(tester, '/me');
      expect([find.text('伺服器暫時出錯').evaluate().length, find.text('月報').evaluate().length, find.text('還沒有辦理記錄').evaluate().length], [1, 1, 1]);
      await finish(tester);
    });
  });

  group('通知', () {
    testWidgets('按日子分組：今天、日期', (tester) async {
      await open(tester, '/notifications');
      expect([find.text('今天').evaluate().length, find.text('2026-01-02').evaluate().length], [1, 1]);
    });

    testWidgets('有未讀時有「全部已讀」', (tester) async {
      await open(tester, '/notifications');
      expect(find.text('全部已讀'), findsOneWidget);
    });

    testWidgets('類別名稱', (tester) async {
      await open(tester, '/notifications');
      expect(['文件核對', '到期提醒', '辦理進度'].map((t) => find.text(t).evaluate().length).toList(), [1, 1, 1]);
    });

    testWidgets('點沒有連結的通知：標為已讀，留在本頁', (tester) async {
      await open(tester, '/notifications');
      await tapText(tester, '批文快到期');
      expect([calls('POST', '/my/notifications/read'), find.byType(NotificationsPage).evaluate().length], [['{"id":"n2"}'], 1]);
    });

    testWidgets('點有連結的通知：打開連結的頁面', (tester) async {
      await open(tester, '/notifications');
      await tapText(tester, '文件需要重交');
      await settle(tester);
      expect(find.byType(RequestDetailPage), findsOneWidget);
    });

    testWidgets('已讀的通知再點不再送已讀', (tester) async {
      await open(tester, '/notifications');
      await tapText(tester, '辦理進度更新');
      expect(calls('POST', '/my/notifications/read'), isEmpty);
    });

    testWidgets('「全部已讀」：送出後「全部已讀」消失', (tester) async {
      await open(tester, '/notifications');
      await tapText(tester, '全部已讀');
      expect([calls('POST', '/my/notifications/read'), find.text('全部已讀').evaluate().length], [['{"all":true}'], 0]);
    });

    testWidgets('沒有通知：「暫時沒有通知」', (tester) async {
      notices = [];
      await open(tester, '/notifications');
      expect([find.text('暫時沒有通知').evaluate().length, find.text('全部已讀').evaluate().length], [1, 0]);
    });

    testWidgets('載入失敗：提示錯誤和「暫時沒有通知」', (tester) async {
      fail = true;
      await open(tester, '/notifications');
      expect([find.text('伺服器暫時出錯').evaluate().length, find.text('暫時沒有通知').evaluate().length], [1, 1]);
      await finish(tester);
    });
  });

  group('未登入', () {
    testWidgets('打開分頁時沒有登入：打開登入頁', (tester) async {
      await open(tester, '/me', user: false);
      expect(find.byType(LoginPage), findsOneWidget);
    });
  });

  // 管理者 2026-11-23：拍背面時畫面停在正面，背面辨識完不知道；「點擊卡面翻轉」字太小
  group('新增牌照拍卡', () {
    setUp(() => PlateCreatePage.capture = (context, {required side}) async => 'data:image/jpeg;base64,AAAA');
    tearDown(() => PlateCreatePage.capture = openCardCapture);
    ApprovalCard card(WidgetTester tester) => tester.widget<ApprovalCard>(find.byType(ApprovalCard));

    testWidgets('拍背面時模擬卡翻到背面，辨識完提示是背面', (tester) async {
      await open(tester, '/plate-create', mode: '自管');
      expect(card(tester).back, false);
      await tapText(tester, '拍背面');
      expect([card(tester).back, textContaining('已辨識背面，請核對資料').evaluate().isNotEmpty], [true, true]);
      await finish(tester);
    });

    testWidgets('再拍正面時翻回正面，提示是正面', (tester) async {
      await open(tester, '/plate-create', mode: '自管');
      await tapText(tester, '拍背面');
      await finish(tester);
      await tapText(tester, '拍正面');
      expect([card(tester).back, textContaining('已辨識正面，請確認編號').evaluate().isNotEmpty], [false, true]);
      await finish(tester);
    });

    testWidgets('「點擊卡面翻轉」用 App 的小字字號', (tester) async {
      await open(tester, '/plate-create', mode: '自管');
      expect(tester.widget<Text>(find.text('點擊卡面翻轉')).style?.fontSize, 12);
    });
  });
}
