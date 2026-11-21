// 委託內容：一比一移植 mobile/src/pages/scope/scope.vue（App 端）。只能看；外包也寫「我們負責」。
// 網址：/scope（全部，每個牌照／公司一行）；/scope?id=<牌照或公司 id>（從牌照頁、公司卡片或上一層進來，直接看那一個的細項）。
// onShow(load)：每次回到本頁（從子頁返回、App 回到前景）都重新載入。計算在 scope_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf, str;
import '../plate_detail/plate_detail_widgets.dart';
import 'advisor_card_3a.dart';
import 'scope_logic.dart';

class ScopePage extends StatefulWidget {
  const ScopePage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<ScopePage> createState() => ScopePageState();
}

class ScopePageState extends State<ScopePage> {
  late final String only = widget.query['id'] ?? '';
  List<dynamic> sections = [];
  Map? advisor;
  bool loaded = false;
  String title = '委託內容';
  late final AppLifecycleListener lifecycle = AppLifecycleListener(onResume: load);

  @override
  void initState() {
    super.initState();
    lifecycle;
    WidgetsBinding.instance.addPostFrameCallback((_) => load());
  }

  @override
  void dispose() {
    lifecycle.dispose();
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  Future<void> load() async {
    if (!mounted) return;
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final r = await Future.wait([api('/my/scope'), api('/my/overview')], eagerError: true);
      _set(() {
        sections = listOf(at(r[0], 'sections'));
        advisor = at(r[1], 'advisor') is Map ? at(r[1], 'advisor') as Map : null;
        final t = ownerTitle(sections, only);
        if (t != null) title = t;
      });
    } catch (e) {
      if (mounted) showToast(context, e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  Future<void> go(String path) async {
    await context.push(path);
    if (mounted) unawaited(load());
  }

  @override
  Widget build(BuildContext context) {
    final shown = shownSections(sections, only);
    final summary = scopeSummary(shown, only);
    final blocks = <Blk>[
      Blk(Text('委託內容', style: ts(Fs.title, weight: w800, height: 1.3, color: C.jadeDeep)), bottom: 4),
      // .subtle.intro：字號由 .intro 決定（14）
      if (loaded && summary.isNotEmpty) Blk(Text(summary, style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
      if (loaded && only.isEmpty && AdvisorCard.shows(advisor, false)) Blk(AdvisorCard(advisor: advisor), top: 12, bottom: 12),
      if (only.isEmpty)
        for (final section in shown) ...[
          Blk(SectionTitle(str(section['label']), bare: true), top: 28, bottom: 12),
          Blk(_listCard(listOf(section['owners'])), bottom: 12),
        ]
      else
        for (final owner in ownersOf(shown)) Blk(_ownerCard(owner), bottom: 12),
      if (loaded && shown.isEmpty)
        Blk(CardBox(margin: EdgeInsets.zero, padding: EdgeInsets.zero, child: Empty(only.isNotEmpty ? '找不到這個牌照或公司，可能已轉出或註銷。' : '還沒有委託內容')), bottom: 12),
      if (loaded && shown.isNotEmpty) ...[
        Blk(Btn('申請調整委託', kind: BtnKind.line, expand: true, onTap: () => go(adjustPath(shown, only))), top: 20),
        Blk(Text('告訴顧問想加入或取消哪一項，顧問確認後會在這裏更新。', textAlign: TextAlign.center, style: ts(Fs.meta, color: C.ink2, height: 1.6)), top: 8),
      ],
    ];
    return AppPage(title: title, child: PageBody(children: [Blocks(blocks)]));
  }

  // .card.list（內距 4 16）：每個牌照／公司一行，按進去看細項
  Widget _listCard(List<dynamic> owners) => CardBox(
        margin: EdgeInsets.zero,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final (i, owner) in owners.indexed)
            Line(last: i == owners.length - 1, onTap: () => go('/scope?id=${jsString(at(owner, 'id'))}'), children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(str(at(owner, 'label')), style: ts(Fs.h, weight: w700, height: 1.4)),
                  Text(truthy(at(owner, 'stopped')) ? '已標記不再續期' : ownerCounts(owner), style: ts(Fs.body, color: C.ink2)),
                ]),
              ),
              const Chev(),
            ]),
        ]),
      );

  // .card.owner：一個牌照或公司的細項
  Widget _ownerCard(Object? owner) {
    final us = listOf(at(owner, 'us')), you = listOf(at(owner, 'you'));
    final stopped = truthy(at(owner, 'stopped'));
    Widget item(Object? x, {bool muted = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(str(at(x, 'name')), style: ts(Fs.body, color: muted ? C.ink2 : C.ink)),
        );
    Widget group(List<Widget> children) => Container(
          margin: const EdgeInsets.only(top: 16),
          padding: const EdgeInsets.only(top: 12),
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.rule))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
        );
    return CardBox(
      margin: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(child: Text(str(at(owner, 'label')), style: ts(Fs.h, weight: w800, height: 1.4))),
          if (stopped) ...[const SizedBox(width: 12), const Pill('不再續期', tone: Tone.gray)],
        ]),
        if (truthy(at(owner, 'nameEn'))) Subtle(str(at(owner, 'nameEn'))),
        if (stopped)
          Padding(padding: const EdgeInsets.only(top: 8), child: Text('已標記不再續期，我們不再為這個牌照辦理續期。', style: ts(Fs.body, color: C.ink2)))
        else ...[
          if (us.isNotEmpty) group([Text('我們負責', style: ts(Fs.body, weight: w800, color: C.jade)), for (final x in us) item(x)]),
          if (you.isNotEmpty)
            group([
              const Align(alignment: Alignment.centerLeft, child: Who('你自行辦理')),
              Padding(padding: const EdgeInsets.only(top: 4), child: Text('到期前我們會提醒你。', style: ts(Fs.meta, color: C.ink2, height: 1.6))),
              for (final x in you) item(x, muted: true),
            ]),
          if (us.isEmpty && you.isEmpty) Text('這裏暫時沒有委託事項。', style: ts(Fs.body, color: C.ink2)),
        ],
      ]),
    );
  }
}

