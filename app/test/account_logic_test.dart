// 階段 3d 帳號三頁（申請使用、服務條款、註銷帳號）的計算：每種情況一個測試。
import 'package:dualplate/pages/close_account/close_account_logic.dart';
import 'package:dualplate/pages/login/login_page.dart' show AreaCode, areaCodes;
import 'package:dualplate/pages/signup/signup_logic.dart';
import 'package:dualplate/pages/terms/terms_logic.dart';
import 'package:flutter_test/flutter_test.dart';

final hk = areaCodes[0], mo = areaCodes[1], cn = areaCodes[2];

String problem({AreaCode? area, String phone = '91234567', String name = '陳先生', String password = 'password-10', String? again, bool agree = true}) =>
    signupProblem(area: area ?? hk, phone: phone, name: name, password: password, again: again ?? password, agree: agree);

void main() {
  group('申請使用：送出前檢查', () {
    test('沒有號碼', () => expect(problem(phone: ''), '請填寫手機號碼'));
    test('號碼只有符號當作沒有', () => expect(problem(phone: '--'), '請填寫手機號碼'));
    test('香港號碼不足 8 位', () => expect(problem(phone: '9123456'), '香港手機號碼應為 8 位'));
    test('澳門號碼超過 8 位', () => expect(problem(area: mo, phone: '661234567'), '澳門手機號碼應為 8 位'));
    test('內地號碼不是 1 字頭', () => expect(problem(area: cn, phone: '23812345678'), '內地手機號碼應為 11 位'));
    test('號碼中間的空格和橫線不算', () => expect(problem(phone: '9123 4567'), ''));
    test('內地 1 字頭 11 位可以', () => expect(problem(area: cn, phone: '13812345678'), ''));
    test('稱呼只有空格', () => expect(problem(name: '   '), '請填寫稱呼'));
    test('密碼 9 個字元', () => expect(problem(password: '123456789'), '密碼至少 10 個字元'));
    test('兩次密碼不一樣', () => expect(problem(again: 'password-11'), '兩次輸入的密碼不一樣'));
    test('未勾選同意', () => expect(problem(agree: false), '請先閱讀並同意服務條款及私隱聲明'));
    test('先檢查號碼再檢查稱呼', () => expect(problem(phone: '', name: ''), '請填寫手機號碼'));
    test('全部正確', () => expect(problem(), ''));
  });

  group('申請使用：送出內容', () {
    test('號碼只留數字並加區號，稱呼去空格，密碼原文，附條款版本', () {
      expect(signupBody(area: hk, phone: '9123 4567', name: ' 陳先生 ', password: ' pass word 1 ', termsVersion: 3), {
        'phone': '+85291234567',
        'name': '陳先生',
        'password': ' pass word 1 ',
        'acceptTerms': true,
        'termsVersion': 3,
      });
    });
    test('內地號碼加 +86', () {
      expect(signupBody(area: cn, phone: '13812345678', name: '王', password: 'x', termsVersion: 1)['phone'], '+8613812345678');
    });
  });

  group('申請使用：條款剛更新', () {
    test('409 而且訊息有「條款已更新」', () => expect(termsChanged(409, '條款已更新，請重新閱讀'), isTrue));
    test('409 但訊息不同', () => expect(termsChanged(409, '這個號碼已申請'), isFalse));
    test('不是 409', () => expect(termsChanged(400, '條款已更新'), isFalse));
  });

  group('服務條款', () {
    test('登入後已發佈：記下是自己的', () => expect(myTermsDoc({'published': true, 'version': 2}), {'published': true, 'version': 2, 'mine': true}));
    test('登入後未發佈：當作沒有', () => expect(myTermsDoc({'published': false}), isNull));
    test('回應不是物件：當作沒有', () => expect(myTermsDoc('x'), isNull));
    test('自己的、未同意：要同意', () => expect(termsNeedAccept({'mine': true, 'accepted': false}), isTrue));
    test('自己的、已同意：不用', () => expect(termsNeedAccept({'mine': true, 'accepted': true}), isFalse));
    test('未登入讀到的：不用同意', () => expect(termsNeedAccept({'version': 1}), isFalse));
    test('沒有條款：不用同意', () => expect(termsNeedAccept(null), isFalse));
    test('mode force 是強制', () => expect(termsForced({'mode': 'force'}), isTrue));
    test('mode prompt 不是強制', () => expect(termsForced({'mode': 'prompt'}), isFalse));
    test('強制時的提示', () => expect(termsBanner({'mode': 'force', 'everAccepted': true}), ('請先閱讀並同意', '服務條款及私隱聲明已更新，同意後才可繼續使用。')));
    test('以前同意過的提示', () => expect(termsBanner({'everAccepted': true}), ('服務條款已更新', '請閱讀並同意最新版本。')));
    test('第一次的提示', () => expect(termsBanner({'everAccepted': false}), ('請先閱讀服務條款', '開始使用前，請閱讀並同意以下條款及私隱聲明。')));
  });

  group('註銷帳號：送出內容', () {
    test('沒選原因：只送密碼', () => expect(closeBody(password: 'pw', reason: '', reasonText: ''), {'password': 'pw'}));
    test('選了原因：送原因', () => expect(closeBody(password: 'pw', reason: '不再需要', reasonText: ''), {'password': 'pw', 'reason': '不再需要'}));
    test('選「其他」並寫了原因：去掉前後空格', () => expect(closeBody(password: 'pw', reason: '其他', reasonText: '  搬走了 '), {'password': 'pw', 'reason': '其他', 'reasonText': '搬走了'}));
    test('選「其他」但原因只有空格：不送原因文字', () => expect(closeBody(password: 'pw', reason: '其他', reasonText: '  '), {'password': 'pw', 'reason': '其他'}));
    test('改選別的原因：之前寫的文字不送', () => expect(closeBody(password: 'pw', reason: '不再需要', reasonText: '搬走了'), {'password': 'pw', 'reason': '不再需要'}));
    test('密碼原文送出，不去空格', () => expect(closeBody(password: ' pw ', reason: '', reasonText: '')['password'], ' pw '));
    test('不送 retain（停用 30 天的計劃未批准）', () => expect(closeBody(password: 'pw', reason: '其他', reasonText: 'x').containsKey('retain'), isFalse));
  });

  group('註銷帳號：數量', () {
    test('數字加單位', () => expect(countText({'plates': 3}, 'plates', '個'), '3 個'));
    test('沒有數量：只有單位', () => expect(countText({}, 'plates', '個'), ' 個'));
    test('沒有 counts：只有單位', () => expect(countText(null, 'drivers', '位'), ' 位'));
  });
}
