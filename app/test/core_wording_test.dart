// 用語工具（lib/core/wording.dart）：每個期望值都是把 mobile/src/lib/api.js 的同名函數在 node 裏跑出來的結果
// （香港時區，2026-11-15；做法見 1d 報告）。一個情況一個測試，失敗時直接看出是哪一項。
import 'package:dualplate/core/session.dart';
import 'package:dualplate/core/wording.dart';
import 'package:flutter_test/flutter_test.dart';

void custody() => Session.debugSet(token: 't', user: {}, mode: '托管');
void selfMode() => Session.debugSet(token: 't', user: {}, mode: '自管');
void userSelf() => Session.debugSet(token: 't', user: {'serviceMode': '自管'});
void signedOut() => Session.debugSet();

void main() {
  tearDown(signedOut);

  group('isSelfManaged', () {
    test('托管客戶', () { custody(); expect(isSelfManaged(), false); });
    test('首頁記下自管', () { selfMode(); expect(isSelfManaged(), true); });
    test('未記下時看登入的 user.serviceMode', () { userSelf(); expect(isSelfManaged(), true); });
    test('未登入', () { signedOut(); expect(isSelfManaged(), false); });
    test('記下的托管優先於 user 的自管', () { Session.debugSet(token: 't', user: {'serviceMode': '自管'}, mode: '托管'); expect(isSelfManaged(), false); });
    test('記下空字串時看 user', () { Session.debugSet(token: 't', user: {'serviceMode': '自管'}, mode: ''); expect(isSelfManaged(), true); });
  });

  group('unsetWord', () {
    test('托管：確認中', () { custody(); expect(unsetWord(), '確認中'); });
    test('自管：未填寫', () { selfMode(); expect(unsetWord(), '未填寫'); });
    test('未登入：確認中', () { signedOut(); expect(unsetWord(), '確認中'); });
  });

  group('noDatesWord', () {
    test('托管：資料整理中', () { custody(); expect(noDatesWord(), '資料整理中'); });
    test('自管：未填到期日', () { selfMode(); expect(noDatesWord(), '未填到期日'); });
  });

  group('forMode', () {
    test('托管用第一句', () { custody(); expect(forMode('托管句', '自管句'), '托管句'); });
    test('自管用第二句', () { selfMode(); expect(forMode('托管句', '自管句'), '自管句'); });
    test('只有 user.serviceMode 是自管', () { userSelf(); expect(forMode('托管句', '自管句'), '自管句'); });
  });

  group('canEntrust', () {
    test('托管：自己辦的也不能委託', () { custody(); expect(canEntrust({'handledBy': 'you', 'code': 'approval'}), false); });
    test('自管：自己辦的可以委託', () { selfMode(); expect(canEntrust({'handledBy': 'you', 'code': 'approval'}), true); });
    test('自管：90 天過關不能委託', () { selfMode(); expect(canEntrust({'handledBy': 'you', 'code': 'crossing_90'}), false); });
    test('自管：我們辦的不能委託', () { selfMode(); expect(canEntrust({'handledBy': 'us', 'code': 'approval'}), false); });
    test('自管：空項目', () { selfMode(); expect(canEntrust({}), false); });
  });

  group('showSelfTag', () {
    test('托管：自己辦的標「自行辦理」', () { custody(); expect(showSelfTag({'handledBy': 'you'}), true); });
    test('托管：我們辦的不標', () { custody(); expect(showSelfTag({'handledBy': 'us'}), false); });
    test('自管：全部不標', () { selfMode(); expect(showSelfTag({'handledBy': 'you'}), false); });
    test('空項目不標', () { custody(); expect(showSelfTag({}), false); });
  });

  group('entrustPath', () {
    test('批文續期，有牌照', () => expect(entrustPath({'code': 'approval', 'name': '批文續期', 'plateId': 'p1'}), '/requests?entrust=item&service=renewal&item=%E6%89%B9%E6%96%87%E7%BA%8C%E6%9C%9F&plate=p1'));
    test('澳門驗車，沒有牌照', () => expect(entrustPath({'code': 'mo_inspection', 'name': '澳門驗車'}), '/requests?entrust=item&service=inspection&item=%E6%BE%B3%E9%96%80%E9%A9%97%E8%BB%8A'));
    test('沒有對應的服務用 other，名稱編碼', () => expect(entrustPath({'code': 'xyz', 'name': 'A&B 牌'}), '/requests?entrust=item&service=other&item=A%26B%20%E7%89%8C'));
    test('沒有名稱寫 undefined（和現有 App 一樣）', () => expect(entrustPath({'code': 'customs_filing'}), '/requests?entrust=item&service=filing&item=undefined'));
    test('長期委託', () => expect(longTermPath, '/requests?entrust=long'));
  });

  group('platePath、requestPath', () {
    test('牌照詳情，編碼空格', () => expect(platePath('p 1'), '/plate-detail?id=p%201'));
    test('辦理，有牌照', () => expect(requestPath('renewal', 'p2'), '/requests?service=renewal&plate=p2'));
    test('辦理，沒有服務', () => expect(requestPath(null), '/requests?service='));
    test('辦理，空字串', () => expect(requestPath('', ''), '/requests?service='));
  });

  group('levelLabel、levelTone', () {
    test('已逾期紅', () => expect([levelLabel['overdue'], levelTone['overdue']], ['已逾期', 'red']));
    test('快到期橙', () => expect([levelLabel['due'], levelTone['due']], ['快到期', 'amber']));
    test('即將到期無色', () => expect([levelLabel['upcoming'], levelTone['upcoming']], ['即將到期', '']));
    test('正常無色', () => expect([levelLabel['ok'], levelTone['ok']], ['正常', '']));
    test('不認識的狀態沒有文字', () => expect(levelLabel['missing'], isNull));
  });

  group('daysText', () {
    test('沒有天數', () => expect(daysText({}), ''));
    test('天數是 null', () => expect(daysText({'daysLeft': null}), ''));
    test('還有 5 天', () => expect(daysText({'daysLeft': 5}), '還有 5 天'));
    test('今天到期', () => expect(daysText({'daysLeft': 0}), '今天到期'));
    test('逾期 3 天', () => expect(daysText({'daysLeft': -3}), '逾期 3 天'));
    test('字串 7', () => expect(daysText({'daysLeft': '7'}), '還有 7 天'));
    test('字串 -2', () => expect(daysText({'daysLeft': '-2'}), '逾期 2 天'));
    test('字串 0 不算今天（JS 用 ===）', () => expect(daysText({'daysLeft': '0'}), '還有 0 天'));
    test('小數', () => expect(daysText({'daysLeft': 1.5}), '還有 1.5 天'));
  });

  test('selfHandled', () => expect(selfHandled, '自行辦理'));

  group('requestTone', () {
    test('需要你提供資料：橙', () => expect(requestTone('需要你提供資料'), 'amber'));
    test('辦理中：藍', () => expect(requestTone('辦理中'), 'blue'));
    test('已收到：藍', () => expect(requestTone('已收到'), 'blue'));
    test('已完成：灰', () => expect(requestTone('已完成'), 'gray'));
    test('已取消：灰', () => expect(requestTone('已取消'), 'gray'));
    test('其他狀態：藍', () => expect(requestTone('其他'), 'blue'));
    test('沒有狀態：藍', () => expect(requestTone(null), 'blue'));
    test('空字串：藍', () => expect(requestTone(''), 'blue'));
  });

  group('clientStage', () {
    test('托管：沒有步驟', () { custody(); expect(clientStage(null), '等待顧問受理'); });
    test('托管：空字串', () { custody(); expect(clientStage(''), '等待顧問受理'); });
    test('托管：待內部受理', () { custody(); expect(clientStage('待內部受理'), '等待顧問受理'); });
    test('托管：數字 0 當作沒有', () { custody(); expect(clientStage(0), '等待顧問受理'); });
    test('自管：沒有步驟', () { selfMode(); expect(clientStage(null), '等待我們受理'); });
    test('自管：待內部受理', () { selfMode(); expect(clientStage('待內部受理'), '等待我們受理'); });
    test('開頭的「客戶」改成「等你」', () { custody(); expect(clientStage('客戶提供文件'), '等你提供文件'); });
    test('中間的「客戶」不改', () { custody(); expect(clientStage('核對客戶資料'), '核對客戶資料'); });
    test('其他步驟照用', () { selfMode(); expect(clientStage('顧問核對'), '顧問核對'); });
    test('數字照寫', () { custody(); expect(clientStage(12), '12'); });
  });

  group('detailText', () {
    test('批文有效期開始（有空格）', () => expect(detailText('批文有效期開始 2026-01-02'), '由批文生效日 2026-01-02 起計'));
    test('批文有效期開始（沒空格）', () => expect(detailText('批文有效期開始2026-01-02'), '由批文生效日 2026-01-02 起計'));
    test('尾部多了空格不改', () => expect(detailText('批文有效期開始  2026-01-02 '), '批文有效期開始  2026-01-02 '));
    test('不在開頭不改', () => expect(detailText('另：批文有效期開始 2026-01-02'), '另：批文有效期開始 2026-01-02'));
    test('日期不是兩位數不改', () => expect(detailText('批文有效期開始 2026-1-2'), '批文有效期開始 2026-1-2'));
    test('其他說明照用', () => expect(detailText('其他說明'), '其他說明'));
    test('空字串', () => expect(detailText(''), ''));
    test('null', () => expect(detailText(null), ''));
    test('數字 0', () => expect(detailText(0), ''));
  });

  group('money', () {
    test('港幣整數', () => expect(money('HKD', 120000), r'HK$ 1,200'));
    test('人民幣有角分', () => expect(money('RMB', 123456), '¥ 1,234.56'));
    test('CNY 也是 ¥', () => expect(money('CNY', 5), '¥ 0.05'));
    test('澳門幣', () => expect(money('MOP', 100), 'MOP 1'));
    test('不認識的貨幣照寫代碼', () => expect(money('USD', 100), 'USD 1'));
    test('沒有貨幣：空字串', () => expect(money('', 100), '1'));
    test('沒有貨幣：null', () => expect(money(null, 100), '1'));
    test('負數有角分', () => expect(money(null, -150050), '-1,500.50'));
    test('金額 null', () => expect(money('HKD', null), r'HK$ 0'));
    test('金額空字串', () => expect(money('HKD', ''), r'HK$ 0'));
    test('金額不是數字', () => expect(money('HKD', 'abc'), r'HK$ NaN'));
    test('金額是字串', () => expect(money('HKD', '1250'), r'HK$ 12.50'));
    test('半分四捨五入', () => expect(money('HKD', 12.5), r'HK$ 0.13'));
    test('很小的負數', () => expect(money('HKD', -0.1), r'HK$ -0.00'));
    test('十億', () => expect(money('HKD', 100000000000), r'HK$ 1,000,000,000'));
    test('無限大', () => expect(money('HKD', double.infinity), r'HK$ ∞'));
    test('半分', () => expect(money('HKD', 0.5), r'HK$ 0.01'));
    test('負一分', () => expect(money('HKD', -1), r'HK$ -0.01'));
  });

  group('plateName', () {
    test('內地牌和香港牌', () => expect(plateName({'mainlandPlate': '粵ZA123港', 'localPlate': 'HK1234'}), '粵ZA123港 · HK1234'));
    test('底線寫法的欄位', () => expect(plateName({'mainland_plate': '粵ZB456澳', 'local_plate': 'MA1234'}), '粵ZB456澳 · MA1234'));
    test('只有內地牌', () => expect(plateName({'mainlandPlate': '粵ZA123港'}), '粵ZA123港'));
    test('只有香港牌', () => expect(plateName({'localPlate': 'HK1'}), 'HK1'));
    test('都沒有', () => expect(plateName({}), '車牌待補充'));
    test('駝峰欄位空白時用底線欄位', () => expect(plateName({'mainlandPlate': '', 'mainland_plate': 'X1'}), 'X1'));
    test('數字 0 略去、數字照寫', () => expect(plateName({'mainlandPlate': 0, 'localPlate': 123}), '123'));
  });

  group('friendlyDate', () {
    test('純日期照用', () => expect(friendlyDate('2026-11-15'), '2026-11-15'));
    test('UTC 15:59 是香港前一天', () => expect(friendlyDate('2026-11-14T15:59:59.000Z'), '2026-11-14'));
    test('UTC 16:00 是香港翌日', () => expect(friendlyDate('2026-11-14T16:00:00.000Z'), '2026-11-15'));
    test('有時區 +08:00', () => expect(friendlyDate('2026-11-15T03:00:00+08:00'), '2026-11-15'));
    test('有時區 +0800', () => expect(friendlyDate('2026-11-15T03:00:00+0800'), '2026-11-15'));
    test('不是日期：取前 10 個字', () => expect(friendlyDate('not a date'), 'not a date'));
    test('不是日期：長字串截斷', () => expect(friendlyDate('待補資料，請稍後再看看'), '待補資料，請稍後再看'));
    test('斜線日期當本地午夜（香港時區）', () => expect(friendlyDate('2026/11/15'), '2026-11-15'), skip: DateTime(2026, 11, 15).timeZoneOffset != const Duration(hours: 8));
    test('空字串：待核對', () => expect(friendlyDate(''), '待核對'));
    test('null：待核對', () => expect(friendlyDate(null), '待核對'));
    test('數字 0：待核對', () => expect(friendlyDate(0), '待核對'));
  });

  group('daysLeft', () {
    final now = DateTime(2026, 11, 15, 10);
    test('沒有日期', () => expect(daysLeft(null, now), isNull));
    test('空字串', () => expect(daysLeft('', now), isNull));
    test('今天', () => expect(daysLeft('2026-11-15', now), 1));
    test('明天', () => expect(daysLeft('2026-11-16', now), 2));
    test('昨天', () => expect(daysLeft('2026-11-14', now), 0));
    test('三天前', () => expect(daysLeft('2026-11-12', now), -2));
    test('格式不對：NaN', () => expect(daysLeft('2026/11/16', now)!.isNaN, true));
    test('已有時間：NaN', () => expect(daysLeft('2026-11-16T00:00:00Z', now)!.isNaN, true));
  });

  group('attachmentTone、attachmentLabel', () {
    test('待確認', () => expect([attachmentTone['待確認'], attachmentLabel['待確認']], ['blue', '顧問核對中']));
    test('已確認', () => expect([attachmentTone['已確認'], attachmentLabel['已確認']], ['', '已收妥']));
    test('需重交', () => expect([attachmentTone['需重交'], attachmentLabel['需重交']], ['red', '需要重交']));
  });

  test('上傳上限 5 MB', () => expect(maxUpload, 5242880));

  group('phoneText', () {
    test('香港號碼分組', () => expect(phoneText('+85212345678'), '+852 1234 5678'));
    test('澳門號碼分組', () => expect(phoneText('+85366714829'), '+853 6671 4829'));
    test('內地號碼分組', () => expect(phoneText('+8613812345678'), '+86 138 1234 5678'));
    test('位數不對照寫', () => expect(phoneText('+8521234567'), '+8521234567'));
    test('沒有號碼', () => expect(phoneText(null), ''));
  });
}
