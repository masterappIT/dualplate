// 出租、新增出租的計算（rental_logic.dart、rental_new_logic.dart）：每種情況一個測試。
import 'package:dualplate/pages/rental/rental_logic.dart';
import 'package:dualplate/pages/rental_new/rental_new_logic.dart';
import 'package:flutter_test/flutter_test.dart';

Map rental({String status = '草擬', String statusWord = '未發出協議', String handling = 'self', Map? agreement, List procedures = const []}) => {
      'status': status,
      'statusWord': statusWord,
      'handling': handling,
      'startsOn': '2026-12-01',
      'plateId': 'p1',
      'plateLabel': '粵ZA100港 · AB1000',
      'renter': {'name': '陳大文', 'vehiclePlate': 'XY 123'},
      'agreement': agreement ?? {'version': 0, 'body': '協議'},
      'procedures': procedures,
    };

Map options({List lessors = const [], Object? currentVehicle = 'AB1000'}) => {'currency': 'HKD', 'lessors': lessors, 'currentVehicle': currentVehicle, 'drivers': [], 'prices': {}};

void main() {
  group('出租 needSign', () {
    test('第一次發：要簽', () {
      expect(needSign(rental(agreement: {'version': 0, 'body': '協議'}), '協議'), true);
    });
    test('協議改了：要簽', () {
      expect(needSign(rental(agreement: {'version': 1, 'body': '協議', 'lessorSigned': {'name': '李'}}), '協議（改）'), true);
    });
    test('只差前後空白不算改', () {
      expect(needSign(rental(agreement: {'version': 1, 'body': '協議', 'lessorSigned': {'name': '李'}}), ' 協議\n'), false);
    });
    test('發出後伺服器說改過：要簽', () {
      expect(needSign(rental(agreement: {'version': 1, 'body': '協議', 'changed': true, 'lessorSigned': {'name': '李'}}), '協議'), true);
    });
    test('這一版還沒有出租人簽名：要簽', () {
      expect(needSign(rental(agreement: {'version': 1, 'body': '協議'}), '協議'), true);
    });
    test('已簽、沒改：只重發連結', () {
      expect(needSign(rental(agreement: {'version': 1, 'body': '協議', 'lessorSigned': {'name': '李'}}), '協議'), false);
    });
  });

  group('出租 nextStep', () {
    test('已取消', () {
      expect(nextStep(rental(status: '已終止', statusWord: '已取消'), selfManaged: false).title, '這次出租已取消');
    });
    test('已終止', () {
      expect(nextStep(rental(status: '已終止', statusWord: '已終止'), selfManaged: false).title, '這次出租已終止');
    });
    test('已結束', () {
      expect(nextStep(rental(status: '已結束'), selfManaged: false), (title: '這次出租已結束', sub: ''));
    });
    test('出租中', () {
      expect(nextStep(rental(status: '生效'), selfManaged: false), (title: '出租中', sub: '由 2026-12-01 起計租金。'));
    });
    test('交給我們代理（托管）', () {
      expect(nextStep(rental(handling: 'agent'), selfManaged: false).sub, '顧問會聯絡你和承租人處理協議和手續。');
    });
    test('交給我們代理（自管）', () {
      expect(nextStep(rental(handling: 'agent'), selfManaged: true).sub, '我們會聯絡你和承租人處理協議和手續。');
    });
    test('未發出協議', () {
      expect(nextStep(rental(), selfManaged: false).title, '把協議發給承租人');
    });
    test('等承租人確認', () {
      expect(nextStep(rental(statusWord: '待承租人確認', agreement: {'version': 1}), selfManaged: false).title, '等承租人確認協議');
    });
    test('自行辦理的手續未辦', () {
      final r = rental(status: '待換車', statusWord: '待換車', agreement: {'version': 1}, procedures: [
        {'name': '換車', 'handler': 'client', 'state': 'open'},
        {'name': '換司機', 'handler': 'client', 'state': 'open'},
      ]);
      expect(nextStep(r, selfManaged: false).title, '請辦理換車、換司機');
    });
    test('等我們辦妥', () {
      final r = rental(status: '待換車', statusWord: '待換車', agreement: {'version': 1}, procedures: [{'name': '換車', 'handler': 'us', 'state': 'open'}]);
      expect(nextStep(r, selfManaged: false).title, '等候換車、換司機辦妥');
    });
  });

  group('出租 其他', () {
    test('waitingOnYou：未發出協議', () {
      expect(waitingOnYou(rental()), true);
    });
    test('waitingOnYou：已終止的自辦手續不算', () {
      expect(waitingOnYou(rental(status: '已終止', statusWord: '已取消', procedures: [{'handler': 'client', 'state': 'open'}])), false);
    });
    test('狀態顏色', () {
      expect([rentalTone({'status': '生效'}), rentalTone({'status': '待換車'}), rentalTone({'status': '已終止'})], ['', 'amber', 'gray']);
    });
    test('各期租金：代收已收', () {
      expect(rentalFeeLabel({'collectionMode': '代收'}, {'status': '已收'}), '我們已收到');
    });
    test('各期租金：直付已收、逾期、部分、未到期', () {
      final r = {'collectionMode': '直付'};
      expect([for (final s in ['已收', '逾期', '部分收', '待收']) rentalFeeLabel(r, {'status': s})], ['已確認收到', '未收到（已過期）', '部分收到', '未到期']);
    });
    test('when：香港時間「10月18日 08:41」', () {
      expect(when('2026-10-18T00:41:00Z'), '10月18日 08:41');
    });
    test('when：沒有時間是空白', () {
      expect(when(null), '');
    });
    test('換車辦好：帶承租人車牌', () {
      expect(reportDonePath(rental(), {'kind': 'vehicle'}), '/self-change?plate=p1&kind=vehicle_change&newPlate=XY%20123');
    });
    test('換司機辦好：不帶車牌', () {
      expect(reportDonePath(rental(), {'kind': 'driver'}), '/self-change?plate=p1&kind=driver_change');
    });
    test('WhatsApp 連結', () {
      expect(whatsappLink(rental(), 'https://x.test/r/1'), startsWith('https://wa.me/?text=${Uri.encodeComponent('陳大文 你好')}'));
    });
    test('簽名人和時間；未簽', () {
      final r = rental(agreement: {'version': 1, 'lessorSigned': {'name': '李先生', 'at': '2026-10-18T00:41:00Z'}});
      expect([signedLine(r, 'lessor'), signedLine(r, 'renter')], ['李先生 · 10月18日 08:41', '未簽']);
    });
    test('週期名稱', () {
      expect([cycleWord('monthly'), cycleWord('x')], ['每月', 'undefined']);
    });
  });

  group('新增出租 金額', () {
    test('千位逗號', () {
      expect(cents('8,000'), 800000);
    });
    test('小數四捨五入到分', () {
      expect(cents('12.345'), 1235);
    });
    test('空白是 0', () {
      expect(cents(''), 0);
    });
    test('負數無效', () {
      expect(cents('-1').isNaN, true);
    });
    test('文字無效', () {
      expect(cents('abc').isNaN, true);
    });
    test('JSON 數字：NaN 變 null', () {
      expect([jsonNumber(double.nan), jsonNumber(5.0), jsonNumber(1.5)], [null, 5, 1.5]);
    });
  });

  group('新增出租 表單', () {
    test('預設出租人：第一間香港公司', () {
      final f = RentalNewForm()
        ..applyOptions(options(lessors: [
          {'type': 'client', 'id': '', 'hint': '以你本人名義'},
          {'type': 'company', 'id': 'c9', 'hint': '香港公司'},
        ]));
      expect(f.lessorKey, 'company:c9');
    });
    test('預設出租人：沒有香港公司用本人', () {
      final f = RentalNewForm()..applyOptions(options(lessors: [{'type': 'company', 'id': 'c1', 'hint': '內地公司'}]));
      expect(f.lessorKey, 'client:');
    });
    test('沒有登記車輛：預設承租人自己的車', () {
      final f = RentalNewForm()..applyOptions(options(currentVehicle: ''));
      expect(f.useCurrent, false);
    });
    test('要辦的手續：換了別的車', () {
      final f = RentalNewForm()
        ..applyOptions(options())
        ..useCurrent = false
        ..vehiclePlate = 'XY 999';
      expect(f.needed.map((n) => n.kind), ['vehicle']);
    });
    test('要辦的手續：填的是現有車牌（空格大小寫不同）不用換車', () {
      final f = RentalNewForm()
        ..applyOptions(options())
        ..useCurrent = false
        ..vehiclePlate = 'ab 1000';
      expect(f.needed, isEmpty);
    });
    test('要辦的手續：有新司機', () {
      final f = RentalNewForm()
        ..applyOptions(options())
        ..newDriver = '王小明';
      expect(f.needed.map((n) => n.kind), ['driver']);
    });
    test('檢查：沒填承租人', () {
      expect((RentalNewForm()..applyOptions(options())).problem(), '請填寫承租人姓名');
    });
    test('檢查：沒選起租日期', () {
      expect((RentalNewForm()..applyOptions(options())..renterName = '陳').problem(), '請選擇起租日期');
    });
    test('檢查：租金 0', () {
      expect((RentalNewForm()..applyOptions(options())..renterName = '陳'..startsOn = '2026-12-01'..rent = '0').problem(), '請填寫租金');
    });
    test('檢查：押金無效', () {
      expect((RentalNewForm()..applyOptions(options())..renterName = '陳'..startsOn = '2026-12-01'..rent = '8000'..deposit = 'x').problem(), '押金金額無效');
    });
    test('送出內容（托管、交給我們代理、代收、換車換司機）', () {
      final f = RentalNewForm()
        ..applyOptions(options(lessors: [{'type': 'company', 'id': 'c9', 'hint': '香港公司'}]))
        ..renterName = '陳大文'
        ..renterPhone = '+852 6123 4567'
        ..useCurrent = false
        ..vehiclePlate = 'XY 999'
        ..newDriver = '王小明'
        ..startsOn = '2026-12-01'
        ..rent = '8,000'
        ..deposit = '16000'
        ..cycle = 'quarterly'
        ..dueDay = '10'
        ..handling = 'agent'
        ..collection = '代收';
      f.pickedDrivers['d2'] = true;
      f.pickedDrivers['d1'] = false;
      f.procedures['driver'] = 'client';
      expect(f.body(), {
        'renter': {'name': '陳大文', 'phone': '+852 6123 4567', 'idNo': ''},
        'lessorType': 'company',
        'lessorCompanyId': 'c9',
        'useCurrentVehicle': false,
        'renterVehiclePlate': 'XY 999',
        'driverIds': ['d2'],
        'newDriverName': '王小明',
        'startsOn': '2026-12-01',
        'endsOn': null,
        'rentAmount': 800000,
        'depositAmount': 1600000,
        'cycle': 'quarterly',
        'dueDay': 10,
        'currency': 'HKD',
        'handling': 'agent',
        'collectionMode': '代收',
        'procedures': {'vehicle': 'us', 'driver': 'client'},
      });
    });
    test('送出內容：自行負責時收租方式一律直付', () {
      final f = RentalNewForm()
        ..applyOptions(options())
        ..collection = '代收';
      expect(f.body()['collectionMode'], '直付');
    });
    test('送出內容：本人名義 lessorCompanyId 是 null', () {
      final f = RentalNewForm()..applyOptions(options());
      expect([f.body()['lessorType'], f.body()['lessorCompanyId']], ['client', null]);
    });
    test('送出內容：收租日不是數字送 null', () {
      final f = RentalNewForm()
        ..applyOptions(options())
        ..dueDay = 'abc';
      expect(f.body()['dueDay'], null);
    });
  });
}
