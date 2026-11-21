// 階段 3a 各頁的計算（index_logic、vehicles_logic、companies_logic、到期提醒、通知、我的、顧問卡）：一個情況一個測試。
// 結果照 mobile/src 對應頁面的 JavaScript。
import 'package:dualplate/business/advisor_card.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/pages/companies/companies_logic.dart';
import 'package:dualplate/pages/deadlines/deadlines_page.dart';
import 'package:dualplate/pages/index/index_logic.dart';
import 'package:dualplate/pages/me/me_page.dart';
import 'package:dualplate/pages/notifications/notifications_page.dart';
import 'package:dualplate/pages/vehicles/vehicles_logic.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> dl(String level, {String handledBy = 'you', String code = 'hk_br', bool markable = false, String ownerLabel = '李氏公司', String? period}) => {
      'code': code,
      'name': '香港商業登記證',
      'level': level,
      'handledBy': handledBy,
      'ownerId': 'o1',
      'ownerLabel': ownerLabel,
      'markable': markable,
      'period': ?period,
      'dueOn': '2026-12-16',
      'daysLeft': 25,
    };

void custody() => Session.debugSet(token: 't', user: {'id': 'u1'}, mode: '托管');
void selfManaged() => Session.debugSet(token: 't', user: {'id': 'u1'}, mode: '自管');

void main() {
  setUp(custody);

  group('首頁待辦', () {
    test('初始資料四個數字都是 0', () {
      expect(emptyOverview()['counts'], {'pending': 0, 'ok': 0, 'due': 0, 'overdue': 0});
    });

    test('你自理而快到期：算待辦', () {
      expect(clientAction(dl('due')), true);
    });

    test('你自理而已逾期：算待辦', () {
      expect(clientAction(dl('overdue')), true);
    });

    test('你自理但還未快到期：不算', () {
      expect(clientAction(dl('upcoming')), false);
    });

    test('我們負責的快到期：不算', () {
      expect(clientAction(dl('due', handledBy: 'us')), false);
    });

    test('90 天過關即使我們負責也算（要你過關）', () {
      expect(clientAction(dl('due', handledBy: 'us', code: 'crossing_90')), true);
    });

    test('次序：要你提供的資料、到期事項、未讀通知', () {
      final list = todoList(
        {'todos': [{'title': '提供文件', 'subtitle': '粵ZA100港', 'requestId': 'r1'}], 'deadlines': [dl('due')]},
        [{'id': 'n1', 'kind': 'attachment', 'title': '文件需重交', 'body': '請重新上傳', 'read': false}],
      );
      expect(list.map((t) => t.title).toList(), ['提供文件', '香港商業登記證', '文件需重交']);
    });

    test('要你提供的資料一律標為緊急', () {
      final list = todoList({'todos': [{'title': 'x', 'subtitle': 'y'}], 'deadlines': []}, []);
      expect(list.single.urgent, true);
    });

    test('到期事項只有已逾期才緊急', () {
      final list = todoList({'todos': [], 'deadlines': [dl('due'), dl('overdue')]}, []);
      expect(list.map((t) => t.urgent).toList(), [false, true]);
    });

    test('90 天過關的說明：過關後按「今天已過關」', () {
      final list = todoList({'todos': [], 'deadlines': [dl('due', code: 'crossing_90', ownerLabel: '粵ZI156港 · ST1296')]}, []);
      expect(list.single.subtitle, '粵ZI156港 · ST1296 · 過關後按「今天已過關」');
    });

    test('可標記辦好的說明：辦好後按「已辦好」', () {
      final list = todoList({'todos': [], 'deadlines': [dl('due', markable: true)]}, []);
      expect(list.single.subtitle, '李氏公司 · 辦好後按「已辦好」');
    });

    test('其他到期事項的說明：請你自行辦理', () {
      final list = todoList({'todos': [], 'deadlines': [dl('due')]}, []);
      expect(list.single.subtitle, '李氏公司 · 請你自行辦理');
    });

    test('沒有所屬時說明只寫動作', () {
      final list = todoList({'todos': [], 'deadlines': [dl('due', ownerLabel: '')]}, []);
      expect(list.single.subtitle, '請你自行辦理');
    });

    test('到期事項的 key 包括期數', () {
      final list = todoList({'todos': [], 'deadlines': [dl('due', period: '2026')]}, []);
      expect(list.single.key, 'dhk_bro12026');
    });

    test('已讀的通知不算待辦', () {
      final list = todoList({'todos': [], 'deadlines': []}, [{'id': 'n1', 'kind': 'attachment', 'title': 't', 'read': true}]);
      expect(list, isEmpty);
    });

    test('只是告知的通知（到期提醒）不算待辦', () {
      final list = todoList({'todos': [], 'deadlines': []}, [{'id': 'n1', 'kind': 'deadline', 'title': 't', 'read': false}]);
      expect(list, isEmpty);
    });

    test('自辦更新被退回的通知算待辦', () {
      final list = todoList({'todos': [], 'deadlines': []}, [{'id': 'n1', 'kind': 'self_handled_returned', 'title': '退回', 'body': '請補充', 'read': false}]);
      expect([list.single.title, list.single.subtitle, list.single.urgent], ['退回', '請補充', true]);
    });

    test('鈴鐺數字：100 則寫 99+', () {
      expect(bellCount(100), '99+');
    });

    test('鈴鐺數字：99 則照寫', () {
      expect(bellCount(99), '99');
    });

    test('沒有值時顯示空白（Vue 的 {{ undefined }}）', () {
      expect(shown(null), '');
    });
  });

  group('我的牌照', () {
    test('健康狀態：未填到期日的牌照，自管寫「未填到期日」', () {
      selfManaged();
      expect(healthLabelOf('pending'), '未填到期日');
    });

    test('健康狀態：未填到期日的牌照，托管寫「資料整理中」', () {
      expect(healthLabelOf('pending'), '資料整理中');
    });

    test('健康狀態顏色：快到期橙、已逾期紅、未填灰、正常綠', () {
      expect(['due', 'overdue', 'pending', 'ok'].map(healthToneOf).toList(), ['amber', 'red', 'gray', '']);
    });

    test('下一件事的顏色：逾期紅、快到期橙、即將到期綠、正常灰', () {
      expect(['overdue', 'due', 'upcoming', 'ok', 'x'].map(noteToneOf).toList(), ['note-red', 'note-amber', 'note-green', 'note-gray', '']);
    });

    test('用途：出租中寫承租人', () {
      expect(usageText({'rental': {'renter': '承租人甲'}}), '出租：承租人甲');
    });

    test('用途：未上牌算空置', () {
      expect(usageText({'installationStatus': '未上牌'}), '空置');
    });

    test('用途：暫停使用算空置', () {
      expect(usageText({'usageStatus': '暫停使用'}), '空置');
    });

    test('用途：自用', () {
      expect(usageText({'usageStatus': '自用'}), '自用');
    });

    test('用途未知：自管寫「未填用途」', () {
      selfManaged();
      expect(usageText({}), '未填用途');
    });

    test('用途未知：托管寫「使用狀況確認中」', () {
      expect(usageText({}), '使用狀況確認中');
    });

    final summaries = [
      {'mainlandPlate': '粵ZA100港', 'localPlate': 'AB1000', 'health': 'overdue', 'usageStatus': '自用', 'holder': '李氏1貿易'},
      {'mainlandPlate': '粵ZB107港', 'localPlate': 'CD1037', 'health': 'ok', 'usageStatus': '自用', 'rental': {'renter': '甲'}},
      {'mainlandPlate': '粵ZC114港', 'localPlate': null, 'health': 'due', 'installationStatus': '未上牌', 'cardNumber': 'GD2025002'},
    ];

    test('篩選數目：全部、需注意、出租中、自用、空置', () {
      expect(plateFilters(summaries).map((f) => '${f.name}${f.count}').toList(), ['全部3', '需注意2', '出租中1', '自用1', '空置1']);
    });

    test('數目為零的篩選不顯示', () {
      expect(shownFilters(summaries.take(1).toList(), '').map((f) => f.id).toList(), ['', 'attention', 'self']);
    });

    test('目前選中的篩選即使數目為零仍顯示', () {
      expect(shownFilters(summaries.take(1).toList(), 'idle').map((f) => f.id).toList(), ['', 'attention', 'self', 'idle']);
    });

    test('按篩選列出', () {
      expect(visiblePlates(summaries, 'attention', '').length, 2);
    });

    test('搜尋不分大小寫，包括香港車牌', () {
      expect(visiblePlates(summaries, '', 'cd10').single['mainlandPlate'], '粵ZB107港');
    });

    test('搜尋批文卡編號', () {
      expect(visiblePlates(summaries, '', 'gd2025002').single['mainlandPlate'], '粵ZC114港');
    });

    test('搜尋前後空白不算', () {
      expect(visiblePlates(summaries, '', '  李氏1 ').length, 1);
    });

    test('首頁按「正常」看全部、按「快到期」「已逾期」看需注意', () {
      expect([plateFilterPresets['ok'], plateFilterPresets['due'], plateFilterPresets['overdue']], ['', 'attention', 'attention']);
    });

    test('列表卡第二行：有持牌公司寫公司', () {
      expect(plateSubline(summaries[0]), '李氏1貿易 · 自用');
    });

    test('列表卡第二行：沒有持牌公司寫路線兩地牌', () {
      expect(plateSubline({'route': '粵港', 'usageStatus': '自用'}), '粵港兩地牌 · 自用');
    });

    test('預覽：上牌狀態待核對時，托管寫「確認中」', () {
      expect(installText({'installation_status': '待核對'}), '確認中');
    });

    test('預覽：上牌狀態待核對時，自管寫「未填寫」', () {
      selfManaged();
      expect(installText({'installation_status': '待核對'}), '未填寫');
    });

    test('預覽：出租中的使用狀態寫「使用安排中」', () {
      expect(usageStatusText({'usage_status': '出租中'}), '使用安排中');
    });

    test('預覽：沒有批文卡編號，托管寫「待核對」', () {
      expect(cardNumberText({}), '待核對');
    });

    test('預覽：沒有批文卡編號，自管寫「未填寫」', () {
      selfManaged();
      expect(cardNumberText({}), '未填寫');
    });
  });

  group('我的公司', () {
    test('報帳：已完成而零申報寫「零申報」', () {
      expect(filingWord({'status': '已完成', 'zeroFiling': true}), '零申報');
    });

    test('報帳：已完成寫「已完成」', () {
      expect(filingWord({'status': '已完成'}), '已完成');
    });

    test('報帳：會計處理中寫「辦理中」', () {
      expect(filingWord({'status': '會計處理中'}), '辦理中');
    });

    test('報帳：公司已註銷寫「不需申報」', () {
      expect(filingWord({'status': '公司已註銷'}), '不需申報');
    });

    test('報帳：未開始寫「待交資料」', () {
      expect(filingWord({'status': '未開始'}), '待交資料');
    });

    test('報帳顏色：辦好綠、註銷灰、未開始橙、辦理中藍', () {
      expect(['已申報', '公司已註銷', '未開始', '資料已收'].map((s) => filingTone({'status': s})).toList(), ['', 'gray', 'amber', 'blue']);
    });

    test('報帳月份去掉前面的 0', () {
      expect(filingMonth({'period': '2026-09'}), '9月');
    });

    test('報帳月份：11 月', () {
      expect(filingMonth({'period': '2026-11'}), '11月');
    });

    test('登記號碼名稱按註冊地', () {
      expect(['內地', '澳門', '香港'].map((j) => regLabel({'jurisdiction': j})).toList(), ['統一社會信用代碼', '商業登記編號', '商業登記號碼']);
    });

    test('牌照標籤拆成兩塊車牌', () {
      expect(plateParts('粵ZA100港 · AB1000'), ['粵ZA100港', 'AB1000']);
    });

    test('牌照標籤裏「待補充」的部分不顯示', () {
      expect(plateParts('粵ZA100港 · 待補充'), ['粵ZA100港']);
    });

    test('提示改寫：本頁就是「我的公司」', () {
      expect(companyHint('請在「我的公司」補上註冊地址'), '請按「修改公司資料」補上註冊地址');
    });

    test('待核對：指定欄位時只看那個欄位', () {
      final pending = [{'entityType': 'company', 'entityId': 'c1', 'field': 'date:hk_br'}];
      expect([isPendingIn(pending, 'company', 'c1', 'date:hk_br'), isPendingIn(pending, 'company', 'c1', 'date:hk_nar1')], [true, false]);
    });

    test('待核對：不指定欄位時任何欄位都算', () {
      expect(isPendingIn([{'entityType': 'company', 'entityId': 'c1', 'field': 'name'}], 'company', 'c1'), true);
    });

    test('待核對：別的公司不算', () {
      expect(isPendingIn([{'entityType': 'company', 'entityId': 'c2', 'field': 'name'}], 'company', 'c1'), false);
    });
  });

  group('到期提醒', () {
    final items = [
      {'ownerType': 'plate', 'name': 'a'},
      {'ownerType': 'company', 'name': 'b'},
      {'ownerType': 'vehicle', 'name': 'c'},
    ];

    test('「全部」列出全部', () {
      expect(visibleDeadlines(items, '').length, 3);
    });

    test('按類別篩選', () {
      expect(visibleDeadlines(items, 'company').single['name'], 'b');
    });

    test('第二行：所屬加白話補充說明', () {
      expect(deadlineSubline({'ownerLabel': '粵ZJ163港 · UV1333', 'detail': '批文有效期開始 2026-09-17'}), '粵ZJ163港 · UV1333 · 由批文生效日 2026-09-17 起計');
    });

    test('第二行：沒有補充說明時只寫所屬', () {
      expect(deadlineSubline({'ownerLabel': 'ST1296', 'detail': ''}), 'ST1296');
    });
  });

  group('通知', () {
    final now = DateTime.utc(2026, 11, 21, 10);

    test('不到一天：今天', () {
      expect(noticeDay('2026-11-21T05:00:00.000Z', now), '今天');
    });

    test('一天到兩天：昨天', () {
      expect(noticeDay('2026-11-20T05:00:00.000Z', now), '昨天');
    });

    test('更早：寫日期（原文前 10 個字）', () {
      expect(noticeDay('2026-11-10T05:00:00.000Z', now), '2026-11-10');
    });

    test('時間解析不了：寫原文前 10 個字', () {
      expect(noticeDay('not a date at all', now), 'not a date');
    });

    test('相鄰同一天的放一組', () {
      final groups = noticeGroups([
        {'createdAt': '2026-11-21T05:00:00.000Z'},
        {'createdAt': '2026-11-21T04:00:00.000Z'},
        {'createdAt': '2026-11-10T05:00:00.000Z'},
      ], now);
      expect(groups.map((g) => '${g.label}:${g.items.length}').toList(), ['今天:2', '2026-11-10:1']);
    });

    test('類別名稱：沒有對應的寫「通知」', () {
      expect([noticeKindLabel['rental'], noticeKindLabel['xyz'] ?? '通知'], ['出租', '通知']);
    });
  });

  group('我的', () {
    test('只用手機號碼開通的帳戶不顯示佔位電郵', () {
      expect(accountText({'email': '85291234567@phone.invalid'}), '以手機號碼登入');
    });

    test('一般帳戶顯示電郵', () {
      expect(accountText({'email': 'li@demo.local'}), 'li@demo.local');
    });

    test('辦理記錄的車牌用內地車牌', () {
      expect(plateOfRequest({'plate_asset_id': 'p1'}, [{'id': 'p1', 'mainland_plate': '粵ZA100港'}]), '粵ZA100港');
    });

    test('辦理記錄找不到牌照時不顯示車牌', () {
      expect(plateOfRequest({'plate_asset_id': 'p9'}, [{'id': 'p1', 'mainland_plate': '粵ZA100港'}]), '');
    });
  });

  group('顧問卡', () {
    test('有名字、電話或微信其中一樣就顯示', () {
      expect([AdvisorCard.hasAdvisor({'name': '', 'phone': '+852 9123 4567', 'wechat': ''}), AdvisorCard.hasAdvisor({'name': '', 'phone': '', 'wechat': ''})], [true, false]);
    });

    test('沒有顧問資料：有佔位時仍顯示（「我的」頁），首頁不顯示', () {
      expect([AdvisorCard.shows(null, true), AdvisorCard.shows(null, false)], [true, false]);
    });
  });
}
