// 月報：一比一移植 mobile/src/pages/reports/reports.vue（App 端）。
// 列表：每月一張（月份、更正版、發出日期、右邊結算）；點開在同一頁顯示整份月報（「‹ 返回月報列表」回到列表，不是換頁）。
// 每次顯示都重新載入列表（onShow），打開中的月報不關。計算在 reports_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/due_date.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf;
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks;
import 'reports_logic.dart';

class ReportsPage extends StatefulWidget {
  const ReportsPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<ReportsPage> createState() => ReportsPageState();
}

class ReportsPageState extends State<ReportsPage> with PageShow {
  List list = [];
  Map? current;
  bool loaded = false;
  final scroll = ScrollController();

  @override
  String get showPath => '/reports';

  @override
  void onShow() => unawaited(load());

  @override
  void dispose() {
    scroll.dispose();
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  void toast(String text) {
    if (mounted) showToast(context, text);
  }

  Future<void> load() async {
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final result = await api('/my/reports');
      _set(() => list = result is List ? result : []);
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  Future<void> open(Map row) async {
    try {
      final r = await api('/my/reports/${jsString(row['id'])}');
      _set(() => current = r is Map ? r : null);
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    }
  }

  // ── 列表 ──
  Widget listCard(Map r) => ListCard(
        margin: EdgeInsets.zero,
        onTap: () => open(r),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              ListTitle(monthTitle(r['period'])),
              ListSub('${jsNumber(r['version']) > 1 ? '更正版 · ' : ''}發出 ${friendlyDate(r['confirmedAt'])}'),
            ]),
          ),
          const SizedBox(width: 12),
          // .net：靠右直排，間距 2
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            for (final (i, (currency, value)) in netRows(r['net']).indexed)
              Padding(
                padding: EdgeInsets.only(top: i == 0 ? 0 : 2),
                child: Text('${netWord(value)} ${money(currency, value.abs())}', style: numStyle(ts(Fs.body, weight: w700, color: value < 0 ? C.due : C.ok))),
              ),
          ]),
        ]),
      );

  List<Blk> listView() => [
        Blk(Text('每月一份：辦好的事、快到期的事、租金、收費和報帳，由顧問核對後發出。', style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
        for (final r in list.whereType<Map>()) Blk(listCard(r), bottom: 12),
        if (loaded && list.isEmpty) Blk(const CardBox(margin: EdgeInsets.zero, padding: EdgeInsets.zero, child: Empty('還沒有月報。每月初顧問核對後會發給你。')), bottom: 12),
      ];

  // ── 一份月報 ──
  // .line：左右排列、置中、間距 12、上下 12、底線
  Widget sheetLine(List<Widget> children, bool last) {
    final spaced = <Widget>[];
    for (final c in children) {
      if (spaced.isNotEmpty) spaced.add(const SizedBox(width: 12));
      spaced.add(c);
    }
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.rule))),
      child: Row(children: spaced),
    );
  }

  Widget title(String text) => Text(text, style: ts(Fs.body, weight: w700));
  Widget sub(String text, {bool tabular = false}) {
    final s = ts(Fs.meta, color: C.ink2);
    return Padding(padding: const EdgeInsets.only(top: 2), child: Text(text, style: tabular ? numStyle(s) : s));
  }

  // .card.list：內距 4 16；沒有項目時 .subtle 上下 12
  Widget listBox(List<Widget> lines, String empty) => CardBox(
        margin: EdgeInsets.zero,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ...lines,
          if (lines.isEmpty && empty.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Subtle(empty)),
        ]),
      );

  Widget right(String amount, String status) => Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text(amount, style: numStyle(ts(Fs.body, weight: w700))),
        sub(status),
      ]);

  List<Blk> sheetView(Map cur) {
    final report = cur['report'] is Map ? cur['report'] as Map : const {};
    final net = netRows(at(at(report, 'net'), 'net'));
    final completed = listOf(report['completed']), upcoming = listOf(report['upcoming']);
    final usage = listOf(at(report['usage'], 'items')), charges = listOf(at(report['charges'], 'items')), filings = listOf(report['filings']);
    final white = ts(Fs.title, weight: w800, color: ReportsStyle.white);
    return [
      Blk(Align(alignment: Alignment.centerLeft, child: LinkText('‹ 返回月報列表', onTap: () => _set(() => current = null))), bottom: 12),
      Blk(
        CardBox(
          deep: true,
          guilloche: true,
          margin: EdgeInsets.zero,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Kicker(jsNumber(cur['version']) > 1 ? '月報 · 更正版' : '月報'),
            Padding(padding: const EdgeInsets.only(top: 4), child: Text(monthTitle(cur['period']), style: white)),
            Text(jsString(report['customerName']), style: ts(Fs.body, color: C.onDeep2)),
            const TicketRule(deep: true),
            Text('本月結算', style: ts(Fs.meta, weight: w700, color: C.onDeep2)),
            for (final (currency, value) in net)
              Padding(padding: const EdgeInsets.only(top: 4), child: Text('${netWord(value)} ${money(currency, value.abs())}', style: numStyle(white))),
            if (net.isEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text('本月沒有需要結算的款項', style: white)),
          ]),
        ),
        bottom: 12,
      ),
      Blk(SectionTitle('本月辦好的事 · ${completed.length}', bare: true), top: 28, bottom: 12),
      Blk(listBox([
        for (final (i, c) in completed.indexed)
          sheetLine([
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [title(jsString(at(c, 'service'))), sub(jsString(truthy(at(c, 'plate')) ? at(c, 'plate') : at(c, 'title')))])),
            sub(jsString(at(c, 'completedOn')), tabular: true),
          ], i == completed.length - 1),
      ], '本月沒有辦好的事'), bottom: 12),
      Blk(SectionTitle('已逾期及 60 天內到期 · ${upcoming.length}', bare: true), top: 28, bottom: 12),
      Blk(listBox([
        for (final (i, u) in upcoming.indexed)
          sheetLine([
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                title(jsString(at(u, 'name'))),
                if (at(u, 'handledBy') == 'you') const Who(selfHandled),
                sub(jsString(at(u, 'owner'))),
              ]),
            ),
            DueDate(date: at(u, 'dueOn') is String ? at(u, 'dueOn') as String : '', days: at(u, 'daysLeft') is num ? (at(u, 'daysLeft') as num).toInt() : null, level: at(u, 'level') is String ? at(u, 'level') as String : ''),
          ], i == upcoming.length - 1),
      ], '沒有已逾期或 60 天內到期的事項'), bottom: 12),
      if (usage.isNotEmpty) ...[
        Blk(const SectionTitle('出租與租金', bare: true), top: 28, bottom: 12),
        Blk(listBox([
          for (final (i, u) in usage.indexed)
            sheetLine([
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [title(jsString(at(u, 'plate'))), sub('承租人 ${jsString(at(u, 'user'))} · ${truthy(at(u, 'collectedByUs')) ? '由我們代收' : '直接付給你'}')])),
              right(money(at(u, 'currency'), at(u, 'amount')), usageStatus(at(u, 'status'))),
            ], i == usage.length - 1),
        ], ''), bottom: 12),
      ],
      if (charges.isNotEmpty) ...[
        Blk(const SectionTitle('本月收費', bare: true), top: 28, bottom: 12),
        Blk(listBox([
          for (final (i, c) in charges.indexed)
            sheetLine([
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [title(jsString(at(c, 'description'))), sub(jsString(at(c, 'kindLabel')))])),
              right(money(at(c, 'currency'), at(c, 'amount')), chargeStatus(at(c, 'status'))),
            ], i == charges.length - 1),
        ], ''), bottom: 12),
      ],
      if (filings.isNotEmpty) ...[
        Blk(const SectionTitle('內地公司報帳', bare: true), top: 28, bottom: 12),
        Blk(listBox([
          for (final (i, f) in filings.indexed)
            sheetLine([
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  title(jsString(at(f, 'company'))),
                  sub(truthy(at(f, 'zeroFiling')) ? '零申報' : truthy(at(f, 'taxAmount')) ? '稅額 ${money('RMB', at(f, 'taxAmount'))}' : '截止 ${jsString(at(f, 'dueOn'))}'),
                ]),
              ),
              Pill(filingDone(at(f, 'status')) ? '已申報' : '辦理中', tone: filingDone(at(f, 'status')) ? Tone.green : Tone.blue),
            ], i == filings.length - 1),
        ], ''), bottom: 12),
      ],
      // .card.settle：上距 24；裏面的 .section-title 上距 0、下距 12
      Blk(
        CardBox(
          margin: EdgeInsets.zero,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: const [
            Padding(padding: EdgeInsets.only(bottom: 12), child: SectionTitle('結算說明', bare: true)),
            Subtle('應付給你 ＝ 本月代收的租金 − 代收服務費 − 未付的收費。不同幣種分開計算，不換算。如有疑問請聯絡你的顧問。'),
          ]),
        ),
        top: 24,
        bottom: 12,
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final cur = current;
    return AppPage(title: '月報', child: PageBody(controller: scroll, children: [Blocks(cur == null ? listView() : sheetView(cur))]));
  }
}
