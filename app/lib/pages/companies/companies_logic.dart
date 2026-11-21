// 我的公司頁的計算：照抄 mobile/src/pages/companies/companies.vue（報帳狀態、登記號碼名稱、牌照標籤、提示改寫、待核對）。
import '../../core/js.dart';
import '../plate_detail/plate_detail_logic.dart' show at;

// 客戶看的報帳狀態：只分辦好、辦理中、未開始
String filingWord(Object? f) {
  final status = at(f, 'status');
  if (status == '已完成') return truthy(at(f, 'zeroFiling')) ? '零申報' : '已完成';
  if (status == '已申報') return '已申報';
  if (status == '公司已註銷') return '不需申報';
  if (['資料已收', '會計處理中'].contains(status)) return '辦理中';
  return '待交資料';
}

String filingTone(Object? f) {
  final status = at(f, 'status');
  if (['已完成', '已申報'].contains(status)) return '';
  if (status == '公司已註銷') return 'gray';
  if (status == '未開始') return 'amber';
  return 'blue';
}

// 報帳月份：Number(period.slice(5))
String filingMonth(Object? f) {
  final period = at(f, 'period');
  final text = period == null ? '' : jsString(period);
  final n = jsNumber(text.length > 5 ? text.substring(5) : '');
  return '${jsString(n)}月';
}

// 登記號碼按註冊地寫明是甚麼號碼
String regLabel(Object? c) => at(c, 'jurisdiction') == '內地' ? '統一社會信用代碼' : at(c, 'jurisdiction') == '澳門' ? '商業登記編號' : '商業登記號碼';

// 伺服器給的牌照標籤是「內地車牌 · 香港車牌」；「待補」的部分不顯示
List<String> plateParts(Object? label) => (truthy(label) ? jsString(label) : '').split(' · ').where((part) => part.isNotEmpty && !part.contains('待補')).toList();

// 這一頁就是「我的公司」：提示改為按「修改公司資料」
String companyHint(Object? hint) => jsString(hint).replaceFirst('在「我的公司」', '按「修改公司資料」');

// 客戶自行修改公司資料和到期日：立即生效，顧問再核對
bool isPendingIn(List<dynamic> pending, Object? type, Object? id, [String? field]) =>
    pending.any((x) => at(x, 'entityType') == type && at(x, 'entityId') == id && (field == null || at(x, 'field') == field));
