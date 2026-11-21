// 自行辦理更新頁的狀態和計算：逐條照搬 mobile/src/pages/self-change/self-change.vue 的 ref、computed 和函數
// （docs/tasks/self-handled-changes-design.md：客戶自行辦理後更新資料，資料立即生效，托管客戶由顧問整件核對）。
// 不依賴 Flutter，方便逐個情況測試；頁面（self_change_page.dart）只負責畫和接 API。
import '../../core/js.dart';
import '../../core/wording.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf, str;

const selfChangeNames = {
  'vehicle_change': '自行換車', 'renewal': '自行續期', 'driver_change': '自行換司機', 'stop_renewal': '不再續期', 'inspection_done': '自行驗車',
  'filing_done': '自行備案', 'tax_paid': '自行繳交行車稅', 'crossing_change': '自行口岸變更', 'company_change': '自行商號變更', 'replacement': '自行補領',
};

// 驗車、新批文備案、行車稅：只是標記一期辦好，不用拍新批文卡
const markProof = {'inspection_done': '檢驗標誌或檢驗結果', 'filing_done': '備案回執', 'tax_paid': '行車稅繳費收據'};
const markDoing = {'inspection_done': '驗車', 'filing_done': '新批文備案', 'tax_paid': '繳交澳門行車稅'};
const changeDoing = {'vehicle_change': '換車', 'renewal': '續期', 'driver_change': '換司機', 'crossing_change': '口岸變更', 'company_change': '商號變更', 'replacement': '補領'};

String todayIso([DateTime? now]) {
  final d = now ?? DateTime.now();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

class DriverDraft {
  DriverDraft({this.name = '', this.role = '主', this.phone = '', Map<String, String>? dates}) : dates = dates ?? {};
  String name, role, phone;
  final Map<String, String> dates;
}

class RenewalDraft {
  const RenewalDraft({this.done = false, this.expiresOn = ''});
  final bool done;
  final String expiresOn;
}

class SelfChangeForm {
  SelfChangeForm({Map<String, String> query = const {}, DateTime? now}) {
    // onLoad：網址參數（go_router 已解碼）
    plateId = query['plate'] ?? '';
    kind = selfChangeNames.containsKey(query['kind']) ? query['kind']! : 'vehicle_change';
    wantedPlate = query['newPlate'] ?? '';
    mark = (period: query['period'] ?? '', name: query['name'] ?? '', label: query['label'] ?? '', dueOn: query['dueOn'] ?? '');
    today = todayIso(now);
    handledOn = today;
  }

  late final String plateId, kind, wantedPlate, today;
  late final ({String period, String name, String label, String dueOn}) mark;
  late String handledOn;

  Map<String, dynamic> form = {};
  Map<String, dynamic> before = {};
  bool loaded = false;
  final cardText = <String, String>{'crossing': '', 'crpExpiresOn': '', 'company': '', 'contractor': '', 'serial': '', 'cardNumber': ''};
  final vehicle = <String, String>{'plate': '', 'brand': '', 'model': '', 'firstRegisteredOn': '', 'vin': ''};
  Map<String, String> dates = {};
  Map<String, RenewalDraft> renewal = {};
  bool filingDone = false;
  List<DriverDraft> drivers = [];
  String stopReason = '', stopNote = '';

  String get kindName => selfChangeNames[kind]!;
  bool get marking => markProof.containsKey(kind);
  bool get pendingHere => listOf(form['pending']).contains(kind);
  bool get stopped => truthy(form['stoppedOn']) && kind != 'stop_renewal';
  String get localName => form['route'] == '粵澳' ? '澳門' : '香港';
  bool get showCardUpload => kind != 'stop_renewal' && !marking;

  String get intro => marking
      ? '你自己辦好了${markDoing[kind]}？在這裏標記，資料立即生效${forMode('，你的顧問會再核對', '')}。'
      : kind == 'stop_renewal'
          ? '決定不再續期這個兩地牌（例如已賣車、放棄指標）？告訴我們，停止到期提醒。'
          : '你自己辦好了${changeDoing[kind]}？在這裏一次更新，資料立即生效${forMode('，你的顧問會再核對', '')}。自行辦理的變更，請在辦好後 7 天內更新。';

  String get cardHint => switch (kind) {
        'crossing_change' => '拍下新卡正面，系統會讀出新的通行口岸。',
        'company_change' => '拍下新卡正面，系統會讀出新的商號和內承單位。',
        'replacement' => forMode('拍下補領的新卡，顧問會對照核對。', '拍下補領的新卡。'),
        'vehicle_change' => forMode('換車後批文卡上的港澳車牌會改變，請拍下新卡正反面，顧問會對照核對。', '換車後批文卡上的港澳車牌會改變，請拍下新卡正反面。'),
        'renewal' => '拍下新卡，系統會讀出新的有效期，填在下面。',
        'driver_change' => forMode('新卡背面列出駕駛人，請拍下正反面，顧問會對照核對。', '新卡背面列出駕駛人，請拍下正反面。'),
        _ => 'undefined',
      };

  String get photoLabel => const {
        'crossing_change': '新禁區紙相片', 'company_change': '公司變更證明相片', 'replacement': '補領證明相片', 'vehicle_change': '新車行車證、保險單相片',
        'renewal': '新證件相片（例如香港許可證）', 'driver_change': '新司機證件相片', 'inspection_done': '檢驗標誌或檢驗結果相片', 'filing_done': '備案回執相片', 'tax_paid': '行車稅繳費收據相片',
      }[kind] ?? 'undefined';

  String get submitText => kind == 'stop_renewal' ? '確認不再續期' : marking ? '標記已辦好' : '提交更新';

  String get currentVehicle {
    final v = form['vehicle'];
    return [at(v, 'plate'), at(v, 'brand'), at(v, 'model')].where(truthy).map(jsString).join(' · ');
  }

  // 載入表單後預先填入：cardBefore 是顧問核對前的原來卡面；新卡（剛改或剛上傳）讀出不同的值才預先填入
  void fillDefaults() {
    final f = form;
    before = at(f, 'cardBefore') is Map ? Map<String, dynamic>.from(f['cardBefore'] as Map) : {};
    final card = at(f, 'card');
    String changed(String key) => truthy(at(card, key)) && at(card, key) != before[key] ? jsString(at(card, key)) : '';
    String keep(String key, String fallback) => cardText[key]!.isNotEmpty ? cardText[key]! : fallback;
    if (kind == 'crossing_change') cardText['crossing'] = keep('crossing', changed('crossing'));
    if (kind == 'company_change') {
      cardText['company'] = keep('company', str(at(card, 'company')));
      cardText['contractor'] = keep('contractor', str(at(card, 'contractor')));
    }
    if (kind == 'replacement') {
      cardText['serial'] = keep('serial', changed('serial'));
      cardText['cardNumber'] = keep('cardNumber', str(at(card, 'cardNumber')));
    }
    if (kind == 'vehicle_change') {
      final fromCard = truthy(at(card, 'localPlate')) && at(card, 'localPlate') != at(f['vehicle'], 'plate') ? jsString(at(card, 'localPlate')) : '';
      if (vehicle['plate']!.isEmpty) vehicle['plate'] = wantedPlate.isNotEmpty ? wantedPlate : fromCard;
      dates = {for (final d in listOf(f['vehicleDates'])) jsString(at(d, 'code')): dates[jsString(at(d, 'code'))] ?? ''};
    }
    if (kind == 'renewal') {
      final next = <String, RenewalDraft>{};
      for (final doc in listOf(f['renewalDocuments'])) {
        final code = jsString(at(doc, 'code'));
        next[code] = renewal[code] ?? const RenewalDraft();
      }
      // 新卡讀出的有效期比原來晚時，預先填在批文那一行（不可把舊日期當成新日期）
      final read = str(at(card, 'validTo')), original = str(at(f['cardBefore'], 'validTo'));
      final approval = next['approval'];
      if (approval != null && approval.expiresOn.isEmpty && read.isNotEmpty && original.isNotEmpty && read.compareTo(original) > 0 && read.compareTo(today) > 0) {
        next['approval'] = RenewalDraft(done: true, expiresOn: read);
      }
      renewal = next;
    }
    if (kind == 'driver_change' && drivers.isEmpty) {
      final current = listOf(f['drivers']).map((d) => jsString(at(d, 'name'))).toList();
      final onCard = listOf(at(card, 'drivers')).map(jsString).toList();
      final list = onCard.isNotEmpty && onCard.join(',') != current.join(',')
          ? [for (final (i, name) in onCard.indexed) (name, i == 0 ? '主' : '副')]
          : [for (final d in listOf(f['drivers'])) (jsString(at(d, 'name')), jsString(at(d, 'role')))];
      drivers = (list.isNotEmpty ? list : [('', '主')]).map((d) => DriverDraft(name: d.$1, role: d.$2)).toList();
    }
  }

  void setDone(String code, bool done) {
    renewal = {...renewal, code: RenewalDraft(done: done, expiresOn: done ? (renewal[code]?.expiresOn ?? '') : '')};
  }

  void setRenewalDate(String code, String date) {
    final old = renewal[code] ?? const RenewalDraft();
    renewal = {...renewal, code: RenewalDraft(done: old.done, expiresOn: date)};
  }

  void setMain(int index) {
    for (final (i, d) in drivers.indexed) {
      d.role = i == index ? '主' : '副';
    }
  }

  void addDriver() => drivers.add(DriverDraft(role: drivers.any((d) => d.role == '主') ? '副' : '主'));

  // 先在手機上擋下明顯漏填，伺服器仍會再檢查；photos 是已選相片張數
  String problem(int photos) {
    if (kind == 'vehicle_change' && vehicle['plate']!.trim().isEmpty) return '請填寫新車車牌';
    if (kind == 'renewal') {
      final done = renewal.values.where((v) => v.done).toList();
      if (done.isEmpty) return '請選出已續期的文件';
      if (done.any((v) => v.expiresOn.isEmpty)) return '請填寫已續期文件的新到期日';
    }
    if (kind == 'driver_change' && drivers.any((d) => d.name.trim().isEmpty)) return '請填寫司機姓名';
    if (kind == 'stop_renewal' && stopReason.isEmpty) return '請選擇不再續期的原因';
    if (kind == 'crossing_change' && cardText['crossing']!.trim().isEmpty) return '請填寫新的通行口岸';
    if (kind == 'company_change' && cardText['company']!.trim().isEmpty && cardText['contractor']!.trim().isEmpty) return '請填寫新的商號或內承單位';
    if (kind == 'replacement' && cardText['serial']!.trim().isEmpty) return '請填寫新卡的卡面流水號';
    if (marking && photos == 0) return '請附上${markProof[kind]}相片';
    return '';
  }

  Map<String, dynamic> body(List<String> photos) {
    final base = <String, dynamic>{'kind': kind, 'handledOn': handledOn};
    if (kind == 'stop_renewal') return {...base, 'reason': stopReason, 'note': stopNote};
    final shared = {...base, 'photos': photos};
    if (kind == 'vehicle_change') return {...shared, 'vehicle': {...vehicle}, 'dates': {for (final e in dates.entries) if (e.value.isNotEmpty) e.key: e.value}};
    if (marking) return {...shared, 'period': mark.period};
    if (kind == 'crossing_change') return {...shared, 'crossing': cardText['crossing'], if (cardText['crpExpiresOn']!.isNotEmpty) 'crpExpiresOn': cardText['crpExpiresOn']};
    // 只送出有填的一項；原本卡上沒有的那項可以留空
    if (kind == 'company_change') {
      return {...shared, if (cardText['company']!.trim().isNotEmpty) 'company': cardText['company'], if (cardText['contractor']!.trim().isNotEmpty) 'contractor': cardText['contractor']};
    }
    if (kind == 'replacement') return {...shared, 'serial': cardText['serial'], if (cardText['cardNumber']!.isNotEmpty) 'cardNumber': cardText['cardNumber']};
    if (kind == 'renewal') {
      return {
        ...shared,
        'documents': {for (final e in renewal.entries) e.key: e.value.done ? {'done': true, 'expiresOn': e.value.expiresOn} : {'done': false}},
        if (renewal['approval']?.done == true) 'newCardFiling': filingDone,
      };
    }
    return {
      ...shared,
      'drivers': [
        for (final d in drivers) {'name': d.name, 'role': d.role, 'phone': d.phone, 'dates': {for (final e in d.dates.entries) if (e.value.isNotEmpty) e.key: e.value}},
      ],
    };
  }

  String get doneToast => kind == 'stop_renewal' ? forMode('已記錄，顧問會聯絡你', '已記錄') : marking ? forMode('已標記辦好，顧問會再核對', '已標記辦好') : forMode('已更新，顧問會再核對', '已更新');
}
