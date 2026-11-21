// 委託內容頁的計算：逐條照搬 mobile/src/pages/scope/scope.vue 的 computed 和小函數。
import '../../core/js.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf;

// 從牌照頁或公司卡片進來（only 有值）時只看那一個；沒有任何對象的分類拿掉
List<Map> shownSections(List<dynamic> sections, String only) {
  final all = sections.whereType<Map>().toList();
  if (only.isEmpty) return all;
  return all
      .map((s) => {...s, 'owners': listOf(s['owners']).where((o) => at(o, 'id') == only).toList()})
      .where((s) => listOf(s['owners']).isNotEmpty)
      .toList();
}

List<dynamic> ownersOf(List<Map> sections) => [for (final s in sections) ...listOf(s['owners'])];

// 數目為 0 的那半句不寫
String ownerCounts(Object? owner) {
  final us = listOf(at(owner, 'us')).length, you = listOf(at(owner, 'you')).length;
  final text = [us > 0 ? '我們負責 $us 項' : '', you > 0 ? '你自行辦理 $you 項' : ''].where((s) => s.isNotEmpty).join(' · ');
  return text.isEmpty ? '暫時沒有委託事項' : text;
}

// 頂部摘要：整頁按牌照和公司數；單一對象寫它的項數（已標記不再續期的不寫）
String scopeSummary(List<Map> shown, String only) {
  final owners = ownersOf(shown);
  if (only.isNotEmpty) return owners.isNotEmpty && !truthy(at(owners.first, 'stopped')) ? ownerCounts(owners.first) : '';
  if (owners.isEmpty) return '';
  final plates = owners.where((o) => at(o, 'type') == 'plate').length, companies = owners.length - plates;
  return '${[plates > 0 ? '$plates 個牌照' : '', companies > 0 ? '$companies 間公司' : ''].where((s) => s.isNotEmpty).join(' · ')}。按進去看哪些事由我們負責、哪些由你自行辦理。';
}

// 申請調整委託：開「其他代辦要求」，標題自動帶牌照或公司；牌照的會鎖定那個牌照
String adjustPath(List<Map> shown, String only) {
  final owner = only.isNotEmpty && ownersOf(shown).isNotEmpty ? ownersOf(shown).first : null;
  if (owner == null) return '/requests?entrust=scope';
  final plate = at(owner, 'type') == 'plate' ? '&plate=${jsString(at(owner, 'id'))}' : '';
  return '/requests?entrust=scope&item=${Uri.encodeComponent(jsString(at(owner, 'label')))}$plate';
}

// 從單一對象進來時，導航列標題換成它的名稱（找不到就保持「委託內容」）
String? ownerTitle(List<dynamic> sections, String only) {
  if (only.isEmpty) return null;
  for (final s in sections) {
    for (final o in listOf(at(s, 'owners'))) {
      if (at(o, 'id') == only) return jsString(at(o, 'label'));
    }
  }
  return null;
}
