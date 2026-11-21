// 我的（分頁）：一比一移植 mobile/src/pages/me/me.vue（App 端）。
// 托管客戶：委託內容、帳單、月報、辦理記錄、你的顧問；自管客戶：沒有辦理記錄時整塊不顯示，改為「委託我們辦理」卡和聯絡我們。
// 自管與否按 /my/overview 的 serviceMode（載入前當作托管，和現有 App 一樣）。每次顯示（onShow）都重新載入。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/advisor_card.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../business/plate_chip.dart';
import '../../business/welcome_guide.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/dialogs.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../login/contact_card.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf;
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks;

// 只用手機號碼開通的帳戶，電郵是系統佔位，不顯示
String accountText(Map? user) {
  final email = truthy(user?['email']) ? jsString(user!['email']) : '';
  return email.endsWith('@phone.invalid') ? '以手機號碼登入' : email;
}

// 辦理記錄一律用內地車牌標識，與首頁一致
String plateOfRequest(Object? item, List<dynamic> plates) {
  for (final p in plates) {
    if (at(p, 'id') == at(item, 'plate_asset_id')) return truthy(at(p, 'mainland_plate')) ? jsString(at(p, 'mainland_plate')) : '';
  }
  return '';
}

class MePage extends StatefulWidget {
  const MePage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<MePage> createState() => MePageState();
}

class MePageState extends State<MePage> with PageShow {
  Map<String, dynamic>? user = getUser();
  List<dynamic> requests = [], plates = [];
  bool loaded = false, unpaid = false, guide = false, selfManaged = false, hasBills = false;
  Map? advisor;
  Object? unread = 0;

  @override
  String get showPath => '/me';

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
    try {
      final r = await Future.wait([api('/requests'), api('/my/overview'), api('/plate-assets')], eagerError: true);
      final overview = r[1];
      final mode = at(overview, 'serviceMode');
      rememberMode(mode is String ? mode : null);
      _set(() {
        requests = listOf(r[0]);
        plates = listOf(r[2]);
        advisor = at(overview, 'advisor') is Map ? at(overview, 'advisor') as Map : null;
        selfManaged = mode == '自管';
        unread = truthy(at(overview, 'unreadNotifications')) ? at(overview, 'unreadNotifications') : 0;
      });
      api('/my/fees').then((fees) {
        _set(() {
          final outstanding = at(fees, 'outstanding');
          unpaid = outstanding is Map && outstanding.isNotEmpty;
          hasBills = listOf(at(fees, 'items')).isNotEmpty;
        });
      }, onError: (_) {});
    } catch (e) {
      if (mounted) showToast(context, e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  Future<void> logout() async {
    if (await ask(context, title: '退出登入', msg: '確定要退出嗎？', ok: '退出', cancel: '取消') != 'confirm') return;
    clearSession();
    if (mounted) unawaited(context.push('/login'));
  }

  @override
  Widget build(BuildContext context) {
    final showRecords = !selfManaged || requests.isNotEmpty;
    return AppPage(
      title: '我的',
      child: Stack(children: [
        PageBody(children: [
          Blocks([
            Blk(_profileHead()),
            Blk(
              _menu([
                _MenuRow('到期提醒', onTap: () => context.push('/deadlines')),
                if (!selfManaged) _MenuRow('委託內容', onTap: () => context.push('/scope')),
                _MenuRow('通知', pill: truthy(unread) ? _NumPill('${jsString(unread)} 則未讀') : null, onTap: () => context.push('/notifications')),
                if (!selfManaged || hasBills) _MenuRow('帳單', pill: unpaid ? const Pill('有未付款項', tone: Tone.amber) : null, onTap: () => context.push('/billing')),
                if (!selfManaged) _MenuRow('月報', onTap: () => context.push('/reports')),
              ]),
              top: 16,
              bottom: 12,
            ),
            // 自管客戶：沒有辦理記錄時整塊不顯示；也不顯示顧問卡（改為「委託我們辦理」卡）
            if (showRecords)
              Blk(
                Row(children: [
                  Expanded(child: SectionTitle('辦理記錄', bare: true)),
                  if (!selfManaged) ...[const SizedBox(width: 12), LinkText('申請辦理 ›', onTap: () => context.push(requestPath('')))],
                ]),
                top: 28,
                bottom: 12,
              ),
            if (requests.isNotEmpty)
              Blk(
                CardBox(
                  margin: EdgeInsets.zero,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    for (final (i, item) in requests.indexed) _requestLine(item, last: i == requests.length - 1),
                  ]),
                ),
                bottom: 12,
              ),
            if (loaded && requests.isEmpty && !selfManaged) Blk(const CardBox(margin: EdgeInsets.zero, padding: EdgeInsets.zero, child: Empty('還沒有辦理記錄')), bottom: 12),
            if (loaded && !selfManaged) Blk(AdvisorCard(advisor: advisor, placeholder: true), top: 12, bottom: 12),
            // 自管客戶：委託我們辦理（按次或長期委託），取代顧問卡
            if (loaded && selfManaged)
              Blk(
                CardBox(
                  margin: EdgeInsets.zero,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text('委託我們辦理', style: ts(Fs.h, weight: w800, color: C.jadeDeep)),
                    const Subtle('不想自己跑？交給我們辦，省時省心。'),
                    const SizedBox(height: 12),
                    Btn('委託我們辦一項', kind: BtnKind.line, expand: true, onTap: () => context.push('/requests?entrust=one')),
                    const SizedBox(height: 12),
                    Btn('長期委託（談代理方案）', kind: BtnKind.line, expand: true, onTap: () => context.push(longTermPath)),
                  ]),
                ),
                top: 16,
                bottom: 12,
              ),
            if (loaded && selfManaged) Blk(const ContactCard(messages: true, public: false, bare: true), top: 16, bottom: 12),
            Blk(
              _menu([
                _MenuRow('使用導覽', onTap: () => _set(() => guide = true)),
                _MenuRow('服務條款及私隱聲明', onTap: () => context.push('/terms')),
                _MenuRow('退出登入', onTap: logout),
              ]),
              top: 16,
              bottom: 12,
            ),
          ]),
        ]),
        if (guide) WelcomeGuide(force: true, onClosed: () => _set(() => guide = false)),
      ]),
    );
  }

  // .profile-head：名字（頁標題）和帳戶；右邊「我的資料 ›」，整行可按
  Widget _profileHead() => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => context.push('/profile'),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              PageTitle(truthy(user?['name']) ? jsString(user!['name']) : '我的'),
              Subtle(accountText(user)),
            ]),
          ),
          const SizedBox(width: 12),
          Text('我的資料 ›', softWrap: false, style: ts(Fs.body, weight: w700, color: C.jade)),
        ]),
      );

  // .card.menu：內距 0 16；每行最少高 52、底線（最後一行沒有）
  Widget _menu(List<_MenuRow> rows) => CardBox(
        margin: EdgeInsets.zero,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final (i, r) in rows.indexed)
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: r.onTap,
              child: Container(
                constraints: const BoxConstraints(minHeight: 52),
                decoration: BoxDecoration(border: i == rows.length - 1 ? null : const Border(bottom: BorderSide(color: C.rule))),
                child: Row(children: [
                  Expanded(child: Text(r.name, style: ts(Fs.h, weight: w700))),
                  if (r.pill != null) ...[const SizedBox(width: 8), r.pill!],
                  const SizedBox(width: 8),
                  const Chev(),
                ]),
              ),
            ),
        ]),
      );

  // 辦理記錄一行：標題＋狀態；下面內地車牌徽章和步驟
  Widget _requestLine(Object? item, {required bool last}) {
    final plate = plateOfRequest(item, plates);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => context.push('/request-detail?id=${jsString(at(item, 'id'))}'),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.rule))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(at(item, 'title') == null ? '' : jsString(at(item, 'title')), style: ts(Fs.h, weight: w700, height: 1.4))),
            const SizedBox(width: 12),
            Pill(at(item, 'status') == null ? '' : jsString(at(item, 'status')), tone: toneOf(requestTone(at(item, 'status')))),
          ]),
          const SizedBox(height: 4),
          Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            if (plate.isNotEmpty) PlateChip(plate: plate, region: '內地', size: PlateChipSize.sm),
            Text(clientStage(at(item, 'stage')), style: ts(Fs.body, color: C.ink2)),
          ]),
        ]),
      ),
    );
  }
}

class _MenuRow {
  const _MenuRow(this.name, {this.pill, this.onTap});
  final String name;
  final Widget? pill;
  final VoidCallback? onTap;
}

// .pill.amber.num：同 Pill（橙），字用等寬數字、字距 .04em
class _NumPill extends StatelessWidget {
  const _NumPill(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: C.dueBg, borderRadius: BorderRadius.circular(R.pill)),
        child: SizedBox(height: 18, child: Center(widthFactor: 1, child: Text(text, softWrap: false, style: numStyle(ts(Fs.cap, weight: w700, color: C.due, height: 18 / Fs.cap))))),
      );
}
