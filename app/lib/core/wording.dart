// 用語工具：逐條照搬 mobile/src/lib/api.js（自管／托管用語、到期狀態、辦理狀態、金額、日期、車牌名稱、附件狀態），
// 以及 ContactCard.vue 的電話寫法。兩份客戶端的文字必須一樣：改這裏時 api.js 一起改（docs/tasks/flutter-app-plan.md 第六節）。
// 伺服器傳來的資料是 JSON（Map），判斷照 JS 的真假規則（js.dart），連奇怪的值也和現有 App 顯示一樣。
import 'js.dart';
import 'session.dart';

// 未填的資料：托管客戶由顧問整理（確認中）；自管客戶自己填，直接寫「未填寫」
String unsetWord() => isSelfManaged() ? '未填寫' : '確認中';
String noDatesWord() => isSelfManaged() ? '未填到期日' : '資料整理中';

// 自管客戶按次委託：到期項目對應的代辦服務；沒有對應的用「其他代辦要求」
const entrustServices = {
  'approval': 'renewal',
  'hk_crp': 'renewal',
  'mo_permit': 'renewal',
  'inspection': 'inspection',
  'mo_inspection': 'inspection',
  'customs_filing': 'filing',
  'new_card_filing': 'filing',
};

bool canEntrust(Map item) => isSelfManaged() && item['handledBy'] == 'you' && item['code'] != 'crossing_90';

// startEntrust、startLongTerm 的目的地（頁面在階段 3b 才做；路徑沿用 pages.json 的頁面名稱）
String entrustPath(Map item) {
  final service = entrustServices[item['code']] ?? 'other';
  final plate = item['plateId'];
  return '/requests?entrust=item&service=$service&item=${Uri.encodeComponent(item.containsKey('name') ? jsString(item['name']) : 'undefined')}'
      '${truthy(plate) ? '&plate=${Uri.encodeComponent(jsString(plate))}' : ''}';
}

const longTermPath = '/requests?entrust=long';

// 到期狀態的文字和顏色（全站同一套）
const levelLabel = {'overdue': '已逾期', 'due': '快到期', 'upcoming': '即將到期', 'ok': '正常'};
const levelTone = {'overdue': 'red', 'due': 'amber', 'upcoming': '', 'ok': ''};

String daysText(Map item) {
  final days = item['daysLeft'];
  if (days == null) return '';
  final n = jsNumber(days);
  if (n < 0) return '逾期 ${jsString(-n)} 天';
  if (days is num && days == 0) return '今天到期';
  return '還有 ${jsString(days)} 天';
}

// 客戶自己辦、我們只提醒的事項，全站同一個說法
const selfHandled = '自行辦理';

// 自管客戶看到的句子：托管客戶的句子一字不改，自管客戶另給一句（管理者 2026-10-19）
T forMode<T>(T custody, T self) => isSelfManaged() ? self : custody;

// 到期項目旁的「自行辦理」：自管客戶全部都是自己辦，不標
bool showSelfTag(Map item) => item['handledBy'] == 'you' && !isSelfManaged();

// 辦理狀態：全站同一套顏色（進行中藍、要你做的橙、結束灰）
String requestTone(Object? status) => const {'需要你提供資料': 'amber', '辦理中': 'blue', '已收到': 'blue', '已完成': 'gray', '已取消': 'gray'}[status] ?? 'blue';

// 工單步驟名是寫給員工看的（「客戶提供……」），客戶端改成對客戶說話
String clientStage(Object? stage) {
  final text = truthy(stage) ? jsString(stage) : '';
  if (text.isEmpty || text == '待內部受理') return isSelfManaged() ? '等待我們受理' : '等待顧問受理';
  return text.replaceFirst(RegExp(r'^客戶'), '等你');
}

// 到期項目的補充說明：把規則用語改成白話
String detailText(Object? detail) =>
    (truthy(detail) ? jsString(detail) : '').replaceFirstMapped(RegExp(r'^批文有效期開始\s*(\d{4}-\d{2}-\d{2})$'), (m) => '由批文生效日 ${m[1]} 起計');

// 金額：HK$ 1,200／¥ 1,200／MOP 1,200；有角分才顯示小數
const currencySign = {'HKD': r'HK$', 'RMB': '¥', 'CNY': '¥', 'MOP': 'MOP'};

String money(Object? currency, Object? cents) {
  final value = jsNumber(truthy(cents) ? cents : 0) / 100;
  final whole = value.isFinite && value == value.truncateToDouble();
  final sign = currencySign[currency] ?? (truthy(currency) ? jsString(currency) : '');
  return '$sign ${_enUs(value, whole ? 0 : 2)}'.trim();
}

// value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 })
String _enUs(double value, int digits) {
  if (value.isNaN) return 'NaN';
  if (value.isInfinite) return value > 0 ? '∞' : '-∞';
  final text = value.abs().toStringAsFixed(digits);
  final parts = text.split('.');
  final grouped = parts[0].replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  final negative = value < 0 || (value == 0 && value.isNegative);
  return '${negative ? '-' : ''}$grouped${parts.length > 1 ? '.${parts[1]}' : ''}';
}

// 車牌名稱：內地牌 · 香港／澳門牌；都沒有時寫「車牌待補充」
String plateName(Map p) {
  Object? pick(String a, String b) => truthy(p[a]) ? p[a] : p[b];
  final parts = [pick('mainlandPlate', 'mainland_plate'), pick('localPlate', 'local_plate')].where(truthy).map(jsString);
  final text = parts.join(' · ');
  return text.isEmpty ? '車牌待補充' : text;
}

// 牌照詳情、辦理的目的地（頁面在階段 2、3b 才做）
String platePath(Object? id) => '/plate-detail?id=${Uri.encodeComponent(jsString(id))}';
String requestPath(Object? serviceCode, [Object? plateId]) =>
    '/requests?service=${Uri.encodeComponent(truthy(serviceCode) ? jsString(serviceCode) : '')}${truthy(plateId) ? '&plate=${Uri.encodeComponent(jsString(plateId))}' : ''}';

// 日期：純日期照用；時間戳（伺服器存 UTC）換成香港日期，否則香港早上 8 點前會顯示成前一天。香港沒有夏令時間，固定加 8 小時
String friendlyDate(Object? value) {
  if (!truthy(value)) return '待核對';
  final text = jsString(value);
  if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text)) return text;
  final time = _parseDate(text);
  if (time == null) return text.length > 10 ? text.substring(0, 10) : text;
  final hk = DateTime.fromMillisecondsSinceEpoch(time.millisecondsSinceEpoch + 8 * 3600000, isUtc: true);
  return '${hk.year.toString().padLeft(4, '0')}-${_two(hk.month)}-${_two(hk.day)}';
}

String _two(int n) => n.toString().padLeft(2, '0');

// Date.parse：接受 ISO 格式（伺服器傳的就是這種）和「2026/11/15」；沒寫時區的當作本地時間（和 JS 一樣）。
// 其他寫法（例如英文月份）JS 各引擎不一致，這裏當作無法解析
DateTime? _parseDate(String text) {
  final slash = RegExp(r'^(\d{4})/(\d{1,2})/(\d{1,2})$').firstMatch(text);
  if (slash != null) {
    final (y, m, d) = (int.parse(slash[1]!), int.parse(slash[2]!), int.parse(slash[3]!));
    return m < 1 || m > 12 || d < 1 || d > 31 ? null : DateTime(y, m, d);
  }
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$').hasMatch(text)) return null;
  return DateTime.tryParse(text);
}

// 到期日還有幾天（按本地時間當天 23:59:59 計）；沒有日期回傳 null，日期格式不對回傳 NaN（和 JS 一樣）
num? daysLeft(Object? value, [DateTime? now]) {
  if (!truthy(value)) return null;
  final end = DateTime.tryParse('${jsString(value)}T23:59:59');
  if (end == null || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(jsString(value))) return double.nan;
  final diff = end.millisecondsSinceEpoch - (now ?? DateTime.now()).millisecondsSinceEpoch;
  return (diff / 86400000).ceil();
}

// 上傳文件上限（第 15 輪）
const maxUpload = 5 * 1024 * 1024;

// 附件狀態
const attachmentTone = {'待確認': 'blue', '已確認': '', '需重交': 'red'};
const attachmentLabel = {'待確認': '顧問核對中', '已確認': '已收妥', '需重交': '需要重交'};

// ContactCard.vue 的電話寫法：+852 1234 5678、+86 138 1234 5678
String phoneText(Object? value) => (truthy(value) ? jsString(value) : '')
    .replaceFirstMapped(RegExp(r'^\+(852|853)(\d{4})(\d{4})$'), (m) => '+${m[1]} ${m[2]} ${m[3]}')
    .replaceFirstMapped(RegExp(r'^\+86(\d{3})(\d{4})(\d{4})$'), (m) => '+86 ${m[1]} ${m[2]} ${m[3]}');
