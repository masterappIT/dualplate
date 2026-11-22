// 牌照詳情：一比一移植 mobile/src/pages/plate-detail/plate-detail.vue（App 端）。
// 結構、文字、次序、各狀態照抄；計算在 plate_detail_logic.dart，頁內小組件在 plate_detail_widgets.dart。
// 網址：/plate-detail?id=<牌照 id>（new=1 時是「登記現有批文卡」的入口卡）。
// 現有 App 的 onShow：每次回到本頁（從子頁返回、App 回到前景）都重新載入；這裏在子頁關閉後和 App 回到前景時重新載入。
import 'dart:async';
import 'package:flutter/services.dart' show Clipboard, ClipboardData, TextInputType;
import 'package:flutter/widgets.dart';
import '../../business/card_log.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../business/approval_card.dart';
import '../../business/card_capture.dart';
import '../../business/due_date.dart';
import '../../business/plate_chip.dart';
import '../../business/plates.dart';
import '../../business/stamp_mark.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/dialogs.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/loading.dart';
import '../../ui/pickers.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../../ui/uni_switch.dart';
import 'card_original.dart';
import 'doc_photo.dart';
import 'plate_detail_logic.dart';
import 'plate_detail_widgets.dart';

typedef CardCapture = Future<String?> Function(BuildContext context, {required String side});

class PlateDetailPage extends StatefulWidget {
  const PlateDetailPage({super.key, this.id = '', this.creating = false});
  final String id;
  final bool creating;

  // 拍卡：經階段 2 的共用接口（2a 實作）；測試可替換
  static CardCapture capture = openCardCapture;

  @override
  State<PlateDetailPage> createState() => PlateDetailPageState();
}

class PlateDetailPageState extends State<PlateDetailPage> {
  late final String plateId = widget.id;
  late final bool creating = widget.creating;
  // 自管客戶自己建檔，沒有顧問核對批文卡（頁面打開時決定，和 const cardSelfManaged=isSelfManaged() 一樣）
  final bool cardSelfManaged = isSelfManaged();

  List<dynamic> vehicles = [], sources = [], arrangements = [], pending = [], drivers = [], selfRecords = [];
  Map<String, dynamic> detail = {}, docs = {};
  List<J> plates = [];
  Map<String, J> plateDetail = {};
  J summary = {};
  Object? rentalOptions;
  // 計劃第七節決定（2026-11-22）：開關和「今天已過關」各自的送出中狀態（現有 App 共用 crossingBusy）
  bool reminderBusy = false, crossingBusy = false, justCrossed = false, loaded = false, cardBack = false, allDeadlines = false;
  bool showEdit = false, savingFile = false, savingDriver = false, savingVehicle = false, registeringVehicle = false, nextBusy = false;
  Map<String, dynamic> fieldStatus = {};
  String editingCardId = '', editingDriverId = '', editingVehicleId = '', uploadingDoc = '';
  Map<String, dynamic> cardDraft = {}, plateForm = {}, driverForm = {}, vehicleForm = {};
  final open = <String, bool>{};
  int stampSeq = 0;

  final scroll = ScrollController();
  final foldKeys = <String, GlobalKey>{};
  final ctl = <String, TextEditingController>{};
  late final AppLifecycleListener lifecycle = AppLifecycleListener(onResume: load);

  @override
  void initState() {
    super.initState();
    lifecycle;
    // onLoad 和 onShow 都會 load（現有 App 第一次打開時載入兩次，畫面一樣）；這裏只載一次
    if (!creating) WidgetsBinding.instance.addPostFrameCallback((_) => load());
  }

  @override
  void dispose() {
    lifecycle.dispose();
    scroll.dispose();
    for (final c in ctl.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  J? get plate0 => plates.isEmpty ? null : plates.first;
  List<dynamic> get boundVehicles => vehicles.where((v) => at(v, 'id') == plate0?['vehicle_id'] && plate0 != null).toList();
  List<dynamic> get shownDeadlines {
    final list = deadlineList(summary);
    return allDeadlines ? list : list.take(5).toList();
  }

  bool isPending(String type, Object? id, [String? field]) =>
      pending.any((x) => at(x, 'entityType') == type && at(x, 'entityId') == id && (field == null || at(x, 'field') == field));

  void toast(String text, {Duration? duration}) {
    hideLoading();
    if (mounted) showToast(context, text, duration: duration ?? ToastStyle.duration);
  }

  String errText(Object e) => e is ApiError ? e.message : '$e';

  // 子頁：關閉後回到本頁（onShow）重新載入
  Future<void> go(String path) async {
    await context.push(path);
    if (mounted) unawaited(load());
  }

  // ── 載入 ─────────────────────────────────────────────────────────────────────────
  Future<void> load() async {
    if (!mounted) return;
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    if (creating || plateId.isEmpty) return;
    try {
      final r = await Future.wait([api('/plate-assets/$plateId'), api('/vehicles'), api('/catalog'), api('/my/plates/$plateId')], eagerError: true);
      final p = Map<String, dynamic>.from(r[0] as Map), v = listOf(r[1]), mine = Map<String, dynamic>.from(r[3] as Map);
      _set(() => summary = mine);
      loadPending();
      loadSelf();
      api('/my/drivers').then((list) => _set(() => drivers = listOf(list)), onError: (_) => _set(() => drivers = []));
      api('/my/rentals').then((list) => _set(() => arrangements = listOf(list).where((item) => at(item, 'plateId') == plateId).toList()), onError: (_) => _set(() => arrangements = []));
      api('/my/plates/$plateId/rental-options').then((r) => _set(() => rentalOptions = r), onError: (_) => _set(() => rentalOptions = null));
      _set(() {
        plates = [p];
        plateDetail = {...plateDetail, '${p['id']}': p};
        vehicles = v;
        sources = listOf(at(r[2], 'sources'));
        fillPlateForm(p);
      });
      final entries = await Future.wait(v.map((item) async => MapEntry('${at(item, 'id')}', await api('/vehicles/${at(item, 'id')}'))), eagerError: true);
      _set(() => detail = Map.fromEntries(entries));
      loadDocs(v.where((item) => at(item, 'id') == p['vehicle_id']).toList());
    } catch (e) {
      toast(errText(e));
    } finally {
      _set(() => loaded = true);
    }
  }

  Future<void> loadPending() async {
    try {
      final r = await api('/my/pending');
      _set(() => pending = listOf(r));
    } catch (_) {
      _set(() => pending = []);
    }
  }

  Future<void> loadSelf() async {
    try {
      final r = await api('/my/plates/$plateId/self-handled');
      _set(() => selfRecords = listOf(r));
    } catch (_) {
      _set(() => selfRecords = []);
    }
  }

  Future<void> loadDocs(List<dynamic> list) async {
    final entries = await Future.wait(list.map((v) => api('/vehicles/${at(v, 'id')}/documents').then((r) => MapEntry('${at(v, 'id')}', r), onError: (_) => MapEntry('${at(v, 'id')}', null))));
    _set(() => docs = {...docs, for (final e in entries) if (truthy(e.value)) e.key: e.value});
  }

  Future<void> reloadSummary(Object? id) async {
    final r = await api('/my/plates/$id');
    _set(() => summary = Map<String, dynamic>.from(r as Map));
  }

  // ── 輸入框 ───────────────────────────────────────────────────────────────────────
  TextEditingController field(String form, String key, Map<String, dynamic> values) =>
      ctl['$form:$key'] ??= TextEditingController(text: values[key] == null ? '' : jsString(values[key]));

  void refill(String form, Map<String, dynamic> values) {
    for (final e in ctl.entries) {
      if (!e.key.startsWith('$form:')) continue;
      final v = values[e.key.substring(form.length + 1)];
      final text = v == null ? '' : jsString(v);
      if (e.value.text != text) e.value.text = text;
    }
  }

  void fillPlateForm(J p) {
    plateForm = {
      'mainlandPlate': str(p['mainland_plate']),
      'localPlate': str(p['local_plate']),
      'installationStatus': truthy(p['installation_status']) ? p['installation_status'] : '待核對',
      'usageStatus': truthy(p['usage_status']) ? p['usage_status'] : '待核對',
      'vehicleId': str(p['vehicle_id']),
      'cardNumber': str(p['card_number']),
      'cardExpiresOn': str(p['card_expires_on']),
      'notes': str(p['notes']),
    };
    refill('plate', plateForm);
  }

  // ── 折疊區 ───────────────────────────────────────────────────────────────────────
  void toggle(String key) => _set(() => open[key] = !(open[key] ?? false));

  void openFold(String key) {
    _set(() => open[key] = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Future.delayed(PlateDetailStyle.scrollDelay, () {
        final ctx = foldKeys[key]?.currentContext;
        if (ctx != null && ctx.mounted) Scrollable.ensureVisible(ctx, alignment: 0, duration: PlateDetailStyle.scrollDuration, curve: Curves.linear);
      });
    });
  }

  // ── 90 天過關 ────────────────────────────────────────────────────────────────────
  Future<void> toggleReminder(bool on) async {
    if (reminderBusy || crossingBusy) return;
    _set(() => reminderBusy = true);
    try {
      await api('/my/plates/$plateId/crossing-reminder', 'PUT', {'enabled': on});
      await reloadSummary(plateId);
      toast(on ? '已開啟 90 天過關提醒' : '已關閉提醒');
    } catch (e) {
      toast(errText(e));
    } finally {
      _set(() => reminderBusy = false);
    }
  }

  Future<void> markCrossed(String? date) async {
    if (reminderBusy || crossingBusy || date == null || date.isEmpty) return;
    _set(() => crossingBusy = true);
    try {
      final result = await api('/my/plates/$plateId/crossings', 'POST', {'crossedOn': date});
      // 蓋章：先拿掉再放回，重播動畫
      _set(() => justCrossed = false);
      Future.delayed(PlateDetailStyle.stampDelay, () => _set(() {
            justCrossed = true;
            stampSeq++;
          }));
      toast('已記錄，下次請在 ${jsString(at(result, 'nextDueOn'))} 前過關', duration: PlateDetailStyle.crossToast);
      await reloadSummary(plateId);
    } catch (e) {
      toast(errText(e));
    } finally {
      _set(() => crossingBusy = false);
    }
  }

  // ── 牌照資料 ─────────────────────────────────────────────────────────────────────
  Future<void> savePlate(J p) async {
    if (savingFile) return;
    final nextVehicle = vehicles.cast<Object?>().firstWhere((v) => at(v, 'id') == plateForm['vehicleId'], orElse: () => null);
    final local = str(plateForm['localPlate']).trim();
    final Object? newPlate = truthy(plateForm['vehicleId']) && plateForm['vehicleId'] != str(p['vehicle_id'])
        ? at(nextVehicle, 'plate')
        : local != str(p['local_plate'])
            ? local
            : '';
    if (truthy(newPlate) && truthy(p['local_plate'])) {
      final did = await askChange('港澳車牌由 ${jsString(p['local_plate'])} 改為 ${jsString(newPlate)}', '換車');
      if (did == null) return;
      if (did) return openSelf('vehicle_change', jsString(newPlate));
    }
    _set(() => savingFile = true);
    try {
      final updated = Map<String, dynamic>.from(await api('/plate-assets/${p['id']}', 'PATCH', plateForm) as Map);
      _set(() {
        plates = [updated];
        plateDetail = {...plateDetail, '${p['id']}': updated};
        fillPlateForm(updated);
      });
      await reloadSummary(p['id']);
      loadPending();
      toast(forMode('已更新，顧問會再核對', '已更新'));
    } catch (e) {
      toast(errText(e));
    } finally {
      _set(() => savingFile = false);
    }
  }

  // ── 批文卡 ───────────────────────────────────────────────────────────────────────
  Map cardData(J p) => (at(plateDetail['${p['id']}'], 'cardData') as Map?) ?? const {};
  Map displayCardData(J p) => editingCardId == '${p['id']}' ? cardDraft : cardData(p);

  void editCard(J p) {
    _set(() {
      cardDraft = Map<String, dynamic>.from(cardData(p));
      editingCardId = '${p['id']}';
      refill('card', cardDraft);
    });
  }

  Future<void> saveCard(J p) async {
    final before = cardData(p), why = await askWhy(before, cardDraft);
    if (why == null) return;
    try {
      final updated = Map<String, dynamic>.from(await api('/plate-assets/${p['id']}', 'PUT', {'cardData': cardDraft}) as Map);
      _set(() {
        plateDetail = {...plateDetail, '${p['id']}': updated};
        plates = plates.map((item) => item['id'] == p['id'] ? updated : item).toList();
        editingCardId = '';
      });
      await reloadSummary(p['id']);
      loadPending();
      if (why is ChangeAsk) return openSelf(why.kind, why.newPlate);
      toast(forMode('已更新，顧問會再核對', '已更新'));
    } catch (e) {
      toast(errText(e));
    }
  }

  // 上傳批文卡：先選正面或背面；還沒有正本時直接對框讀取，已有正本才再選「只保存正本」或「上傳並讀取內容」
  Future<void> uploadCard(J p) async {
    final face = await choose(context, '上傳哪一面？', const ['正面', '背面']);
    if (face < 0) return;
    final side = face == 0 ? 'front' : 'back';
    if (originalSides(plateDetail['${p['id']}']).isEmpty) return readCard(p, side);
    if (!mounted) return;
    final mode = await choose(context, '怎樣處理這張相片？', [
      const ChoiceItem('只保存正本', '資料不變，只留相片記錄'),
      ChoiceItem('上傳並讀取內容', forMode('系統讀出卡上的文字填入，顧問會再核對', '系統讀出卡上的文字填入，請核對一次')),
    ]);
    if (mode == 0) {
      await saveCardOriginal(p, side);
    } else if (mode == 1) {
      await readCard(p, side);
    }
  }

  Future<void> saveCardOriginal(J p, String side) async {
    final photo = await PlateDetailPage.capture(context, side: side);
    if (photo == null || !mounted) return;
    showLoading(context, '正在上傳');
    try {
      await api('/plate-assets/${p['id']}/card/$side', 'POST', {'image': photo, 'recognize': false});
      forgetCardOriginal(p['id']);
      final updated = Map<String, dynamic>.from(await api('/plate-assets/${p['id']}') as Map);
      _set(() => plateDetail = {...plateDetail, '${p['id']}': updated});
      hideLoading();
      toast('正本已保存，資料沒有改動');
    } catch (e) {
      debugPrint('[PlateDetail] 只保存正本失敗 $e');
      hideLoading();
      toast(e is ApiError && e.message.isNotEmpty ? e.message : '上傳失敗');
    }
  }

  Future<void> readCard(J p, String side) async {
    final photo = await PlateDetailPage.capture(context, side: side);
    if (photo == null || !mounted) return;
    showLoading(context, '正在上傳辨識');
    final clock = Stopwatch()..start();
    try {
      final before = Map<String, dynamic>.from(cardData(p));
      final response = await api('/plate-assets/${p['id']}/card/$side', 'POST', {'image': photo});
      cardLog('recognize $side ${clock.elapsedMilliseconds}ms fields=${((at(response, 'fieldStatus') as Map?) ?? const {}).length}');
      forgetCardOriginal(p['id']);
      _set(() => fieldStatus = Map<String, dynamic>.from((at(response, 'fieldStatus') as Map?) ?? const {}));
      final updated = Map<String, dynamic>.from(await api('/plate-assets/${p['id']}') as Map);
      _set(() {
        plateDetail = {...plateDetail, '${p['id']}': updated};
        plates = plates.map((item) => item['id'] == p['id'] ? updated : item).toList();
      });
      editCard(p);
      await reloadSummary(p['id']);
      loadPending();
      hideLoading();
      final why = await askWhy(before, (at(response, 'cardData') as Map?) ?? const {}, uploaded: true);
      if (why is ChangeAsk) {
        _set(() => editingCardId = '');
        return openSelf(why.kind, why.newPlate);
      }
      toast('已辨識，請核對欄位');
    } catch (e) {
      // 現有 App：catch 裏先 uni.hideLoading() 再提示；漏了會令等待框一直蓋住畫面
      debugPrint('[PlateDetail] 上傳辨識失敗 $e');
      cardLog('recognize $side failed ${clock.elapsedMilliseconds}ms $e');
      hideLoading();
      toast(e is ApiError && e.message.isNotEmpty ? e.message : '上傳失敗');
    }
  }

  void viewOriginal(J p) => viewCardOriginal(context, p['id'], originalSides(plateDetail['${p['id']}']), cardBack ? 'back' : 'front');

  // ── 到期日 ───────────────────────────────────────────────────────────────────────
  Future<void> putDate(Object? item, String? date, String done) async {
    try {
      await api('/my/dates', 'PUT', {'ownerType': at(item, 'ownerType'), 'ownerId': at(item, 'ownerId'), 'code': at(item, 'code'), 'expiresOn': date});
      await reloadSummary(plateId);
      loadPending();
      toast(done);
    } catch (e) {
      toast(errText(e));
    }
  }

  Future<void> fillDate(Object? item, String? date) async {
    if (date == null || date.isEmpty) return;
    await putDate(item, date, cardSelfManaged ? '已記錄，到期前會提醒你' : '已記錄，顧問會再核對');
  }

  Future<void> saveDate(Object? item, String? date) async {
    if (date == null || date.isEmpty || date == at(item, 'dueOn')) return;
    await putDate(item, date, forMode('到期日已更新，顧問會再核對', '到期日已更新'));
  }

  Future<void> pickDate(Object? item, {required bool editing}) async {
    final date = await showDatePicker(context, value: editing ? str(at(item, 'dueOn')) : null);
    if (date == null) return;
    editing ? await saveDate(item, date) : await fillDate(item, date);
  }

  // ── 司機 ─────────────────────────────────────────────────────────────────────────
  void editDriver(Object? d) {
    if (editingDriverId == at(d, 'id')) return _set(() => editingDriverId = '');
    final full = drivers.cast<Object?>().firstWhere((x) => at(x, 'id') == at(d, 'id'), orElse: () => const {});
    _set(() {
      driverForm = {
        'name': truthy(at(full, 'name')) ? at(full, 'name') : at(d, 'name'),
        'phone': str(at(full, 'phone')),
        'hkIdNo': str(at(full, 'hkIdNo')),
        'homeReturnPermitNo': str(at(full, 'homeReturnPermitNo')),
      };
      refill('driver', driverForm);
      editingDriverId = '${at(d, 'id')}';
    });
  }

  Future<void> saveDriver() async {
    if (savingDriver) return;
    _set(() => savingDriver = true);
    try {
      await api('/my/drivers/$editingDriverId', 'PATCH', driverForm);
      _set(() => editingDriverId = '');
      final r = await Future.wait([api('/my/plates/$plateId'), api('/my/drivers')], eagerError: true);
      _set(() {
        summary = Map<String, dynamic>.from(r[0] as Map);
        drivers = listOf(r[1]);
      });
      loadPending();
      toast(forMode('已更新，顧問會再核對', '已更新'));
    } catch (e) {
      toast(errText(e));
    } finally {
      _set(() => savingDriver = false);
    }
  }

  // ── 車輛 ─────────────────────────────────────────────────────────────────────────
  Future<void> registerVehicle() async {
    if (registeringVehicle) return;
    _set(() => registeringVehicle = true);
    try {
      final r = await api('/plate-assets/$plateId/vehicle', 'POST');
      toast('已登記車輛 ${jsString(at(at(r, 'vehicle'), 'plate'))}，請上傳證件');
      await load();
    } catch (e) {
      toast(errText(e));
    } finally {
      _set(() => registeringVehicle = false);
    }
  }

  Future<void> uploadDoc(Object? v, Object? d) async {
    if (uploadingDoc.isNotEmpty) return;
    try {
      final image = await pickDocPhoto(context);
      if (image == null) return;
      _set(() => uploadingDoc = '${at(v, 'id')}:${at(d, 'kind')}');
      final r = await api('/vehicles/${at(v, 'id')}/documents/${at(d, 'kind')}', 'POST', {'image': image});
      _set(() {
        docs = {...docs, '${at(v, 'id')}': {'vehicleId': at(r, 'vehicleId'), 'retired': at(r, 'retired'), 'documents': at(r, 'documents'), 'checks': at(r, 'checks')}};
        if (truthy(at(r, 'vehicle'))) vehicles = vehicles.map((item) => at(item, 'id') == at(v, 'id') ? at(r, 'vehicle') : item).toList();
      });
      if (listOf(at(r, 'applied')).isNotEmpty) {
        await reloadSummary(plateId);
        loadPending();
      }
      toast(docToast(d, r));
    } catch (e) {
      toast(errText(e));
    } finally {
      _set(() => uploadingDoc = '');
    }
  }

  void editVehicle(Object? v) {
    if (editingVehicleId == at(v, 'id')) return _set(() => editingVehicleId = '');
    _set(() {
      vehicleForm = {
        'plate': str(at(v, 'plate')),
        'brand': str(at(v, 'brand')),
        'model': str(at(v, 'model')),
        'vin': str(at(v, 'vin')),
        'manufacturedYear': truthy(at(v, 'manufactured_year')) ? jsString(at(v, 'manufactured_year')) : '',
        'firstRegisteredOn': str(at(v, 'first_registered_on')),
      };
      refill('vehicle', vehicleForm);
      editingVehicleId = '${at(v, 'id')}';
    });
  }

  Future<void> saveVehicle(Object? v) async {
    if (savingVehicle) return;
    final newPlate = str(vehicleForm['plate']).trim();
    if (newPlate.isNotEmpty && truthy(at(v, 'plate')) && newPlate.toUpperCase() != jsString(at(v, 'plate')).toUpperCase()) {
      final did = await askChange('車牌由 ${jsString(at(v, 'plate'))} 改為 $newPlate', '換車');
      if (did == null) return;
      if (did) {
        _set(() => editingVehicleId = '');
        return openSelf('vehicle_change', newPlate);
      }
    }
    _set(() => savingVehicle = true);
    try {
      final updated = await api('/my/vehicles/${at(v, 'id')}', 'PATCH', {...vehicleForm, 'manufacturedYear': str(vehicleForm['manufacturedYear'])});
      _set(() {
        vehicles = vehicles.map((item) => at(item, 'id') == at(v, 'id') ? updated : item).toList();
        editingVehicleId = '';
      });
      loadPending();
      toast(forMode('已更新，顧問會再核對', '已更新'));
    } catch (e) {
      toast(errText(e));
    } finally {
      _set(() => savingVehicle = false);
    }
  }

  // ── 自行辦理和「有變動？」────────────────────────────────────────────────────────────
  void openSelf(String kind, [String newPlate = '', Map<String, Object?> extra = const {}]) => go(selfChangePath(plateId, kind, newPlate: newPlate, extra: extra));

  void markDone(Object? item) => openSelf(markDoneKind(at(item, 'code')), '', {
        'period': at(item, 'period'),
        'name': at(item, 'name'),
        'label': truthy(at(item, 'detail')) ? at(item, 'detail') : '',
        'dueOn': truthy(at(item, 'dueOn')) ? at(item, 'dueOn') : '',
      });

  // 回傳 true＝辦了變更、false＝之前填錯、null＝取消
  Future<bool?> askChange(String what, String change) async {
    final r = await ask(context, title: what, msg: '是自己辦了$change，還是之前填錯？', ok: changeOk[change] ?? 'undefined', cancel: '之前填錯');
    return r == 'confirm' ? true : r == 'cancel' ? false : null;
  }

  // 回傳 ChangeAsk（辦了變更）、false（沒有或之前填錯）、null（取消；uploaded 時新卡已存檔，取消也當 false）
  Future<Object?> askWhy(Map before, Map after, {bool uploaded = false}) async {
    final c = cardChange(before, after, plate0?['route']);
    if (c == null) return false;
    final did = await askChange(c.title, c.change);
    return did == null ? (uploaded ? false : null) : did ? c : false;
  }

  Future<void> askChanges() async {
    final options = [
      ('我已經自己辦好', '續期、換車、換司機、口岸或商號變更、補領，在這裏更新資料', doneSelf),
      (forMode('請顧問幫我辦', '交給我們辦'), forMode('開一張辦理申請，顧問會跟進', '我們報價，你同意後才開始'), askAdvisor),
      ('資料有錯字', forMode('直接修改，顧問會再核對', '直接修改'), fixTypo),
    ];
    final i = await choose(context, '這個牌照有甚麼變動？', [for (final o in options) ChoiceItem(o.$1, o.$2)]);
    if (i >= 0) await options[i].$3();
  }

  Future<void> doneSelf() async {
    final own = ownChanges(plate0?['route']);
    final i = await choose(context, '你自己辦好了甚麼？', own.map((x) => x.$1).toList());
    if (i >= 0) openSelf(own[i].$2);
  }

  Future<void> askAdvisor() async {
    final i = await choose(context, forMode('請顧問幫你辦甚麼？', '要交給我們辦甚麼？'), advisorChanges.map((x) => x.$1).toList());
    if (i >= 0) unawaited(go(requestPath(advisorChanges[i].$2, summary['id'])));
  }

  Future<void> fixTypo() async {
    final p = plate0!;
    final list = <(String, VoidCallback)>[
      ('批文卡內容', () {
        editCard(p);
        openFold('card');
      }),
      ('牌照資料', () {
        _set(() => showEdit = true);
        openFold('plate');
      }),
      if (boundVehicles.isNotEmpty)
        ('車輛資料', () {
          _set(() => editingVehicleId = '');
          editVehicle(boundVehicles.first);
          openFold('vehicle');
        }),
      if (listOf(summary['drivers']).isNotEmpty) ('司機資料', () => openFold('drivers')),
    ];
    final i = await choose(context, '要修改哪一項？', list.map((x) => x.$1).toList());
    if (i >= 0) list[i].$2();
  }

  Future<void> runNext(NextStep step) async {
    if (nextBusy) return;
    _set(() => nextBusy = true);
    try {
      switch (step.action) {
        case NextAction.crossToday:
          await markCrossed(todayIso());
        case NextAction.markDone:
          markDone(step.item);
        case NextAction.openDeadlines:
          openFold('deadlines');
        case NextAction.registerVehicle:
          await registerVehicle();
        case NextAction.uploadDoc:
          await uploadDoc(boundVehicles.first, step.doc);
      }
    } finally {
      _set(() => nextBusy = false);
    }
  }

  // 到「我的公司」打開那間公司的修改表單
  Future<void> fillCompany(Object? id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('editCompany', jsString(id));
    if (mounted) context.go('/companies');
  }

  void openSource(Object? sourceId) {
    final source = sources.cast<Object?>().firstWhere((s) => at(s, 'id') == sourceId, orElse: () => null);
    if (source == null) return;
    Clipboard.setData(ClipboardData(text: str(at(source, 'url')))).then((_) => toast('官方連結已複製'));
  }

  // ── 畫面 ─────────────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) => AppPage(
        title: '牌照詳情',
        child: KeyboardBarArea(
          child: Builder(builder: (context) {
            final inset = MediaQuery.viewInsetsOf(context).bottom;
            return Padding(
              padding: EdgeInsets.only(bottom: inset),
              child: PageBody(controller: scroll, children: [Blocks(pageBlocks())]),
            );
          }),
        ),
      );

  List<Blk> pageBlocks() {
    final out = <Blk>[];
    if (creating) {
      out.add(Blk(
        DCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const ListTitle('登記現有批文卡'),
            const ListSub('尚未取得批文卡，請使用申請辦理。'),
            const SizedBox(height: 16),
            Btn('前往批文卡建檔', onTap: () => context.pushReplacement('/plate-create')),
          ]),
        ),
        bottom: 12,
      ));
    }
    if (!creating && loaded && plates.isEmpty) {
      // .card.empty：.empty 的內距 24 16 蓋過 .card 的 16
      out.add(Blk(const DCard(padding: EdgeInsets.zero, child: Empty('找不到這個兩地牌檔案。')), bottom: 12));
    }
    for (final p in plates) {
      out.addAll(plateBlocks(p));
    }
    if (!creating && truthy(summary['id']) && !truthy(plate0?['stopped_on'])) {
      out.add(Blk(Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 4),
        child: Link('不再續期這個牌照 ›', color: C.ink2, align: TextAlign.center, onTap: () => openSelf('stop_renewal')),
      )));
    }
    if (cardSelfManaged && !creating && truthy(summary['id'])) {
      out.add(Blk(Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 4),
        child: Link('刪除這個牌照 ›', color: C.ink2, align: TextAlign.center, onTap: () => go('/plate-delete?id=${Uri.encodeComponent(plateId)}')),
      )));
    }
    return out;
  }

  Widget centered(Widget w) => SizedBox(width: double.infinity, child: w);

  List<Blk> plateBlocks(J p) {
    final out = <Blk>[];
    final todo = clientTodoCount(summary);
    final health = summary['health'];
    // 頁首：車牌＋整體狀態
    out.add(Blk(
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          PlateChip(plate: str(truthy(p['mainland_plate']) ? p['mainland_plate'] : summary['mainlandPlate']), region: '內地', size: PlateChipSize.lg),
          if (truthy(p['local_plate'])) PlateChip(plate: str(p['local_plate']), region: p['route'] == '粵澳' ? '澳門' : '香港', size: PlateChipSize.lg),
          if (todo > 0)
            Pill('$todo 項待辦', tone: Tone.amber)
          else if (truthy(health))
            Pill(healthLabel(health), tone: toneOf(healthTone[health])),
        ]),
        const SizedBox(height: 8),
        Subtle(['${jsString(p['route'])}兩地牌', summary['holder']].where(truthy).map(jsString).join(' · ')),
      ]),
      bottom: 16,
    ));
    if (truthy(summary['id'])) {
      out.add(Blk(
        Align(
          alignment: Alignment.centerLeft,
          child: Link('${truthy(p['card_expires_on']) ? '批文有效期至 ${jsString(p['card_expires_on'])} · ' : ''}批文卡 ›', onTap: () => openFold('card')),
        ),
        top: -8,
        bottom: 12,
      ));
    }
    final warnings = listOf(summary['warnings']);
    if (warnings.isNotEmpty) {
      out.add(Blk(
        DetailListCard(
          warn: true,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ListTitle(warnings.map(jsString).join('、')),
            ListSub(forMode('牌照仍照常管理，如需處理我們會聯絡你。', '請盡快跟進；需要幫忙可按「有變動？」交給我們辦。')),
          ]),
        ),
        bottom: 12,
      ));
    }
    final gaps = listOf(summary['companyGaps']);
    if (gaps.isNotEmpty) {
      out.add(Blk(
        DetailListCard(
          warn: true,
          onTap: () => fillCompany(at(gaps.first, 'id')),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const ListTitle('請補上公司資料'),
            for (final c in gaps) ListSub('${jsString(at(c, 'name'))}：缺${listOf(at(c, 'missing')).map(jsString).join('、')}'),
            const Padding(padding: EdgeInsets.only(top: 8), child: Link('前往補充 ›')),
          ]),
        ),
        bottom: 12,
      ));
    }
    if (truthy(p['stopped_on'])) {
      out.add(Blk(
        DetailListCard(
          warn: true,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const ListTitle('已標記不再續期'),
            ListSub('${jsString(p['stopped_on'])} · ${jsString(p['stop_reason'])}。這個牌照不再提醒到期；如要恢復，${forMode('請聯絡你的顧問', '請在「我的 › 聯絡我們」發訊息給我們')}。'),
          ]),
        ),
        bottom: 12,
      ));
    }
    for (final r in selfNotes(selfRecords, plate0)) {
      final back = at(r, 'status') == '已退回';
      out.add(Blk(
        DetailListCard(
          warn: back,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ListTitle(back ? '顧問未能確認你的「${jsString(at(r, 'kindName'))}」更新' : '你提交的「${jsString(at(r, 'kindName'))}」顧問核對中'),
            ListSub(back ? str(at(r, 'reviewNote')) : '資料已更新；顧問核對後如有問題會聯絡你。'),
          ]),
        ),
        bottom: 12,
      ));
    }
    if (!truthy(summary['id'])) return out;

    // 下一件要做的事
    final step = nextStep(plate: plate0, summary: summary, bound: boundVehicles, docs: docs);
    out.add(Blk(
      DCard(
        warn: step?.level == 'overdue',
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('下一件要做的事', style: ts(Fs.meta, weight: w700, color: C.ink3))),
          if (step != null) ...[
            LineTitle(step.title),
            LineSub(step.sub),
            const SizedBox(height: 12),
            DBtn(step.label, enabled: !nextBusy, onTap: () => runNext(step)),
          ] else ...[
            LineTitle(forMode('目前不用你做甚麼', '目前沒有快到期的事項')),
            LineSub(forMode('我們負責的事項會按時跟進；有需要時會出現在這裏。', '到期前會在這裏提醒你。')),
          ],
        ]),
      ),
      top: 4,
      bottom: 12,
    ));
    out.add(Blk(DBtn('有變動？', kind: BtnKind.line, onTap: askChanges), top: 12));
    out.add(Blk(Text('其他資料', style: ts(Fs.h, weight: w800, height: 1.4, color: C.jadeDeep)), top: 24, bottom: 12));

    // 其他資料：平時收起，標題列顯示摘要
    Blk head(String key, String title, String sum) => Blk(
          KeyedSubtree(key: foldKeys[key] ??= GlobalKey(debugLabel: 'fold-$key'), child: FoldHead(title: title, summary: sum, open: open[key] ?? false, onTap: () => toggle(key))),
          bottom: 12,
        );
    List<Blk> body(String key, List<Blk> Function() inner) => (open[key] ?? false) ? wrapBlk(inner(), top: -4, bottom: 12) : const [];

    if (!cardSelfManaged) out.add(Blk(FoldHead(title: '委託內容', summary: '哪些事由我們負責', onTap: () => go('/scope?id=${p['id']}')), bottom: 12));
    out.add(head('deadlines', '到期項目', deadlineSummary(summary)));
    out.addAll(body('deadlines', deadlineBlocks));
    out.add(head('crossing', '90 天過關', crossingSummary(summary)));
    out.addAll(body('crossing', crossingBlocks));
    out.add(head('card', '批文卡', cardSummary(p)));
    out.addAll(body('card', () => cardBlocks(p)));
    out.add(head('vehicle', '車輛與證件', vehicleSummary(summary, boundVehicles, docs)));
    out.addAll(body('vehicle', vehicleBlocks));
    out.add(head('drivers', '司機', driverSummary(summary)));
    out.addAll(body('drivers', driverBlocks));
    out.add(head('usage', '出租', usageSummary(summary, arrangements)));
    out.addAll(body('usage', usageBlocks));
    out.add(head('holder', '持牌公司', truthy(summary['holder']) ? jsString(summary['holder']) : '待補充'));
    out.addAll(body('holder', holderBlocks));
    out.add(head('plate', '牌照資料', plateSummary(plate0, vehicles)));
    out.addAll(body('plate', () => plateFileBlocks(p)));
    final requests = listOf(summary['requests']);
    out.add(head('requests', '辦理記錄', requests.isNotEmpty ? '${requests.length} 項' : '沒有'));
    out.addAll(body('requests', requestBlocks));
    return out;
  }

  // ── 到期項目 ─────────────────────────────────────────────────────────────────────
  Widget dueDate(Object? item) => DueDate(date: str(at(item, 'dueOn')), days: (at(item, 'daysLeft') as num?)?.toInt(), level: str(at(item, 'level')));

  List<Blk> deadlineBlocks() {
    final list = deadlineList(summary), undated = undatedList(summary), shown = shownDeadlines;
    final more = list.length > 5;
    final lines = <Widget>[];
    for (var i = 0; i < shown.length; i++) {
      final item = shown[i];
      final sub = deadlineSub(item);
      final selfTag = showSelfTag(item as Map), pend = isPending(str(at(item, 'ownerType')), at(item, 'ownerId'), 'date:${jsString(at(item, 'code'))}');
      Widget right;
      if (truthy(at(item, 'editable'))) {
        right = DateEdit(date: dueDate(item), link: '修改', onTap: () => pickDate(item, editing: true));
      } else if (truthy(at(item, 'markable'))) {
        right = DateEdit(date: dueDate(item), link: '已辦好', onTap: () => markDone(item));
      } else {
        right = DateEdit(date: dueDate(item), link: '已辦好', hiddenLink: true);
      }
      lines.add(Line(last: i == shown.length - 1 && !more, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            LineTitle(jsString(at(item, 'name'))),
            // .who 和 .pill 都是行內元素，兩個都有時排在同一行
            if (selfTag || pend)
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (selfTag) const Who(selfHandled),
                if (pend) const PendingTag(),
              ]),
            if (sub.isNotEmpty) LineSub(sub),
            if (canEntrust(item)) Padding(padding: const EdgeInsets.only(top: 6), child: Link('委託我們辦 ›', onTap: () => go(entrustPath({...item, 'plateId': at(item, 'plateId')})))),
          ]),
        ),
        right,
      ]));
    }
    // 計劃第七節決定（2026-11-22）：只有「還沒有填日期」時不放上面的卡（現有 App 會留下一張約 10pt 高的空白卡）
    final blocks = <Blk>[
      if (list.isNotEmpty || undated.isEmpty) Blk(
        DCard(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ...lines,
            if (list.isEmpty && undated.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: LineSub(summary['health'] == 'pending' ? forMode('你的顧問正在整理這個牌照的到期資料。', '還沒有填到期日；補上後到期前會提醒你。') : '半年內沒有到期項目。'),
              ),
            if (more) MoreLink(allDeadlines ? '收起' : '顯示全部 ${list.length} 項', onTap: () => _set(() => allDeadlines = !allDeadlines)),
          ]),
        ),
        bottom: 12,
      ),
    ];
    if (undated.isNotEmpty) {
      blocks.add(Blk(
        DCard(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const UndatedTitle('還沒有填日期'),
            for (final item in undated)
              Line(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    LineTitle(jsString(at(item, 'name'))),
                    if (at(item, 'ownerType') != 'plate') LineSub(jsString(at(item, 'ownerLabel'))),
                    if (truthy(at(item, 'hint'))) LineSub(jsString(at(item, 'hint'))),
                  ]),
                ),
                if (at(item, 'fill') == 'date') DateEdit(link: '填日期', onTap: () => pickDate(item, editing: false)),
              ]),
            const LineSub('填上到期日後，到期前會提醒你。', top: 8),
          ]),
        ),
        top: 12,
        bottom: 12,
      ));
    }
    return blocks;
  }

  // ── 90 天過關 ────────────────────────────────────────────────────────────────────
  List<Blk> crossingBlocks() {
    final c = summary['crossing'];
    final enabled = truthy(at(c, 'enabled'));
    final card = Stack(clipBehavior: Clip.none, children: [
      DCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SpacedRow(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const LineTitle('90 天過關提醒'),
                LineSub(enabled ? '每 ${truthy(at(c, 'days')) ? jsString(at(c, 'days')) : 90} 天須過關一次，期限前提醒你' : '車輛不常過關時可開啟，我們會在期限前提醒你'),
              ]),
            ),
            UniSwitch(checked: enabled, disabled: reminderBusy, onChanged: toggleReminder),
          ]),
          if (enabled) ...[
            const TicketRule(),
            SpacedRow(children: [
              Flexible(child: LineSub(truthy(at(c, 'lastCrossedOn')) ? '上次過關 ${jsString(at(c, 'lastCrossedOn'))}' : '請記錄最近一次過關日期')),
              if (truthy(at(c, 'nextDueOn'))) DueDate(date: jsString(at(c, 'nextDueOn'))),
            ]),
            const SizedBox(height: 16),
            DBtn(crossingBusy ? '記錄中' : '今天已過關', enabled: !crossingBusy, onTap: () => markCrossed(todayIso())),
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () async => markCrossed(await showDatePicker(context, end: todayIso())),
              child: const Padding(padding: EdgeInsets.only(top: 12), child: Link('其他日期過關 ›', align: TextAlign.center)),
            ),
          ],
        ]),
      ),
      // 印章蓋在卡片右下角（right 16、bottom -12），不擋點擊；計劃第七節決定（2026-11-22）：現有 App 的 .crossing-stamp 在右上角，蓋住提醒開關
      if (enabled && justCrossed)
        Positioned(right: 16, bottom: -12, child: IgnorePointer(child: StampMark(key: ValueKey('stamp-$stampSeq'), text: '已過關', tone: 'jade', play: true))),
    ]);
    return [Blk(card, top: 12, bottom: 12)];
  }

  // ── 批文卡 ───────────────────────────────────────────────────────────────────────
  List<Blk> cardBlocks(J p) {
    final id = '${p['id']}';
    final editing = editingCardId == id;
    final sides = originalSides(plateDetail[id]);
    return [
      Blk(
        DCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            ApprovalCard(
              key: ValueKey('card-$id'),
              data: displayCardData(p),
              back: cardBack,
              flipOnTap: false,
              showControls: false,
              tapLabel: cardBack ? '翻到批文卡正面' : '翻到批文卡背面',
              onCardTap: () => _set(() => cardBack = !cardBack),
            ),
            const SizedBox(height: 12),
            Segmented<bool>(options: const [(false, '正面'), (true, '背面')], value: cardBack, onChanged: (v) => _set(() => cardBack = v)),
            const SizedBox(height: 12),
            Row(children: [
              if (sides.isNotEmpty) ...[Expanded(child: DBtn('查看正本', kind: BtnKind.small, onTap: () => viewOriginal(p))), const SizedBox(width: 8)],
              Expanded(child: DBtn('修改內容', kind: BtnKind.small, onTap: () => editCard(p))),
              const SizedBox(width: 8),
              Expanded(child: DBtn('上傳新批文卡', kind: BtnKind.small, onTap: () => uploadCard(p))),
            ]),
            if (editing) ...[
              const SizedBox(height: 16),
              // .card-editor 沒有上內距、也不是 flow-root：第一個標籤的上外距 16 穿出去和編輯框的 16 合併，標籤貼着紙色底頂端
              EditorBox(children: [
                for (var i = 0; i < cardFields.length; i++) ...[
                  StatusLabel(cardFields[i].$2, status: fieldStatusText(fieldStatus[cardFields[i].$1]), failed: fieldStatusFailed(fieldStatus[cardFields[i].$1]), top: i == 0 ? 0 : 16),
                  Field(
                    controller: field('card', cardFields[i].$1, cardDraft),
                    placeholder: cardFields[i].$2,
                    onChanged: (v) => _set(() => cardDraft = {...cardDraft, cardFields[i].$1: v}),
                  ),
                ],
                EditorActions(onCancel: () => _set(() => editingCardId = ''), save: '儲存批文卡內容', onSave: () => saveCard(p)),
              ]),
            ],
          ]),
        ),
        bottom: 12,
      ),
    ];
  }

  // ── 車輛與證件 ───────────────────────────────────────────────────────────────────
  List<Blk> vehicleBlocks() {
    final out = <Blk>[];
    final permits = vehiclePermits(summary);
    if (permits.isNotEmpty) {
      out.add(Blk(
        DCard(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const UndatedTitle('通行證與備案'),
            for (var i = 0; i < permits.length; i++)
              Line(last: i == permits.length - 1, children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    LineTitle(jsString(at(permits[i], 'name'))),
                    if (isPending(str(at(permits[i], 'ownerType')), at(permits[i], 'ownerId'), 'date:${jsString(at(permits[i], 'code'))}')) const PendingTag(),
                  ]),
                ),
                DateEdit(
                  date: truthy(at(permits[i], 'dueOn')) ? dueDate(permits[i]) : null,
                  link: truthy(at(permits[i], 'dueOn')) ? '修改' : '填日期',
                  onTap: () => pickDate(permits[i], editing: truthy(at(permits[i], 'dueOn'))),
                ),
              ]),
          ]),
        ),
        bottom: 12,
      ));
    }
    final p = plate0;
    final bound = boundVehicles;
    if (!creating && loaded && p != null && bound.isEmpty && p['installation_status'] != '未上牌') {
      final local = p['local_plate'];
      out.add(Blk(
        DCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const LineTitle('尚未登記車輛'),
            LineSub(truthy(local)
                ? '按港澳車牌 ${jsString(local)} 登記這部車，之後可拍下行駛證、${p['route'] == '粵澳' ? '澳門車輛登記文件' : '香港車輛牌照'}和保險單，系統會讀出車架號碼和日期。'
                : '請先在上方填寫港澳車牌，再登記車輛。'),
            if (truthy(local)) ...[
              const SizedBox(height: 12),
              DBtn(registeringVehicle ? '正在登記…' : '登記這部車', kind: BtnKind.small, solid: true, enabled: !registeringVehicle, onTap: registerVehicle),
            ],
          ]),
        ),
        bottom: 12,
      ));
    }
    if (!creating) {
      for (final v in bound) {
        out.add(Blk(vehicleCard(v), bottom: 12));
      }
    }
    return out;
  }

  Widget vehicleCard(Object? v) {
    final id = '${at(v, 'id')}';
    final origin = at(v, 'origin');
    final d = docs[id];
    final inspections = listOf(at(detail[id], 'inspections'));
    final guidance = listOf(at(detail[id], 'inspectionGuidance'));
    final docList = listOf(at(d, 'documents'));
    final brandModel = [at(v, 'brand'), at(v, 'model')].where(truthy).map(jsString).join(' ');
    final blocks = <Blk>[
      Blk(SpacedRow(children: [
        PlateChip(plate: str(at(v, 'plate')), region: origin == '內地' ? '內地' : origin == '澳門' ? '澳門' : '香港'),
        Pill(jsString(at(v, 'type')), tone: Tone.gray),
      ])),
      Blk(
        Kv([
          ('車型', Text(brandModel.isEmpty ? '待補充' : brandModel)),
          ('類別', Text('${jsString(at(v, 'route'))} · ${jsString(origin)}車')),
          if (truthy(at(v, 'manufactured_year'))) ('製造年份', NumText(jsString(at(v, 'manufactured_year')))),
        ]),
        top: 16,
      ),
      if (isPending('vehicle', at(v, 'id'))) Blk(const PendingTag()),
      Blk(MoreLink(editingVehicleId == id ? '收起車輛修改' : '修改車輛資料 ›', onTap: () => editVehicle(v))),
      if (editingVehicleId == id) Blk(vehicleEditor(v), top: 4, bottom: 12),
      Blk(const BareTicketRule(), top: 16, bottom: 16),
      Blk(const LineTitle('車輛證件')),
      Blk(LineSub('拍下證件，系統會讀出車架號碼、日期等，只填入空白的資料，不會改動你已填的${forMode('；顧問會再核對', '')}。'), top: 2, bottom: 4),
      for (final c in listOf(at(d, 'checks')))
        Blk(Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [const Pill('請核對', tone: Tone.amber), const SizedBox(width: 8), Expanded(child: LineSub(jsString(at(c, 'text'))))]),
        )),
      for (final doc in docList)
        Blk(Line(top: true, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              LineTitle(jsString(at(doc, 'label'))),
              LineSub(truthy(at(doc, 'uploaded')) ? '已上傳 · ${str(at(doc, 'uploadedAt')).length > 10 ? str(at(doc, 'uploadedAt')).substring(0, 10) : str(at(doc, 'uploadedAt'))}' : jsString(at(doc, 'hint'))),
              for (final f in listOf(at(doc, 'fields')).where((item) => truthy(at(item, 'value'))))
                LineSub('${jsString(at(f, 'label'))}：${jsString(at(f, 'value'))}${at(f, 'status') == 'ok' ? '' : '（請核對）'}', tabular: true),
            ]),
          ),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            if (truthy(at(doc, 'uploaded'))) Link('看原件', onTap: () => viewVehicleDocument(context, at(v, 'id'), at(doc, 'kind'))),
            if (truthy(at(doc, 'uploaded')) && !truthy(at(d, 'retired'))) const SizedBox(height: 8),
            if (!truthy(at(d, 'retired')))
              Link(
                uploadingDoc == '$id:${jsString(at(doc, 'kind'))}' ? (truthy(at(doc, 'recognizable')) ? '辨識中…' : '上傳中…') : truthy(at(doc, 'uploaded')) ? '重新上傳' : '上傳',
                onTap: () => uploadDoc(v, doc),
              ),
          ]),
        ])),
      Blk(const BareTicketRule(), top: 16, bottom: 16),
      Blk(const LineTitle('驗車安排')),
      for (var i = 0; i < inspections.length; i++)
        Blk(Line(last: i == inspections.length - 1 && guidance.isEmpty, children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              LineTitle(jsString(at(inspections[i], 'title'))),
              LineSub(truthy(at(inspections[i], 'appointment_on')) ? jsString(at(inspections[i], 'appointment_on')) : '日期待安排', tabular: true),
            ]),
          ),
          Pill(jsString(at(inspections[i], 'status')), tone: Tone.blue),
        ])),
      if (inspections.isEmpty) Blk(const LineSub('暫時沒有驗車安排。', top: 0), top: 2),
      if (guidance.isNotEmpty)
        Blk(
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: C.paper, borderRadius: BorderRadius.circular(R.card)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('相關官方規定', style: ts(Fs.meta, color: C.ink3))),
              for (final g in guidance)
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => openSource(at(g, 'sourceId')),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Expanded(child: Text(jsString(at(g, 'label')), style: ts(Fs.body, color: C.ink2))),
                      if (truthy(at(g, 'sourceId'))) ...[const SizedBox(width: 12), const Link('來源 ›')],
                    ]),
                  ),
                ),
            ]),
          ),
          top: 16,
        ),
    ];
    return DCard(child: Blocks(blocks));
  }

  Widget vehicleEditor(Object? v) {
    Widget input(String key, String label, String hint, {bool number = false}) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          FieldLabel(label),
          Field(controller: field('vehicle', key, vehicleForm), placeholder: hint, keyboardType: number ? TextInputType.number : null, onChanged: (t) => vehicleForm[key] = t),
        ]);
    return EditorBox(children: [
      input('plate', '車牌', '車牌號碼'),
      input('brand', '品牌', '例如 Toyota'),
      input('model', '型號', '例如 Alphard'),
      input('vin', '車架號碼', '按行車證填寫'),
      input('manufacturedYear', '製造年份', '例如 2021', number: true),
      const FieldLabel('首次登記日期'),
      PickerBox(
        text: truthy(vehicleForm['firstRegisteredOn']) ? jsString(vehicleForm['firstRegisteredOn']) : '選擇日期',
        onTap: () async {
          final date = await showDatePicker(context, value: str(vehicleForm['firstRegisteredOn']));
          if (date != null) _set(() => vehicleForm = {...vehicleForm, 'firstRegisteredOn': date});
        },
      ),
      EditorActions(onCancel: () => _set(() => editingVehicleId = ''), save: savingVehicle ? '正在儲存…' : '儲存車輛資料', saving: savingVehicle, onSave: () => saveVehicle(v)),
    ]);
  }

  // ── 司機 ─────────────────────────────────────────────────────────────────────────
  List<Blk> driverBlocks() {
    final list = listOf(summary['drivers']);
    if (list.isEmpty) return [Blk(const DCard(child: LineSub('這個牌照還沒有登記司機；換司機請按上方「有變動？」。')), bottom: 12)];
    return [
      Blk(
        DCard(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (final d in list) ...[
              // 每位司機包在自己的 <view> 裏：沒有打開修改時 .line 是唯一的子元素（:last-child），所以沒有底線
              Line(last: editingDriverId != at(d, 'id'), onTap: () => editDriver(d), children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    LineTitle(jsString(at(d, 'name'))),
                    if (isPending('driver', at(d, 'id'))) const PendingTag(),
                  ]),
                ),
                Pill(at(d, 'role') == '主' ? '主司機' : '副司機', tone: at(d, 'role') == '主' ? Tone.green : Tone.gray),
                Link(editingDriverId == at(d, 'id') ? '收起' : '修改'),
              ]),
              if (editingDriverId == at(d, 'id'))
                Padding(
                  padding: const EdgeInsets.only(top: 4, bottom: 12),
                  child: EditorBox(children: [
                    const FieldLabel('姓名'),
                    Field(controller: field('driver', 'name', driverForm), placeholder: '司機姓名', onChanged: (t) => driverForm['name'] = t),
                    const FieldLabel('電話'),
                    Field(controller: field('driver', 'phone', driverForm), placeholder: '例如 +852 9123 4567', onChanged: (t) => driverForm['phone'] = t),
                    const FieldLabel('香港身份證號碼'),
                    Field(controller: field('driver', 'hkIdNo', driverForm), placeholder: '例如 A123456(7)', onChanged: (t) => driverForm['hkIdNo'] = t),
                    const LineSub('只保存最後 4 位'),
                    const FieldLabel('回鄉證號碼'),
                    Field(controller: field('driver', 'homeReturnPermitNo', driverForm), placeholder: '按回鄉證填寫', onChanged: (t) => driverForm['homeReturnPermitNo'] = t),
                    EditorActions(onCancel: () => _set(() => editingDriverId = ''), save: savingDriver ? '正在儲存…' : '儲存司機資料', saving: savingDriver, onSave: saveDriver),
                  ]),
                ),
            ],
            const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: LineSub('司機證件到期會列在到期項目。要更換司機，按上方「有變動？」。')),
          ]),
        ),
        bottom: 12,
      ),
    ];
  }

  // ── 出租 ─────────────────────────────────────────────────────────────────────────
  List<Blk> usageBlocks() {
    final out = <Blk>[];
    if (arrangements.isEmpty) out.add(Blk(DCard(child: LineSub(usageNote(summary, arrangements, rentalOptions))), bottom: 12));
    for (final a in arrangements) {
      final user = at(a, 'user'), invoices = listOf(at(a, 'invoices'));
      final client = at(a, 'source') == 'client';
      out.add(Blk(
        DCard(
          onTap: client ? () => go('/rental?id=${jsString(at(a, 'id'))}') : null,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SpacedRow(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  LineTitle(jsString(at(user, 'name'))),
                  LineSub('${truthy(at(user, 'vehiclePlate')) ? '使用車輛 ${jsString(at(user, 'vehiclePlate'))} · ' : ''}${jsString(at(a, 'startsOn'))} 起${truthy(at(a, 'endsOn')) ? ' 至 ${jsString(at(a, 'endsOn'))}' : ''}'),
                ]),
              ),
              Pill(jsString(at(a, 'statusWord')), tone: toneOf(rentalTone(a))),
              if (client) const Chev(),
            ]),
            LineSub('租金 ${money(at(a, 'currency'), at(a, 'amount'))} / ${cycleLabel[at(a, 'cycle')] ?? 'undefined'} · ${at(a, 'collectionMode') == '代收' ? '由我們代收' : '直接付給你'}'),
            if (at(a, 'status') == '生效' || invoices.isNotEmpty) ...[
              const TicketRule(),
              for (final i in invoices)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    NumText(jsString(at(i, 'period')), color: C.ink2),
                    Pill(feeLabel(a, i), tone: toneOf(feeTone[at(i, 'status')])),
                  ]),
                ),
              if (invoices.isEmpty) const LineSub('暫時沒有租金記錄'),
            ],
          ]),
        ),
        bottom: 12,
      ));
    }
    final allowed = truthy(at(rentalOptions, 'allowed'));
    if (allowed) {
      out.add(Blk(DBtn('新增出租', kind: BtnKind.line, onTap: () => go('/rental-new?plate=$plateId')), bottom: 12));
    } else if (truthy(at(rentalOptions, 'reason')) && !arrangements.any((a) => ['草擬', '待換車', '生效'].contains(at(a, 'status')))) {
      out.add(Blk(LineSub(jsString(at(rentalOptions, 'reason')), top: 0), top: 2, bottom: 12));
    }
    if (cardSelfManaged) {
      out.add(Blk(
        Align(
          alignment: Alignment.centerLeft,
          child: Link('想由我們代收租金？交給我們代收 ›', onTap: () => go(entrustPath({'code': 'rental_collection', 'name': '出租代收租金', 'plateId': plateId}))),
        ),
        bottom: 12,
      ));
    }
    return out;
  }

  // ── 持牌公司 ─────────────────────────────────────────────────────────────────────
  List<Blk> holderBlocks() {
    final s = summary, rental = s['rental'];
    String or(Object? v) => truthy(v) ? jsString(v) : '待補充';
    return [
      Blk(
        DCard(
          child: Kv([
            ('用途', Text(holderUsage(s))),
            if (truthy(rental)) ('租期', NumText('${truthy(at(rental, 'startsOn')) ? jsString(at(rental, 'startsOn')) : '—'} 至 ${truthy(at(rental, 'endsOn')) ? jsString(at(rental, 'endsOn')) : '未定'}')),
            if (truthy(s['indicatorCategory'])) ('指標類別', Text(jsString(s['indicatorCategory']))),
            if (truthy(s['port'])) ('口岸', Text(jsString(s['port']))),
            ('持牌公司', Text(or(s['holder']))),
            ('內承單位', Text(or(s['contractor']))),
          ]),
        ),
        bottom: 12,
      ),
    ];
  }

  // ── 牌照資料 ─────────────────────────────────────────────────────────────────────
  List<Blk> plateFileBlocks(J p) {
    final route = p['route'];
    Widget plateItem(String label, Widget plate) => Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(label, style: ts(Fs.cap, color: C.ink3))),
            plate,
          ]),
        );
    final local = p['local_plate'];
    final options = vehicleOptions(p, vehicles);
    final installed = installWord(plateForm['installationStatus']);
    return [
      Blk(
        DCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              plateItem('內地港澳入出境號牌', truthy(p['mainland_plate']) ? Center(child: MainlandPlate(plate: jsString(p['mainland_plate']), width: 300)) : const PlateMissing()),
              const SizedBox(width: 12),
              plateItem(
                '${route == '粵港' ? '香港' : '澳門'}號牌',
                !truthy(local)
                    ? const PlateMissing()
                    : route == '粵港'
                        ? Center(child: HongKongPlate(plate: jsString(local), width: 300))
                        // 第七節管理者決定（2026-11-22）：粵澳路線也用 MacauPlate，和登入頁的澳門牌一樣
                        : Center(child: MacauPlate(plate: jsString(local), width: 300)),
              ),
            ]),
            const SizedBox(height: 16),
            Kv([
              ('上牌狀態', Text(p['installation_status'] == '待核對' ? unsetWord() : jsString(p['installation_status']))),
              ('使用狀態', Text(usageWord(p['usage_status']))),
              ('綁定車輛', Text(boundVehicle(p, vehicles))),
            ]),
            MoreLink(showEdit ? '收起資料修改' : '修改牌照資料 ›', onTap: () => _set(() => showEdit = !showEdit)),
            if (showEdit)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  const FieldLabel('內地車牌號'),
                  Field(controller: field('plate', 'mainlandPlate', plateForm), placeholder: '尚未上牌可留空', onChanged: (t) => plateForm['mainlandPlate'] = t),
                  const FieldLabel('香港／澳門車牌號'),
                  Field(controller: field('plate', 'localPlate', plateForm), placeholder: '尚未上牌可留空', onChanged: (t) => plateForm['localPlate'] = t),
                  const FieldLabel('上牌狀態'),
                  PickerBox(
                    text: installed,
                    gray: installed == '未填寫',
                    onTap: () async {
                      final list = installOptions();
                      final i = await showSelectorPicker(context, list);
                      if (i != null) _set(() => plateForm = {...plateForm, 'installationStatus': list[i]});
                    },
                  ),
                  if (cardSelfManaged) ...[
                    const FieldLabel('使用狀態'),
                    if (plateForm['usageStatus'] == '出租中')
                      const PickerBox(text: '出租中（在出租區處理）', chev: false)
                    else
                      PickerBox(
                        text: usageWord(plateForm['usageStatus']),
                        gray: usageWord(plateForm['usageStatus']) == '未填寫',
                        onTap: () async {
                          final i = await showSelectorPicker(context, const ['自用', '空置']);
                          if (i != null) _set(() => plateForm = {...plateForm, 'usageStatus': const ['自用', '暫停使用'][i]});
                        },
                      ),
                  ],
                  const FieldLabel('綁定車輛'),
                  PickerBox(
                    text: options.cast<({String id, String label})?>().firstWhere((v) => v!.id == plateForm['vehicleId'], orElse: () => null)?.label ?? '未綁定',
                    onTap: () async {
                      final i = await showSelectorPicker(context, options.map((o) => o.label).toList());
                      if (i != null) _set(() => plateForm = {...plateForm, 'vehicleId': options[i].id});
                    },
                  ),
                  const FieldLabel('批文卡有效期至'),
                  Field(controller: field('plate', 'cardExpiresOn', plateForm), placeholder: 'YYYY-MM-DD', onChanged: (t) => plateForm['cardExpiresOn'] = t),
                  const FieldLabel('備註'),
                  TextArea(controller: field('plate', 'notes', plateForm), placeholder: '補充這個兩地牌的資料', onChanged: (t) => plateForm['notes'] = t),
                  LineSub(
                    cardSelfManaged ? '出租請在上面的出租區新增；批文卡編號請在上方「修改內容」更新。修改後立即生效。' : '使用狀態由顧問記錄；批文卡編號請在上方「修改內容」更新。修改後立即生效，顧問會再核對。',
                    top: 12,
                  ),
                  const SizedBox(height: 16),
                  DBtn(savingFile ? '正在儲存…' : '儲存牌照資料', enabled: !savingFile, onTap: () => savePlate(p)),
                ]),
              ),
          ]),
        ),
        bottom: 12,
      ),
    ];
  }

  // ── 辦理記錄 ─────────────────────────────────────────────────────────────────────
  List<Blk> requestBlocks() {
    final list = listOf(summary['requests']);
    if (list.isEmpty) return [Blk(const DCard(child: LineSub('這個牌照還沒有辦理記錄。')), bottom: 12)];
    return [
      Blk(
        DCard(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (var i = 0; i < list.length; i++)
              Line(last: i == list.length - 1, onTap: () => go('/request-detail?id=${jsString(at(list[i], 'id'))}'), children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      Expanded(child: LineTitle(jsString(at(list[i], 'title')))),
                      const SizedBox(width: 12),
                      Pill(jsString(at(list[i], 'status')), tone: toneOf(requestTone(at(list[i], 'status')))),
                    ]),
                    LineSub(clientStage(at(list[i], 'stage'))),
                  ]),
                ),
                const Chev(),
              ]),
          ]),
        ),
        bottom: 12,
      ),
    ];
  }
}
