// 車牌管家（首頁分頁）：一比一移植 mobile/src/pages/index/index.vue（App 端）。
// 結構、文字、次序、各狀態照抄；計算在 index_logic.dart。每次顯示（onShow）都重新載入。
// 階段 4：App 版載入頁先取好的首頁資料（安卓是上次存下的首頁緩存，core/launch.dart 的 takeHome／saveHome）、安卓檢查新版本（business/app_update.dart）。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/due_date.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../business/plate_chip.dart';
import '../../business/welcome_guide.dart';
import '../../core/api.dart';
import '../../business/app_update.dart';
import '../../core/js.dart';
import '../../core/launch.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/dialogs.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show J, at, listOf;
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DetailListCard, wrapBlk;
import 'bell_icon.dart';
import 'index_logic.dart';

class IndexPage extends StatefulWidget {
  const IndexPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<IndexPage> createState() => IndexPageState();
}

class IndexPageState extends State<IndexPage> with PageShow {
  Map<String, dynamic>? user = getUser();
  // App 版載入頁已先取好的資料（只有第一次打開有；安卓 App 是上次存下的資料，下面 load() 再取最新），免得數字由 0 跳到實數
  final HomeData? _home = takeHome();
  bool guideReady = false;
  late bool loaded = _home != null;
  late J data = _home?.overview ?? emptyOverview();
  late List<dynamic> notices = _home?.notices.toList() ?? [];

  @override
  String get showPath => '/index';

  bool get selfManaged => data['serviceMode'] == '自管';

  @override
  void onShow() => unawaited(load());

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  Future<void> load() async {
    user = getUser();
    if (user == null) {
      unawaited(context.push('/login'));
      return;
    }
    // 安卓 App 先檢查新版本；條款提示等它關掉才出，條款提示處理完才顯示導覽，免得兩個彈出層疊在一起
    appUpdate.check(context).then((_) {
      if (!mounted) return null;
      return checkTerms(({required title, required msg, required ok, required cancel}) => ask(context, title: title, msg: msg, ok: ok, cancel: cancel));
    }).then((result) {
      if (result != 'opened') _set(() => guideReady = true);
    });
    try {
      final r = await Future.wait([api('/my/overview'), api('/my/notifications').catchError((_) => {'items': []})], eagerError: true);
      final overview = Map<String, dynamic>.from(r[0] as Map);
      rememberMode(overview['serviceMode'] is String ? overview['serviceMode'] as String : null);
      _set(() {
        data = overview;
        notices = listOf(at(r[1], 'items')).toList();
      });
      saveHome(overview, notices);
    } catch (e) {
      if (mounted) showToast(context, e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  void openTodo(TodoItem item) {
    if (truthy(item.requestId)) return openRequest(item.requestId);
    final n = item.notice;
    if (n != null) {
      _set(() => n['read'] = true);
      api('/my/notifications/read', 'POST', {'id': n['id']}).catchError((_) => null);
      if (!truthy(n['link'])) return;
      return openAppLink(context, jsString(n['link']));
    }
    openDeadline(item.deadline);
  }

  void goPlates(String filter) {
    VehiclesFilter.preset = filter;
    context.go('/vehicles');
  }

  void openRequest(Object? id) => context.push('/request-detail?id=${jsString(id)}');

  // 公司事項打開「我的公司」；牌照和車輛事項打開所屬牌照
  void openDeadline(Map? item) {
    if (at(item, 'ownerType') == 'company') {
      context.go('/companies');
    } else if (truthy(at(item, 'plateId'))) {
      context.push(platePath(at(item, 'plateId')));
    } else {
      context.push('/deadlines');
    }
  }

  @override
  Widget build(BuildContext context) {
    final todos = todoList(data, notices);
    final plates = listOf(data['plates']);
    final requests = listOf(data['activeRequests']);
    final pending = at(data['counts'], 'pending');
    return AppPage(
      title: '車牌管家',
      child: Stack(children: [
        PageBody(children: [
          Blocks([
            Blk(_hero(plates.length)),
            if (truthy(pending))
              Blk(
                Text('另有 ${shown(pending)} 個牌照${selfManaged ? '未填到期日' : '資料整理中'}', textAlign: TextAlign.center, style: ts(Fs.meta, color: C.ink3)),
                top: 8,
              ),
            // 自管客戶還沒有牌照：引導拍批文卡建立第一個（沿用新增牌照頁）
            if (selfManaged && loaded && plates.isEmpty)
              Blk(
                DetailListCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    const ListTitle('建立你的第一個牌照'),
                    const ListSub('拍下批文卡正反面，自動辨識牌照和到期日，之後到期前會提醒你。'),
                    const SizedBox(height: 12),
                    Btn('拍批文卡', onTap: () => context.push('/plate-create')),
                  ]),
                ),
                top: 12,
                bottom: 12,
              ),
            // 待辦：要你提供的、你自理而快到期的、未讀通知，合成一個清單；做完自動消失
            Blk(
              Text.rich(TextSpan(children: [
                const TextSpan(text: '待辦'),
                if (todos.isNotEmpty) TextSpan(text: ' · ${todos.length}', style: numStyle(ts(Fs.h, weight: w800, height: 1.4, color: C.jadeDeep))),
              ]), style: ts(Fs.h, weight: w800, height: 1.4, color: C.jadeDeep)),
              top: 28,
              bottom: 12,
            ),
            if (todos.isNotEmpty)
              ...wrapBlk([for (final item in todos) Blk(_todoCard(item), bottom: 12)])
            else if (selfManaged)
              Blk(const DetailListCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [ListTitle('目前沒有快到期的事項'), ListSub('到期前會在這裏提醒你；辦好後按「已辦好」。')])), bottom: 12)
            else
              Blk(const DetailListCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [ListTitle('目前不用你做甚麼'), ListSub('我們負責的事項會按時跟進；需要你提供資料或確認時，會出現在這裏。')])), bottom: 12),
            // .link.all-deadlines：置中、上下內距 8
            Blk(GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => context.push('/deadlines'),
              child: Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text('查看全部到期日 ›', textAlign: TextAlign.center, style: ts(Fs.body, weight: w700, color: C.jade))),
            )),
            if (requests.isNotEmpty)
              ...wrapBlk([
                Blk(SectionRow(title: '辦理中', trailing: LinkText('全部 ›', onTap: () => context.go('/me'))), top: 28, bottom: 12),
                for (final item in requests.take(3)) Blk(_requestCard(item), bottom: 12),
              ]),
            if (!selfManaged) Blk(Btn('請顧問幫我辦', kind: BtnKind.line, expand: true, onTap: () => context.push(requestPath(''))), top: 16),
          ]),
        ]),
        if (guideReady) const WelcomeGuide(),
      ]),
    );
  }

  // .hero.deep.guilloche：深綠、圓角 12、內距 16 16 12；沒有框線（不是 .card）
  Widget _hero(int plateCount) {
    final counts = data['counts'];
    final unread = data['unreadNotifications'];
    final name = truthy(data['customerName']) ? jsString(data['customerName']) : truthy(user?['name']) ? jsString(user!['name']) : '歡迎';
    Widget tile(String key, String label, Color color, {bool first = false}) {
      final v = at(counts, key);
      return Expanded(
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => goPlates(key),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 4),
            decoration: first ? null : const BoxDecoration(border: Border(left: BorderSide(color: HomeStyle.tileRule))),
            child: Column(children: [
              Text(shown(v), style: numStyle(ts(Fs.stat, weight: w800, height: 1.2, color: truthy(v) ? color : C.onDeep2))),
              const SizedBox(height: 2),
              Text(label, style: ts(Fs.meta, weight: w700, color: truthy(v) ? color : C.onDeep2)),
            ]),
          ),
        ),
      );
    }

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: C.jadeDeep, borderRadius: BorderRadius.circular(R.panel)),
      child: Guilloche(
        color: C.onDeep,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Kicker(selfManaged ? '自己管理' : '委託人'),
                  const SizedBox(height: 4),
                  Text(name, style: ts(Fs.title, weight: w800, height: 1.3, color: HomeStyle.white)),
                  const SizedBox(height: 2),
                  Text.rich(TextSpan(children: [
                    const TextSpan(text: '名下 '),
                    TextSpan(text: '$plateCount', style: numStyle(ts(Fs.body, color: C.onDeep2))),
                    const TextSpan(text: ' 個兩地牌'),
                  ]), style: ts(Fs.body, color: C.onDeep2)),
                ]),
              ),
              const SizedBox(width: 12),
              _bell(unread),
            ]),
            const TicketRule(deep: true),
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              tile('ok', '正常', C.onDeepOk, first: true),
              tile('due', '快到期', C.onDeepDue),
              tile('overdue', '已逾期', C.onDeepOverdue),
            ]),
          ]),
        ),
      ),
    );
  }

  // .bell：40 圓、白底，鈴 20×20；未讀數 .bell-dot 在右上（top -4、right -6）
  Widget _bell(Object? unread) => Semantics(
        label: '通知',
        button: true,
        child: GestureDetector(
          key: const ValueKey('index-bell'),
          behavior: HitTestBehavior.opaque,
          onTap: () => context.push('/notifications'),
          child: SizedBox(
            width: 40,
            height: 40,
            child: Stack(clipBehavior: Clip.none, children: [
              Container(decoration: const BoxDecoration(color: C.card, shape: BoxShape.circle), alignment: Alignment.center, child: const BellIcon(size: 20)),
              if (truthy(unread))
                Positioned(
                  top: -4,
                  right: -6,
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 20),
                    height: 20,
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    decoration: BoxDecoration(color: C.plateYellow, borderRadius: BorderRadius.circular(R.pill), border: Border.all(color: C.jadeDeep)),
                    alignment: Alignment.center,
                    child: Text(bellCount(unread), textAlign: TextAlign.center, style: numStyle(ts(Fs.cap, weight: w800, color: C.jadeDeep, height: 18 / Fs.cap))),
                  ),
                ),
            ]),
          ),
        ),
      );

  // .list-card.row（緊急時加 .warn-card）：左邊標題和說明，右邊到期徽章或 ›
  Widget _todoCard(TodoItem item) => DetailListCard(
        warn: item.urgent,
        onTap: () => openTodo(item),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [ListTitle(item.title), ListSub(item.subtitle)]),
          ),
          const SizedBox(width: 12),
          if (item.deadline != null)
            DueDate(date: at(item.deadline, 'dueOn') is String ? at(item.deadline, 'dueOn') as String : '', days: _int(at(item.deadline, 'daysLeft')), level: at(item.deadline, 'level') is String ? at(item.deadline, 'level') as String : '')
          else
            const Chev(),
        ]),
      );

  // 辦理中：標題＋狀態；下面車牌徽章和步驟
  Widget _requestCard(Object? item) => DetailListCard(
        onTap: () => openRequest(at(item, 'id')),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: ListTitle(shown(at(item, 'title')))),
            const SizedBox(width: 12),
            Pill(shown(at(item, 'status')), tone: toneOf(requestTone(at(item, 'status')))),
          ]),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            if (truthy(at(item, 'plate'))) PlateChip(plate: jsString(at(item, 'plate')), region: '內地', size: PlateChipSize.sm),
            Text(clientStage(at(item, 'stage')), style: ts(Fs.body, color: C.ink2)),
          ]),
        ]),
      );
}

int? _int(Object? v) => v is num && v.isFinite ? v.toInt() : null;
