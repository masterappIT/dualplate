// 出租頁的計算：照 mobile/src/pages/rental/rental.vue 的 computed 和小函數。
import '../../core/js.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf;

const signParties = [('lessor', '出租人'), ('renter', '承租人')];
const cycleLabel = {'monthly': '每月', 'quarterly': '每季', 'yearly': '每年'};
const rentalFeeTone = {'已收': 'gray', '逾期': 'red', '部分收': 'amber', '待收': ''};

String cycleWord(Object? cycle) => cycleLabel[cycle] ?? 'undefined';

String rentalFeeLabel(Map r, Map i) => i['status'] == '已收'
    ? (r['collectionMode'] == '代收' ? '我們已收到' : '已確認收到')
    : i['status'] == '逾期'
        ? '未收到（已過期）'
        : i['status'] == '部分收'
            ? '部分收到'
            : '未到期';

String rentalTone(Map r) => r['status'] == '生效' ? '' : (r['status'] == '草擬' || r['status'] == '待換車') ? 'amber' : 'gray';

Map agreementOf(Map? r) => r != null && r['agreement'] is Map ? r['agreement'] as Map : const {};
String _s(Object? v) => truthy(v) ? jsString(v) : '';

// 協議改了（去掉前後空白比較），或伺服器說這一版發出後改過
bool agreementChanged(Map? r, String draft) => draft.trim() != _s(agreementOf(r)['body']).trim() || truthy(agreementOf(r)['changed']);

// 第一次發、協議改了、或這一版還沒有出租人簽名：要先簽名
bool needSign(Map? r, String draft) {
  final a = agreementOf(r);
  return !truthy(a['version']) || agreementChanged(r, draft) || !truthy(a['lessorSigned']);
}

// 「10月18日 08:41」（香港時間）；沒有時間時空白
String when(Object? value) {
  if (!truthy(value)) return '';
  final t = DateTime.tryParse(jsString(value));
  if (t == null) return '';
  final hk = t.toUtc().add(const Duration(hours: 8));
  String two(int n) => n.toString().padLeft(2, '0');
  return '${hk.month}月${hk.day}日 ${two(hk.hour)}:${two(hk.minute)}';
}

List<Map> proceduresOf(Map r) => listOf(r['procedures']).whereType<Map>().toList();

// 現在輪到客戶：未發出協議，或有自行辦理的手續未辦（已終止的除外）
bool waitingOnYou(Map? r) {
  if (r == null) return false;
  return r['statusWord'] == '未發出協議' || proceduresOf(r).any((p) => p['handler'] == 'client' && p['state'] != 'done' && r['status'] != '已終止');
}

// 「現在」卡：只寫一件事
({String title, String sub}) nextStep(Map x, {required bool selfManaged}) {
  String mode(String custody, String self) => selfManaged ? self : custody;
  final mine = proceduresOf(x).where((p) => p['handler'] == 'client' && p['state'] != 'done').map((p) => jsString(p['name'])).toList();
  if (x['status'] == '已終止') return (title: x['statusWord'] == '已取消' ? '這次出租已取消' : '這次出租已終止', sub: '如要重新出租，可在牌照頁新增。');
  if (x['status'] == '已結束') return (title: '這次出租已結束', sub: '');
  if (x['status'] == '生效') return (title: '出租中', sub: '由 ${jsString(x['startsOn'])} 起計租金。');
  if (x['handling'] != 'self' && !truthy(agreementOf(x)['version'])) {
    return (title: '已交給我們代理', sub: mode('顧問會聯絡你和承租人處理協議和手續。', '我們會聯絡你和承租人處理協議和手續。'));
  }
  if (x['statusWord'] == '未發出協議') return (title: '把協議發給承租人', sub: '看過協議後按「發給承租人」，把連結傳給承租人確認。');
  if (x['statusWord'] == '待承租人確認') return (title: '等承租人確認協議', sub: '承租人打開連結後按「我同意這份協議」。連結不見了可以重新發送。');
  if (mine.isNotEmpty) return (title: '請辦理${mine.join('、')}', sub: '辦好後按「已辦好？更新」，在「有變動？」填上新資料。辦妥後就開始出租。');
  return (title: '等候換車、換司機辦妥', sub: '我們辦妥後就會開始出租，並通知你。');
}

// 換車、換司機自行辦好：打開「自行辦理更新」（換車時帶上承租人的車牌）
String reportDonePath(Map r, Map p) {
  final vehicle = p['kind'] == 'vehicle';
  return '/self-change?plate=${jsString(r['plateId'])}&kind=${vehicle ? 'vehicle_change' : 'driver_change'}'
      '${vehicle ? '&newPlate=${Uri.encodeComponent(jsString(at(r['renter'], 'vehiclePlate')))}' : ''}';
}

String whatsappLink(Map r, String url) => 'https://wa.me/?text=${Uri.encodeComponent('${jsString(at(r['renter'], 'name'))} 你好，這是 ${jsString(r['plateLabel'])} 的出租協議，請打開連結核對並確認（要輸入你電話最後 4 位）：$url')}';

// 「這一版的簽名」每方下面一行：簽名人 · 時間；未簽
String signedLine(Map r, String party) {
  final s = agreementOf(r)['${party}Signed'];
  return truthy(s) ? '${jsString(at(s, 'name'))} · ${when(at(s, 'at'))}' : '未簽';
}

String procedureSub(Map p) => p['handler'] == 'us' ? '交給我們辦 · ${jsString(p['price'])}' : '我自行辦理';

// 已上傳的簽署本最大 8 MB
const signedMaxBytes = 8 * 1024 * 1024;
