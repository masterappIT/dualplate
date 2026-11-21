// 我的牌照頁的計算：照抄 mobile/src/pages/vehicles/vehicles.vue（篩選、搜尋、用途文字、首頁帶來的篩選）。
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf;

String healthLabelOf(Object? health) => switch (health) { 'ok' => '正常', 'due' => '快到期', 'overdue' => '已逾期', 'pending' => noDatesWord(), _ => '' };
String healthToneOf(Object? health) => switch (health) { 'due' => 'amber', 'overdue' => 'red', 'pending' => 'gray', _ => '' };
// noteTone：overdue 紅、due 橙、upcoming 綠、ok 灰；其他沒有顏色
String noteToneOf(Object? level) => switch (level) { 'overdue' => 'note-red', 'due' => 'note-amber', 'upcoming' => 'note-green', 'ok' => 'note-gray', _ => '' };

bool idle(Object? p) => at(p, 'installationStatus') == '未上牌' || at(p, 'usageStatus') == '暫停使用';

String usageText(Object? p) => truthy(at(p, 'rental'))
    ? '出租：${jsString(at(at(p, 'rental'), 'renter'))}'
    : idle(p)
        ? '空置'
        : at(p, 'usageStatus') == '自用'
            ? '自用'
            : isSelfManaged()
                ? '未填用途'
                : '使用狀況確認中';

final Map<String, bool Function(Object?)> plateTests = {
  'attention': (p) => ['due', 'overdue'].contains(at(p, 'health')),
  'rented': (p) => truthy(at(p, 'rental')),
  'self': (p) => at(p, 'usageStatus') == '自用' && !truthy(at(p, 'rental')),
  'idle': idle,
};

typedef PlateFilter = ({String id, String name, int count});

List<PlateFilter> plateFilters(List<dynamic> summaries) => [
      (id: '', name: '全部', count: summaries.length),
      for (final (id, name) in const [('attention', '需注意'), ('rented', '出租中'), ('self', '自用'), ('idle', '空置')]) (id: id, name: name, count: summaries.where(plateTests[id]!).length),
    ];

// 數目為零的篩選不顯示（「全部」和目前選中的除外）
List<PlateFilter> shownFilters(List<dynamic> summaries, String filter) => plateFilters(summaries).where((f) => f.id.isEmpty || f.count > 0 || filter == f.id).toList();

List<dynamic> visiblePlates(List<dynamic> summaries, String filter, String keyword) {
  final word = keyword.trim().toLowerCase();
  return summaries.where((p) {
    if (filter.isNotEmpty && !plateTests[filter]!(p)) return false;
    if (word.isEmpty) return true;
    // [a,b,…].join(' ')：null 和 undefined 寫成空白
    final text = [at(p, 'mainlandPlate'), at(p, 'localPlate'), at(p, 'holder'), at(p, 'contractor'), at(p, 'cardNumber')].map((v) => v == null ? '' : jsString(v)).join(' ');
    return text.toLowerCase().contains(word);
  }).toList();
}

// 首頁按「正常／快到期／已逾期」：正常看全部，其餘看「需注意」，都改用列表
const plateFilterPresets = {'ok': '', 'due': 'attention', 'overdue': 'attention'};

// 列表卡第二行：持牌公司（沒有就寫「粵港兩地牌」）· 用途
String plateSubline(Object? p) => '${truthy(at(p, 'holder')) ? jsString(at(p, 'holder')) : '${jsString(at(p, 'route'))}兩地牌'} · ${usageText(p)}';

List<String> warningsOf(Object? p) => listOf(at(p, 'warnings')).map((w) => w == null ? '' : jsString(w)).toList();

// 預覽裏的「上牌狀態」「使用狀態」「批文卡編號」
String installText(Object? plate) {
  final s = at(plate, 'installation_status');
  return !truthy(s) || s == '待核對' ? unsetWord() : jsString(s);
}

String usageStatusText(Object? plate) {
  final s = at(plate, 'usage_status');
  return !truthy(s) || s == '待核對' ? unsetWord() : s == '出租中' ? '使用安排中' : jsString(s);
}

String cardNumberText(Object? plate) => truthy(at(plate, 'card_number')) ? jsString(at(plate, 'card_number')) : (isSelfManaged() ? '未填寫' : '待核對');
