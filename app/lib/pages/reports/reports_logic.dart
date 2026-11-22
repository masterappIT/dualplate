// 月報頁的計算：照 mobile/src/pages/reports/reports.vue。
import '../../core/js.dart';

// 「2026 年 11 月」（period 是「2026-11」）
String monthTitle(Object? period) {
  final p = jsString(period);
  final month = p.length > 5 ? int.tryParse(p.substring(5)) : null;
  return '${p.length >= 4 ? p.substring(0, 4) : p} 年 ${month ?? 'NaN'} 月';
}

// 結算金額：不是 0 的幣種，次序照伺服器
List<(String, num)> netRows(Object? net) => [
      if (net is Map)
        for (final e in net.entries)
          if (truthy(e.value)) (jsString(e.key), jsNumber(e.value)),
    ];

// 「你應付 HK$ 100」／「應付給你 HK$ 100」的前半
String netWord(num value) => value < 0 ? '你應付' : '應付給你';

String usageStatus(Object? status) => status == '已收' ? '已收到' : status == '部分收' ? '部分收到' : '未收到';
String chargeStatus(Object? status) => status == '已收' ? '已付款' : status == '部分收' ? '部分付款' : '待付款';
bool filingDone(Object? status) => status == '已完成' || status == '已申報';
