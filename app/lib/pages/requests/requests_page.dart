// 申請辦理：一比一移植 mobile/src/pages/requests/requests.vue（App 端）。
// 網址：/requests，查詢參數 service、plate（從牌照快捷入口來，預先選好）、entrust（item／long／scope）、item（委託的項目名稱）。
// onShow(load)：每次回到本頁（從子頁返回、App 回到前景）都重新載入，並再套一次預選（照舊）。狀態和計算在 requests_logic.dart。
import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../business/plate_chip.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/pickers.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf, str;
import '../plate_detail/plate_detail_widgets.dart';
import 'requests_logic.dart';

class RequestsPage extends StatefulWidget {
  const RequestsPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<RequestsPage> createState() => RequestsPageState();
}

class RequestsPageState extends State<RequestsPage> with PageShow {
  late final RequestsForm f = RequestsForm(selfManaged: isSelfManaged(), query: widget.query);
  final description = TextEditingController();
  bool submitting = false;
  Object? price;
  String _priceKey = '|粵港';

  @override
  String get showPath => '/requests';
  @override
  void onShow() => load();

  @override
  void dispose() {
    description.dispose();
    super.dispose();
  }

  // 改了狀態後重畫；服務或路線變了就照 watch([serviceCode, route]) 重新取參考價
  void change(VoidCallback fn) {
    if (!mounted) return;
    setState(fn);
    final key = '${f.serviceCode}|${f.route}';
    if (key == _priceKey) return;
    _priceKey = key;
    setState(() => price = null);
    if (!f.selfManaged || f.serviceCode.isEmpty) return;
    api('/my/entrust-price?service=${Uri.encodeComponent(f.serviceCode)}&route=${Uri.encodeComponent(f.route)}').then((r) {
      if (mounted && _priceKey == key) setState(() => price = r);
    }, onError: (Object _) {});
  }

  void toast(String text) {
    if (mounted) showToast(context, text);
  }

  Future<void> load() async {
    if (!mounted) return;
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final r = await Future.wait([api('/catalog'), api('/vehicles'), api('/plate-assets'), api('/requests')], eagerError: true);
      change(() {
        f.services = listOf(at(r[0], 'services'));
        f.vehicles = listOf(r[1]);
        f.plates = listOf(r[2]);
        f.requests = listOf(r[3]);
        f.applyWanted();
      });
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    }
  }

  // 返回本頁時由 PageShow 重新載入（onShow）
  void go(String path) => context.push(path);

  Future<void> pickPlate() async {
    final i = await showSelectorPicker(context, f.plateNames, index: f.plateIndex);
    if (i != null) change(() => f.plateIndex = i);
  }

  Future<void> submit() async {
    f.description = description.text;
    final message = f.problem();
    if (message.isNotEmpty) return toast(message);
    change(() => submitting = true);
    try {
      final created = Map<String, dynamic>.from(await api('/requests', 'POST', f.body()) as Map);
      change(() => f.submitted(created));
      description.clear();
      toast(submittedToast(f.selfManaged));
      if (f.lockedPlate != null) {
        Timer(const Duration(milliseconds: 600), () {
          if (mounted) context.pushReplacement('/request-detail?id=${jsString(created['id'])}');
        });
      }
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    } finally {
      change(() => submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final locked = f.lockedPlate;
    final blocks = <Blk>[
      Blk(Text(f.introText, style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
      if (locked != null) Blk(_lockedCard(locked), bottom: 12),
      if (locked == null && !f.fixedService)
        Blk(Segmented<String>(options: [for (final r in requestRoutes) (r, '$r服務')], value: f.route, onChanged: (r) => change(() => f.setRoute(r))), bottom: 12),
      Blk(CardBox(margin: EdgeInsets.zero, child: Blocks(_formBlocks())), bottom: 12),
      Blk(SectionRow(title: '我的辦理記錄', trailing: Text('${f.requests.length} 項', style: numStyle(ts(Fs.meta, color: C.ink2, height: 1.6)))), top: 28, bottom: 12),
      if (f.requests.isEmpty)
        Blk(CardBox(margin: EdgeInsets.zero, padding: EdgeInsets.zero, child: const Empty('還沒有辦理記錄，提交後可在這裏看進度。')), bottom: 12)
      else
        Blk(_listCard(), bottom: 12),
    ];
    return AppPage(
      title: '申請辦理',
      // iOS 鍵盤上方的「⌃ ⌄ 完成」列（現有 App 的 WKWebView 自帶），和牌照詳情頁同一做法
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(children: [Blocks(blocks)]));
        }),
      ),
    );
  }

  // .card.locked：為這個牌照辦理（內地牌、港澳牌）
  Widget _lockedCard(Object? p) => CardBox(
        margin: EdgeInsets.zero,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('為這個牌照辦理', style: ts(Fs.meta, weight: w700, color: C.ink3)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            PlateChip(plate: str(at(p, 'mainland_plate')), region: '內地'),
            if (truthy(at(p, 'local_plate'))) PlateChip(plate: str(at(p, 'local_plate')), region: at(p, 'route') == '粵澳' ? '澳門' : '香港'),
          ]),
        ]),
      );

  List<Blk> _formBlocks() {
    final (formTitle, sub) = switch (f.entrust) {
      'scope' => ('申請調整委託', f.entrustItem.isNotEmpty ? f.entrustItem : '全部委託內容'),
      'long' => ('長期委託', '由我們負責你指定的事項，按年收固定代辦費；範圍和價錢由我們和你一起定。'),
      _ => ('要辦甚麼？', '不確定就選「其他代辦要求」，寫下情況即可。'),
    };
    return [
      Blk(Text(formTitle, style: ts(Fs.h, weight: w800, color: C.jadeDeep))),
      Blk(Subtle(sub)),
      if (!f.fixedService)
        Blk(
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final s in f.shownServices)
              Chip(str(at(s, 'name')), active: f.serviceCode == at(s, 'code'), onTap: () => change(() => f.pickService(jsString(at(s, 'code'))))),
          ]),
          top: 12,
          bottom: 16,
        ),
      if (f.showPrice) Blk(Text(priceText(price), style: ts(Fs.body, weight: w700, color: C.jadeDeep)), top: 12),
      if (f.noPlateYet) ...[
        _label('哪個牌照？'),
        Blk(Subtle('還沒有${f.route}牌照。這項要先新增牌照，才可以交給我們辦。')),
        Blk(Btn('新增牌照', kind: BtnKind.line, expand: true, onTap: () => go('/plate-create')), top: 12),
      ] else if (f.showPlatePicker) ...[
        _label('哪個牌照？'),
        Blk(PickerBox(text: f.plateNames[f.plateIndex.clamp(0, f.plateNames.length - 1)], gray: f.plateIndex == 0, onTap: pickPlate)),
      ],
      _label('補充說明（可不填）'),
      Blk(TextArea(controller: description, placeholder: f.placeholder)),
      Blk(_SubmitButton(loading: submitting, onTap: submit), top: 16),
    ];
  }

  Blk _label(String text) => Blk(Text(text, style: ts(Fs.body, weight: w700, color: C.ink2)), top: 16, bottom: 8);

  // .card.list：每項一行（標題＋狀態，下面是內地牌和目前步驟）
  Widget _listCard() => CardBox(
        margin: EdgeInsets.zero,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final (i, item) in f.requests.indexed)
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => go('/request-detail?id=${jsString(at(item, 'id'))}'),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(border: i == f.requests.length - 1 ? null : const Border(bottom: BorderSide(color: C.rule))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    Expanded(child: Text(str(at(item, 'title')), style: ts(Fs.h, weight: w700, height: 1.4))),
                    const SizedBox(width: 12),
                    Pill(customerStatus(at(item, 'status')), tone: toneOf(requestTone(customerStatus(at(item, 'status'))))),
                  ]),
                  const SizedBox(height: 4),
                  Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    if (f.plateOf(item).isNotEmpty) PlateChip(plate: f.plateOf(item), region: '內地', size: PlateChipSize.sm),
                    Text(clientStage(at(item, 'stage')), style: ts(Fs.body, color: C.ink2)),
                  ]),
                ]),
              ),
            ),
        ]),
      );
}

// <button class="primary" :loading :disabled>：送出中是 uni-button[disabled] 的灰底，文字前加 uni-button[loading] 的轉圈圖示（18px、右距 .34em）
class _SubmitButton extends StatelessWidget {
  const _SubmitButton({required this.loading, required this.onTap});
  final bool loading;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    if (!loading) return Btn('提交', onTap: onTap);
    return Opacity(
      opacity: Motion.disabledOpacity,
      child: Container(
        height: H.primary,
        decoration: BoxDecoration(color: UniDisabled.bg, borderRadius: BorderRadius.circular(R.control)),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          const _UniSpinner(),
          SizedBox(width: Fs.h * .34),
          Text('提交', style: ts(Fs.h, weight: w700, color: UniDisabled.text, height: 1)),
        ]),
      ),
    );
  }
}

// uni-button[loading]:before 的轉圈：12 條放射線，1 秒轉一圈、分 12 格跳
class _UniSpinner extends StatefulWidget {
  const _UniSpinner();
  @override
  State<_UniSpinner> createState() => _UniSpinnerState();
}

class _UniSpinnerState extends State<_UniSpinner> with SingleTickerProviderStateMixin {
  late final AnimationController run = AnimationController(vsync: this, duration: const Duration(seconds: 1))..repeat();
  @override
  void dispose() {
    run.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: run,
        builder: (context, _) => Transform.rotate(angle: (run.value * 12).floor() * math.pi / 6, child: const CustomPaint(size: Size.square(18), painter: _RaysPainter())),
      );
}

class _RaysPainter extends CustomPainter {
  const _RaysPainter();
  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero), r = size.width / 2;
    for (var i = 0; i < 12; i++) {
      final a = i * math.pi / 6 - math.pi / 2;
      final paint = Paint()
        ..color = UniDisabled.text.withValues(alpha: .25 + .75 * i / 11)
        ..strokeWidth = size.width / 12
        ..strokeCap = StrokeCap.round;
      canvas.drawLine(c + Offset(math.cos(a), math.sin(a)) * r * .5, c + Offset(math.cos(a), math.sin(a)) * r * .92, paint);
    }
  }

  @override
  bool shouldRepaint(_RaysPainter old) => false;
}
