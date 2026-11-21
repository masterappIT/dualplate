// 自行辦理更新頁的狀態和計算（lib/pages/self_change/self_change_logic.dart）：一個情況一個測試。
// 期望值按 mobile/src/pages/self-change/self-change.vue 的原碼推算。
import 'package:dualplate/core/session.dart';
import 'package:dualplate/pages/self_change/self_change_logic.dart';
import 'package:flutter_test/flutter_test.dart';

void custody() => Session.debugSet(token: 't', user: {'id': 'u', 'serviceMode': '托管'}, mode: '托管');
void selfManaged() => Session.debugSet(token: 't', user: {'id': 'u', 'serviceMode': '自管'}, mode: '自管');

final now = DateTime(2026, 11, 21);
SelfChangeForm make(String kind, {Map<String, String> query = const {}, Map<String, dynamic>? form}) {
  final f = SelfChangeForm(query: {'plate': 'p1', 'kind': kind, ...query}, now: now);
  if (form != null) f.form = form;
  return f;
}

void main() {
  setUp(custody);

  group('網址參數', () {
    test('照參數讀入牌照、項目和標記資料', () {
      final f = make('filing_done', query: {'period': '2026', 'name': '新批文備案', 'label': 'x', 'dueOn': '2026-12-01'});
      expect(f.plateId, 'p1');
      expect(f.kind, 'filing_done');
      expect(f.mark, (period: '2026', name: '新批文備案', label: 'x', dueOn: '2026-12-01'));
    });
    test('不認得的項目：當自行換車', () => expect(make('oops').kind, 'vehicle_change'));
    test('沒有項目：當自行換車', () => expect(SelfChangeForm(now: now).kind, 'vehicle_change'));
    test('辦理日期預設今天', () {
      final f = make('renewal');
      expect(f.today, '2026-11-21');
      expect(f.handledOn, '2026-11-21');
    });
    test('今天的寫法補零', () => expect(todayIso(DateTime(2027, 3, 5)), '2027-03-05'));
  });

  group('項目的性質', () {
    test('驗車、備案、行車稅是標記一期', () {
      for (final k in ['inspection_done', 'filing_done', 'tax_paid']) {
        expect(make(k).marking, isTrue, reason: k);
      }
    });
    test('換車不是標記', () => expect(make('vehicle_change').marking, isFalse));
    test('標記不用拍新卡', () => expect(make('tax_paid').showCardUpload, isFalse));
    test('不再續期不用拍新卡', () => expect(make('stop_renewal').showCardUpload, isFalse));
    test('續期要拍新卡', () => expect(make('renewal').showCardUpload, isTrue));
    test('這項已在等候核對', () => expect(make('renewal', form: {'pending': ['renewal']}).pendingHere, isTrue));
    test('別項在等候核對：不算', () => expect(make('renewal', form: {'pending': ['driver_change']}).pendingHere, isFalse));
    test('已停止續期：其他項目顯示已停止', () => expect(make('renewal', form: {'stoppedOn': '2026-10-01'}).stopped, isTrue));
    test('已停止續期：不再續期本身不算', () => expect(make('stop_renewal', form: {'stoppedOn': '2026-10-01'}).stopped, isFalse));
    test('港澳名稱：粵澳寫澳門，其他寫香港', () {
      expect(make('renewal', form: {'route': '粵澳'}).localName, '澳門');
      expect(make('renewal', form: {'route': '粵港'}).localName, '香港');
    });
    test('項目名稱', () => expect(make('crossing_change').kindName, '自行口岸變更'));
  });

  group('文字', () {
    test('標記（托管）：說顧問會再核對', () => expect(make('inspection_done').intro, '你自己辦好了驗車？在這裏標記，資料立即生效，你的顧問會再核對。'));
    test('標記（自管）：不提顧問', () {
      selfManaged();
      expect(make('inspection_done').intro, '你自己辦好了驗車？在這裏標記，資料立即生效。');
    });
    test('不再續期的引言', () => expect(make('stop_renewal').intro, startsWith('決定不再續期這個兩地牌')));
    test('變更（托管）：提 7 天內更新', () {
      expect(make('renewal').intro, '你自己辦好了續期？在這裏一次更新，資料立即生效，你的顧問會再核對。自行辦理的變更，請在辦好後 7 天內更新。');
    });
    test('拍卡提示：自管換車不提顧問', () {
      selfManaged();
      expect(make('vehicle_change').cardHint, '換車後批文卡上的港澳車牌會改變，請拍下新卡正反面。');
    });
    test('拍卡提示：口岸變更', () => expect(make('crossing_change').cardHint, '拍下新卡正面，系統會讀出新的通行口岸。'));
    test('拍卡提示：不拍卡的項目照舊是 undefined', () => expect(make('stop_renewal').cardHint, 'undefined'));
    test('相片標籤：備案', () => expect(make('filing_done').photoLabel, '備案回執相片'));
    test('相片標籤：不再續期照舊是 undefined', () => expect(make('stop_renewal').photoLabel, 'undefined'));
    test('按鈕文字：不再續期、標記、變更各一款', () {
      expect(make('stop_renewal').submitText, '確認不再續期');
      expect(make('tax_paid').submitText, '標記已辦好');
      expect(make('renewal').submitText, '提交更新');
    });
    test('完成提示（托管）', () {
      expect(make('stop_renewal').doneToast, '已記錄，顧問會聯絡你');
      expect(make('tax_paid').doneToast, '已標記辦好，顧問會再核對');
      expect(make('renewal').doneToast, '已更新，顧問會再核對');
    });
    test('完成提示（自管）', () {
      selfManaged();
      expect(make('stop_renewal').doneToast, '已記錄');
      expect(make('tax_paid').doneToast, '已標記辦好');
      expect(make('renewal').doneToast, '已更新');
    });
    test('目前車輛：有的才寫', () => expect(make('vehicle_change', form: {'vehicle': {'plate': 'AB123', 'brand': '豐田', 'model': ''}}).currentVehicle, 'AB123 · 豐田'));
  });

  group('預先填入：口岸變更', () {
    test('新卡讀出不同口岸：填入', () {
      final f = make('crossing_change', form: {'card': {'crossing': '深圳灣'}, 'cardBefore': {'crossing': '皇崗'}})..fillDefaults();
      expect(f.cardText['crossing'], '深圳灣');
    });
    test('新卡口岸和原來一樣：不填', () {
      final f = make('crossing_change', form: {'card': {'crossing': '皇崗'}, 'cardBefore': {'crossing': '皇崗'}})..fillDefaults();
      expect(f.cardText['crossing'], '');
    });
    test('已自己填了：不覆蓋', () {
      final f = make('crossing_change', form: {'card': {'crossing': '深圳灣'}, 'cardBefore': {}});
      f.cardText['crossing'] = '港珠澳大橋';
      f.fillDefaults();
      expect(f.cardText['crossing'], '港珠澳大橋');
    });
  });

  group('預先填入：商號變更和補領', () {
    test('商號變更：填入卡上的商號和內承單位', () {
      final f = make('company_change', form: {'card': {'company': '新公司', 'contractor': '內承'}})..fillDefaults();
      expect((f.cardText['company'], f.cardText['contractor']), ('新公司', '內承'));
    });
    test('補領：流水號只在改變時填，編號照卡填', () {
      final f = make('replacement', form: {'card': {'serial': 'S1', 'cardNumber': 'C1'}, 'cardBefore': {'serial': 'S1'}})..fillDefaults();
      expect((f.cardText['serial'], f.cardText['cardNumber']), ('', 'C1'));
    });
  });

  group('預先填入：換車', () {
    test('網址帶新車牌：優先用', () {
      final f = make('vehicle_change', query: {'newPlate': 'NEW1'}, form: {'card': {'localPlate': 'CARD1'}, 'vehicle': {'plate': 'OLD1'}})..fillDefaults();
      expect(f.vehicle['plate'], 'NEW1');
    });
    test('新卡港澳車牌不同於原車：填入', () {
      final f = make('vehicle_change', form: {'card': {'localPlate': 'CARD1'}, 'vehicle': {'plate': 'OLD1'}})..fillDefaults();
      expect(f.vehicle['plate'], 'CARD1');
    });
    test('新卡車牌和原車一樣：不填', () {
      final f = make('vehicle_change', form: {'card': {'localPlate': 'OLD1'}, 'vehicle': {'plate': 'OLD1'}})..fillDefaults();
      expect(f.vehicle['plate'], '');
    });
    test('車輛日期按表單列出，保留已填的', () {
      final f = make('vehicle_change', form: {'vehicleDates': [{'code': 'insurance'}, {'code': 'license'}]});
      f.dates = {'insurance': '2027-01-01', 'gone': 'x'};
      f.fillDefaults();
      expect(f.dates, {'insurance': '2027-01-01', 'license': ''});
    });
  });

  group('預先填入：續期', () {
    Map<String, dynamic> renewalForm(String read, String original) => {
          'renewalDocuments': [{'code': 'approval'}, {'code': 'hk_permit'}],
          'card': {'validTo': read},
          'cardBefore': {'validTo': original},
        };
    test('新卡有效期比原來和今天晚：預先勾選批文並填日期', () {
      final f = make('renewal', form: renewalForm('2028-01-01', '2027-01-01'))..fillDefaults();
      expect(f.renewal['approval']!.done, isTrue);
      expect(f.renewal['approval']!.expiresOn, '2028-01-01');
      expect(f.renewal['hk_permit']!.done, isFalse);
    });
    test('新卡有效期和原來一樣：不填（不可把舊日期當新日期）', () {
      final f = make('renewal', form: renewalForm('2027-01-01', '2027-01-01'))..fillDefaults();
      expect(f.renewal['approval']!.done, isFalse);
    });
    test('新卡有效期不晚於今天：不填', () {
      final f = make('renewal', form: renewalForm('2026-11-01', '2026-01-01'))..fillDefaults();
      expect(f.renewal['approval']!.expiresOn, '');
    });
    test('沒有原來的有效期：不填', () {
      final f = make('renewal', form: renewalForm('2028-01-01', ''))..fillDefaults();
      expect(f.renewal['approval']!.done, isFalse);
    });
    test('已自己填了批文日期：不覆蓋', () {
      final f = make('renewal', form: renewalForm('2028-01-01', '2027-01-01'));
      f.renewal = {'approval': const RenewalDraft(done: true, expiresOn: '2029-01-01')};
      f.fillDefaults();
      expect(f.renewal['approval']!.expiresOn, '2029-01-01');
    });
    test('取消勾選：清掉日期', () {
      final f = make('renewal')..setRenewalDate('approval', '2028-01-01');
      f.setDone('approval', true);
      expect(f.renewal['approval']!.expiresOn, '2028-01-01');
      f.setDone('approval', false);
      expect((f.renewal['approval']!.done, f.renewal['approval']!.expiresOn), (false, ''));
    });
  });

  group('預先填入：換司機', () {
    test('新卡駕駛人和現有不同：用卡上的，第一個是主', () {
      final f = make('driver_change', form: {'drivers': [{'name': '甲', 'role': '主'}], 'card': {'drivers': ['乙', '丙']}})..fillDefaults();
      expect(f.drivers.map((d) => (d.name, d.role)), [('乙', '主'), ('丙', '副')]);
    });
    test('新卡駕駛人和現有一樣：用現有的', () {
      final f = make('driver_change', form: {'drivers': [{'name': '甲', 'role': '副'}], 'card': {'drivers': ['甲']}})..fillDefaults();
      expect(f.drivers.map((d) => (d.name, d.role)), [('甲', '副')]);
    });
    test('都沒有：一個空白的主司機', () {
      final f = make('driver_change', form: {})..fillDefaults();
      expect(f.drivers.map((d) => (d.name, d.role)), [('', '主')]);
    });
    test('已有草稿：不重設', () {
      final f = make('driver_change', form: {'card': {'drivers': ['乙']}});
      f.drivers = [DriverDraft(name: '我填的')];
      f.fillDefaults();
      expect(f.drivers.single.name, '我填的');
    });
    test('設為主司機：其他人改為副', () {
      final f = make('driver_change')..drivers = [DriverDraft(name: 'a'), DriverDraft(name: 'b', role: '副')];
      f.setMain(1);
      expect(f.drivers.map((d) => d.role), ['副', '主']);
    });
    test('加司機：已有主司機就加副', () {
      final f = make('driver_change')..drivers = [DriverDraft(name: 'a')];
      f.addDriver();
      expect(f.drivers.last.role, '副');
    });
    test('加司機：沒有主司機就加主', () {
      final f = make('driver_change')..drivers = [DriverDraft(name: 'a', role: '副')];
      f.addDriver();
      expect(f.drivers.last.role, '主');
    });
  });

  group('提交前檢查', () {
    test('換車沒填車牌', () => expect(make('vehicle_change').problem(0), '請填寫新車車牌'));
    test('換車車牌只有空白', () {
      final f = make('vehicle_change');
      f.vehicle['plate'] = '  ';
      expect(f.problem(0), '請填寫新車車牌');
    });
    test('續期沒選文件', () => expect(make('renewal').problem(0), '請選出已續期的文件'));
    test('續期選了文件沒填日期', () => expect((make('renewal')..setDone('approval', true)).problem(0), '請填寫已續期文件的新到期日'));
    test('續期填好：可以提交', () {
      final f = make('renewal')..setDone('approval', true);
      f.setRenewalDate('approval', '2028-01-01');
      expect(f.problem(0), '');
    });
    test('換司機有空白姓名', () => expect((make('driver_change')..drivers = [DriverDraft(name: ' ')]).problem(0), '請填寫司機姓名'));
    test('不再續期沒選原因', () => expect(make('stop_renewal').problem(0), '請選擇不再續期的原因'));
    test('口岸變更沒填口岸', () => expect(make('crossing_change').problem(0), '請填寫新的通行口岸'));
    test('商號變更兩項都空', () => expect(make('company_change').problem(0), '請填寫新的商號或內承單位'));
    test('商號變更只填內承單位：可以提交', () {
      final f = make('company_change');
      f.cardText['contractor'] = '內承';
      expect(f.problem(0), '');
    });
    test('補領沒填流水號', () => expect(make('replacement').problem(0), '請填寫新卡的卡面流水號'));
    test('標記沒附相片', () => expect(make('tax_paid').problem(0), '請附上行車稅繳費收據相片'));
    test('標記附了相片：可以提交', () => expect(make('tax_paid').problem(1), ''));
  });

  group('提交內容', () {
    test('不再續期：原因和備註，不送相片', () {
      final f = make('stop_renewal')
        ..stopReason = '已賣車'
        ..stopNote = '';
      expect(f.body(['x']), {'kind': 'stop_renewal', 'handledOn': '2026-11-21', 'reason': '已賣車', 'note': ''});
    });
    test('換車：車輛資料和有填的日期', () {
      final f = make('vehicle_change');
      f.vehicle['plate'] = 'NEW1';
      f.dates = {'insurance': '2027-01-01', 'license': ''};
      final b = f.body(['p']);
      expect(b['photos'], ['p']);
      expect((b['vehicle'] as Map)['plate'], 'NEW1');
      expect(b['dates'], {'insurance': '2027-01-01'});
    });
    test('標記：送期數', () {
      final f = make('filing_done', query: {'period': '2026'});
      expect(f.body([]), {'kind': 'filing_done', 'handledOn': '2026-11-21', 'photos': [], 'period': '2026'});
    });
    test('口岸變更：沒填禁區紙到期日就不送', () {
      final f = make('crossing_change');
      f.cardText['crossing'] = '深圳灣';
      expect(f.body([]).containsKey('crpExpiresOn'), isFalse);
      f.cardText['crpExpiresOn'] = '2027-05-01';
      expect(f.body([])['crpExpiresOn'], '2027-05-01');
    });
    test('商號變更：只送有填的一項', () {
      final f = make('company_change');
      f.cardText['company'] = '新公司';
      f.cardText['contractor'] = ' ';
      final b = f.body([]);
      expect(b['company'], '新公司');
      expect(b.containsKey('contractor'), isFalse);
    });
    test('補領：沒填編號就不送編號', () {
      final f = make('replacement');
      f.cardText['serial'] = 'S2';
      final b = f.body([]);
      expect(b['serial'], 'S2');
      expect(b.containsKey('cardNumber'), isFalse);
    });
    test('續期：每份文件的勾選和日期；批文已續期才送新批文備案', () {
      final f = make('renewal')
        ..renewal = {'approval': const RenewalDraft(done: true, expiresOn: '2028-01-01'), 'hk_permit': const RenewalDraft()}
        ..filingDone = true;
      final b = f.body([]);
      expect(b['documents'], {'approval': {'done': true, 'expiresOn': '2028-01-01'}, 'hk_permit': {'done': false}});
      expect(b['newCardFiling'], isTrue);
    });
    test('續期：批文沒勾選就不送新批文備案', () {
      final f = make('renewal')..renewal = {'hk_permit': const RenewalDraft(done: true, expiresOn: '2027-01-01')};
      expect(f.body([]).containsKey('newCardFiling'), isFalse);
    });
    test('換司機：每人的姓名、角色、電話和有填的日期', () {
      final f = make('driver_change')..drivers = [DriverDraft(name: '甲', phone: '123', dates: {'license': '2028-01-01', 'permit': ''})];
      expect(f.body([])['drivers'], [
        {'name': '甲', 'role': '主', 'phone': '123', 'dates': {'license': '2028-01-01'}},
      ]);
    });
  });
}
