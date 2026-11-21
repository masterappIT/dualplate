// 委託內容頁的計算（lib/pages/scope/scope_logic.dart）：一個情況一個測試。
// 期望值按 mobile/src/pages/scope/scope.vue 的原碼推算。
import 'package:dualplate/pages/scope/scope_logic.dart';
import 'package:flutter_test/flutter_test.dart';

final plateA = {'id': 'p1', 'type': 'plate', 'label': '粵B12345', 'us': [1, 2], 'you': [3]};
final plateB = {'id': 'p2', 'type': 'plate', 'label': '粵C6789', 'us': [], 'you': [], 'stopped': true};
final company = {'id': 'c1', 'type': 'company', 'label': '大文有限公司', 'us': [], 'you': [1, 2]};
final sections = [
  {'title': '牌照', 'owners': [plateA, plateB]},
  {'title': '公司', 'owners': [company]},
];

void main() {
  group('顯示的分類', () {
    test('沒有指定對象：全部分類', () => expect(shownSections(sections, ''), sections));
    test('指定牌照：只留那個牌照，沒有對象的分類拿掉', () {
      final shown = shownSections(sections, 'p1');
      expect(shown.length, 1);
      expect(shown.first['title'], '牌照');
      expect(shown.first['owners'], [plateA]);
    });
    test('指定的對象不存在：沒有分類', () => expect(shownSections(sections, 'x'), isEmpty));
    test('不是物件的分類略過', () => expect(shownSections([null, 'x', ...sections], '').length, 2));
    test('所有分類的對象攤平', () => expect(ownersOf(shownSections(sections, '')), [plateA, plateB, company]));
  });

  group('對象的項數', () {
    test('兩邊都有', () => expect(ownerCounts(plateA), '我們負責 2 項 · 你自行辦理 1 項'));
    test('只有自行辦理：數目為 0 的那半句不寫', () => expect(ownerCounts(company), '你自行辦理 2 項'));
    test('都沒有：暫時沒有委託事項', () => expect(ownerCounts(plateB), '暫時沒有委託事項'));
  });

  group('頂部摘要', () {
    test('整頁：按牌照和公司數', () {
      expect(scopeSummary(shownSections(sections, ''), ''), '2 個牌照 · 1 間公司。按進去看哪些事由我們負責、哪些由你自行辦理。');
    });
    test('整頁只有公司', () {
      final only = [{'owners': [company]}];
      expect(scopeSummary(shownSections(only, ''), ''), '1 間公司。按進去看哪些事由我們負責、哪些由你自行辦理。');
    });
    test('整頁沒有對象：不寫', () => expect(scopeSummary([], ''), ''));
    test('單一對象：寫它的項數', () => expect(scopeSummary(shownSections(sections, 'p1'), 'p1'), '我們負責 2 項 · 你自行辦理 1 項'));
    test('單一對象已標記不再續期：不寫', () => expect(scopeSummary(shownSections(sections, 'p2'), 'p2'), ''));
    test('單一對象找不到：不寫', () => expect(scopeSummary(shownSections(sections, 'x'), 'x'), ''));
  });

  group('申請調整委託的網址', () {
    test('整頁：只帶 entrust=scope', () => expect(adjustPath(shownSections(sections, ''), ''), '/requests?entrust=scope'));
    test('牌照：帶名稱並鎖定牌照', () {
      expect(adjustPath(shownSections(sections, 'p1'), 'p1'), '/requests?entrust=scope&item=${Uri.encodeComponent('粵B12345')}&plate=p1');
    });
    test('公司：只帶名稱，不鎖定牌照', () {
      expect(adjustPath(shownSections(sections, 'c1'), 'c1'), '/requests?entrust=scope&item=${Uri.encodeComponent('大文有限公司')}');
    });
    test('指定的對象找不到：同整頁', () => expect(adjustPath(shownSections(sections, 'x'), 'x'), '/requests?entrust=scope'));
  });

  group('導航列標題', () {
    test('整頁：保持「委託內容」（null）', () => expect(ownerTitle(sections, ''), isNull));
    test('單一對象：換成它的名稱', () => expect(ownerTitle(sections, 'c1'), '大文有限公司'));
    test('找不到：保持「委託內容」（null）', () => expect(ownerTitle(sections, 'x'), isNull));
  });
}
