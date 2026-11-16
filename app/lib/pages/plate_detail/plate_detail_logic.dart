// 牌照詳情頁的計算：逐條照搬 mobile/src/pages/plate-detail/plate-detail.vue 的 computed 和小函數。
// 伺服器資料是 JSON（Map／List），真假和轉字串照 JS 規則（core/js.dart），連奇怪的值也和現有 App 顯示一樣。
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';

typedef J = Map<String, dynamic>;

// 取值的小工具：a?.b?.c 和 JS 的 String(x||'')
Object? at(Object? v, String key) => v is Map ? v[key] : null;
List<dynamic> listOf(Object? v) => v is List ? v : const [];
String str(Object? v) => truthy(v) ? jsString(v) : '';

const healthTone = {'ok': '', 'due': 'amber', 'overdue': 'red', 'pending': 'gray'};
String healthLabel(Object? health) => switch (health) { 'ok' => '正常', 'due' => '快到期', 'overdue' => '已逾期', 'pending' => noDatesWord(), _ => 'undefined' };

const cycleLabel = {'monthly': '每月', 'quarterly': '每季', 'yearly': '每年'};
const feeTone = {'已收': 'gray', '逾期': 'red', '部分收': 'amber', '待收': ''};
const levelWord = {'overdue': '已逾期', 'due': '快到期'};

// 自管客戶只可選未上牌／已上牌，沒有選時顯示「未填寫」；托管照舊
List<String> installOptions() => isSelfManaged() ? const ['未上牌', '已上牌'] : const ['待核對', '未上牌', '已上牌'];
String installWord(Object? status) => isSelfManaged() && status == '待核對' ? '未填寫' : jsString(status);
String usageWord(Object? status) => !truthy(status) || status == '待核對' ? unsetWord() : status == '暫停使用' ? '空置' : jsString(status);

// 90 天過關有自己的卡片，不在到期清單重複
List<dynamic> deadlineList(J summary) {
  final enabled = truthy(at(summary['crossing'], 'enabled'));
  return listOf(summary['deadlines']).where((item) => !(enabled && at(item, 'name') == '90 天過關')).toList();
}

List<dynamic> vehiclePermits(J summary) => listOf(summary['vehiclePermits']);

// 通行證與備案在「車輛與證件」填，不重複列在「還沒有填日期」
List<dynamic> undatedList(J summary) {
  final permits = vehiclePermits(summary);
  return listOf(summary['undated']).where((item) => !(at(item, 'ownerType') == 'plate' && permits.any((p) => at(p, 'code') == at(item, 'code')))).toList();
}

String deadlineSub(Object? item) => [at(item, 'ownerType') == 'plate' ? '' : at(item, 'ownerLabel'), detailText(at(item, 'detail'))].where(truthy).map(jsString).join(' · ');

String cardSummary(J p) {
  final status = truthy(p['card_status']) ? jsString(p['card_status']) : '待核對';
  final expires = truthy(p['card_expires_on']) ? '有效期至 ${jsString(p['card_expires_on'])}' : '';
  if (isSelfManaged() && status == '待核對') return expires.isNotEmpty ? expires : '已建檔';
  return status + (expires.isNotEmpty ? ' · $expires' : '');
}

String rentalTone(Object? a) => at(a, 'status') == '生效' ? '' : ['草擬', '待換車'].contains(at(a, 'status')) ? 'amber' : 'gray';

String feeLabel(Object? a, Object? i) => at(i, 'status') == '已收'
    ? (at(a, 'collectionMode') == '代收' ? '我們已收到' : '已確認收到')
    : at(i, 'status') == '逾期'
        ? '未收到（已過期）'
        : at(i, 'status') == '部分收'
            ? '部分收到'
            : '未到期';

int clientTodoCount(J summary) =>
    listOf(summary['deadlines']).where((i) => ['due', 'overdue'].contains(at(i, 'level')) && (at(i, 'handledBy') == 'you' || at(i, 'code') == 'crossing_90')).length;

String deadlineSummary(J summary) {
  final list = deadlineList(summary), undated = undatedList(summary);
  final gap = undated.isNotEmpty ? '${undated.length} 項未填日期' : '';
  if (list.isEmpty) return gap.isNotEmpty ? gap : (summary['health'] == 'pending' ? (isSelfManaged() ? '未填到期日' : '整理中') : '半年內沒有');
  final urgent = list.where((i) => ['overdue', 'due'].contains(at(i, 'level'))).toList();
  return '${list.length} 項${urgent.isNotEmpty ? ' · ${urgent.length} 項${levelWord[urgent.any((i) => at(i, 'level') == 'overdue') ? 'overdue' : 'due']}' : ''}${gap.isNotEmpty ? ' · $gap' : ''}';
}

String crossingSummary(J summary) {
  final c = summary['crossing'];
  return !truthy(at(c, 'enabled')) ? '未開啟' : truthy(at(c, 'lastCrossedOn')) ? '上次 ${jsString(at(c, 'lastCrossedOn'))}' : '未記錄過關日期';
}

String vehicleSummary(J summary, List<dynamic> bound, Map<String, dynamic> docs) {
  final v = bound.isEmpty ? null : bound.first;
  final gap = vehiclePermits(summary).where((item) => !truthy(at(item, 'dueOn'))).length;
  final gapText = gap > 0 ? ' · $gap 項未填日期' : '';
  if (v == null) return '尚未登記車輛$gapText';
  final list = listOf(at(docs[at(v, 'id')], 'documents'));
  return '${jsString(at(v, 'plate'))}$gapText${list.isNotEmpty ? ' · 證件 ${list.where((d) => truthy(at(d, 'uploaded'))).length}/${list.length} 已上傳' : ''}';
}

String driverSummary(J summary) {
  final list = listOf(summary['drivers']);
  if (list.isEmpty) return '未登記';
  final main = list.cast<Object?>().firstWhere((d) => at(d, 'role') == '主', orElse: () => list.first);
  return '${jsString(at(main, 'name'))}（${at(main, 'role') == '主' ? '主' : '副'}）${list.length > 1 ? ' 等 ${list.length} 人' : ''}';
}

// 有出租時，摘要加狀態或最近一期租金的收款狀態
String paidWord(Object? a) {
  final list = listOf(at(a, 'invoices'));
  if (list.any((i) => at(i, 'status') == '逾期')) return '有逾期未收';
  if (list.isEmpty) return '未有租金記錄';
  final sorted = [...list]..sort((x, y) => jsString(at(y, 'period')).compareTo(jsString(at(x, 'period'))));
  final last = sorted.first;
  return at(last, 'status') == '已收' ? '已收' : at(last, 'status') == '部分收' ? '部分收到' : '未到期';
}

String usageSummary(J summary, List<dynamic> arrangements) {
  final active = arrangements.cast<Object?>().firstWhere((a) => at(a, 'status') == '生效', orElse: () => arrangements.isEmpty ? null : arrangements.first);
  if (active != null) return '${jsString(at(at(active, 'user'), 'name'))} · ${at(active, 'status') == '生效' ? paidWord(active) : jsString(at(active, 'statusWord'))}';
  return holderUsage(summary);
}

// 「出租：xx」、自用、空置……（摘要和持牌公司區共用）
String holderUsage(J s) => truthy(s['rental'])
    ? '出租：${jsString(at(s['rental'], 'renter'))}'
    : s['usageStatus'] == '自用'
        ? '自用'
        : s['usageStatus'] == '暫停使用'
            ? '空置'
            : s['installationStatus'] == '未上牌'
                ? '空置（未上牌）'
                : unsetWord();

String boundVehicle(J p, List<dynamic> vehicles) {
  final v = vehicles.cast<Object?>().firstWhere((x) => at(x, 'id') == p['vehicle_id'], orElse: () => null);
  return v != null ? [at(v, 'brand'), at(v, 'model'), at(v, 'plate')].where(truthy).map(jsString).join(' · ') : '未綁定';
}

String plateSummary(J? p, List<dynamic> vehicles) => p == null ? '' : '${p['installation_status'] == '待核對' ? unsetWord() : jsString(p['installation_status'])} · ${boundVehicle(p, vehicles)}';

List<({String id, String label})> vehicleOptions(J p, List<dynamic> vehicles) => [
      (id: '', label: '未綁定'),
      for (final v in vehicles)
        if (at(v, 'customer_id') == p['customer_id'] && at(v, 'route') == p['route'] && (!truthy(at(v, 'retired_on')) || at(v, 'id') == p['vehicle_id']))
          (id: jsString(at(v, 'id')), label: [at(v, 'plate'), at(v, 'brand'), at(v, 'model')].where(truthy).map(jsString).join(' · ')),
    ];

// 退回的說明顯示 30 天；不再續期待核對時，上面的「已標記不再續期」已說明，不重複
List<dynamic> selfNotes(List<dynamic> records, J? plate, [DateTime? now]) {
  final seen = <Object?>{};
  final t = (now ?? DateTime.now()).millisecondsSinceEpoch;
  return records.where((r) {
    if (seen.contains(at(r, 'kind'))) return false;
    seen.add(at(r, 'kind'));
    final reviewed = DateTime.tryParse(str(at(r, 'reviewedAt')))?.millisecondsSinceEpoch;
    return (at(r, 'status') == '已退回' && reviewed != null && t - reviewed < 30 * 86400000) ||
        (at(r, 'status') == '待核對' && !(at(r, 'kind') == 'stop_renewal' && truthy(plate?['stopped_on'])));
  }).toList();
}

String fieldStatusText(Object? status) => at(status, 'status') == 'uncertain' ? '請核對' : at(status, 'status') == 'failed' ? '未能辨識，請手動填寫' : '';
bool fieldStatusFailed(Object? status) => at(status, 'status') == 'failed';

// 批文卡欄位（cardFields）
const cardFields = [
  ('cardNumber', '編號'), ('company', '商號'), ('contractor', '內承單位'), ('crossing', '通行口岸'), ('serial', '卡面流水號'), ('mainlandPlate', '內地車牌號'),
  ('localPlate', '港澳車牌號'), ('driver1', '駕駛人 1'), ('driver2', '駕駛人 2'), ('driver3', '駕駛人 3'), ('currentApproval', '現批文號'), ('previousApproval', '原批文號'),
  ('color', '顏色'), ('seats', '座位／噸位'), ('purpose', '請予辦理'), ('validFrom', '有效期開始'), ('validTo', '有效期結束'), ('notes', '備註'),
];

// 上傳過的批文卡照片（正本）：有哪一面就看哪一面
List<String> originalSides(Object? plateDetail) => ['front', 'back'].where((side) => truthy(at(at(plateDetail, 'cardImages'), side))).toList();

String formatMacau(Object? value) =>
    jsString(value ?? '').toUpperCase().replaceAll(RegExp(r'[\s-]'), '').replaceFirstMapped(RegExp(r'^([A-Z]{2})([0-9]{2})([0-9]{2})$'), (m) => '${m[1]}-${m[2]}-${m[3]}');

String todayIso([DateTime? now]) {
  final d = now ?? DateTime.now();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

// 改動判斷：回傳要問的那一條（標題、哪類變更、對應的自行辦理種類、新車牌）；沒有要問的回傳 null
typedef ChangeAsk = ({String title, String change, String kind, String newPlate});

String driverNames(Map card) {
  final list = ['driver1', 'driver2', 'driver3'].map((k) => truthy(card[k]) ? jsString(card[k]).trim() : '').where((s) => s.isNotEmpty).toList()..sort();
  return list.join('、');
}

// 比較批文卡改動：港澳車牌→換車、駕駛人→換司機、有效期延後→續期、口岸（粵港）→口岸變更、商號／內承單位→商號變更、流水號→補領
ChangeAsk? cardChange(Map before, Map after, Object? route) {
  String text(Map m, String key) => truthy(m[key]) ? jsString(m[key]).trim() : '';
  final local = text(after, 'localPlate'), oldLocal = text(before, 'localPlate');
  if (local.isNotEmpty && oldLocal.isNotEmpty && local.toUpperCase() != oldLocal.toUpperCase()) {
    return (title: '港澳車牌由 $oldLocal 改為 $local', change: '換車', kind: 'vehicle_change', newPlate: local);
  }
  final b = driverNames(before), a = driverNames(after);
  if (b.isNotEmpty && a.isNotEmpty && b != a) return (title: '駕駛人改為 $a', change: '換司機', kind: 'driver_change', newPlate: '');
  final bv = before['validTo'], av = after['validTo'];
  if (truthy(bv) && truthy(av) && jsString(av).compareTo(jsString(bv)) > 0) return (title: '有效期延至 ${jsString(av)}', change: '續期', kind: 'renewal', newPlate: '');
  bool moved(String key) => text(after, key).isNotEmpty && text(before, key).isNotEmpty && text(after, key) != text(before, key);
  if (moved('crossing') && route == '粵港') return (title: '通行口岸改為 ${text(after, 'crossing')}', change: '口岸變更', kind: 'crossing_change', newPlate: '');
  if (moved('company') || moved('contractor')) {
    final key = moved('company') ? 'company' : 'contractor';
    return (title: '${moved('company') ? '商號' : '內承單位'}改為 ${text(after, key)}', change: '商號變更', kind: 'company_change', newPlate: '');
  }
  if (moved('serial')) return (title: '卡面流水號改為 ${text(after, 'serial')}', change: '補領', kind: 'replacement', newPlate: '');
  return null;
}

// askChange 的確認鍵文字
const changeOk = {'換車': '辦了換車', '換司機': '換了司機', '續期': '辦了續期', '口岸變更': '辦了變更', '商號變更': '辦了變更', '補領': '辦了補領'};

// 「你自己辦好了甚麼？」：粵港才有口岸變更
List<(String, String)> ownChanges(Object? route) => [
      ('續期', 'renewal'), ('換車', 'vehicle_change'), ('換司機', 'driver_change'),
      if (route == '粵港') ('口岸變更', 'crossing_change'),
      ('商號變更', 'company_change'), ('補領批文卡', 'replacement'),
    ];

const advisorChanges = [('續期', 'renewal'), ('換車', 'vehicle_change'), ('換司機', 'driver_change'), ('其他', 'other')];

// 自行辦理頁的網址（openSelf）
String selfChangePath(String plateId, String kind, {String newPlate = '', Map<String, Object?> extra = const {}}) {
  final query = <String, Object?>{'plate': plateId, 'kind': kind, if (newPlate.isNotEmpty) 'newPlate': newPlate, ...extra};
  return '/self-change?${query.entries.map((e) => '${e.key}=${Uri.encodeComponent(e.value == null ? 'undefined' : jsString(e.value))}').join('&')}';
}

// 驗車、新批文備案、澳門車輛稅：客戶自己辦好了
String markDoneKind(Object? code) => code == 'inspection' ? 'inspection_done' : code == 'mo_vehicle_tax' ? 'tax_paid' : 'filing_done';

// 下一件要做的事：先逾期、再快到期（你自理的事項、90 天過關），然後是車輛登記和必要證件
enum NextAction { crossToday, markDone, openDeadlines, registerVehicle, uploadDoc }

class NextStep {
  NextStep({required this.title, required this.sub, required this.label, required this.action, this.level = '', this.dueOn = '', this.item, this.doc});
  final String title, sub, label, level, dueOn;
  final NextAction action;
  final Object? item, doc;
}

NextStep? nextStep({required J? plate, required J summary, required List<dynamic> bound, required Map<String, dynamic> docs, DateTime? now}) {
  final p = plate;
  if (p == null || !truthy(summary['id'])) return null;
  final steps = <NextStep>[];
  const rank = {'overdue': 0, 'due': 1};
  final c = summary['crossing'];
  if (truthy(at(c, 'enabled')) && truthy(at(c, 'nextDueOn'))) {
    final left = daysLeft(at(c, 'nextDueOn'), now);
    if (left != null && left <= 15) {
      final due = jsString(at(c, 'nextDueOn'));
      steps.add(NextStep(
        level: left < 0 ? 'overdue' : 'due',
        dueOn: due,
        title: '90 天內要過關一次',
        sub: '${left < 0 ? '已過期限 ' : '期限 '}$due${truthy(at(c, 'lastCrossedOn')) ? '，上次 ${jsString(at(c, 'lastCrossedOn'))}' : ''}',
        label: '今天已過關',
        action: NextAction.crossToday,
      ));
    }
  }
  for (final item in deadlineList(summary)) {
    final level = at(item, 'level');
    if (at(item, 'handledBy') == 'you' && rank.containsKey(level)) {
      steps.add(NextStep(
        level: '$level',
        dueOn: jsString(at(item, 'dueOn')),
        title: '${jsString(at(item, 'name'))}${level == 'overdue' ? '已逾期' : '快到期'}',
        sub: [at(item, 'ownerType') == 'plate' ? '' : at(item, 'ownerLabel'), '到期日 ${jsString(at(item, 'dueOn'))}', '請你自行辦理'].where(truthy).map(jsString).join(' · '),
        label: truthy(at(item, 'markable')) ? '已辦好' : truthy(at(item, 'editable')) ? '更新到期日' : '查看',
        action: truthy(at(item, 'markable')) ? NextAction.markDone : NextAction.openDeadlines,
        item: item,
      ));
    }
  }
  // Array.sort 是穩定排序；Dart 的 List.sort 不保證，用 mergeSort 的做法：先記下次序
  final indexed = [for (var i = 0; i < steps.length; i++) (i, steps[i])];
  indexed.sort((a, b) {
    final r = rank[a.$2.level]! - rank[b.$2.level]!;
    if (r != 0) return r;
    final d = a.$2.dueOn.compareTo(b.$2.dueOn);
    return d != 0 ? d : a.$1 - b.$1;
  });
  if (indexed.isNotEmpty) return indexed.first.$2;
  if (bound.isEmpty && p['installation_status'] != '未上牌' && truthy(p['local_plate'])) {
    return NextStep(
      title: '登記這部車',
      sub: '按港澳車牌 ${jsString(p['local_plate'])} 登記，之後可拍下行駛證和${p['route'] == '粵澳' ? '澳門車輛登記文件' : '香港車輛牌照'}。',
      label: '登記這部車',
      action: NextAction.registerVehicle,
    );
  }
  final v = bound.isEmpty ? null : bound.first;
  if (v != null) {
    final d = docs[at(v, 'id')];
    if (!truthy(at(d, 'retired'))) {
      final missing = listOf(at(d, 'documents')).cast<Object?>().firstWhere((x) => truthy(at(x, 'primary')) && !truthy(at(x, 'uploaded')), orElse: () => null);
      if (missing != null) {
        return NextStep(title: '上傳${jsString(at(missing, 'label'))}', sub: '拍下證件，系統會讀出車架號碼和日期。', label: '拍照上傳', action: NextAction.uploadDoc, doc: missing);
      }
    }
  }
  return null;
}

// 出租區的說明句
String usageNote(J summary, List<dynamic> arrangements, Object? rentalOptions) {
  final allowed = truthy(at(rentalOptions, 'allowed'));
  return '${usageSummary(summary, arrangements)}。${allowed ? '可以把這個牌照出租給別人使用：填好承租人和租金，我們會產生出租協議給你發出。' : truthy(rentalOptions) || isSelfManaged() ? '' : '出租由顧問記錄。'}';
}

// 車輛證件上傳後的提示
String docToast(Object? doc, Object? r) => !truthy(at(doc, 'recognizable'))
    ? '已上傳'
    : truthy(at(r, 'recognitionFailed'))
        ? '已上傳，未能辨識，請手動填寫'
        : listOf(at(r, 'applied')).isNotEmpty
            ? '已讀出並填入${listOf(at(r, 'applied')).map((a) => jsString(at(a, 'label'))).join('、')}'
            : '已上傳，請對照核對';
