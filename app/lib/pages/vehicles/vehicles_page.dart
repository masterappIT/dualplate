// 我的牌照（分頁）：一比一移植 mobile/src/pages/vehicles/vehicles.vue（App 端）。
// 批文卡疊（預設）和列表兩種看法，偏好記在本機（plateView）；點卡打開單張預覽（可翻面），返回鍵先關預覽。
// 每次顯示（onShow）都重新載入；首頁按狀態數字過來時帶篩選（VehiclesFilter）。計算在 vehicles_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../business/approval_card.dart';
import '../../business/css.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../business/plate_chip.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show J, at, listOf;
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DetailListCard, wrapBlk;
import '../login/login_page.dart' show LoginInput;
import 'vehicles_logic.dart';

class VehiclesPage extends StatefulWidget {
  const VehiclesPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<VehiclesPage> createState() => VehiclesPageState();
}

class VehiclesPageState extends State<VehiclesPage> with PageShow, BackClose, TickerProviderStateMixin {
  List<dynamic> plates = [], summaries = [];
  Map<String, J> details = {};
  bool loaded = false, flipped = false;
  String selectedPlateId = '', mode = 'cards', keyword = '', filter = '';
  final search = TextEditingController();
  late final AnimationController overlayIn = AnimationController(vsync: this, duration: VehiclesStyle.overlayIn);
  late final AnimationController focusIn = AnimationController(vsync: this, duration: VehiclesStyle.focusIn);

  @override
  String get showPath => '/vehicles';

  @override
  void initState() {
    super.initState();
    search.addListener(() {
      if (search.text != keyword) _set(() => keyword = search.text);
    });
    // uni.getStorageSync('plateView')||'cards'
    SharedPreferences.getInstance().then((prefs) {
      final saved = prefs.getString('plateView');
      if (truthy(saved) && mounted) setState(() => mode = saved!);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    search.dispose();
    overlayIn.dispose();
    focusIn.dispose();
    super.dispose();
  }

  @override
  void onShow() => unawaited(load());

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  Map? get selectedPlate {
    for (final p in plates) {
      if (at(p, 'id') == selectedPlateId && selectedPlateId.isNotEmpty) return p as Map;
    }
    return null;
  }

  // 安卓返回鍵先關批文卡預覽
  @override
  bool get backOpen => selectedPlate != null;
  @override
  void backClose() => closeCard();

  void addPlate() => context.push('/plate-create');

  void openPlate(Object? id) {
    closeCard();
    context.push(platePath(id));
  }

  void selectPlate(Object? p) {
    _set(() {
      selectedPlateId = jsString(at(p, 'id'));
      flipped = false;
    });
    // prefers-reduced-motion 時沒有動畫
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      overlayIn.value = 1;
      focusIn.value = 1;
    } else {
      overlayIn.forward(from: 0);
      focusIn.forward(from: 0);
    }
  }

  void closeCard() => _set(() {
        selectedPlateId = '';
        flipped = false;
      });

  // 記住看法；預設批文卡疊
  void setMode(String next) {
    _set(() => mode = next);
    SharedPreferences.getInstance().then((prefs) => prefs.setString('plateView', next), onError: (_) => false);
  }

  Future<void> load() async {
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    closeCard();
    final preset = VehiclesFilter.preset;
    if (preset != null && preset.isNotEmpty) {
      _set(() {
        filter = plateFilterPresets[preset] ?? '';
        mode = 'list';
      });
      VehiclesFilter.preset = null;
    }
    try {
      final r = await Future.wait([api('/plate-assets'), api('/my/overview')], eagerError: true);
      final p = listOf(r[0]).toList();
      _set(() {
        plates = p;
        summaries = listOf(at(r[1], 'plates')).toList();
      });
      final list = await Future.wait(p.map((item) => api('/plate-assets/${jsString(at(item, 'id'))}')), eagerError: true);
      _set(() => details = {for (final item in list) jsString(at(item, 'id')): Map<String, dynamic>.from(item as Map)});
    } catch (e) {
      if (mounted) showToast(context, e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  Map cardData(Object? id) => (at(details[jsString(id)], 'cardData') as Map?) ?? const {};

  @override
  Widget build(BuildContext context) {
    syncBack();
    final unit = rpxUnit(context);
    final visible = visiblePlates(summaries, filter, keyword);
    return AppPage(
      title: '我的牌照',
      child: Stack(children: [
        PageBody(children: [
          Blocks([
            Blk(
              Text.rich(TextSpan(children: [
                const TextSpan(text: '名下 '),
                TextSpan(text: '${plates.length}', style: numStyle(ts(Fs.body, color: C.ink2, height: 1.6))),
                const TextSpan(text: ' 個兩地牌。點擊查看到期、使用情況和辦理。'),
              ]), style: ts(Fs.body, color: C.ink2, height: 1.6)),
              bottom: 16,
            ),
            // 新增牌照放在最上方：批文卡多時，放在卡疊下面要捲很久才看得到
            Blk(Btn('＋ 新增牌照', kind: BtnKind.line, expand: true, onTap: addPlate), bottom: 16),
            if (plates.isNotEmpty) Blk(Segmented<String>(options: const [('cards', '批文卡'), ('list', '列表')], value: mode, onChanged: setMode), bottom: 16),
            if (mode == 'list' && plates.isNotEmpty)
              ...wrapBlk([
                // .field.search：uni-input 高 48（同登入頁輸入框，不用 base.dart 的 Field 50）
                Blk(LoginInput(controller: search, placeholder: '搜尋車牌、公司')),
                Blk(
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    for (final f in shownFilters(summaries, filter)) _CountChip(name: f.name, count: f.count, active: filter == f.id, onTap: () => _set(() => filter = f.id)),
                  ]),
                  top: 12,
                  bottom: 16,
                ),
                for (final p in visible) Blk(_plateCard(p), bottom: 12),
                if (visible.isEmpty) Blk(const Empty('沒有符合條件的牌照')),
              ]),
            if (loaded && plates.isEmpty)
              Blk(
                CardBox(
                  margin: EdgeInsets.zero,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
                  child: Column(children: [
                    Text('還沒有牌照記錄', textAlign: TextAlign.center, style: ts(Fs.h, weight: w700, height: 1.4)),
                    const SizedBox(height: 4),
                    Text(forMode('拍下批文卡正反面交給我們，我們會替你建立檔案。', '按上面的「新增牌照」拍下批文卡，就能建立牌照。'), textAlign: TextAlign.center, style: ts(Fs.body, color: C.ink2)),
                  ]),
                ),
                bottom: 12,
              ),
            if (mode == 'cards' && plates.isNotEmpty) Blk(_deck(unit), top: VehiclesStyle.deckTopRpx * unit, bottom: VehiclesStyle.deckBottomRpx * unit),
          ]),
        ]),
        if (selectedPlate != null) Positioned.fill(child: _focus(selectedPlate!)),
      ]),
    );
  }

  Widget _plateCard(Object? p) {
    final local = at(p, 'localPlate');
    final next = at(p, 'next');
    final warnings = warningsOf(p);
    final health = at(p, 'health');
    return DetailListCard(
      onTap: () => openPlate(at(p, 'id')),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Flexible(
            child: Wrap(spacing: 8, runSpacing: 8, children: [
              PlateChip(plate: _s(at(p, 'mainlandPlate')), region: '內地'),
              if (truthy(local)) PlateChip(plate: jsString(local), region: at(p, 'route') == '粵澳' ? '澳門' : '香港'),
            ]),
          ),
          const SizedBox(width: 12),
          Pill(healthLabelOf(health), tone: toneOf(healthToneOf(health))),
        ]),
        ListSub(plateSubline(p)),
        if (warnings.isNotEmpty) ListNote(warnings.join('、'), tone: NoteTone.gray),
        if (truthy(next)) ListNote('${_s(at(next, 'name'))} · ${daysText(next as Map)}', tone: _noteTone(noteToneOf(at(next, 'level')))),
      ]),
    );
  }

  // 批文卡疊：每張往下錯開 230rpx，後面的蓋在前面上；只露出上半部，點一張打開預覽
  Widget _deck(double unit) {
    final reveal = VehiclesStyle.cardRevealRpx * unit;
    final height = (VehiclesStyle.deckMinRpx + (plates.length - 1).clamp(0, 1 << 30) * VehiclesStyle.cardRevealRpx) * unit;
    const face = ApprovalFace(radiusRpx: VehiclesStyle.deckRadiusRpx, shadowYRpx: VehiclesStyle.deckShadowYRpx, shadowBlurRpx: VehiclesStyle.deckShadowBlurRpx, shadow: VehiclesStyle.deckShadow);
    return SizedBox(
      height: height,
      child: Stack(clipBehavior: Clip.none, children: [
        for (final (i, p) in plates.indexed)
          Positioned(
            left: 0,
            right: 0,
            top: i * reveal,
            child: ApprovalCard(
              key: ValueKey('deck-${at(p, 'id')}'),
              data: cardData(at(p, 'id')),
              flipOnTap: false,
              tapLabel: '單獨查看此批文卡',
              showControls: false,
              face: face,
              onCardTap: () => selectPlate(p),
            ),
          ),
      ]),
    );
  }

  // .wallet-overlay：深色遮罩（只蓋頁面內容）＋置中的 .wallet-focus 卡；點遮罩關閉
  Widget _focus(Map p) {
    final local = p['local_plate'];
    final overlay = CurvedAnimation(parent: overlayIn, curve: Motion.ease);
    final focus = CurvedAnimation(parent: focusIn, curve: VehiclesStyle.focusCurve);
    return FadeTransition(
      opacity: overlay,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: closeCard,
        child: Container(
          color: VehiclesStyle.overlay,
          padding: const EdgeInsets.all(16),
          alignment: Alignment.center,
          child: LayoutBuilder(builder: (context, box) {
            return AnimatedBuilder(
              animation: focus,
              builder: (context, child) => Opacity(
                opacity: focus.value.clamp(0, 1),
                child: Transform.translate(
                  offset: Offset(0, VehiclesStyle.focusFromY * (1 - focus.value)),
                  child: Transform.scale(scale: VehiclesStyle.focusFromScale + (1 - VehiclesStyle.focusFromScale) * focus.value, child: child),
                ),
              ),
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {},
                child: Container(
                  key: const ValueKey('wallet-focus'),
                  constraints: BoxConstraints(maxWidth: 560, maxHeight: box.maxHeight + 32 - 48),
                  decoration: BoxDecoration(color: C.paper, borderRadius: BorderRadius.circular(R.panel), boxShadow: Shadows.float),
                  clipBehavior: Clip.antiAlias,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                        Flexible(
                          child: Wrap(spacing: 8, runSpacing: 8, children: [
                            PlateChip(plate: _s(p['mainland_plate']), region: '內地'),
                            if (truthy(local)) PlateChip(plate: jsString(local), region: p['route'] == '粵澳' ? '澳門' : '香港'),
                          ]),
                        ),
                        const SizedBox(width: 8),
                        Semantics(
                          label: '關閉批文卡預覽',
                          button: true,
                          child: GestureDetector(
                            key: const ValueKey('close-focus'),
                            onTap: closeCard,
                            child: Container(
                              width: VehiclesStyle.closeSize,
                              height: VehiclesStyle.closeSize,
                              decoration: const BoxDecoration(color: C.mutedBg, shape: BoxShape.circle),
                              alignment: Alignment.center,
                              child: Text('×', style: ts(Fs.title, color: C.ink2, height: 1)),
                            ),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 12),
                      ApprovalCard(
                        key: ValueKey('focus-${p['id']}'),
                        data: cardData(p['id']),
                        back: flipped,
                        flipOnTap: false,
                        showControls: false,
                        tapLabel: flipped ? '翻到批文卡正面' : '翻到批文卡背面',
                        onCardTap: () => _set(() => flipped = !flipped),
                      ),
                      const SizedBox(height: 12),
                      Segmented<bool>(options: const [(false, '正面'), (true, '背面')], value: flipped, onChanged: (v) => _set(() => flipped = v)),
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: C.card, border: Border.all(color: C.rule), borderRadius: BorderRadius.circular(R.card)),
                        child: Kv([
                          ('上牌狀態', Text(installText(p))),
                          ('使用狀態', Text(usageStatusText(p))),
                          ('批文卡編號', Text(cardNumberText(p), style: numStyle(ts(Fs.body)))),
                        ]),
                      ),
                      const SizedBox(height: 16),
                      Btn('查看牌照詳情', onTap: () => openPlate(p['id'])),
                    ]),
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}

String _s(Object? v) => v == null ? '' : jsString(v);

NoteTone _noteTone(String name) => switch (name) { 'note-red' => NoteTone.red, 'note-amber' => NoteTone.amber, 'note-green' => NoteTone.green, 'note-gray' => NoteTone.gray, _ => NoteTone.none };

// .chip 裏「名稱數目」：數目用 .num（等寬數字、字距 .04em）。模板寫 {{ f.name }} <text>，uni-app 編譯時把中間的空格收掉（現有 App 顯示「全部8」）
class _CountChip extends StatelessWidget {
  const _CountChip({required this.name, required this.count, required this.active, required this.onTap});
  final String name;
  final int count;
  final bool active;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final style = ts(Fs.body, weight: w700, color: active ? HomeStyle.white : C.ink2);
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: Motion.fast,
        curve: Motion.ease,
        height: H.chip,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(color: active ? C.jade : C.mutedBg, borderRadius: BorderRadius.circular(R.pill)),
        child: Center(widthFactor: 1, child: Text.rich(TextSpan(children: [TextSpan(text: name), TextSpan(text: '$count', style: numStyle(style))]), style: style)),
      ),
    );
  }
}
