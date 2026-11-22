// 帳單頁的計算：照 mobile/src/pages/billing/billing.vue 的 computed 和小函數。
import '../../core/js.dart';

// 尚未付款合計：{ 幣種: 分 } → [(幣種, 分)]，次序照伺服器（Object.entries）
List<(String, Object?)> feeTotals(Map? outstanding) => [for (final e in (outstanding ?? const {}).entries) (jsString(e.key), e.value)];

// 「請你確認」的分期：按到期日排序（沒有到期日的當空字串，排最前）
List<Map> feesToConfirm(List items) {
  final list = [for (final i in items) if (i is Map && truthy(i['needsConfirm'])) i];
  list.sort((a, b) => jsString(a['dueOn'] ?? '').compareTo(jsString(b['dueOn'] ?? '')));
  return list;
}

// 未付：未收、部分收，而且不在「請你確認」裏；全部：所有款項
List<Map> feesShown(List items, String filter) => [
      for (final i in items)
        if (i is Map && (filter != 'open' || (['未收', '部分收'].contains(i['status']) && !truthy(i['needsConfirm'])))) i,
    ];

String feeLabel(Map item) => item['status'] == '已收' ? '已付款' : truthy(item['overdue']) ? '已逾期' : item['status'] == '部分收' ? '部分付款' : '待付款';
String feeTone(Map item) => item['status'] == '已收' ? 'gray' : truthy(item['overdue']) ? 'red' : 'amber';

String emptyFeesText(String filter) => filter == 'open' ? '沒有其他未付款項' : '還沒有帳單記錄';
