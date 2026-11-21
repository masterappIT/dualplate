// 申請辦理頁的狀態和計算：逐條照搬 mobile/src/pages/requests/requests.vue 的 ref、computed、watch 和小函數。
// 不依賴 Flutter，方便逐個情況測試；頁面（requests_page.dart）只負責畫和接 API。
// Vue 的 watch(route) 在 route 真的改變時重設選擇；這裏由 setRoute() 同步做（applyWanted 的 await nextTick 等於「watch 已跑完」）。
import '../../core/js.dart';
import '../../core/wording.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf, str;

const requestRoutes = ['粵港', '粵澳'];

// 列表回傳內部狀態，換成客戶看得懂的說法（與辦理進度頁一致）
String customerStatus(Object? status) =>
    const {'待開始': '已收到', '新要求': '已收到', '進行中': '辦理中', '待收件': '辦理中', '待客戶提供': '需要你提供資料', '待客戶配合': '需要你提供資料'}[status] ?? jsString(status);

// 選牌照的選項名稱：內地牌 · 港澳牌；都沒有用批文卡編號
String plateOptionName(Object? p) {
  final text = [at(p, 'mainland_plate'), at(p, 'local_plate')].where(truthy).map(jsString).join(' · ');
  return text.isNotEmpty ? text : jsString(at(p, 'card_number'));
}

class RequestsForm {
  RequestsForm({required this.selfManaged, Map<String, String> query = const {}}) {
    // onLoad：網址參數（go_router 已解碼）
    entrust = ['item', 'long', 'scope'].contains(query['entrust']) ? query['entrust']! : '';
    entrustItem = query['item'] ?? '';
    wantedService = query['service'] ?? '';
    wantedPlate = query['plate'] ?? '';
    if (entrust == 'long' || entrust == 'scope') wantedService = 'other';
  }

  final bool selfManaged;
  // 自管客戶的委託入口（docs/requirements.md 5.6.2）：item＝按次委託某個到期項目；long＝長期委託洽談；scope＝托管客戶申請調整委託
  late final String entrust, entrustItem;
  late String wantedService, wantedPlate;

  String route = '粵港', serviceCode = '', title = '', description = '';
  int vehicleIndex = 0, plateIndex = 0;
  List<dynamic> services = [], vehicles = [], plates = [], requests = [];

  bool get fixedService => entrust == 'long' || entrust == 'scope';
  List<dynamic> get available => services.where((s) => listOf(at(s, 'routes')).contains(route)).toList();
  Object? get selectedService => available.cast<Object?>().firstWhere((s) => at(s, 'code') == serviceCode, orElse: () => null);
  List<dynamic> get vehicleOptions => vehicles.where((v) => at(v, 'route') == route).toList();
  List<dynamic> get plateOptions => plates.where((p) => at(p, 'route') == route).toList();
  List<String> get plateNames => [serviceCode == 'other' ? '不指定牌照' : '請選擇牌照', ...plateOptions.map(plateOptionName)];
  Object? get lockedPlate => plates.cast<Object?>().firstWhere((p) => at(p, 'id') == wantedPlate, orElse: () => null);
  List<dynamic> get shownServices => lockedPlate != null ? available.where((s) => at(s, 'code') != 'new_application').toList() : available;

  // 新申請不用選牌照；其他業務要選，「其他代辦要求」可不指定
  bool get needsPlate => serviceCode.isNotEmpty && serviceCode != 'new_application';
  // 沒有這條路線的牌照：要選牌照的服務先新增牌照，「其他代辦要求」照舊可不指定
  bool get noPlateYet => needsPlate && serviceCode != 'other' && lockedPlate == null && !fixedService && plateOptions.isEmpty;
  bool get showPlatePicker => !noPlateYet && needsPlate && lockedPlate == null && !fixedService;
  bool get showPrice => selfManaged && serviceCode.isNotEmpty && !fixedService;

  String get introText => entrust == 'scope'
      ? '告訴顧問想加入或取消哪些事項，顧問確認後會更新你的委託內容。'
      : entrust == 'item'
          ? '交給我們辦「$entrustItem」。提交後我們會聯絡你，確認實價和要準備的資料。'
          : entrust == 'long'
              ? '提交後我們會聯絡你，了解要交給我們的事項，再按合約報價。'
              : selfManaged
                  ? '選擇要交給我們辦的事，提交後我們會聯絡你報價，並列出需要準備的資料。'
                  : '選擇要辦的事，提交後你的顧問會聯絡你，並列出需要準備的資料。';

  String get placeholder => entrust == 'scope'
      ? '想加入或取消哪些事項，例如香港商業登記證改由你們辦'
      : entrust == 'long'
          ? '想交給我們的事項，例如全部牌照續期、公司年報'
          : '例如新車資料、希望完成的日期';

  // watch(route)：路線改變時，選了的服務不適用就清掉；標題、車輛、牌照重設
  void setRoute(String value) {
    if (value == route) return;
    route = value;
    if (!available.any((s) => at(s, 'code') == serviceCode)) serviceCode = '';
    title = str(at(selectedService, 'name'));
    vehicleIndex = 0;
    plateIndex = 0;
  }

  void pickService(String code) {
    serviceCode = code;
    title = entrust == 'scope'
        ? '申請調整委託${entrustItem.isNotEmpty ? '：$entrustItem' : ''}'
        : entrust == 'item'
            ? '委託辦理：$entrustItem'
            : str(at(selectedService, 'name'));
  }

  // 從牌照的快捷入口、委託入口進來：牌照和服務預先選好（每次 onShow 載入後都做一次，照舊）
  void applyWanted() {
    final plate = lockedPlate;
    if (plate != null) {
      setRoute(jsString(at(plate, 'route')));
      plateIndex = plateOptions.indexWhere((p) => at(p, 'id') == at(plate, 'id')) + 1;
      vehicleIndex = vehicleOptions.indexWhere((v) => at(v, 'id') == at(plate, 'vehicle_id')) + 1;
    }
    if (entrust == 'long' && plates.isNotEmpty) setRoute(jsString(at(plates.first, 'route')));
    if (wantedService.isNotEmpty && available.any((s) => at(s, 'code') == wantedService)) pickService(wantedService);
    if (entrust == 'long') title = '長期委託洽談';
  }

  // 提交前在手機上擋下的情況（照 submit 的次序）；回傳提示文字，可以提交時回傳空字串
  String problem() {
    if (serviceCode.isEmpty) return '請先選擇要辦的事';
    if (noPlateYet) return '請先新增牌照';
    if (needsPlate && serviceCode != 'other' && plateOptions.isNotEmpty && plateIndex == 0) return '請選擇哪個牌照';
    if (title.trim().isEmpty) return '請先選擇要辦的事';
    return '';
  }

  Map<String, dynamic> body() {
    final vehicle = vehicleIndex > 0 && vehicleIndex <= vehicleOptions.length ? vehicleOptions[vehicleIndex - 1] : null;
    final plate = serviceCode == 'new_application' || plateIndex <= 0 || plateIndex > plateOptions.length ? null : plateOptions[plateIndex - 1];
    return {
      'route': route,
      'serviceCode': serviceCode,
      'vehicleId': truthy(at(vehicle, 'id')) ? at(vehicle, 'id') : null,
      'plateAssetId': truthy(at(plate, 'id')) ? at(plate, 'id') : null,
      'title': title,
      'description': description,
    };
  }

  // 提交成功：新記錄放最前；服務保留、說明清空、車輛和牌照重設
  void submitted(Map created) {
    final vehicle = vehicleIndex > 0 && vehicleIndex <= vehicleOptions.length ? vehicleOptions[vehicleIndex - 1] : null;
    requests = [
      {...created, 'plate': truthy(at(vehicle, 'plate')) ? at(vehicle, 'plate') : null},
      ...requests,
    ];
    pickService(serviceCode);
    if (entrust == 'long') title = '長期委託洽談';
    description = '';
    vehicleIndex = 0;
    plateIndex = 0;
  }

  String plateOf(Object? item) => str(at(plates.cast<Object?>().firstWhere((p) => at(p, 'id') == at(item, 'plate_asset_id'), orElse: () => null), 'mainland_plate'));
}

// 自管客戶的參考價（/my/entrust-price）
String priceText(Object? price) {
  final from = at(price, 'from');
  return truthy(from) ? '參考價：由 ${money(at(from, 'currency'), at(from, 'amount'))} 起，實價由我們確認' : '價錢由我們報價，你同意後才開始辦';
}

String submittedToast(bool selfManaged) => selfManaged ? '已提交，我們會盡快聯絡你' : '已提交，顧問會盡快聯絡你';
