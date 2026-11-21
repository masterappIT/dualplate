// 新增牌照頁的計算：逐條照搬 mobile/src/pages/plate-create/plate-create.vue 的 computed 和小函數。
import '../../core/js.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf, str;

// 批文卡欄位（次序和名稱照舊）
const cardFields = [
  ('cardNumber', '批文卡編號'), ('company', '商號'), ('contractor', '內承單位'), ('crossing', '通行口岸'), ('serial', '卡面流水號'),
  ('mainlandPlate', '內地車牌號'), ('localPlate', '港澳車牌號'), ('driver1', '駕駛人 1'), ('driver2', '駕駛人 2'), ('driver3', '駕駛人 3'),
  ('currentApproval', '現批文號'), ('previousApproval', '原批文號'), ('color', '顏色'), ('seats', '座位／噸位'), ('purpose', '請予辦理'),
  ('validFrom', '有效期開始'), ('validTo', '有效期結束'), ('notes', '備註'),
];

// 持牌公司的選項：第一項是「按批文卡自動判斷」
List<({String id, String label})> groupOptions(Object? link) => [
      (id: '', label: '按批文卡自動判斷'),
      for (final g in listOf(at(link, 'groups'))) (id: jsString(at(g, 'id')), label: jsString(at(g, 'name'))),
    ];

// 持牌公司：按批文卡的商號、內承單位找名下公司；找不到就只用名稱新建，之後在「我的公司」補資料
String holderText(Object? link, String groupId, bool selfManaged) {
  if (groupId.isNotEmpty) {
    final g = listOf(at(link, 'groups')).cast<Object?>().firstWhere((g) => at(g, 'id') == groupId, orElse: () => null);
    return '將連到：${str(at(g, 'name'))}';
  }
  final fresh = listOf(at(link, 'companies')).where((c) => !truthy(at(c, 'existing'))).map((c) => jsString(at(c, 'name'))).toList();
  if (truthy(at(link, 'groupId'))) return '將連到你已有的公司：${jsString(at(link, 'groupName'))}${fresh.isNotEmpty ? '；${fresh.join('、')} 會加到這組' : ''}';
  if (fresh.isNotEmpty) return '會新建公司：${fresh.join('、')}。建檔後在「我的公司」補上登記號碼等資料即可。';
  return selfManaged ? '未辨識到商號；建立後可在「我的公司」補上。' : '未辨識到商號，你的顧問核對時會連到你的公司。';
}

String groupLinkText(String groupId) => groupId.isNotEmpty ? '改選或改回自動判斷 ›' : '不對？改選名下其他公司組 ›';

// 錄入到一半：已拍相片或填過資料
bool isDirty(Map<String, String> images, Map<String, Object?> draft) =>
    truthy(images['front']) || truthy(images['back']) || draft.values.any((v) => (truthy(v) ? jsString(v) : '').trim().isNotEmpty);

// 辨識結果只填空白的欄位（已填的不覆蓋）
Map<String, Object?> mergeRecognized(Map<String, Object?> draft, Object? cardData) {
  final next = {...draft};
  if (cardData is Map) {
    for (final e in cardData.entries) {
      if (truthy(e.value) && !truthy(next[e.key])) next['${e.key}'] = e.value;
    }
  }
  return next;
}

// 建立前檢查；回傳提示文字，可以建立時回傳空字串
String createProblem(Map<String, Object?> draft, Map<String, String> images) {
  final cardNumber = (truthy(draft['cardNumber']) ? jsString(draft['cardNumber']) : '').trim();
  if (cardNumber.isNotEmpty) return '';
  return truthy(images['front']) || truthy(images['back']) ? '未能辨識編號，請手動填寫' : '請先拍下批文卡';
}

String introText(bool selfManaged) => selfManaged ? '拍下批文卡正反面，系統會自動辨識，不用逐欄填寫；請核對一次辨識結果。' : '拍下批文卡正反面，系統會自動辨識，你的顧問會再核對，不用逐欄填寫。';
String fieldHint(bool selfManaged) => selfManaged ? '請對照批文卡核對；發現辨識錯誤可以直接修改。' : '其他內容顧問會對照原件核對；發現辨識錯誤也可以自行修改。';
String createText(bool busy, bool selfManaged) => busy ? '處理中…' : selfManaged ? '建立牌照' : '提交給顧問核對';

// 新批文備案：只在這一期已逾期時問
Object? overdueFiling(Object? plate) =>
    listOf(at(plate, 'deadlines')).cast<Object?>().firstWhere((d) => at(d, 'code') == 'new_card_filing' && at(d, 'level') == 'overdue', orElse: () => null);

// 「查看已拍的照片」：有預覽的面，從指定的一面開始
({List<String> sides, int current}) photoSides(Map<String, Object?> previews, String side) {
  final sides = ['front', 'back'].where((s) => previews[s] != null).toList();
  final i = sides.indexOf(side);
  return (sides: sides, current: i < 0 ? 0 : i);
}
