// 聯絡我們、我的資料、新增公司、修改公司資料的計算：每種情況一個測試。
import 'package:dualplate/business/company_editor.dart';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/pages/company_new/company_new_logic.dart';
import 'package:dualplate/pages/messages/messages_logic.dart';
import 'package:dualplate/pages/profile/profile_logic.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('聯絡我們', () {
    test('時間換成香港時間：日／月 時:分', () {
      expect(messageTime('2026-11-21T19:05:00Z'), '22/11 03:05');
    });
    test('香港午夜寫 00', () {
      expect(messageTime('2026-11-21T16:05:00Z'), '22/11 00:05');
    });
    test('沒有時間：空白', () {
      expect(messageTime(null), '');
    });
    test('時間格式不對：Invalid Date', () {
      expect(messageTime('昨天'), 'Invalid Date');
    });
    test('只有空格不送', () {
      expect(messageProblem('   '), '請輸入訊息');
    });
    test('有內容可送', () {
      expect(messageProblem(' 你好 '), '');
    });
    test('可發訊息和不可發訊息的說明不同', () {
      expect(messagesIntro(true), '在這裏留言，我們會在辦公時間內回覆；回覆時會通知你。');
      expect(messagesIntro(false), '這裏是我們發給你的訊息。有問題請直接聯絡你的顧問。');
    });
    test('我們發的寫發訊人', () {
      expect(senderLine({'fromStaff': true, 'senderName': '陳顧問', 'createdAt': '2026-11-21T19:05:00Z'}), '陳顧問 · 22/11 03:05');
    });
    test('我們發的沒有名字寫「我們」', () {
      expect(senderLine({'fromStaff': true, 'senderName': '', 'createdAt': null}), '我們 · ');
    });
    test('客戶發的寫「你」', () {
      expect(senderLine({'fromStaff': false, 'createdAt': null}), '你 · ');
    });
  });

  group('我的資料', () {
    test('顯示名稱：空白不可存', () {
      expect(nameChanged('  ', '李先生'), false);
    });
    test('顯示名稱：沒改不可存', () {
      expect(nameChanged(' 李先生 ', '李先生'), false);
    });
    test('顯示名稱：改了可存', () {
      expect(nameChanged('李生', '李先生'), true);
    });
    test('委託人：沒改', () {
      expect(customerChanged({'name': '李先生', 'kind': '個人', 'phone': ''}, {'name': '李先生', 'kind': '個人', 'phone': null}), false);
    });
    test('委託人：只送改了的欄位，送原文', () {
      expect(customerChanges({'name': ' 李氏公司 ', 'kind': '公司', 'phone': '+85291110000'}, {'name': '李先生', 'kind': '個人', 'phone': '+85291110000'}), {'name': ' 李氏公司 ', 'kind': '公司'});
    });
    test('密碼：沒填目前密碼', () {
      expect(passwordProblem('', '1234567890', '1234567890'), '請輸入目前密碼');
    });
    test('密碼：新密碼少於 10 個字元', () {
      expect(passwordProblem('old', '123456789', '123456789'), '新密碼至少 10 個字元');
    });
    test('密碼：兩次不一樣', () {
      expect(passwordProblem('old', '1234567890', '1234567891'), '兩次輸入的新密碼不一樣');
    });
    test('密碼：沒有問題', () {
      expect(passwordProblem('old', '1234567890', '1234567890'), '');
    });
    test('待核對：有委託人的修改', () {
      expect(customerPendingIn([{'entityType': 'plate'}, {'entityType': 'customer'}]), true);
    });
    test('待核對：伺服器失敗（空清單）', () {
      expect(customerPendingIn([]), false);
    });
  });

  group('新增公司', () {
    final overview = {
      'plates': [
        {'id': 'p1', 'route': '粵港', 'mainlandPlate': '粵ZA100港', 'localPlate': 'AB1000'},
        {'id': 'p2', 'route': '粵澳', 'mainlandPlate': '粵ZM1澳', 'localPlate': ''},
        {'id': 'p3', 'route': '粵港', 'mainlandPlate': '', 'localPlate': '', 'cardNumber': 'C123'},
      ],
    };
    test('牌照選項的名稱', () {
      expect(plateChoices(overview).map((p) => p.label), ['粵ZA100港 · AB1000', '粵ZM1澳', '批文卡 C123']);
    });
    test('香港公司只可選粵港牌照', () {
      expect(choicesFor('香港', plateChoices(overview)).map((p) => p.id), ['p1', 'p3']);
    });
    test('澳門公司只可選粵澳牌照', () {
      expect(choicesFor('澳門', plateChoices(overview)).map((p) => p.id), ['p2']);
    });
    test('內地公司兩種都可以', () {
      expect(choicesFor('內地', plateChoices(overview)).map((p) => p.id), ['p1', 'p2', 'p3']);
    });
    test('換註冊地後選了的牌照不在選項：改回不屬於任何牌照', () {
      expect(keepPlate('p1', choicesFor('澳門', plateChoices(overview))), '');
    });
    test('換註冊地後選了的牌照仍在選項：保留', () {
      expect(keepPlate('p1', choicesFor('內地', plateChoices(overview))), 'p1');
    });
    test('送出：名稱去空格，沒選牌照不送 plateId', () {
      expect(companyNewBody('香港', ' 李氏貿易 ', ''), {'jurisdiction': '香港', 'name': '李氏貿易'});
    });
    test('送出：選了牌照帶 plateId', () {
      expect(companyNewBody('內地', '李氏', 'p1'), {'jurisdiction': '內地', 'name': '李氏', 'plateId': 'p1'});
    });
    test('名稱欄提示：內地用簡體字', () {
      expect([companyNamePlaceholder('內地'), companyNamePlaceholder('香港')], ['按營業執照填寫，用簡體字', '按商業登記證填寫']);
    });
  });

  group('修改公司資料', () {
    final form = {'name': 'N', 'nameEn': 'E', 'registrationNo': 'R', 'companyNumber': 'C', 'incorporatedOn': '2020-01-01', 'taxpayerType': '一般納稅人'};
    test('香港公司：多送英文名稱和公司編號', () {
      expect(companyPayload('香港', form), {'name': 'N', 'registrationNo': 'R', 'incorporatedOn': '2020-01-01', 'nameEn': 'E', 'companyNumber': 'C'});
    });
    test('澳門公司：只送共同欄位', () {
      expect(companyPayload('澳門', form), {'name': 'N', 'registrationNo': 'R', 'incorporatedOn': '2020-01-01'});
    });
    test('內地公司：選了納稅人類型才送', () {
      expect(companyPayload('內地', form)['taxpayerType'], '一般納稅人');
      expect(companyPayload('內地', {...form, 'taxpayerType': ''}).containsKey('taxpayerType'), false);
    });
    test('登記號碼的名稱按司法區', () {
      expect([regLabelOf('內地'), regLabelOf('澳門'), regLabelOf('香港')], ['統一社會信用代碼', '商業登記編號', '商業登記號碼']);
    });
    test('表單初值：沒有的欄位是空字串', () {
      expect(companyForm({'name': '李氏', 'nameEn': null}), {'name': '李氏', 'nameEn': '', 'registrationNo': '', 'companyNumber': '', 'incorporatedOn': '', 'taxpayerType': ''});
    });
    test('伺服器的簡體建議', () {
      expect(suggestionOf(ApiError('要用簡體字', data: {'suggestion': '李氏贸易'})), '李氏贸易');
      expect(suggestionOf(ApiError('其他錯誤', data: {})), isNull);
    });
  });
}
