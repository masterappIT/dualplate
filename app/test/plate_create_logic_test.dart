// 新增牌照頁的計算（lib/pages/plate_create/plate_create_logic.dart）：一個情況一個測試。
// 期望值按 mobile/src/pages/plate-create/plate-create.vue 的原碼推算。
import 'package:dualplate/pages/plate_create/plate_create_logic.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('批文卡欄位', () {
    test('共 18 欄，次序照舊（第一欄批文卡編號、最後一欄備註）', () {
      expect(cardFields.length, 18);
      expect(cardFields.first, ('cardNumber', '批文卡編號'));
      expect(cardFields.last, ('notes', '備註'));
    });
  });

  group('持牌公司選項', () {
    test('第一項是「按批文卡自動判斷」，之後是名下公司組', () {
      final options = groupOptions({
        'groups': [
          {'id': 'g1', 'name': '甲組'},
          {'id': 2, 'name': '乙組'},
        ],
      });
      expect(options.map((o) => o.id), ['', 'g1', '2']);
      expect(options.map((o) => o.label), ['按批文卡自動判斷', '甲組', '乙組']);
    });
    test('沒有連結資料時只有自動判斷一項', () => expect(groupOptions(null).length, 1));
  });

  group('持牌公司說明', () {
    final link = {
      'groups': [
        {'id': 'g1', 'name': '甲組'},
      ],
      'companies': [
        {'name': '舊公司', 'existing': true},
        {'name': '新公司甲'},
        {'name': '新公司乙', 'existing': false},
      ],
    };
    test('手動選了公司組：寫「將連到」該組', () => expect(holderText(link, 'g1', false), '將連到：甲組'));
    test('選了已不存在的公司組：名稱留空', () => expect(holderText(link, 'gx', false), '將連到：'));
    test('自動找到已有公司組，另有新公司：寫會加到這組', () {
      expect(holderText({...link, 'groupId': 'g1', 'groupName': '甲組'}, '', false), '將連到你已有的公司：甲組；新公司甲、新公司乙 會加到這組');
    });
    test('自動找到已有公司組，沒有新公司：只寫連到', () {
      expect(holderText({'groupId': 'g1', 'groupName': '甲組', 'companies': []}, '', false), '將連到你已有的公司：甲組');
    });
    test('沒有已有公司組，有新公司：寫會新建', () {
      expect(holderText(link, '', false), '會新建公司：新公司甲、新公司乙。建檔後在「我的公司」補上登記號碼等資料即可。');
    });
    test('自管、未辨識到商號：自己在「我的公司」補', () => expect(holderText({}, '', true), '未辨識到商號；建立後可在「我的公司」補上。'));
    test('托管、未辨識到商號：顧問核對時連', () => expect(holderText({}, '', false), '未辨識到商號，你的顧問核對時會連到你的公司。'));
    test('改選連結文字：已選公司組與自動判斷各一款', () {
      expect(groupLinkText('g1'), '改選或改回自動判斷 ›');
      expect(groupLinkText(''), '不對？改選名下其他公司組 ›');
    });
  });

  group('錄入到一半', () {
    test('甚麼都沒有：不算', () => expect(isDirty({}, {}), isFalse));
    test('只有空白欄位：不算', () => expect(isDirty({}, {'company': '  ', 'notes': null}), isFalse));
    test('拍了正面：算', () => expect(isDirty({'front': 'data:x'}, {}), isTrue));
    test('拍了背面：算', () => expect(isDirty({'back': 'data:x'}, {}), isTrue));
    test('填了一欄：算', () => expect(isDirty({}, {'company': '某公司'}), isTrue));
    test('填了數字：算', () => expect(isDirty({}, {'seats': 7}), isTrue));
  });

  group('合併辨識結果', () {
    test('只填空白欄位，已填的不覆蓋', () {
      final next = mergeRecognized({'company': '我填的', 'serial': ''}, {'company': '辨識的', 'serial': 'A1', 'crossing': '皇崗'});
      expect(next, {'company': '我填的', 'serial': 'A1', 'crossing': '皇崗'});
    });
    test('辨識結果的空值不寫入', () => expect(mergeRecognized({'serial': 'A1'}, {'serial': '', 'notes': null}), {'serial': 'A1'}));
    test('辨識結果不是物件：原樣回傳', () => expect(mergeRecognized({'a': '1'}, 'oops'), {'a': '1'}));
    test('不改動原來的草稿', () {
      final draft = <String, Object?>{'a': ''};
      mergeRecognized(draft, {'a': 'x'});
      expect(draft['a'], '');
    });
  });

  group('建立前檢查', () {
    test('有批文卡編號：可以建立', () => expect(createProblem({'cardNumber': 'C123'}, {}), ''));
    test('編號只有空白、已拍相片：請手動填寫', () => expect(createProblem({'cardNumber': '  '}, {'front': 'x'}), '未能辨識編號，請手動填寫'));
    test('只拍了背面也算拍過', () => expect(createProblem({}, {'back': 'x'}), '未能辨識編號，請手動填寫'));
    test('沒拍相片也沒編號：請先拍下批文卡', () => expect(createProblem({}, {}), '請先拍下批文卡'));
  });

  group('文字', () {
    test('引言：自管與托管', () {
      expect(introText(true), contains('請核對一次辨識結果'));
      expect(introText(false), contains('你的顧問會再核對'));
    });
    test('欄位提示：自管與托管', () {
      expect(fieldHint(true), '請對照批文卡核對；發現辨識錯誤可以直接修改。');
      expect(fieldHint(false), '其他內容顧問會對照原件核對；發現辨識錯誤也可以自行修改。');
    });
    test('建立按鈕：處理中優先，其次按模式', () {
      expect(createText(true, true), '處理中…');
      expect(createText(false, true), '建立牌照');
      expect(createText(false, false), '提交給顧問核對');
    });
  });

  group('新批文備案', () {
    test('有逾期的新批文備案：回傳該期', () {
      final d = {'code': 'new_card_filing', 'level': 'overdue', 'dueOn': '2026-11-01'};
      expect(overdueFiling({'deadlines': [{'code': 'new_card_filing', 'level': 'due'}, d]}), d);
    });
    test('新批文備案未逾期：不問', () => expect(overdueFiling({'deadlines': [{'code': 'new_card_filing', 'level': 'due'}]}), isNull));
    test('別的項目逾期：不問', () => expect(overdueFiling({'deadlines': [{'code': 'inspection', 'level': 'overdue'}]}), isNull));
    test('沒有牌照資料：不問', () => expect(overdueFiling(null), isNull));
  });

  group('查看已拍的照片', () {
    test('兩面都有，從背面開始', () {
      final r = photoSides({'front': 1, 'back': 2}, 'back');
      expect(r.sides, ['front', 'back']);
      expect(r.current, 1);
    });
    test('只有背面，從正面點進來：從第一張開始', () {
      final r = photoSides({'back': 2}, 'front');
      expect(r.sides, ['back']);
      expect(r.current, 0);
    });
    test('都沒有：空清單', () => expect(photoSides({}, 'front').sides, isEmpty));
  });
}
