// 牌照詳情頁（lib/pages/plate_detail/）：組件和流程，一個情況一個測試。
// 伺服器用 MockClient 代替（不連正式網站），拍卡用 PlateDetailPage.capture 替換，證件相片用 debugPickDocPhoto 替換。
// 畫面按 iPhone 17 Pro Max：440×956。
import 'dart:convert';
import 'package:dualplate/business/approval_card.dart';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/plate_detail/card_original.dart';
import 'package:dualplate/pages/plate_detail/doc_photo.dart';
import 'package:dualplate/pages/plate_detail/plate_detail_page.dart';
import 'package:dualplate/ui/image_preview.dart';
import 'package:dualplate/ui/uni_switch.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const photo = 'data:image/jpeg;base64,AAAA';

late List<http.Request> sent;
late Map<String, dynamic> plate, summary;
late List<dynamic> vehicles;
Object? cardUploadReply;
bool offline = false, missing = false, rentalOptionsFail = false;

Map<String, dynamic> basePlate() => {
      'id': 'p1',
      'customer_id': 'c1',
      'route': '粵港',
      'mainland_plate': '粵ZA123港',
      'local_plate': 'HK1234',
      'installation_status': '已上牌',
      'usage_status': '自用',
      'vehicle_id': 'v1',
      'card_status': '已核對',
      'card_expires_on': '2027-05-01',
      'cardData': {'cardNumber': '1234567890', 'company': '測試有限公司', 'localPlate': 'HK1234', 'driver1': '陳大文', 'validTo': '2027-05-01', 'serial': 'A001', 'crossing': '皇崗'},
      'cardImages': <String, dynamic>{},
    };

Map<String, dynamic> baseSummary() => {
      'id': 'p1',
      'health': 'ok',
      'holder': '測試有限公司',
      'contractor': '測試內承',
      'mainlandPlate': '粵ZA123港',
      'crossing': {'enabled': false},
      'drivers': [
        {'id': 'd1', 'name': '陳大文', 'role': '主'},
      ],
      'deadlines': [],
      'requests': [],
    };

http.Response reply(Object? body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

Future<http.Response> handle(http.Request r) async {
  sent.add(r);
  if (offline) throw http.ClientException('offline');
  final path = r.url.path.replaceFirst('/api', ''), m = r.method;
  if (path == '/plate-assets/p1' && m == 'GET') return missing ? reply({'error': '找不到'}, 404) : reply(plate);
  if (path == '/plate-assets/p1' && (m == 'PUT' || m == 'PATCH')) {
    final body = jsonDecode(r.body) as Map;
    if (body['cardData'] != null) plate['cardData'] = body['cardData'];
    if (body['localPlate'] != null) plate['local_plate'] = body['localPlate'];
    return reply(plate);
  }
  if (path == '/vehicles' && m == 'GET') return reply(vehicles);
  if (path == '/catalog') return reply({'sources': []});
  if (path == '/my/plates/p1') return reply(summary);
  if (path == '/my/pending') return reply([]);
  if (path == '/my/plates/p1/self-handled') return reply([]);
  if (path == '/my/drivers' && m == 'GET') return reply([{'id': 'd1', 'name': '陳大文', 'phone': '+85291234567'}]);
  if (path.startsWith('/my/drivers/')) return reply({'ok': true});
  if (path == '/my/rentals') return reply([]);
  if (path == '/my/plates/p1/rental-options') return rentalOptionsFail ? reply({'error': '錯誤'}, 500) : reply({'allowed': false});
  if (path == '/vehicles/v1') return reply({'inspections': []});
  if (path == '/vehicles/v1/documents' && m == 'GET') return reply({'documents': [license]});
  if (path == '/vehicles/v1/documents/license' && m == 'POST') return reply({'vehicleId': 'v1', 'documents': [], 'checks': [], 'applied': []});
  if (path.startsWith('/plate-assets/p1/card/') && m == 'POST') {
    plate['cardImages'] = {...plate['cardImages'] as Map, path.split('/').last: true};
    return reply(cardUploadReply ?? {'ok': true});
  }
  if (path.startsWith('/plate-assets/p1/image/')) return http.Response.bytes(_png, 200, headers: {'content-type': 'image/png'});
  if (path == '/my/plates/p1/crossing-reminder') return reply({'ok': true});
  if (path == '/my/plates/p1/crossings') return reply({'nextDueOn': '2027-02-14'});
  if (path == '/my/dates') return reply({'ok': true});
  if (path == '/my/vehicles/v1') return reply(vehicles.first);
  return reply({'error': '沒有這個接口'}, 404);
}

const license = {'kind': 'license', 'label': '行駛證', 'hint': '拍下行駛證', 'fields': [], 'recognizable': true, 'primary': false, 'uploaded': false};

// 1×1 透明 PNG
final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');

// 內容是 text 的輸入框
Finder input(String text) => find.byWidgetPredicate((w) => w is EditableText && w.controller.text == text).last;

List<String> calls(String method, String path) => sent.where((r) => r.method == method && r.url.path == '/api$path').map((r) => r.body).toList();

Future<void> open(WidgetTester tester, {String mode = '托管', String location = '/plate-detail?id=p1', bool user = true}) async {
  tester.view.physicalSize = const Size(1320, 2868);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({});
  await Session.load();
  Session.debugSet(token: user ? 't' : null, user: user ? {'id': 'u1', 'serviceMode': mode} : null, mode: mode);
  await tester.pumpWidget(DualplateApp(initialLocation: location));
  await settle(tester);
}

Future<void> settle(WidgetTester tester, [int times = 6]) async {
  for (var i = 0; i < times; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

// 等提示消失，免得測試結束時還有計時器
Future<void> finish(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 3));
  await tester.pump(const Duration(seconds: 1));
}

Future<void> tapText(WidgetTester tester, String text, {bool last = false}) async {
  final f = find.text(text);
  await tester.ensureVisible(last ? f.last : f.first);
  await tester.pump();
  await tester.tap(last ? f.last : f.first);
  await settle(tester);
}

// 底部選單：上一個選單收起後等 300ms 才打開下一個
Future<void> pickSheet(WidgetTester tester, String text) async {
  await tester.pump(const Duration(milliseconds: 300));
  await settle(tester);
  await tester.tap(find.text(text).last);
  await settle(tester);
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    sent = [];
    plate = basePlate();
    summary = baseSummary();
    vehicles = [
      {'id': 'v1', 'customer_id': 'c1', 'route': '粵港', 'plate': 'HK1234', 'brand': 'Toyota', 'model': 'Alphard', 'type': '私家車', 'origin': '香港'},
    ];
    cardUploadReply = null;
    offline = false;
    missing = false;
    rentalOptionsFail = false;
    Api.client = MockClient(handle);
    PlateDetailPage.capture = (context, {required side}) async => photo;
    debugPickDocPhoto = null;
    debugForgetAllOriginals();
    debugResetApi();
  });

  group('載入', () {
    testWidgets('頁首：兩塊車牌、狀態、路線和持牌公司', (tester) async {
      await open(tester);
      expect(find.text('粵ZA123港'), findsOneWidget);
      expect(find.text('HK1234'), findsOneWidget);
      expect(find.text('正常'), findsOneWidget);
      expect(find.text('粵港兩地牌 · 測試有限公司'), findsOneWidget);
      expect(find.text('批文有效期至 2027-05-01 · 批文卡 ›'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('找不到牌照：顯示「找不到這個兩地牌檔案。」', (tester) async {
      missing = true;
      await open(tester);
      expect(find.text('找不到這個兩地牌檔案。'), findsOneWidget);
      expect(find.text('找不到'), findsOneWidget); // 提示伺服器的錯誤文字
      await finish(tester);
    });

    testWidgets('連不上伺服器：提示並顯示找不到', (tester) async {
      offline = true;
      await open(tester);
      expect(find.text(offlineMessage), findsOneWidget);
      expect(find.text('找不到這個兩地牌檔案。'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('沒有登入：打開登入頁', (tester) async {
      await open(tester, user: false);
      expect(find.text('找不到這個兩地牌檔案。'), findsNothing);
      expect(sent.where((r) => r.url.path.startsWith('/api/plate-assets')), isEmpty);
      await finish(tester);
    });

    testWidgets('new=1：登記現有批文卡入口，不載入資料', (tester) async {
      await open(tester, location: '/plate-detail?new=1');
      expect(find.text('登記現有批文卡'), findsOneWidget);
      expect(find.text('前往批文卡建檔'), findsOneWidget);
      expect(sent, isEmpty);
    });

    testWidgets('有兩項你自理的快到期：頁首寫「2 項待辦」', (tester) async {
      summary['deadlines'] = [
        {'name': '甲', 'level': 'due', 'handledBy': 'you', 'dueOn': '2026-12-01'},
        {'name': '乙', 'level': 'overdue', 'handledBy': 'you', 'dueOn': '2026-11-01'},
      ];
      await open(tester);
      expect(find.text('2 項待辦'), findsOneWidget);
      await finish(tester);
    });
  });

  group('自管和托管', () {
    testWidgets('托管：有「委託內容」，沒有「刪除這個牌照」', (tester) async {
      await open(tester);
      expect(find.text('委託內容'), findsOneWidget);
      expect(find.text('刪除這個牌照 ›'), findsNothing);
      expect(find.text('不再續期這個牌照 ›'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('自管：沒有「委託內容」，有「刪除這個牌照」', (tester) async {
      await open(tester, mode: '自管');
      expect(find.text('委託內容'), findsNothing);
      expect(find.text('刪除這個牌照 ›'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('托管：沒有要做的事時寫「目前不用你做甚麼」', (tester) async {
      vehicles = [vehicles.first];
      await open(tester);
      expect(find.text('目前不用你做甚麼'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('自管：沒有要做的事時寫「目前沒有快到期的事項」', (tester) async {
      await open(tester, mode: '自管');
      expect(find.text('目前沒有快到期的事項'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('已標記不再續期：顯示說明，不顯示「不再續期這個牌照」', (tester) async {
      plate['stopped_on'] = '2026-11-01';
      plate['stop_reason'] = '車輛出售';
      await open(tester);
      expect(find.text('已標記不再續期'), findsOneWidget);
      expect(find.text('不再續期這個牌照 ›'), findsNothing);
      await finish(tester);
    });
  });

  group('批文卡', () {
    testWidgets('點「批文卡 ›」：打開批文卡區', (tester) async {
      await open(tester);
      expect(find.byType(ApprovalCard), findsNothing);
      await tapText(tester, '批文有效期至 2027-05-01 · 批文卡 ›');
      expect(find.byType(ApprovalCard), findsOneWidget);
      expect(find.text('測試有限公司'), findsWidgets);
      await finish(tester);
    });

    testWidgets('點卡面：翻到背面，分段切換跟着變', (tester) async {
      await open(tester);
      await tapText(tester, '批文卡');
      expect(find.text('内地车牌号:'), findsNothing);
      await tester.tap(find.byType(ApprovalCard));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));
      expect(find.text('内地车牌号:'), findsOneWidget); // 背面的字
      expect(find.bySemanticsLabel('翻到批文卡正面'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('沒有正本：沒有「查看正本」', (tester) async {
      await open(tester);
      await tapText(tester, '批文卡');
      expect(find.text('查看正本'), findsNothing);
      await finish(tester);
    });

    testWidgets('上傳：沒有正本時選正面後直接拍卡讀取', (tester) async {
      cardUploadReply = {'cardData': plate['cardData'], 'fieldStatus': {'company': {'status': 'uncertain'}}};
      await open(tester);
      await tapText(tester, '批文卡');
      await tapText(tester, '上傳新批文卡');
      expect(find.text('上傳哪一面？'), findsOneWidget);
      await pickSheet(tester, '正面');
      await settle(tester, 10);
      final body = jsonDecode(calls('POST', '/plate-assets/p1/card/front').single) as Map;
      expect(body.containsKey('recognize'), isFalse);
      expect(find.text('怎樣處理這張相片？'), findsNothing);
      expect(find.text('商號\uFFFC請核對', findRichText: true), findsOneWidget); // 編輯框「商號」標籤旁的欄位狀態
      expect(find.text('已辨識，請核對欄位'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('上傳：拍卡取消（佔位回傳 null）時不送出', (tester) async {
      PlateDetailPage.capture = (context, {required side}) async => null;
      await open(tester);
      await tapText(tester, '批文卡');
      await tapText(tester, '上傳新批文卡');
      await pickSheet(tester, '背面');
      expect(calls('POST', '/plate-assets/p1/card/back'), isEmpty);
      await finish(tester);
    });

    testWidgets('上傳：已有正本時再問怎樣處理，「只保存正本」不讀取', (tester) async {
      plate['cardImages'] = {'front': true};
      await open(tester);
      await tapText(tester, '批文卡');
      expect(find.text('查看正本'), findsOneWidget);
      await tapText(tester, '上傳新批文卡');
      await pickSheet(tester, '背面');
      expect(find.text('怎樣處理這張相片？'), findsOneWidget);
      expect(find.text('系統讀出卡上的文字填入，顧問會再核對'), findsOneWidget);
      await pickSheet(tester, '只保存正本');
      await settle(tester, 10);
      expect((jsonDecode(calls('POST', '/plate-assets/p1/card/back').single) as Map)['recognize'], false);
      expect(find.text('正本已保存，資料沒有改動'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('上傳：自管的「上傳並讀取內容」說明', (tester) async {
      plate['cardImages'] = {'front': true};
      await open(tester, mode: '自管');
      await tapText(tester, '批文卡');
      await tapText(tester, '上傳新批文卡');
      await pickSheet(tester, '正面');
      expect(find.text('系統讀出卡上的文字填入，請核對一次'), findsOneWidget);
      await pickSheet(tester, '取消');
      await finish(tester);
    });

    testWidgets('讀取後港澳車牌不同：問換車，選「辦了換車」轉到自行辦理更新', (tester) async {
      cardUploadReply = {'cardData': {...plate['cardData'] as Map, 'localPlate': 'XY99'}};
      await open(tester);
      await tapText(tester, '批文卡');
      await tapText(tester, '上傳新批文卡');
      await pickSheet(tester, '正面');
      await settle(tester, 10);
      expect(find.text('港澳車牌由 HK1234 改為 XY99'), findsOneWidget);
      await tapText(tester, '辦了換車');
      expect(find.text('自行辦理更新'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('讀取後港澳車牌不同：選「之前填錯」留在本頁核對', (tester) async {
      cardUploadReply = {'cardData': {...plate['cardData'] as Map, 'localPlate': 'XY99'}};
      await open(tester);
      await tapText(tester, '批文卡');
      await tapText(tester, '上傳新批文卡');
      await pickSheet(tester, '正面');
      await settle(tester, 10);
      await tapText(tester, '之前填錯');
      expect(find.text('已辨識，請核對欄位'), findsOneWidget);
      expect(find.text('儲存批文卡內容'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('修改內容：輸入時卡面跟着變，儲存送出整張卡', (tester) async {
      await open(tester);
      await tapText(tester, '批文卡');
      await tapText(tester, '修改內容');
      final company = input('測試有限公司');
      await tester.enterText(company, '新公司');
      await tester.pump();
      expect(find.text('新公司'), findsNWidgets(2)); // 卡面和輸入框
      await tapText(tester, '儲存批文卡內容');
      // 商號改了：先問
      expect(find.text('商號改為 新公司'), findsOneWidget);
      await tapText(tester, '之前填錯');
      expect((jsonDecode(calls('PUT', '/plate-assets/p1').single) as Map)['cardData']['company'], '新公司');
      expect(find.text('已更新，顧問會再核對'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('修改內容：問的時候點框外取消，不送出', (tester) async {
      await open(tester);
      await tapText(tester, '批文卡');
      await tapText(tester, '修改內容');
      final valid = input('2027-05-01');
      await tester.enterText(valid, '2028-05-01');
      await tester.pump();
      await tapText(tester, '儲存批文卡內容');
      expect(find.text('有效期延至 2028-05-01'), findsOneWidget);
      await tester.tapAt(const Offset(20, 300));
      await settle(tester);
      expect(calls('PUT', '/plate-assets/p1'), isEmpty);
      expect(find.text('儲存批文卡內容'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('修改內容：「取消」收起編輯框', (tester) async {
      await open(tester);
      await tapText(tester, '批文卡');
      await tapText(tester, '修改內容');
      await tapText(tester, '取消');
      expect(find.text('儲存批文卡內容'), findsNothing);
      await finish(tester);
    });

    testWidgets('查看正本：下載後打開看大圖', (tester) async {
      plate['cardImages'] = {'front': true, 'back': true};
      await open(tester);
      await tapText(tester, '批文卡');
      await tapText(tester, '查看正本');
      await settle(tester);
      expect(find.byType(ImagePreview), findsOneWidget);
      expect(find.text('1/2'), findsOneWidget);
      expect(calls('GET', '/plate-assets/p1/image/card-front').length, 1);
      await finish(tester);
    });

    testWidgets('查看正本：下載失敗提示「圖片載入失敗」', (tester) async {
      plate['cardImages'] = {'front': true};
      await open(tester);
      Api.client = MockClient((r) async => r.url.path.contains('/image/') ? http.Response('', 500) : handle(r));
      await tapText(tester, '批文卡');
      await tapText(tester, '查看正本');
      await settle(tester);
      expect(find.text('圖片載入失敗'), findsOneWidget);
      expect(find.byType(ImagePreview), findsNothing);
      await finish(tester);
    });
  });

  group('90 天過關', () {
    testWidgets('開啟提醒：送出並提示', (tester) async {
      await open(tester);
      await tapText(tester, '90 天過關');
      await tester.tap(find.byType(UniSwitch));
      await settle(tester);
      expect(jsonDecode(calls('PUT', '/my/plates/p1/crossing-reminder').single), {'enabled': true});
      expect(find.text('已開啟 90 天過關提醒'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('今天已過關：送出今天的日期並提示下次期限', (tester) async {
      summary['crossing'] = {'enabled': true, 'days': 90, 'lastCrossedOn': '2026-10-01', 'nextDueOn': '2026-12-30'};
      await open(tester);
      await tapText(tester, '90 天過關');
      await tapText(tester, '今天已過關');
      final now = DateTime.now();
      final today = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      expect(jsonDecode(calls('POST', '/my/plates/p1/crossings').single), {'crossedOn': today});
      expect(find.text('已記錄，下次請在 2027-02-14 前過關'), findsOneWidget);
      expect(find.text('已過關'), findsOneWidget); // 印章
      await finish(tester);
    });
  });

  group('到期項目', () {
    testWidgets('超過 5 項：顯示「顯示全部 N 項」，按下展開', (tester) async {
      summary['deadlines'] = [for (var i = 1; i <= 7; i++) {'name': '項目$i', 'level': 'ok', 'handledBy': 'us', 'dueOn': '2027-0$i-01', 'ownerType': 'plate'}];
      await open(tester);
      await tapText(tester, '到期項目');
      expect(find.text('項目6'), findsNothing);
      await tapText(tester, '顯示全部 7 項');
      expect(find.text('項目7'), findsOneWidget);
      expect(find.text('收起'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('托管：你自理的事項標「自行辦理」', (tester) async {
      summary['deadlines'] = [{'name': '驗車', 'level': 'ok', 'handledBy': 'you', 'dueOn': '2027-01-01', 'ownerType': 'plate'}];
      await open(tester);
      await tapText(tester, '到期項目');
      expect(find.text('自行辦理'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('沒有到期項目：寫「半年內沒有到期項目。」', (tester) async {
      await open(tester);
      await tapText(tester, '到期項目');
      expect(find.text('半年內沒有到期項目。'), findsOneWidget);
      await finish(tester);
    });
  });

  group('有變動？', () {
    testWidgets('托管：三個選項的文字', (tester) async {
      await open(tester);
      await tapText(tester, '有變動？');
      expect(find.text('這個牌照有甚麼變動？'), findsOneWidget);
      expect(find.text('請顧問幫我辦'), findsOneWidget);
      expect(find.text('直接修改，顧問會再核對'), findsOneWidget);
      await pickSheet(tester, '取消');
      await finish(tester);
    });

    testWidgets('自管：三個選項的文字', (tester) async {
      await open(tester, mode: '自管');
      await tapText(tester, '有變動？');
      expect(find.text('交給我們辦'), findsOneWidget);
      expect(find.text('我們報價，你同意後才開始'), findsOneWidget);
      await pickSheet(tester, '取消');
      await finish(tester);
    });

    testWidgets('我已經自己辦好：粵港有口岸變更，選了轉到自行辦理更新', (tester) async {
      await open(tester);
      await tapText(tester, '有變動？');
      await pickSheet(tester, '我已經自己辦好');
      expect(find.text('你自己辦好了甚麼？'), findsOneWidget);
      expect(find.text('口岸變更'), findsOneWidget);
      await pickSheet(tester, '續期');
      expect(find.text('自行辦理更新'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('資料有錯字 › 批文卡內容：打開批文卡編輯', (tester) async {
      await open(tester);
      await tapText(tester, '有變動？');
      await pickSheet(tester, '資料有錯字');
      await pickSheet(tester, '批文卡內容');
      expect(find.text('儲存批文卡內容'), findsOneWidget);
      await finish(tester);
    });
  });

  group('牌照資料、司機、車輛', () {
    testWidgets('改港澳車牌：先問換車，「之前填錯」才儲存', (tester) async {
      await open(tester);
      await tapText(tester, '牌照資料');
      await tapText(tester, '修改牌照資料 ›');
      final local = input('HK1234');
      await tester.enterText(local, 'HK5678');
      await tester.pump();
      await tapText(tester, '儲存牌照資料');
      expect(find.text('港澳車牌由 HK1234 改為 HK5678'), findsOneWidget);
      await tapText(tester, '之前填錯');
      expect((jsonDecode(calls('PATCH', '/plate-assets/p1').single) as Map)['localPlate'], 'HK5678');
      expect(find.text('已更新，顧問會再核對'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('自管：上牌狀態未選時顯示「未填寫」', (tester) async {
      plate['installation_status'] = '待核對';
      await open(tester, mode: '自管');
      await tapText(tester, '牌照資料');
      await tapText(tester, '修改牌照資料 ›');
      expect(find.text('未填寫'), findsWidgets);
      expect(find.text('使用狀態'), findsWidgets);
      await finish(tester);
    });

    testWidgets('司機：點司機打開修改，儲存送出', (tester) async {
      await open(tester);
      await tapText(tester, '司機');
      await tapText(tester, '修改');
      expect(find.text('只保存最後 4 位'), findsOneWidget);
      await tapText(tester, '儲存司機資料');
      expect(calls('PATCH', '/my/drivers/d1').length, 1);
      expect(find.text('已更新，顧問會再核對'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('車輛：改車牌先問「車牌由 … 改為 …」', (tester) async {
      await open(tester);
      await tapText(tester, '車輛與證件');
      await tapText(tester, '修改車輛資料 ›');
      final p = input('HK1234');
      await tester.enterText(p, 'NEW1');
      await tester.pump();
      await tapText(tester, '儲存車輛資料');
      expect(find.text('車牌由 HK1234 改為 NEW1'), findsOneWidget);
      await tapText(tester, '之前填錯');
      expect(calls('PATCH', '/my/vehicles/v1').length, 1);
      await finish(tester);
    });

    testWidgets('車輛證件：相片接口未接上（回傳 null）時不送出', (tester) async {
      await open(tester);
      await tapText(tester, '車輛與證件');
      await tapText(tester, '上傳');
      expect(calls('POST', '/vehicles/v1/documents/license'), isEmpty);
      await finish(tester);
    });

    testWidgets('車輛證件：有相片時上傳並提示', (tester) async {
      debugPickDocPhoto = (context) async => photo;
      await open(tester);
      await tapText(tester, '車輛與證件');
      await tapText(tester, '上傳');
      expect(calls('POST', '/vehicles/v1/documents/license').length, 1);
      expect(find.text('已上傳，請對照核對'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('沒有綁定車輛：顯示「尚未登記車輛」', (tester) async {
      plate['vehicle_id'] = null;
      await open(tester);
      await tapText(tester, '車輛與證件');
      expect(find.text('尚未登記車輛'), findsWidgets); // 摘要和卡片
      expect(find.text('登記這部車'), findsWidgets);
      await finish(tester);
    });
  });

  group('其他區塊', () {
    testWidgets('粵澳：牌照資料用另寫的澳門牌，號碼加短橫', (tester) async {
      plate['route'] = '粵澳';
      plate['local_plate'] = 'MA1234';
      await open(tester);
      await tapText(tester, '牌照資料');
      expect(find.text('澳門號牌'), findsOneWidget);
      expect(find.text('MA-12-34'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('沒有號碼：顯示「未提供號碼」', (tester) async {
      plate['local_plate'] = '';
      await open(tester);
      await tapText(tester, '牌照資料');
      expect(find.text('未提供號碼'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('辦理記錄：沒有時寫說明', (tester) async {
      await open(tester);
      await tapText(tester, '辦理記錄');
      expect(find.text('這個牌照還沒有辦理記錄。'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('持牌公司：用途、持牌公司、內承單位', (tester) async {
      await open(tester);
      await tapText(tester, '持牌公司');
      expect(find.text('測試內承'), findsOneWidget);
      expect(find.text('用途'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('出租：托管、讀不到出租選項時寫「出租由顧問記錄。」', (tester) async {
      rentalOptionsFail = true;
      await open(tester);
      await tapText(tester, '出租');
      expect(find.text('確認中。出租由顧問記錄。'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('出租：托管、讀到出租選項但不可出租時只寫狀態', (tester) async {
      await open(tester);
      await tapText(tester, '出租');
      expect(find.text('確認中。'), findsOneWidget);
      await finish(tester);
    });
  });
}
