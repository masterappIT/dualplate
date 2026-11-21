// 申請辦理頁的狀態和計算（lib/pages/requests/requests_logic.dart）：一個情況一個測試。
// 期望值按 mobile/src/pages/requests/requests.vue 的原碼推算。
import 'package:dualplate/pages/requests/requests_logic.dart';
import 'package:flutter_test/flutter_test.dart';

final services = [
  {'code': 'new_application', 'name': '新申請', 'routes': ['粵港', '粵澳']},
  {'code': 'renewal', 'name': '續期', 'routes': ['粵港', '粵澳']},
  {'code': 'hk_only', 'name': '香港專項', 'routes': ['粵港']},
  {'code': 'other', 'name': '其他代辦要求', 'routes': ['粵港', '粵澳']},
];
final plates = [
  {'id': 'p1', 'route': '粵港', 'mainland_plate': '粵B12345', 'local_plate': 'AB123', 'vehicle_id': 'v1'},
  {'id': 'p2', 'route': '粵澳', 'mainland_plate': '粵C67890', 'local_plate': 'MA1234', 'vehicle_id': 'v2'},
];
final vehicles = [
  {'id': 'v1', 'route': '粵港', 'plate': 'AB123'},
  {'id': 'v2', 'route': '粵澳', 'plate': 'MA1234'},
];

RequestsForm form({bool selfManaged = false, Map<String, String> query = const {}, bool withPlates = true}) =>
    RequestsForm(selfManaged: selfManaged, query: query)
      ..services = services
      ..vehicles = withPlates ? vehicles : []
      ..plates = withPlates ? plates : [];

void main() {
  group('列表狀態', () {
    test('待開始、新要求：已收到', () {
      expect(customerStatus('待開始'), '已收到');
      expect(customerStatus('新要求'), '已收到');
    });
    test('進行中、待收件：辦理中', () {
      expect(customerStatus('進行中'), '辦理中');
      expect(customerStatus('待收件'), '辦理中');
    });
    test('待客戶提供、待客戶配合：需要你提供資料', () {
      expect(customerStatus('待客戶提供'), '需要你提供資料');
      expect(customerStatus('待客戶配合'), '需要你提供資料');
    });
    test('其他狀態照原文', () => expect(customerStatus('已完成'), '已完成'));
  });

  group('牌照選項名稱', () {
    test('內地牌 · 港澳牌', () => expect(plateOptionName(plates.first), '粵B12345 · AB123'));
    test('只有內地牌', () => expect(plateOptionName({'mainland_plate': '粵B1'}), '粵B1'));
    test('都沒有：用批文卡編號', () => expect(plateOptionName({'card_number': 'C9'}), 'C9'));
  });

  group('網址參數', () {
    test('沒有參數：一般申請', () {
      final f = form();
      expect(f.entrust, '');
      expect(f.fixedService, isFalse);
      expect(f.route, '粵港');
    });
    test('不認得的 entrust 當沒有', () => expect(form(query: {'entrust': 'xx'}).entrust, ''));
    test('長期委託：服務固定為其他代辦要求', () {
      final f = form(query: {'entrust': 'long', 'service': 'renewal'});
      expect(f.wantedService, 'other');
      expect(f.fixedService, isTrue);
    });
    test('調整委託：服務固定為其他代辦要求', () => expect(form(query: {'entrust': 'scope'}).wantedService, 'other'));
    test('按次委託：服務照參數', () {
      final f = form(query: {'entrust': 'item', 'item': '驗車', 'service': 'renewal'});
      expect(f.wantedService, 'renewal');
      expect(f.fixedService, isFalse);
    });
  });

  group('服務和路線', () {
    test('粵港可選四項服務', () => expect(form().available.length, 4));
    test('粵澳不顯示只屬粵港的服務', () {
      final f = form()..setRoute('粵澳');
      expect(f.available.map((s) => s['code']), ['new_application', 'renewal', 'other']);
    });
    test('選服務：標題用服務名稱', () {
      final f = form()..pickService('renewal');
      expect(f.title, '續期');
    });
    test('按次委託：標題寫委託辦理和項目', () {
      final f = form(query: {'entrust': 'item', 'item': '驗車'})..pickService('renewal');
      expect(f.title, '委託辦理：驗車');
    });
    test('調整委託有項目：標題帶項目', () {
      final f = form(query: {'entrust': 'scope', 'item': '粵B12345'})..pickService('other');
      expect(f.title, '申請調整委託：粵B12345');
    });
    test('調整委託沒有項目：只寫申請調整委託', () {
      final f = form(query: {'entrust': 'scope'})..pickService('other');
      expect(f.title, '申請調整委託');
    });
    test('換路線：服務仍適用就保留', () {
      final f = form()..pickService('renewal');
      f.plateIndex = 1;
      f.vehicleIndex = 1;
      f.setRoute('粵澳');
      expect(f.serviceCode, 'renewal');
      expect(f.title, '續期');
      expect((f.plateIndex, f.vehicleIndex), (0, 0));
    });
    test('換路線：服務不適用就清掉，標題也清空', () {
      final f = form()..pickService('hk_only');
      f.setRoute('粵澳');
      expect(f.serviceCode, '');
      expect(f.title, '');
    });
    test('選同一條路線：甚麼都不重設', () {
      final f = form()..pickService('renewal');
      f.plateIndex = 1;
      f.setRoute('粵港');
      expect(f.plateIndex, 1);
    });
  });

  group('牌照選擇', () {
    test('牌照選項只有這條路線的', () => expect(form().plateOptions, [plates.first]));
    test('第一項：一般寫「請選擇牌照」', () => expect((form()..pickService('renewal')).plateNames, ['請選擇牌照', '粵B12345 · AB123']));
    test('第一項：其他代辦要求寫「不指定牌照」', () => expect((form()..pickService('other')).plateNames.first, '不指定牌照'));
    test('新申請不用選牌照', () {
      final f = form()..pickService('new_application');
      expect(f.needsPlate, isFalse);
      expect(f.showPlatePicker, isFalse);
    });
    test('續期要選牌照', () => expect((form()..pickService('renewal')).showPlatePicker, isTrue));
    test('沒有這條路線的牌照：續期要先新增牌照', () {
      final f = form(withPlates: false)..pickService('renewal');
      expect(f.noPlateYet, isTrue);
      expect(f.showPlatePicker, isFalse);
    });
    test('沒有牌照：其他代辦要求照舊可不指定', () {
      final f = form(withPlates: false)..pickService('other');
      expect(f.noPlateYet, isFalse);
      expect(f.showPlatePicker, isTrue);
    });
    test('長期委託：不顯示選牌照', () {
      final f = form(query: {'entrust': 'long'})..pickService('other');
      expect(f.showPlatePicker, isFalse);
      expect(f.noPlateYet, isFalse);
    });
  });

  group('參考價', () {
    test('自管選了服務：顯示', () => expect((form(selfManaged: true)..pickService('renewal')).showPrice, isTrue));
    test('托管：不顯示', () => expect((form()..pickService('renewal')).showPrice, isFalse));
    test('自管未選服務：不顯示', () => expect(form(selfManaged: true).showPrice, isFalse));
    test('自管長期委託：不顯示', () => expect((form(selfManaged: true, query: {'entrust': 'long'})..pickService('other')).showPrice, isFalse));
    test('有起價：寫參考價', () {
      expect(priceText({'from': {'currency': 'HKD', 'amount': 120000}}), r'參考價：由 HK$ 1,200 起，實價由我們確認');
    });
    test('沒有起價：寫由我們報價', () => expect(priceText(null), '價錢由我們報價，你同意後才開始辦'));
  });

  group('預選（從牌照或委託入口進來）', () {
    test('鎖定粵澳牌照：路線、牌照、車輛都選好', () {
      final f = form(query: {'plate': 'p2'})..applyWanted();
      expect(f.route, '粵澳');
      expect(f.plateIndex, 1);
      expect(f.vehicleIndex, 1);
      expect(f.lockedPlate, plates[1]);
    });
    test('鎖定牌照：不顯示新申請', () {
      final f = form(query: {'plate': 'p1'})..applyWanted();
      expect(f.shownServices.map((s) => s['code']), isNot(contains('new_application')));
    });
    test('鎖定牌照：不顯示選牌照', () {
      final f = form(query: {'plate': 'p1', 'service': 'renewal'})..applyWanted();
      expect(f.serviceCode, 'renewal');
      expect(f.showPlatePicker, isFalse);
    });
    test('找不到網址指定的牌照：不鎖定', () {
      final f = form(query: {'plate': 'nope'})..applyWanted();
      expect(f.lockedPlate, isNull);
      expect(f.route, '粵港');
    });
    test('網址指定的服務這條路線沒有：不選', () {
      final f = form(query: {'plate': 'p2', 'service': 'hk_only'})..applyWanted();
      expect(f.serviceCode, '');
    });
    test('長期委託：路線跟第一個牌照，標題寫長期委託洽談', () {
      final f = RequestsForm(selfManaged: true, query: {'entrust': 'long'})
        ..services = services
        ..plates = [plates[1], plates[0]]
        ..applyWanted();
      expect(f.route, '粵澳');
      expect(f.serviceCode, 'other');
      expect(f.title, '長期委託洽談');
    });
    test('長期委託沒有牌照：路線保持粵港', () {
      final f = form(query: {'entrust': 'long'}, withPlates: false)..applyWanted();
      expect(f.route, '粵港');
      expect(f.title, '長期委託洽談');
    });
  });

  group('提交前檢查', () {
    test('未選服務', () => expect(form().problem(), '請先選擇要辦的事'));
    test('要先新增牌照', () => expect((form(withPlates: false)..pickService('renewal')).problem(), '請先新增牌照'));
    test('有牌照未選', () => expect((form()..pickService('renewal')).problem(), '請選擇哪個牌照'));
    test('選了牌照：可以提交', () {
      final f = form()..pickService('renewal');
      f.plateIndex = 1;
      expect(f.problem(), '');
    });
    test('其他代辦要求不選牌照：可以提交', () => expect((form()..pickService('other')).problem(), ''));
    test('新申請不選牌照：可以提交', () => expect((form()..pickService('new_application')).problem(), ''));
    test('標題是空白：請先選擇要辦的事', () {
      final f = form()..pickService('other');
      f.title = '  ';
      expect(f.problem(), '請先選擇要辦的事');
    });
  });

  group('提交內容', () {
    test('選了牌照和車輛：送出 id', () {
      final f = form()..pickService('renewal');
      f.plateIndex = 1;
      f.vehicleIndex = 1;
      f.description = '盡快';
      expect(f.body(), {'route': '粵港', 'serviceCode': 'renewal', 'vehicleId': 'v1', 'plateAssetId': 'p1', 'title': '續期', 'description': '盡快'});
    });
    test('未選牌照和車輛：送 null', () {
      final b = (form()..pickService('other')).body();
      expect(b['vehicleId'], isNull);
      expect(b['plateAssetId'], isNull);
    });
    test('新申請：就算選了牌照也不送', () {
      final f = form()..pickService('new_application');
      f.plateIndex = 1;
      expect(f.body()['plateAssetId'], isNull);
    });
    test('牌照序號超出範圍：不送', () {
      final f = form()..pickService('renewal');
      f.plateIndex = 9;
      expect(f.body()['plateAssetId'], isNull);
    });
  });

  group('提交成功', () {
    test('新記錄放最前，帶車輛車牌；說明清空、選擇重設、服務保留', () {
      final f = form()..pickService('renewal');
      f.requests = [{'id': 'old'}];
      f.vehicleIndex = 1;
      f.plateIndex = 1;
      f.description = 'x';
      f.submitted({'id': 'new'});
      expect(f.requests, [{'id': 'new', 'plate': 'AB123'}, {'id': 'old'}]);
      expect((f.description, f.vehicleIndex, f.plateIndex, f.serviceCode, f.title), ('', 0, 0, 'renewal', '續期'));
    });
    test('未選車輛：新記錄的車牌是 null', () {
      final f = form()..pickService('other');
      f.submitted({'id': 'new'});
      expect(f.requests.first, {'id': 'new', 'plate': null});
    });
    test('長期委託：標題保持長期委託洽談', () {
      final f = form(query: {'entrust': 'long'})..applyWanted();
      f.submitted({'id': 'new'});
      expect(f.title, '長期委託洽談');
    });
    test('提示：自管與托管', () {
      expect(submittedToast(true), '已提交，我們會盡快聯絡你');
      expect(submittedToast(false), '已提交，顧問會盡快聯絡你');
    });
  });

  group('引言和提示文字', () {
    test('調整委託', () => expect(form(query: {'entrust': 'scope'}).introText, startsWith('告訴顧問想加入或取消哪些事項')));
    test('按次委託帶項目名稱', () => expect(form(query: {'entrust': 'item', 'item': '驗車'}).introText, startsWith('交給我們辦「驗車」')));
    test('長期委託', () => expect(form(query: {'entrust': 'long'}).introText, startsWith('提交後我們會聯絡你，了解')));
    test('自管一般申請', () => expect(form(selfManaged: true).introText, startsWith('選擇要交給我們辦的事')));
    test('托管一般申請', () => expect(form().introText, startsWith('選擇要辦的事，提交後你的顧問')));
    test('輸入框提示：調整、長期、一般各一款', () {
      expect(form(query: {'entrust': 'scope'}).placeholder, startsWith('想加入或取消哪些事項'));
      expect(form(query: {'entrust': 'long'}).placeholder, startsWith('想交給我們的事項'));
      expect(form().placeholder, '例如新車資料、希望完成的日期');
    });
  });

  group('記錄的內地牌', () {
    test('按 plate_asset_id 找牌照', () => expect(form().plateOf({'plate_asset_id': 'p2'}), '粵C67890'));
    test('找不到牌照：空字串', () => expect(form().plateOf({'plate_asset_id': 'x'}), ''));
  });
}
