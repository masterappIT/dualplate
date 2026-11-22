// 帳單、月報的計算（billing_logic.dart、reports_logic.dart）：每種情況一個測試。
import 'package:dualplate/pages/billing/billing_logic.dart';
import 'package:dualplate/pages/reports/reports_logic.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('帳單 feeTotals', () {
    test('按伺服器次序列出各幣種', () {
      expect(feeTotals({'HKD': 100, 'RMB': 200}), [('HKD', 100), ('RMB', 200)]);
    });
    test('沒有未付時是空清單', () {
      expect(feeTotals({}), isEmpty);
    });
    test('null 當作空', () {
      expect(feeTotals(null), isEmpty);
    });
  });

  group('帳單 feesToConfirm', () {
    test('只取 needsConfirm 的', () {
      final list = feesToConfirm([
        {'id': 'a', 'needsConfirm': true, 'dueOn': '2027-01-01'},
        {'id': 'b', 'needsConfirm': false, 'dueOn': '2026-01-01'},
      ]);
      expect(list.map((i) => i['id']), ['a']);
    });
    test('按到期日排序', () {
      final list = feesToConfirm([
        {'id': 'late', 'needsConfirm': true, 'dueOn': '2027-02-20'},
        {'id': 'early', 'needsConfirm': true, 'dueOn': '2026-11-25'},
      ]);
      expect(list.map((i) => i['id']), ['early', 'late']);
    });
    test('沒有到期日的排最前', () {
      final list = feesToConfirm([
        {'id': 'dated', 'needsConfirm': true, 'dueOn': '2026-11-25'},
        {'id': 'none', 'needsConfirm': true},
      ]);
      expect(list.map((i) => i['id']), ['none', 'dated']);
    });
  });

  group('帳單 feesShown', () {
    final items = [
      {'id': 'open', 'status': '未收'},
      {'id': 'partial', 'status': '部分收'},
      {'id': 'paid', 'status': '已收'},
      {'id': 'confirm', 'status': '未收', 'needsConfirm': true},
    ];
    test('未付：未收和部分收，不含要確認的', () {
      expect(feesShown(items, 'open').map((i) => i['id']), ['open', 'partial']);
    });
    test('全部：每一項都列出', () {
      expect(feesShown(items, 'all').map((i) => i['id']), ['open', 'partial', 'paid', 'confirm']);
    });
  });

  group('帳單 狀態文字和顏色', () {
    test('已收：已付款、灰', () {
      expect([feeLabel({'status': '已收', 'overdue': true}), feeTone({'status': '已收', 'overdue': true})], ['已付款', 'gray']);
    });
    test('逾期：已逾期、紅', () {
      expect([feeLabel({'status': '未收', 'overdue': true}), feeTone({'status': '未收', 'overdue': true})], ['已逾期', 'red']);
    });
    test('部分收：部分付款、橙', () {
      expect([feeLabel({'status': '部分收'}), feeTone({'status': '部分收'})], ['部分付款', 'amber']);
    });
    test('未收：待付款、橙', () {
      expect([feeLabel({'status': '未收'}), feeTone({'status': '未收'})], ['待付款', 'amber']);
    });
    test('空白提示按篩選不同', () {
      expect([emptyFeesText('open'), emptyFeesText('all')], ['沒有其他未付款項', '還沒有帳單記錄']);
    });
  });

  group('月報', () {
    test('monthTitle：月份不補零', () {
      expect(monthTitle('2026-03'), '2026 年 3 月');
    });
    test('netRows：去掉 0 的幣種', () {
      expect(netRows({'HKD': 0, 'MOP': -500, 'RMB': 300}), [('MOP', -500), ('RMB', 300)]);
    });
    test('netRows：沒有結算時空清單', () {
      expect(netRows(null), isEmpty);
    });
    test('netWord：負數是你應付', () {
      expect([netWord(-1), netWord(1)], ['你應付', '應付給你']);
    });
    test('出租收款狀態', () {
      expect([usageStatus('已收'), usageStatus('部分收'), usageStatus('未收')], ['已收到', '部分收到', '未收到']);
    });
    test('收費狀態', () {
      expect([chargeStatus('已收'), chargeStatus('部分收'), chargeStatus('未收')], ['已付款', '部分付款', '待付款']);
    });
    test('報帳已申報：已完成和已申報都算', () {
      expect([filingDone('已完成'), filingDone('已申報'), filingDone('待交資料')], [true, true, false]);
    });
  });
}
