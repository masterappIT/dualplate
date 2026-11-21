// 自行辦理更新：一比一移植 mobile/src/pages/self-change/self-change.vue（App 端）。
// 網址：/self-change?plate=<牌照 id>&kind=<種類>（newPlate、period、name、label、dueOn 可選）；導航列標題是種類名稱（自行換車等）。
// 種類：換車、續期、換司機、口岸變更、商號變更、補領（拍新批文卡＋資料）；驗車、新批文備案、行車稅（標記一期辦好，必須附相片）；不再續期。
// 狀態和計算在 self_change_logic.dart；選相片和壓縮在 plate_detail/doc_photo.dart。
import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/num_text.dart';
import '../../business/card_capture.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/dialogs.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/image_preview.dart';
import '../../ui/pickers.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/card_original.dart' show forgetCardOriginal;
import '../plate_detail/doc_photo.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf, str;
import '../plate_detail/plate_detail_widgets.dart';
import 'self_change_logic.dart';

typedef CardCaptureFn = Future<String?> Function(BuildContext context, {required String side});

class SelfChangePage extends StatefulWidget {
  const SelfChangePage({super.key, this.query = const {}});
  final Map<String, String> query;

  // 拍卡：經階段 2 的共用接口；測試可替換
  static CardCaptureFn capture = openCardCapture;

  @override
  State<SelfChangePage> createState() => SelfChangePageState();
}

class SelfChangePageState extends State<SelfChangePage> {
  late final SelfChangeForm f = SelfChangeForm(query: widget.query);
  bool busy = false, submitting = false;
  Map<String, bool> uploaded = {};
  final List<CardPhoto> photos = [];
  final ctl = <String, TextEditingController>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => load());
  }

  @override
  void dispose() {
    for (final c in ctl.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  void toast(String text) {
    if (mounted) showToast(context, text);
  }

  String err(Object e) => e is ApiError ? e.message : '$e';

  // 輸入框：每個欄位一個控制器；資料由程式改動（預先填入、移除司機）後用 sync() 把文字放回輸入框
  TextEditingController c(String key, String value) => ctl.putIfAbsent(key, () => TextEditingController(text: value));

  void sync() {
    void put(String key, String value) {
      final x = ctl[key];
      if (x != null && x.text != value) x.text = value;
    }

    for (final e in f.cardText.entries) {
      put('card.${e.key}', e.value);
    }
    for (final e in f.vehicle.entries) {
      put('vehicle.${e.key}', e.value);
    }
    for (final (i, d) in f.drivers.indexed) {
      put('d$i.name', d.name);
      put('d$i.phone', d.phone);
    }
    put('stop.note', f.stopNote);
  }

  Future<void> load() async {
    try {
      final form = Map<String, dynamic>.from(await api('/my/plates/${Uri.encodeComponent(f.plateId)}/self-handled/form') as Map);
      _set(() {
        f.form = form;
        f.fillDefaults();
      });
      sync();
    } catch (e) {
      toast(err(e));
    } finally {
      _set(() => f.loaded = true);
    }
  }

  Future<void> uploadCard(String side) async {
    final photo = await SelfChangePage.capture(context, side: side);
    if (photo == null || !mounted) return;
    _set(() => busy = true);
    try {
      await api('/plate-assets/${f.plateId}/card/$side', 'POST', {'image': photo});
      forgetCardOriginal(f.plateId);
      _set(() => uploaded = {...uploaded, side: true});
      final form = Map<String, dynamic>.from(await api('/my/plates/${Uri.encodeComponent(f.plateId)}/self-handled/form') as Map);
      _set(() {
        f.form = form;
        f.fillDefaults();
      });
      sync();
      toast('已上傳，請核對下面的資料');
    } catch (e) {
      toast(e is ApiError && e.message.isNotEmpty ? e.message : '上傳失敗');
    } finally {
      _set(() => busy = false);
    }
  }

  Future<void> addPhoto() async {
    final file = await pickOnePhoto(context);
    if (file == null || !mounted) return;
    _set(() => busy = true);
    try {
      final photo = await cardPhoto(file);
      _set(() => photos.add(photo));
    } catch (e) {
      toast(e is PhotoError && e.message.isNotEmpty ? e.message : '相片讀取失敗');
    } finally {
      _set(() => busy = false);
    }
  }

  Future<void> viewPhoto(int index) async {
    final i = await choose(context, '這張相片', const ['放大查看', '移除這張']);
    if (!mounted) return;
    if (i == 0) {
      await previewImages(context, photos.map<Uint8List>((p) => p.bytes).toList(), current: index);
    } else if (i == 1) {
      _set(() => photos.removeAt(index));
    }
  }

  Future<String?> pickDate(String? value, {String? start, String? end}) => showDatePicker(context, value: value, start: start, end: end);

  Future<void> submit() async {
    final message = f.problem(photos.length);
    if (message.isNotEmpty) return toast(message);
    if (f.kind == 'stop_renewal') {
      final ok = await ask(context, title: '確認不再續期？', msg: forMode('這個牌照會停止到期提醒，你的顧問會聯絡你確認。', '這個牌照會停止到期提醒。'), ok: '確認', cancel: '返回');
      if (ok != 'confirm') return;
    }
    _set(() => submitting = true);
    try {
      await api('/my/plates/${Uri.encodeComponent(f.plateId)}/self-handled', 'POST', f.body(photos.map((p) => p.data).toList()));
      toast(f.doneToast);
      Timer(const Duration(milliseconds: 700), () {
        if (!mounted) return;
        if (context.canPop()) {
          context.pop();
        } else {
          context.pushReplacement('/plate-detail?id=${Uri.encodeComponent(f.plateId)}');
        }
      });
    } catch (e) {
      toast(err(e));
    } finally {
      _set(() => submitting = false);
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final blocks = <Blk>[
      Blk(Text(f.intro, style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
      if (f.loaded && f.pendingHere)
        Blk(_warn('已提交「${f.kindName}」，顧問核對中', '核對完成前不能再提交同一類更新；如需修改請聯絡你的顧問。'), bottom: 12)
      else if (f.loaded && f.stopped)
        Blk(_warn('這個牌照已標記為不再續期', '如要恢復，${forMode('請聯絡你的顧問', '請在「我的 › 聯絡我們」發訊息給我們')}。'), bottom: 12)
      else if (f.loaded) ...[
        if (f.showCardUpload) _card(_cardUpload()),
        if (f.kind == 'vehicle_change') ...[_card(_vehicleInfo()), _card(_vehicleDates())],
        if (f.kind == 'renewal') _card(_renewal()),
        if (f.kind == 'driver_change') _card(_drivers()),
        if (f.kind == 'crossing_change') _card(_crossing()),
        if (f.kind == 'company_change') _card(_company()),
        if (f.kind == 'replacement') _card(_replacement()),
        if (f.marking) _card(_marking()),
        if (f.kind == 'stop_renewal') _card(_stop()),
        _card(_shared()),
        Blk(DBtn(submitting ? '正在提交…' : f.submitText, enabled: !(submitting || busy), onTap: submit), top: 4),
      ],
    ];
    return AppPage(
      title: f.kindName,
      // iOS 鍵盤上方的「⌃ ⌄ 完成」列（現有 App 的 WKWebView 自帶），和牌照詳情頁同一做法
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(children: [Blocks(blocks)]));
        }),
      ),
    );
  }

  // .list-card.warn-card：標題＋說明
  Widget _warn(String title, String sub) => CardBox(
        margin: EdgeInsets.zero,
        warn: true,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [ListTitle(title), ListSub(sub)]),
      );

  Blk _card(List<Blk> inner) => Blk(CardBox(margin: EdgeInsets.zero, child: Blocks(inner)), bottom: 12);
  Blk _step(String text) => Blk(Text(text, style: ts(Fs.h, weight: w800, color: C.jadeDeep)), bottom: 4);
  Blk _sub(String text, {double top = 0}) => Blk(Subtle(text), top: top);
  Blk _label(String text, {double top = 16}) => Blk(Text(text, style: ts(Fs.body, weight: w700, color: C.ink2)), top: top, bottom: 8);

  Widget _input(String key, String value, String placeholder, ValueChanged<String> onChanged) => Field(controller: c(key, value), placeholder: placeholder, onChanged: (v) => _set(() => onChanged(v)));

  // 日期選擇（.field.picker）：空白時灰字「選擇…」
  Widget _date(String value, String empty, ValueChanged<String> onPicked, {String? start, String? end, bool clear = false, VoidCallback? onClear}) {
    final box = PickerBox(
      text: value.isNotEmpty ? value : empty,
      gray: value.isEmpty,
      onTap: () async {
        final v = await pickDate(value.isEmpty ? null : value, start: start, end: end);
        if (v != null) _set(() => onPicked(v));
      },
    );
    if (!clear) return box;
    // .row（gap 12）：日期框撐滿，有日期時右邊「清除」
    return Row(children: [
      Expanded(child: box),
      if (value.isNotEmpty) ...[const SizedBox(width: 12), LinkText('清除', onTap: () => _set(onClear!))],
    ]);
  }

  Widget _switch(bool done, VoidCallback onDone, VoidCallback onNot, {String a = '已辦好', String b = '未辦'}) =>
      Segmented<bool>(options: [(true, a), (false, b)], value: done, onChanged: (v) => v ? onDone() : onNot());

  List<Blk> _cardUpload() => [
        _step('新批文卡'),
        _sub(f.cardHint),
        Blk(
          Row(children: [
            Expanded(child: DBtn(uploaded['front'] == true ? '✓ 已拍正面' : '拍正面', kind: BtnKind.small, enabled: !busy, onTap: () => uploadCard('front'))),
            const SizedBox(width: 8),
            Expanded(child: DBtn(uploaded['back'] == true ? '✓ 已拍背面' : '拍背面', kind: BtnKind.small, enabled: !busy, onTap: () => uploadCard('back'))),
          ]),
          top: 12,
        ),
        if (busy) _sub('正在上傳辨識，請稍候…', top: 8),
      ];

  List<Blk> _vehicleInfo() {
    final v = f.vehicle;
    return [
      _step('新車資料'),
      if (truthy(f.form['vehicle'])) _sub('現在的車：${f.currentVehicle}。提交後舊車資料保留作記錄，不再提醒。'),
      _label('新車${f.localName}車牌（必填）'),
      Blk(_input('vehicle.plate', v['plate']!, '按新車行車證填寫', (x) => v['plate'] = x)),
      _label('品牌'),
      Blk(_input('vehicle.brand', v['brand']!, '例如 Toyota', (x) => v['brand'] = x)),
      _label('型號'),
      Blk(_input('vehicle.model', v['model']!, '例如 Alphard', (x) => v['model'] = x)),
      _label('首次登記日期'),
      Blk(_date(v['firstRegisteredOn']!, '選擇日期', (x) => v['firstRegisteredOn'] = x, end: f.today)),
      _sub('用來推算內地驗車年份。', top: 4),
      _label('車架號碼'),
      Blk(_input('vehicle.vin', v['vin']!, '按行車證填寫', (x) => v['vin'] = x)),
    ];
  }

  List<Blk> _vehicleDates() => [
        _step('新車證件到期日'),
        _sub(forMode('未有可先留空，你的顧問會跟進。', '未有可先留空，之後在牌照頁補上。')),
        for (final d in listOf(f.form['vehicleDates'])) ...[
          _label(str(at(d, 'name'))),
          Blk(_date(f.dates[jsString(at(d, 'code'))] ?? '', '選擇到期日', (x) => f.dates[jsString(at(d, 'code'))] = x, clear: true, onClear: () => f.dates[jsString(at(d, 'code'))] = '')),
        ],
      ];

  // 續期：逐份文件已辦好／未辦；.doc 之間有細線
  List<Blk> _renewal() {
    final docs = listOf(f.form['renewalDocuments']);
    Widget doc(int index, List<Blk> inner) {
      final body = Padding(padding: const EdgeInsets.only(bottom: 4), child: Blocks(inner));
      if (index == 0) return body;
      return Container(padding: const EdgeInsets.only(top: 4), decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.rule))), child: body);
    }

    final approvalDone = f.renewal['approval']?.done == true;
    final blocks = <Blk>[_step('哪些已續期？'), _sub('只辦好一部分也可以先更新，未辦的會照舊提醒。')];
    var index = 0;
    for (final d in docs) {
      final code = jsString(at(d, 'code'));
      final r = f.renewal[code] ?? const RenewalDraft();
      final inner = <Blk>[
        _label(str(at(d, 'name'))),
        Blk(Text.rich(TextSpan(text: '現在到期日：', children: [TextSpan(text: truthy(at(d, 'expiresOn')) ? jsString(at(d, 'expiresOn')) : '未有記錄', style: numStyle(ts(Fs.meta, color: C.ink2, height: 1.6)))]), style: ts(Fs.meta, color: C.ink2, height: 1.6))),
        Blk(_switch(r.done, () => _set(() => f.setDone(code, true)), () => _set(() => f.setDone(code, false))), top: 8),
        if (r.done)
          Blk(
            PickerBox(
              text: r.expiresOn.isNotEmpty ? '新到期日 ${r.expiresOn}' : '選擇新到期日',
              gray: r.expiresOn.isEmpty,
              onTap: () async {
                final v = await pickDate(r.expiresOn.isEmpty ? null : r.expiresOn, start: f.today);
                if (v != null) _set(() => f.setRenewalDate(code, v));
              },
            ),
            top: 8,
          ),
      ];
      // 第一份的 .field-label 上距穿出 .doc（沒有上內距），和上面合併；之後每份 .doc+.doc 上距 8、上內距 4、細線
      if (index == 0) {
        inner[0] = Blk(inner[0].child, bottom: 8);
        blocks.add(Blk(doc(0, inner), top: 16));
      } else {
        blocks.add(Blk(doc(index, inner), top: 8));
      }
      index++;
    }
    if (approvalDone) {
      blocks.add(Blk(
        doc(index, [
          _label('新批文的海關及邊檢備案'),
          _sub('新批文生效後須在 183 天內備案。'),
          Blk(_switch(f.filingDone, () => _set(() => f.filingDone = true), () => _set(() => f.filingDone = false)), top: 8),
        ]),
        top: index == 0 ? 16 : 8,
      ));
    }
    return blocks;
  }

  // 換司機：每位司機一段，最多 3 位
  List<Blk> _drivers() {
    final list = f.drivers;
    return [
      _step('換司機後的司機名單'),
      _sub('按新批文卡上的駕駛人填寫，最多 3 位；不在名單的司機不再提醒證件到期。'),
      for (final (i, d) in list.indexed)
        Blk(Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(border: i == list.length - 1 ? null : const Border(bottom: BorderSide(color: C.rule))),
          child: Blocks([
            Blk(Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Text('司機 ${i + 1}', style: ts(Fs.h, weight: w700)),
              if (list.length > 1)
                LinkText('移除', onTap: () {
                  _set(() => f.drivers.removeAt(i));
                  sync();
                }),
            ])),
            _label('姓名'),
            Blk(_input('d$i.name', d.name, '按批文卡填寫', (x) => d.name = x)),
            Blk(_switch(d.role == '主', () => _set(() => f.setMain(i)), () => _set(() => d.role = '副'), a: '主司機', b: '副司機'), top: 8),
            _label('電話（可不填）'),
            Blk(_input('d$i.phone', d.phone, '例如 +852 9123 4567', (x) => d.phone = x)),
            for (final doc in listOf(f.form['driverDates'])) ...[
              _label('${str(at(doc, 'name'))}到期日（可不填）'),
              Blk(_date(d.dates[jsString(at(doc, 'code'))] ?? '', '選擇到期日', (x) => d.dates[jsString(at(doc, 'code'))] = x, clear: true, onClear: () => d.dates[jsString(at(doc, 'code'))] = '')),
            ],
          ]),
        )),
      if (list.length < 3)
        Blk(Btn('＋ 加一位司機', kind: BtnKind.line, expand: true, onTap: () {
          _set(f.addDriver);
          sync();
        }), top: 12),
    ];
  }

  List<Blk> _crossing() => [
        _step('新的通行口岸'),
        _sub('原來：${truthy(f.before['crossing']) ? jsString(f.before['crossing']) : '未有記錄'}'),
        _label('新批文卡上的通行口岸（必填）'),
        Blk(_input('card.crossing', f.cardText['crossing']!, '例如 港珠澳大橋', (x) => f.cardText['crossing'] = x)),
        _label('新禁區紙到期日（可不填）'),
        Blk(_date(f.cardText['crpExpiresOn']!, '選擇到期日', (x) => f.cardText['crpExpiresOn'] = x, clear: true, onClear: () => f.cardText['crpExpiresOn'] = '')),
        _sub(forMode('口岸改變後，海關及邊檢備案可能要重辦，你的顧問會跟進。', '口岸改變後，海關及邊檢備案可能要重辦，請留意；需要幫忙可交給我們辦。'), top: 12),
      ];

  List<Blk> _company() => [
        _step('新批文卡上的名稱'),
        _sub(forMode('按新卡填寫；公司的登記資料請到「我的公司」更新，牌照所屬公司由顧問核對後調整。', '按新卡填寫；公司的登記資料和牌照所屬公司，請到「我的公司」核對。')),
        _label('商號'),
        Blk(_input('card.company', f.cardText['company']!, truthy(f.before['company']) ? jsString(f.before['company']) : '按批文卡填寫', (x) => f.cardText['company'] = x)),
        _label('內承單位'),
        Blk(_input('card.contractor', f.cardText['contractor']!, truthy(f.before['contractor']) ? jsString(f.before['contractor']) : '按批文卡填寫', (x) => f.cardText['contractor'] = x)),
      ];

  List<Blk> _replacement() => [
        _step('補領的新卡'),
        _sub('補領的批文卡有效期不變，只有流水號（有時連編號）不同。'),
        _label('卡面流水號（必填）'),
        Blk(_input('card.serial', f.cardText['serial']!, truthy(f.before['serial']) ? '原來 ${jsString(f.before['serial'])}' : '按新卡填寫', (x) => f.cardText['serial'] = x)),
        _label('批文卡編號'),
        Blk(_input('card.cardNumber', f.cardText['cardNumber']!, '按新卡填寫', (x) => f.cardText['cardNumber'] = x)),
      ];

  List<Blk> _marking() => [
        _step(f.mark.name),
        Blk(
          Kv([
            if (f.mark.label.isNotEmpty) ('項目', Text(f.mark.label)),
            ('到期日', NumText(f.mark.dueOn.isNotEmpty ? f.mark.dueOn : '—')),
          ]),
          top: 8,
        ),
        _sub('標記後這一期不再提醒；請附上${markProof[f.kind]}相片${forMode('，顧問會再核對', '作記錄')}。', top: 12),
      ];

  List<Blk> _stop() => [
        _step('為甚麼不再續期？'),
        Blk(
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final r in listOf(f.form['stopReasons'])) Chip(jsString(r), active: f.stopReason == r, onTap: () => _set(() => f.stopReason = jsString(r))),
          ]),
          top: 12,
          bottom: 16,
        ),
        _label('補充說明（可不填）'),
        Blk(TextArea(controller: c('stop.note', f.stopNote), placeholder: '例如車已於 10 月賣出', onChanged: (v) => f.stopNote = v)),
        _sub(forMode('提交後這個牌照不再提醒到期；你的顧問會聯絡你確認。', '提交後這個牌照不再提醒到期。')),
      ];

  // 共用：辦好日期、相片（最多 6 張）
  List<Blk> _shared() => [
        _label(f.kind == 'stop_renewal' ? '決定日期' : '辦好日期', top: 0),
        Blk(_date(f.handledOn, f.handledOn, (x) => f.handledOn = x, end: f.today)),
        if (f.kind != 'stop_renewal') ...[
          _label('${f.photoLabel}（${f.marking ? '必須' : '可選'}，最多 6 張）'),
          Blk(Wrap(spacing: 8, runSpacing: 8, children: [
            for (final (i, p) in photos.indexed)
              GestureDetector(
                onTap: () => viewPhoto(i),
                child: Container(
                  width: 72,
                  height: 72,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(color: C.paper, border: Border.all(color: C.rule), borderRadius: BorderRadius.circular(R.control)),
                  child: Image.memory(p.bytes, fit: BoxFit.cover),
                ),
              ),
            if (photos.length < 6)
              GestureDetector(
                onTap: addPhoto,
                child: Container(
                  width: 72,
                  height: 72,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: C.paper, border: Border.all(color: C.rule), borderRadius: BorderRadius.circular(R.control)),
                  child: Text('＋', style: ts(Fs.title, weight: w700, color: C.jade)),
                ),
              ),
          ])),
          if (photos.isNotEmpty) _sub('點相片可放大或移除。', top: 8),
        ],
      ];
}
