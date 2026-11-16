// 牌照詳情頁的計算（lib/pages/plate_detail/plate_detail_logic.dart）、批文卡的有效期寫法、日期選擇器的規則：一個情況一個測試。
// 期望值按 mobile/src/pages/plate-detail/plate-detail.vue 的原碼推算。
import 'package:dualplate/business/approval_card.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/pages/plate_detail/plate_detail_logic.dart';
import 'package:dualplate/ui/pickers.dart';
import 'package:flutter_test/flutter_test.dart';

void custody() => Session.debugSet(token: 't', user: {'id': 'u', 'serviceMode': '托管'}, mode: '托管');
void selfManaged() => Session.debugSet(token: 't', user: {'id': 'u', 'serviceMode': '自管'}, mode: '自管');

Map<String, dynamic> item(String name, {String level = 'ok', String handledBy = 'us', String dueOn = '2026-12-01', String ownerType = 'plate', Object? markable, Object? editable, String code = 'x'}) =>
    {'name': name, 'level': level, 'handledBy': handledBy, 'dueOn': dueOn, 'ownerType': ownerType, 'ownerLabel': '陳大文', 'markable': markable, 'editable': editable, 'code': code};

void main() {
  setUp(custody);

  group('批文卡摘要', () {
    test('托管：沒有狀態時寫「待核對」加有效期', () => expect(cardSummary({'card_expires_on': '2027-01-01'}), '待核對 · 有效期至 2027-01-01'));
    test('托管：沒有有效期時只寫狀態', () => expect(cardSummary({'card_status': '已核對'}), '已核對'));
    test('自管：待核對時只寫有效期', () {
      selfManaged();
      expect(cardSummary({'card_expires_on': '2027-01-01'}), '有效期至 2027-01-01');
    });
    test('自管：待核對又沒有有效期時寫「已建檔」', () {
      selfManaged();
      expect(cardSummary({}), '已建檔');
    });
  });

  group('到期項目摘要', () {
    test('沒有項目、托管、整理中', () => expect(deadlineSummary({'health': 'pending'}), '整理中'));
    test('沒有項目、自管、未填到期日', () {
      selfManaged();
      expect(deadlineSummary({'health': 'pending'}), '未填到期日');
    });
    test('沒有項目、正常：半年內沒有', () => expect(deadlineSummary({'health': 'ok'}), '半年內沒有'));
    test('有逾期：寫逾期件數', () => expect(deadlineSummary({'deadlines': [item('A', level: 'overdue'), item('B', level: 'due'), item('C')]}), '3 項 · 2 項已逾期'));
    test('只有快到期：寫快到期', () => expect(deadlineSummary({'deadlines': [item('A', level: 'due')]}), '1 項 · 1 項快到期'));
    test('有未填日期：加在後面', () => expect(deadlineSummary({'deadlines': [item('A')], 'undated': [{'code': 'u', 'ownerType': 'driver'}]}), '1 項 · 1 項未填日期'));
    test('開了 90 天過關時不列「90 天過關」', () => expect(deadlineSummary({'crossing': {'enabled': true}, 'deadlines': [item('90 天過關'), item('A')]}), '1 項'));
    test('通行證已在車輛區列出，不算未填日期', () =>
        expect(undatedList({'vehiclePermits': [{'code': 'p1'}], 'undated': [{'code': 'p1', 'ownerType': 'plate'}, {'code': 'p2', 'ownerType': 'plate'}]}).length, 1));
  });

  group('其他摘要', () {
    test('90 天過關：未開啟', () => expect(crossingSummary({}), '未開啟'));
    test('90 天過關：未記錄', () => expect(crossingSummary({'crossing': {'enabled': true}}), '未記錄過關日期'));
    test('90 天過關：上次日期', () => expect(crossingSummary({'crossing': {'enabled': true, 'lastCrossedOn': '2026-10-01'}}), '上次 2026-10-01'));
    test('司機：未登記', () => expect(driverSummary({}), '未登記'));
    test('司機：主司機和人數', () => expect(driverSummary({'drivers': [{'name': '甲', 'role': '副'}, {'name': '乙', 'role': '主'}]}), '乙（主） 等 2 人'));
    test('司機：沒有主司機時用第一位', () => expect(driverSummary({'drivers': [{'name': '甲', 'role': '副'}]}), '甲（副）'));
    test('車輛：未登記加未填日期件數', () => expect(vehicleSummary({'vehiclePermits': [{'dueOn': ''}]}, [], {}), '尚未登記車輛 · 1 項未填日期'));
    test('車輛：證件上傳數', () => expect(vehicleSummary({}, [{'id': 'v1', 'plate': 'HK1'}], {'v1': {'documents': [{'uploaded': true}, {'uploaded': false}]}}), 'HK1 · 證件 1/2 已上傳'));
    test('出租：有逾期未收', () => expect(usageSummary({}, [{'status': '生效', 'user': {'name': '甲'}, 'invoices': [{'status': '逾期', 'period': '2026-10'}]}]), '甲 · 有逾期未收'));
    test('出租：最近一期已收', () => expect(usageSummary({}, [{'status': '生效', 'user': {'name': '甲'}, 'invoices': [{'status': '待收', 'period': '2026-09'}, {'status': '已收', 'period': '2026-10'}]}]), '甲 · 已收'));
    test('出租：未生效時寫狀態字', () => expect(usageSummary({}, [{'status': '草擬', 'statusWord': '待簽署', 'user': {'name': '甲'}}]), '甲 · 待簽署'));
    test('出租：沒有出租、托管、未填寫時寫確認中', () => expect(usageSummary({}, []), '確認中'));
    test('出租：沒有出租、自管、未填寫時寫未填寫', () {
      selfManaged();
      expect(usageSummary({}, []), '未填寫');
    });
    test('出租：暫停使用寫空置', () => expect(usageSummary({'usageStatus': '暫停使用'}, []), '空置'));
    test('牌照資料：待核對寫確認中，綁定車輛名稱', () =>
        expect(plateSummary({'installation_status': '待核對', 'vehicle_id': 'v1'}, [{'id': 'v1', 'brand': 'Toyota', 'plate': 'HK1'}]), '確認中 · Toyota · HK1'));
    test('待辦數：你自理而且快到期，加上 90 天過關', () =>
        expect(clientTodoCount({'deadlines': [item('A', level: 'due', handledBy: 'you'), item('B', level: 'due'), {'code': 'crossing_90', 'level': 'overdue'}]}), 2));
    test('整體狀態：自管的整理中寫「未填到期日」', () {
      selfManaged();
      expect(healthLabel('pending'), '未填到期日');
    });
  });

  group('出租金額狀態', () {
    test('代收已收：我們已收到', () => expect(feeLabel({'collectionMode': '代收'}, {'status': '已收'}), '我們已收到'));
    test('直付已收：已確認收到', () => expect(feeLabel({'collectionMode': '直付'}, {'status': '已收'}), '已確認收到'));
    test('逾期：未收到（已過期）', () => expect(feeLabel({}, {'status': '逾期'}), '未收到（已過期）'));
    test('出租標籤顏色：生效綠、草擬橙、結束灰', () => expect([rentalTone({'status': '生效'}), rentalTone({'status': '草擬'}), rentalTone({'status': '已結束'})], ['', 'amber', 'gray']));
  });

  group('批文卡改動要問的事', () {
    test('港澳車牌改了：問換車', () {
      final c = cardChange({'localPlate': 'HK1'}, {'localPlate': 'hk2'}, '粵港')!;
      expect((c.title, c.kind, c.newPlate), ('港澳車牌由 HK1 改為 hk2', 'vehicle_change', 'hk2'));
    });
    test('港澳車牌只是大小寫不同：不問', () => expect(cardChange({'localPlate': 'hk1'}, {'localPlate': 'HK1'}, '粵港'), isNull));
    test('駕駛人改了：問換司機，名單排序後比較', () {
      final c = cardChange({'driver1': '甲', 'driver2': '乙'}, {'driver1': '乙', 'driver2': '丙'}, '粵港')!;
      expect((c.title, c.kind), ('駕駛人改為 丙、乙', 'driver_change'));
    });
    test('駕駛人只是次序不同：不問', () => expect(cardChange({'driver1': '甲', 'driver2': '乙'}, {'driver1': '乙', 'driver2': '甲'}, '粵港'), isNull));
    test('有效期延後：問續期', () => expect(cardChange({'validTo': '2026-01-01'}, {'validTo': '2027-01-01'}, '粵港')!.kind, 'renewal'));
    test('有效期提前：不問', () => expect(cardChange({'validTo': '2027-01-01'}, {'validTo': '2026-01-01'}, '粵港'), isNull));
    test('粵港口岸改了：問口岸變更', () => expect(cardChange({'crossing': '皇崗'}, {'crossing': '深圳灣'}, '粵港')!.title, '通行口岸改為 深圳灣'));
    test('粵澳口岸改了：不問', () => expect(cardChange({'crossing': '拱北'}, {'crossing': '橫琴'}, '粵澳'), isNull));
    test('內承單位改了：問商號變更', () => expect(cardChange({'contractor': '甲'}, {'contractor': '乙'}, '粵港')!.title, '內承單位改為 乙'));
    test('流水號改了：問補領', () => expect(cardChange({'serial': 'A1'}, {'serial': 'A2'}, '粵港')!.kind, 'replacement'));
    test('原本沒有的欄位填上：不問', () => expect(cardChange({}, {'localPlate': 'HK1', 'company': '甲'}, '粵港'), isNull));
    test('確認鍵文字：口岸變更寫「辦了變更」', () => expect(changeOk['口岸變更'], '辦了變更'));
  });

  group('下一件要做的事', () {
    final plate = {'id': 'p1', 'local_plate': 'HK1', 'installation_status': '已上牌', 'route': '粵港'};
    final now = DateTime(2026, 11, 16, 10);
    test('沒有 summary.id：沒有', () => expect(nextStep(plate: plate, summary: {}, bound: [], docs: {}, now: now), isNull));
    test('逾期排在快到期前面', () {
      final s = nextStep(plate: plate, summary: {'id': 'p1', 'deadlines': [item('A', level: 'due', handledBy: 'you', dueOn: '2026-11-20'), item('B', level: 'overdue', handledBy: 'you', dueOn: '2026-11-30', markable: true)]}, bound: [{}], docs: {}, now: now)!;
      expect((s.title, s.label, s.action), ('B已逾期', '已辦好', NextAction.markDone));
    });
    test('不是你自理的不算', () => expect(nextStep(plate: plate, summary: {'id': 'p1', 'deadlines': [item('A', level: 'due')]}, bound: [{}], docs: {}, now: now), isNull));
    test('過關期限 15 天內：今天已過關', () {
      final s = nextStep(plate: plate, summary: {'id': 'p1', 'crossing': {'enabled': true, 'nextDueOn': '2026-11-30', 'lastCrossedOn': '2026-09-01'}}, bound: [{}], docs: {}, now: now)!;
      expect((s.title, s.sub, s.label), ('90 天內要過關一次', '期限 2026-11-30，上次 2026-09-01', '今天已過關'));
    });
    test('過關期限超過 15 天：不提', () => expect(nextStep(plate: plate, summary: {'id': 'p1', 'crossing': {'enabled': true, 'nextDueOn': '2027-01-30'}}, bound: [{}], docs: {}, now: now), isNull));
    test('沒有綁定車輛：登記這部車', () => expect(nextStep(plate: plate, summary: {'id': 'p1'}, bound: [], docs: {}, now: now)!.sub, '按港澳車牌 HK1 登記，之後可拍下行駛證和香港車輛牌照。'));
    test('未上牌：不提登記車輛', () => expect(nextStep(plate: {...plate, 'installation_status': '未上牌'}, summary: {'id': 'p1'}, bound: [], docs: {}, now: now), isNull));
    test('必要證件未上傳：拍照上傳', () {
      final s = nextStep(plate: plate, summary: {'id': 'p1'}, bound: [{'id': 'v1'}], docs: {'v1': {'documents': [{'label': '行駛證', 'primary': true, 'uploaded': false}]}}, now: now)!;
      expect((s.title, s.label), ('上傳行駛證', '拍照上傳'));
    });
    test('可更新到期日：按鈕寫「更新到期日」', () =>
        expect(nextStep(plate: plate, summary: {'id': 'p1', 'deadlines': [item('A', level: 'due', handledBy: 'you', editable: true)]}, bound: [{}], docs: {}, now: now)!.label, '更新到期日'));
  });

  group('其他', () {
    test('自行辦理說明：退回 30 天內顯示，每類只顯示一條', () {
      final now = DateTime.utc(2026, 11, 16);
      final list = selfNotes([
        {'kind': 'renewal', 'status': '已退回', 'reviewedAt': '2026-11-10T00:00:00Z'},
        {'kind': 'renewal', 'status': '待核對'},
        {'kind': 'driver_change', 'status': '已退回', 'reviewedAt': '2026-09-01T00:00:00Z'},
      ], {}, now);
      expect(list.length, 1);
    });
    test('自行辦理說明：已標記不再續期時不重複', () => expect(selfNotes([{'kind': 'stop_renewal', 'status': '待核對'}], {'stopped_on': '2026-11-01'}), isEmpty));
    test('綁定車輛選項：同客戶同路線，退役的只保留已綁定的', () {
      final options = vehicleOptions({'customer_id': 'c', 'route': '粵港', 'vehicle_id': 'v2'}, [
        {'id': 'v1', 'customer_id': 'c', 'route': '粵港', 'plate': 'A'},
        {'id': 'v2', 'customer_id': 'c', 'route': '粵港', 'plate': 'B', 'retired_on': '2026-01-01'},
        {'id': 'v3', 'customer_id': 'c', 'route': '粵港', 'plate': 'C', 'retired_on': '2026-01-01'},
        {'id': 'v4', 'customer_id': 'x', 'route': '粵港', 'plate': 'D'},
      ]);
      expect(options.map((o) => o.label), ['未綁定', 'A', 'B']);
    });
    test('澳門號碼加短橫', () => expect(formatMacau('ma 12 34'), 'MA-12-34'));
    test('自行辦理網址：參數逐個編碼', () => expect(selfChangePath('p 1', 'renewal', newPlate: 'HK 1'), '/self-change?plate=p%201&kind=renewal&newPlate=HK%201'));
    test('你自己辦好了甚麼：粵澳沒有口岸變更', () => expect(ownChanges('粵澳').map((x) => x.$1), ['續期', '換車', '換司機', '商號變更', '補領批文卡']));
    test('正本：有哪一面列哪一面', () => expect(originalSides({'cardImages': {'back': true}}), ['back']));
    test('欄位狀態文字', () => expect([fieldStatusText({'status': 'uncertain'}), fieldStatusText({'status': 'failed'}), fieldStatusText({'status': 'ok'})], ['請核對', '未能辨識，請手動填寫', '']));
    test('證件上傳提示：讀出欄位', () => expect(docToast({'recognizable': true}, {'applied': [{'label': '車架號碼'}, {'label': '到期日'}]}), '已讀出並填入車架號碼、到期日'));
    test('證件上傳提示：不能辨識的證件只寫已上傳', () => expect(docToast({}, {}), '已上傳'));
    test('批文卡有效期：兩個日期用「–」連起', () => expect(ApprovalCard.validity('2026-01-01', '2027-01-01'), '2026.01.01–2027.01.01'));
    test('批文卡有效期：只有一個日期', () => expect(ApprovalCard.validity('', '2027-01-01'), '2027.01.01'));
  });

  group('日期選擇器', () {
    test('年份範圍：今年前後 61 年', () => expect(dateYears(2026, null, null), (1965, 2087)));
    test('年份範圍：start 更早時由 start 起', () => expect(dateYears(2026, '1950-01-01', null), (1950, 2087)));
    final years = [for (var y = 1965; y <= 2087; y++) '$y'];
    test('選了二月三十日：退回二月最後一天', () => expect(clampDate([2026 - 1965, 1, 29], years, [0, 0, 0], [122, 11, 30]), [2026 - 1965, 1, 27]));
    test('閏年二月：退回二十九日', () => expect(clampDate([2028 - 1965, 1, 30], years, [0, 0, 0], [122, 11, 30]), [2028 - 1965, 1, 28]));
    test('遲於 end：退回 end', () => expect(clampDate([2027 - 1965, 0, 0], years, [0, 0, 0], [2026 - 1965, 10, 15]), [2026 - 1965, 10, 15]));
  });
}
