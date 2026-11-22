// 新增出租：一比一移植 mobile/src/pages/rental-new/rental-new.vue（App 端）。
// 網址：/rental-new?plate=<牌照 id>。填承租人、出租人名義、車和司機、要辦的手續、租期租金、由誰負責；
// 新增後以出租頁取代本頁（uni.redirectTo）。自管客戶只可自行負責、租金直接付給你。狀態和計算在 rental_new_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/choices.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/pickers.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DBtn, PickerBox;
import 'rental_new_logic.dart';

class RentalNewPage extends StatefulWidget {
  const RentalNewPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<RentalNewPage> createState() => RentalNewPageState();
}

class RentalNewPageState extends State<RentalNewPage> {
  final bool selfManaged = isSelfManaged();
  late final String plateId = widget.query['plate'] ?? '';
  final f = RentalNewForm();
  bool busy = false;
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

  TextEditingController c(String key, String value) => ctl.putIfAbsent(key, () => TextEditingController(text: value));

  Future<void> load() async {
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final o = await api('/my/plates/$plateId/rental-options') as Map;
      _set(() => f.applyOptions(o));
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    } finally {
      _set(() => f.loaded = true);
    }
  }

  Future<void> submit() async {
    final message = f.problem();
    if (message.isNotEmpty) return toast(message);
    _set(() => busy = true);
    try {
      final created = await api('/my/plates/$plateId/rentals', 'POST', f.body()) as Map;
      if (mounted) context.pushReplacement('/rental?id=${jsString(created['id'])}');
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    } finally {
      _set(() => busy = false);
    }
  }

  // ── 小組件 ──
  Blk step(String text) => Blk(Text(text, style: ts(Fs.h, weight: w800, color: C.jadeDeep)), bottom: 4);
  Blk label(String text) => Blk(Text(text, style: ts(Fs.body, weight: w700, color: C.ink2)), top: 16, bottom: 8);
  Blk sub(String text, {double top = 0}) => Blk(Subtle(text), top: top);
  Blk input(String key, String value, String placeholder, ValueChanged<String> onChanged, {TextInputType? keyboard}) =>
      Blk(Field(controller: c(key, value), placeholder: placeholder, keyboardType: keyboard, onChanged: (v) => _set(() => onChanged(v))));
  Blk card(List<Blk> inner) => Blk(CardBox(margin: EdgeInsets.zero, child: Blocks(inner)), bottom: 12);
  Widget seg(List<(String, String)> options, String value, ValueChanged<String> onChanged) => Segmented<String>(options: options, value: value, onChanged: (v) => _set(() => onChanged(v)));

  Blk date(String value, String empty, ValueChanged<String> onPicked) => Blk(PickerBox(
        text: value.isNotEmpty ? value : empty,
        gray: value.isEmpty,
        onTap: () async {
          // 現有 App 的原生日期滾輪不受 :start 限制（3b 已核實），所以結束日期也不設下限
          final v = await showDatePicker(context, value: value.isEmpty ? null : value);
          if (v != null) _set(() => onPicked(v));
        },
      ));

  List<Blk> form(Map o) {
    final drivers = (o['drivers'] is List ? o['drivers'] as List : const []).whereType<Map>().toList();
    final lessors = (o['lessors'] is List ? o['lessors'] as List : const []).whereType<Map>().toList();
    final current = o['currentVehicle'];
    final currency = jsString(o['currency']);
    final needed = f.needed;
    final prices = o['prices'] is Map ? o['prices'] as Map : const {};
    return [
      card([
        step('承租人'),
        label('姓名或公司名稱（必填）'),
        input('name', f.renterName, '例如 陳大文', (v) => f.renterName = v),
        label('聯絡電話（必填）'),
        input('phone', f.renterPhone, '例如 +852 6123 4567', (v) => f.renterPhone = v),
        sub('承租人打開協議時要輸入電話最後 4 位。', top: 4),
        label('證件號碼'),
        input('idNo', f.renterIdNo, '香港身份證或回鄉證號碼，可不填', (v) => f.renterIdNo = v),
      ]),
      card([
        step('以誰的名義出租'),
        sub('建議以香港身份或香港公司簽署。'),
        // .choices 上距 8，每個 .wd-radio 自己再有上距 10
        Blk(
          WdRadioGroup<String>(
            value: f.lessorKey,
            options: [for (final l in lessors) ('${jsString(l['type'])}:${jsString(l['id'])}', '${jsString(l['label'])}（${jsString(l['hint'])}）')],
            onChanged: (v) => _set(() => f.lessorKey = v),
          ),
          top: 8,
        ),
      ]),
      card([
        step('使用的車和司機'),
        Blk(seg([('current', truthy(current) ? '用現有的車 ${jsString(current)}' : '用現有的車'), ('own', '承租人自己的車')], f.useCurrent ? 'current' : 'own', (v) => f.useCurrent = v == 'current'), top: 8),
        if (!f.useCurrent) ...[
          label('承租人的車牌（必填）'),
          input('vehicle', f.vehiclePlate, '按行車證填寫', (v) => f.vehiclePlate = v),
        ] else if (!truthy(current))
          sub('這個牌照還沒有登記車輛，請選「承租人自己的車」。', top: 4),
        label('司機'),
        for (final d in drivers)
          Blk(Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: WdCheckbox(
              label: '${jsString(d['name'])}（已登記）',
              value: f.pickedDrivers[jsString(d['id'])] == true,
              onChanged: (v) => _set(() => f.pickedDrivers[jsString(d['id'])] = v),
            ),
          )),
        label('新司機姓名'),
        input('newDriver', f.newDriver, '承租人自己的司機，可不填', (v) => f.newDriver = v),
      ]),
      if (needed.isNotEmpty)
        card([
          step('要辦的手續'),
          sub('承租人的車或司機要先登記到批文上，辦妥後才開始出租和收租。'),
          for (final (i, n) in needed.indexed)
            Blk(Container(
              padding: EdgeInsets.only(top: 12, bottom: i == needed.length - 1 ? 0 : 12),
              decoration: BoxDecoration(border: i == needed.length - 1 ? null : const Border(bottom: BorderSide(color: C.rule))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(children: [
                    Expanded(child: Text(n.name, style: ts(Fs.h, weight: w700))),
                    const SizedBox(width: 12),
                    Subtle(f.procedures[n.kind] == 'us' ? jsString(prices[n.kind]) : '辦好後在「有變動？」更新'),
                  ]),
                ),
                seg(const [('us', '交給我們辦'), ('client', '我自行辦理')], f.procedures[n.kind]!, (v) => f.procedures[n.kind] = v),
              ]),
            )),
        ]),
      card([
        step('租期和租金'),
        label('起租日期（必填）'),
        date(f.startsOn, '選擇日期', (v) => f.startsOn = v),
        label('結束日期'),
        date(f.endsOn, '未定，可不填', (v) => f.endsOn = v),
        label('租金（$currency，必填）'),
        input('rent', f.rent, '每期金額，例如 8000', (v) => f.rent = v, keyboard: const TextInputType.numberWithOptions(decimal: true)),
        label('收租週期'),
        Blk(seg(cycleOptions, f.cycle, (v) => f.cycle = v)),
        label('每期收租日（1–28 日）'),
        input('dueDay', f.dueDay, '例如 5', (v) => f.dueDay = v, keyboard: TextInputType.number),
        label('押金（$currency）'),
        input('deposit', f.deposit, '沒有可不填', (v) => f.deposit = v, keyboard: const TextInputType.numberWithOptions(decimal: true)),
      ]),
      card([
        step(selfManaged ? '協議和收租' : '由誰負責'),
        if (selfManaged)
          sub('你自己把協議發給承租人、收租，租金由承租人直接付給你；我們只記錄。想由我們代收，可在牌照的出租區按「交給我們代收」。', top: 4)
        else ...[
          Blk(seg(const [('self', '自行負責'), ('agent', '交給我們代理')], f.handling, (v) => f.handling = v)),
          sub(f.handling == 'self' ? '你自己把協議發給承租人、收租；我們只記錄。' : '協議和後續由顧問接手，可由我們代收租金，按你的委託內容收費。', top: 4),
        ],
        if (f.handling == 'agent') ...[
          label('租金怎樣付'),
          Blk(seg(const [('直付', '直接付給你'), ('代收', '由我們代收')], f.collection, (v) => f.collection = v)),
        ],
      ]),
      Blk(DBtn(busy ? '正在新增…' : '新增出租', enabled: !busy, onTap: submit), top: 4),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final o = f.options;
    final blocks = <Blk>[
      Blk(Intro('${o != null ? jsString(o['plateLabel']) : ''} 出租給別人使用。填好後我們會按香港法律產生出租協議，你可以修改再發給承租人確認。')),
      if (f.loaded && o != null && !truthy(o['allowed']))
        Blk(
          CardBox(
            warn: true,
            margin: EdgeInsets.zero,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [const ListTitle('暫時不能新增出租'), ListSub(jsString(o['reason']))]),
          ),
          bottom: 12,
        )
      else if (f.loaded && o != null)
        ...form(o),
    ];
    return AppPage(
      title: '新增出租',
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(children: [Blocks(blocks)]));
        }),
      ),
    );
  }
}
