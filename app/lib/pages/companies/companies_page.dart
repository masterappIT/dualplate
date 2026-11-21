// 我的公司（分頁）：一比一移植 mobile/src/pages/companies/companies.vue（App 端）。
// 每組公司（香港／澳門公司配內地公司）持有的牌照、公司事項、每月報帳；客戶可改到期日、填日期（立即生效，顧問再核對）。
// 每次顯示（onShow）都重新載入；從牌照詳情「請補上公司資料」過來時，打開那間公司的修改表單並捲到它（editCompany）。
// 「修改公司資料」的表單 CompanyEditor 屬階段 3c：未接上前顯示佔位框（CompaniesPage.editor 由 3c 接上）。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../business/due_date.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../business/plate_chip.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/pickers.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf;
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks;
import 'companies_logic.dart';

// CompanyEditor（階段 3c）：company 是那間公司；close 收起；saved 儲存後收起並重新載入
typedef CompanyEditorBuilder = Widget Function(BuildContext context, Map company, VoidCallback close, Future<void> Function() saved);

class CompaniesPage extends StatefulWidget {
  const CompaniesPage({super.key, this.query = const {}});
  final Map<String, String> query;
  static CompanyEditorBuilder? editor;
  @override
  State<CompaniesPage> createState() => CompaniesPageState();
}

class CompaniesPageState extends State<CompaniesPage> with PageShow {
  // 頁面建立時決定（const selfManagedMode = isSelfManaged()）
  final bool selfManagedMode = isSelfManaged();
  Map data = const {'groups': [], 'ungrouped': []};
  bool loaded = false;
  Map<String, List<dynamic>> filings = {};
  List<dynamic> pending = [];
  String editingId = '';
  final companyKeys = <String, GlobalKey>{};

  @override
  String get showPath => '/companies';

  @override
  void onShow() => unawaited(load());

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  void toast(String text) {
    if (mounted) showToast(context, text);
  }

  bool isPending(Object? type, Object? id, [String? field]) => isPendingIn(pending, type, id, field);

  void toggle(Object? id) => _set(() => editingId = editingId == jsString(id) ? '' : jsString(id));

  GlobalKey keyOf(Object? id) => companyKeys.putIfAbsent(jsString(id), GlobalKey.new);

  // 從牌照頁「請補上公司資料」過來：直接打開那間公司的修改表單，300ms 後捲到它（uni.pageScrollTo duration 0）
  Future<void> openRequested() async {
    final prefs = await SharedPreferences.getInstance();
    final id = prefs.getString('editCompany');
    if (!truthy(id)) return;
    await prefs.remove('editCompany');
    _set(() => editingId = id!);
    Timer(const Duration(milliseconds: 300), () {
      final target = companyKeys[id]?.currentContext;
      if (target != null && target.mounted) Scrollable.ensureVisible(target, alignment: 0, duration: Duration.zero);
    });
  }

  Future<void> saved() async {
    _set(() => editingId = '');
    await load();
  }

  Future<void> load() async {
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final result = await api('/my/companies');
      _set(() => data = result is Map ? result : const {});
      unawaited(openRequested());
      api('/my/pending').then((list) => _set(() => pending = listOf(list)), onError: (_) => _set(() => pending = []));
      api('/my/filings').then((list) => _set(() => filings = {for (final item in listOf(list)) jsString(at(item, 'companyId')): listOf(at(item, 'periods'))}), onError: (_) {});
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  Future<void> fillDate(Map d) async {
    final date = await showDatePicker(context);
    if (!truthy(date)) return;
    try {
      await api('/my/dates', 'PUT', {'ownerType': d['ownerType'], 'ownerId': d['ownerId'], 'code': d['code'], 'expiresOn': date});
      await load();
      toast(selfManagedMode ? '已記錄，到期前會提醒你' : '已記錄，顧問會再核對');
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    }
  }

  Future<void> saveDate(Map d) async {
    final date = await showDatePicker(context, value: d['dueOn'] is String ? d['dueOn'] as String : null);
    if (!truthy(date) || date == d['dueOn']) return;
    try {
      await api('/my/dates', 'PUT', {'ownerType': d['ownerType'], 'ownerId': d['ownerId'], 'code': d['code'], 'expiresOn': date});
      await load();
      toast(forMode('到期日已更新，顧問會再核對', '到期日已更新'));
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final groups = listOf(data['groups']), ungrouped = listOf(data['ungrouped']);
    final empty = loaded && groups.isEmpty && ungrouped.isEmpty;
    return AppPage(
      title: '我的公司',
      child: PageBody(children: [
        Blocks([
          Blk(Text('每組公司持有的牌照，以及公司每年要辦的事。', style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
          // 客戶自己新增公司：放最上方，與牌照列表的「新增牌照」一致
          Blk(Btn('＋ 新增公司', kind: BtnKind.line, expand: true, onTap: () => context.push('/company-new')), bottom: 16),
          for (final g in groups) Blk(_group(g as Map), bottom: 12),
          for (final c in ungrouped) Blk(_ungrouped(c as Map), bottom: 12),
          // 自管客戶沒有顧問：說明公司從哪裏來，並可直接拍批文卡建立牌照
          if (empty && selfManagedMode)
            Blk(
              CardBox(
                margin: EdgeInsets.zero,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text('還沒有公司', textAlign: TextAlign.center, style: ts(Fs.h, weight: w700, height: 1.4)),
                  const SizedBox(height: 4),
                  Text('登記牌照時，批文卡上的公司會自動加到這裏。', textAlign: TextAlign.center, style: ts(Fs.body, color: C.ink2)),
                  const SizedBox(height: 12),
                  Btn('拍批文卡', onTap: () => context.push('/plate-create')),
                ]),
              ),
              bottom: 12,
            )
          else if (empty)
            Blk(
              CardBox(
                margin: EdgeInsets.zero,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
                child: Text('公司資料由你的顧問整理後會顯示在這裏。', textAlign: TextAlign.center, style: ts(Fs.body, color: C.ink3, height: 1.6)),
              ),
              bottom: 12,
            ),
        ]),
      ]),
    );
  }

  // ── 文字 ──
  // .side-label：13、700、ink-3
  Widget sideLabel(String text) => Text(text, style: ts(Fs.meta, weight: w700, color: C.ink3));
  // .company-sub：上距 2、14、ink-2、行高 1.5
  Widget companySub(String text, {double top = 2}) => Padding(padding: EdgeInsets.only(top: top), child: Text(text, style: ts(Fs.body, color: C.ink2)));
  Widget numSub(String label, Object? value) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text.rich(TextSpan(children: [TextSpan(text: '$label '), TextSpan(text: jsString(value), style: numStyle(ts(Fs.body, color: C.ink2)))]), style: ts(Fs.body, color: C.ink2)),
      );
  // 香港公司的英文名稱；沒有時橙色「未填英文名稱」
  Widget nameEn(Map c) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text(truthy(c['nameEn']) ? jsString(c['nameEn']) : '未填英文名稱', style: ts(Fs.body, color: truthy(c['nameEn']) ? C.ink2 : C.due)),
      );
  Widget pendingTag() => const Padding(padding: EdgeInsets.only(top: 4), child: Align(alignment: Alignment.centerLeft, widthFactor: 1, child: Pill('已修改，待核對', tone: Tone.amber)));
  Widget itemName(Object? name) => Text(name == null ? '' : jsString(name), style: ts(Fs.h, weight: w700, height: 1.4));
  // .link（可點；hidden 時佔位不顯示）
  Widget link(String text, {VoidCallback? onTap, bool hidden = false}) {
    final t = Text(text, softWrap: false, style: ts(Fs.body, weight: w700, color: C.jade));
    if (hidden) return Visibility.maintain(visible: false, child: t);
    return GestureDetector(behavior: HitTestBehavior.opaque, onTap: onTap, child: t);
  }

  // .company-links：「修改公司資料 ›／收起」（上內距 8）、托管客戶另有「委託內容 ›」，間距 20
  Widget companyLinks(Map c) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(padding: const EdgeInsets.only(top: 8), child: link(editingId == jsString(c['id']) ? '收起' : '修改公司資料 ›', onTap: () => toggle(c['id']))),
        if (!selfManagedMode) ...[
          const SizedBox(width: 20),
          Padding(padding: const EdgeInsets.only(top: 8), child: link('委託內容 ›', onTap: () => context.push('/scope?id=${jsString(c['id'])}'))),
        ],
      ]);

  Widget? editorFor(Map c) {
    if (editingId != jsString(c['id'])) return null;
    final build = CompaniesPage.editor;
    if (build != null) return build(context, c, () => _set(() => editingId = ''), saved);
    // 3c 接上 CompanyEditor 前的佔位
    return Container(
      key: const ValueKey('company-editor-placeholder'),
      margin: const EdgeInsets.only(top: 4, bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: C.paper, borderRadius: BorderRadius.circular(R.card)),
      child: Text('修改公司資料的表單（階段 3c 移植）', style: ts(Fs.body, color: C.ink3)),
    );
  }

  // 每月報帳：最近三個月
  Widget? filingBox(Map c) {
    final list = filings[jsString(c['id'])];
    if (list == null || list.isEmpty) return null;
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: C.paper, borderRadius: BorderRadius.circular(R.card)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('每月報帳', style: ts(Fs.meta, weight: w700, color: C.ink3)),
        const SizedBox(height: 4),
        Wrap(spacing: 16, runSpacing: 8, children: [
          for (final f in list.take(3))
            Row(mainAxisSize: MainAxisSize.min, children: [
              Text(filingMonth(f), style: numStyle(ts(Fs.body, weight: w700))),
              const SizedBox(width: 4),
              Pill(filingWord(f), tone: toneOf(filingTone(f))),
            ]),
        ]),
      ]),
    );
  }

  // .block：上下內距 12、底線；最後一塊沒有底線
  Widget block({required List<Widget> children, required bool last}) => Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.rule))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      );

  // 公司事項一行：左邊名稱等，右邊到期徽章＋「修改」（可改時打開日期選擇器；不可改時「修改」隱藏佔位）
  Widget deadlineRow(Map d, {bool owner = true}) {
    final editable = truthy(d['editable']);
    final dateEdit = Row(mainAxisSize: MainAxisSize.min, children: [
      DueDate(date: d['dueOn'] is String ? d['dueOn'] as String : '', days: d['daysLeft'] is num ? (d['daysLeft'] as num).toInt() : null, level: d['level'] is String ? d['level'] as String : ''),
      const SizedBox(width: 8),
      link('修改', hidden: !editable),
    ]);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            itemName(d['name']),
            if (showSelfTag(d)) const Who(selfHandled),
            if (owner) companySub(jsString(d['ownerLabel'])),
            if (isPending(d['ownerType'], d['ownerId'], 'date:${jsString(d['code'])}')) pendingTag(),
          ]),
        ),
        const SizedBox(width: 12),
        editable ? GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => saveDate(d), child: dateEdit) : dateEdit,
      ]),
    );
  }

  // 還沒有填日期的一行：可填日期時右邊「填日期」
  Widget undatedRow(Map d, {bool owner = true}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              itemName(d['name']),
              if (owner) companySub(jsString(d['ownerLabel'])),
              if (truthy(d['hint'])) companySub(companyHint(d['hint'])),
            ]),
          ),
          if (d['fill'] == 'date') ...[const SizedBox(width: 12), link('填日期', onTap: () => fillDate(d))],
        ]),
      );

  List<Widget> undatedBlock(List<dynamic> undated, {bool owner = true}) => [
        sideLabel('還沒有填日期'),
        for (final d in undated) undatedRow(d as Map, owner: owner),
        companySub('填上到期日後，到期前會提醒你。', top: 4),
      ];

  // .card.group：內距 4 16；每間公司一段（上下 12、底線），之後是待補充、持有的牌照、公司事項、還沒有填日期
  Widget _group(Map g) {
    final offshore = listOf(g['offshore']), mainland = listOf(g['mainland']);
    final plates = listOf(g['plates']), deadlines = listOf(g['deadlines']), undated = listOf(g['undated']);
    final parts = <(Widget, bool)>[]; // (內容, 是否 .block)
    if (offshore.isEmpty && mainland.isEmpty) parts.add((ListTitle(jsString(g['name'])), false));
    for (final c in [...offshore, ...mainland]) {
      parts.add((_company(c as Map), false));
    }
    if (offshore.isEmpty) parts.add((_missing('香港／澳門公司資料待補充'), false));
    if (mainland.isEmpty) parts.add((_missing('內地公司資料待補充'), false));
    if (plates.isNotEmpty) {
      parts.add((
        Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          sideLabel('持有的牌照'),
          for (final p in plates) _plateLine(p),
        ]),
        true,
      ));
    }
    if (deadlines.isNotEmpty) {
      parts.add((
        Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          sideLabel('公司事項'),
          for (final d in deadlines) deadlineRow(d as Map),
        ]),
        true,
      ));
    }
    // 還沒有填日期：只列你自行辦理的事項；填了到期日就移到上面
    if (undated.isNotEmpty) parts.add((Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: undatedBlock(undated)), true));
    return CardBox(
      margin: EdgeInsets.zero,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final (i, (w, isBlock)) in parts.indexed) isBlock ? block(children: [w], last: i == parts.length - 1) : w,
      ]),
    );
  }

  Widget _missing(String text) => Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: C.rule))),
        child: Padding(padding: const EdgeInsets.only(top: 2), child: Text(text, style: ts(Fs.body, color: C.ink3))),
      );

  // 一組裏的一間公司（.company：上下 12、底線）
  Widget _company(Map c) {
    final status = c['status'];
    return Container(
      key: keyOf(c['id']),
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: C.rule))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Flexible(child: sideLabel('${jsString(c['jurisdiction'])}公司')),
          if (status != '存續') ...[const SizedBox(width: 12), Pill(jsString(status), tone: status == '已註銷' ? Tone.gray : Tone.amber)],
        ]),
        Padding(padding: const EdgeInsets.only(top: 2), child: Text(jsString(c['name']), style: ts(Fs.h, weight: w700, height: 1.4))),
        if (c['jurisdiction'] == '香港') nameEn(c),
        if (truthy(c['registrationNo'])) numSub(regLabel(c), c['registrationNo']),
        if (truthy(c['incorporatedOn'])) numSub('成立日期', c['incorporatedOn']),
        if (isPending('company', c['id'])) pendingTag(),
        companyLinks(c),
        ?editorFor(c),
        ?filingBox(c),
      ]),
    );
  }

  // 持有的牌照一行（最少高 44）：車牌徽章（按號碼自動判斷地區）＋ ›
  Widget _plateLine(Object? p) {
    final parts = plateParts(at(p, 'label'));
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => context.push(platePath(at(p, 'id'))),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 44),
        child: Row(children: [
          Expanded(
            child: Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              for (final part in parts) PlateChip(plate: part),
              if (parts.isEmpty) companySub('車牌待補充'),
            ]),
          ),
          const SizedBox(width: 12),
          const Chev(),
        ]),
      ),
    );
  }

  // 沒有分組的公司（.card）
  Widget _ungrouped(Map c) {
    final deadlines = listOf(c['deadlines']), undated = listOf(c['undated']);
    final blocks = <Widget>[
      if (deadlines.isNotEmpty) Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [sideLabel('公司事項'), for (final d in deadlines) deadlineRow(d as Map, owner: false)]),
      if (undated.isNotEmpty) Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: undatedBlock(undated, owner: false)),
    ];
    return CardBox(
      key: keyOf(c['id']),
      margin: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        sideLabel('${jsString(c['jurisdiction'])}公司'),
        Padding(padding: const EdgeInsets.only(top: 2), child: Text(jsString(c['name']), style: ts(Fs.h, weight: w700, height: 1.4))),
        if (c['jurisdiction'] == '香港') nameEn(c),
        if (truthy(c['registrationNo'])) numSub(regLabel(c), c['registrationNo']),
        if (c['status'] != '存續') Align(alignment: Alignment.centerLeft, widthFactor: 1, child: Pill(jsString(c['status']), tone: Tone.gray)),
        if (isPending('company', c['id'])) pendingTag(),
        companyLinks(c),
        ?editorFor(c),
        for (final (i, b) in blocks.indexed) block(children: [b], last: i == blocks.length - 1),
      ]),
    );
  }
}
