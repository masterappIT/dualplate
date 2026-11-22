// 新增出租頁的狀態和計算：照 mobile/src/pages/rental-new/rental-new.vue。
import '../../core/js.dart';

const cycleOptions = [('monthly', '每月'), ('quarterly', '每季'), ('yearly', '每年')];

// JS 的 Number(text)：去掉前後空白；空字串是 0；認得小數、科學記數、0x 十六進位；其他是 NaN
num jsNumberOf(String text) {
  final t = text.trim();
  if (t.isEmpty) return 0;
  if (RegExp(r'^[+-]?0[xX]').hasMatch(t) && (t.startsWith('-') || t.startsWith('+'))) return double.nan;
  if (t == 'Infinity' || t == '+Infinity') return double.infinity;
  if (t == '-Infinity') return double.negativeInfinity;
  if (RegExp(r'[^0-9a-fA-FxX.eE+-]').hasMatch(t)) return double.nan;
  return num.tryParse(t) ?? double.nan;
}

// 金額（元）→ 分：可帶千位逗號；負數、無效是 NaN（Math.round：.5 向上）
num cents(String text) {
  final value = jsNumberOf(text.replaceAll(',', ''));
  return value.isFinite && value >= 0 ? (value * 100 + .5).floor() : double.nan;
}

// JSON 裏的數字：NaN、無限大變 null（JSON.stringify），整數不帶小數點
Object? jsonNumber(num value) => !value.isFinite ? null : value == value.truncate() ? value.toInt() : value;

bool sameCar(Object? a, Object? b) => jsString(a ?? '').replaceAll(RegExp(r'\s'), '').toUpperCase() == jsString(b ?? '').replaceAll(RegExp(r'\s'), '').toUpperCase();

class RentalNewForm {
  Map? options;
  bool loaded = false;
  String renterName = '', renterPhone = '', renterIdNo = '';
  String lessorKey = 'client:';
  bool useCurrent = true;
  String vehiclePlate = '', newDriver = '';
  // 勾選的司機（Object.keys 的次序：第一次勾選的先）
  final Map<String, bool> pickedDrivers = {};
  String startsOn = '', endsOn = '', rent = '', deposit = '', cycle = 'monthly', dueDay = '5', handling = 'self', collection = '直付';
  final Map<String, String> procedures = {'vehicle': 'us', 'driver': 'us'};

  // 載入選項後的預設：第一間香港公司（建議以香港公司簽署），沒有就用本人；有登記車輛才預設用現有的車
  void applyOptions(Map o) {
    options = o;
    final lessors = o['lessors'] is List ? o['lessors'] as List : const [];
    final hk = lessors.whereType<Map>().where((l) => l['type'] == 'company' && l['hint'] == '香港公司').firstOrNull;
    lessorKey = hk != null ? 'company:${jsString(hk['id'])}' : 'client:';
    useCurrent = truthy(o['currentVehicle']);
  }

  // 換了車才要換車；有新司機才要換司機（與後台判斷一致）
  List<({String kind, String name})> get needed => [
        if (!useCurrent && vehiclePlate.trim().isNotEmpty && !sameCar(vehiclePlate, options?['currentVehicle'])) (kind: 'vehicle', name: '換車'),
        if (newDriver.trim().isNotEmpty) (kind: 'driver', name: '換司機'),
      ];

  num get rentAmount => cents(rent);
  num get depositAmount => deposit.isNotEmpty ? cents(deposit) : 0;

  // 提交前檢查（照次序，第一個問題）
  String problem() {
    if (renterName.trim().isEmpty) return '請填寫承租人姓名';
    if (startsOn.isEmpty) return '請選擇起租日期';
    final r = rentAmount;
    if (r == 0 || r.isNaN) return '請填寫租金';
    if (depositAmount.isNaN) return '押金金額無效';
    return '';
  }

  Map<String, Object?> body() {
    final sep = lessorKey.indexOf(':');
    final lessorType = sep < 0 ? lessorKey : lessorKey.substring(0, sep);
    final rest = sep < 0 ? '' : lessorKey.substring(sep + 1);
    final lessorCompanyId = rest.contains(':') ? rest.substring(0, rest.indexOf(':')) : rest;
    return {
      'renter': {'name': renterName, 'phone': renterPhone, 'idNo': renterIdNo},
      'lessorType': lessorType,
      'lessorCompanyId': lessorCompanyId.isEmpty ? null : lessorCompanyId,
      'useCurrentVehicle': useCurrent,
      'renterVehiclePlate': vehiclePlate,
      'driverIds': [for (final e in pickedDrivers.entries) if (e.value) e.key],
      'newDriverName': newDriver,
      'startsOn': startsOn,
      'endsOn': endsOn.isEmpty ? null : endsOn,
      'rentAmount': jsonNumber(rentAmount),
      'depositAmount': jsonNumber(depositAmount),
      'cycle': cycle,
      'dueDay': jsonNumber(jsNumberOf(dueDay)),
      'currency': options?['currency'],
      'handling': handling,
      'collectionMode': handling == 'agent' ? collection : '直付',
      'procedures': {for (final n in needed) n.kind: procedures[n.kind]},
    };
  }
}
