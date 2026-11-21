// 刪除牌照：一比一移植 mobile/src/pages/plate-delete/plate-delete.vue（App 端）。
// 自管客戶刪除建錯的牌照（docs/tasks/self-managed-fixes-plan.md 第 13 步）：即時刪除，不能復原。托管客戶由伺服器拒絕，頁面顯示伺服器的錯誤。
// 網址：/plate-delete?id=<牌照 id>。onLoad 載入一次（沒有 onShow）。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/choices.dart';
import '../../ui/dialogs.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf, str;
import '../plate_detail/plate_detail_widgets.dart';

// 確認框的內文：牌照 粵Z… 和 2 間公司 會即時刪除，不能復原。
String deleteMessage(String label, int companies) => '牌照 $label${companies > 0 ? ' 和 $companies 間公司' : ''} 會即時刪除，不能復原。';

class PlateDeletePage extends StatefulWidget {
  const PlateDeletePage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<PlateDeletePage> createState() => PlateDeletePageState();
}

class PlateDeletePageState extends State<PlateDeletePage> {
  late final String plateId = widget.query['id'] ?? '';
  Map<String, dynamic>? info;
  String loadError = '', error = '';
  Map<String, bool> picked = {};
  bool busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => load());
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
      final r = Map<String, dynamic>.from(await api('/my/plates/${Uri.encodeComponent(plateId)}/delete') as Map);
      _set(() {
        info = r;
        picked = {for (final c in listOf(r['companies'])) jsString(at(c, 'id')): true};
        loadError = '';
      });
    } catch (e) {
      _set(() => loadError = e is ApiError ? e.message : '$e');
    }
  }

  void openRequest(Object? id) => context.push('/request-detail?id=${jsString(id)}');

  Future<void> submit() async {
    _set(() => error = '');
    final companyIds = [for (final c in listOf(info!['companies'])) if (picked[jsString(at(c, 'id'))] == true) at(c, 'id')];
    final r = await ask(context, title: '確定刪除這個牌照？', msg: deleteMessage(str(info!['label']), companyIds.length), ok: '刪除', cancel: '取消', danger: true);
    if (r != 'confirm' || !mounted) return;
    _set(() => busy = true);
    try {
      await api('/my/plates/${Uri.encodeComponent(plateId)}/delete', 'POST', {'companyIds': companyIds});
      if (!mounted) return;
      // uni.reLaunch 到「我的牌照」，400 毫秒後提示（本頁已關，提示放在最上層）
      final nav = Navigator.of(context, rootNavigator: true);
      context.go('/vehicles');
      Timer(const Duration(milliseconds: 400), () {
        final ctx = _entryContext(nav);
        if (ctx != null) showToast(ctx, '牌照已刪除');
      });
    } catch (e) {
      _set(() => error = e is ApiError ? e.message : '$e');
      if (e is ApiError && e.status == 409) unawaited(load());
    } finally {
      _set(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final i = info;
    final blocks = <Blk>[
      Blk(Text('批文卡輸入有錯、建錯了牌照，可以在這裏刪除。刪除後不能復原。', style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
      if (loadError.isNotEmpty)
        Blk(CardBox(margin: EdgeInsets.zero, child: _ErrorText(loadError)), bottom: 12)
      else if (i != null) ...[
        Blk(const SectionTitle('會刪除的資料', bare: true), top: 28, bottom: 12),
        Blk(_factsCard(i), bottom: 12),
        if (!truthy(i['allowed']))
          Blk(_blockedCard(i), bottom: 12)
        else ...[
          if (listOf(i['companies']).isNotEmpty) ...[
            Blk(const SectionTitle('一併刪除的公司', bare: true), top: 28, bottom: 12),
            Blk(_companiesCard(listOf(i['companies'])), bottom: 12),
          ],
          Blk(
            CardBox(
              margin: EdgeInsets.zero,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('只是不再續期？請回到牌照頁按「不再續期這個牌照」，記錄會保留，只停止提醒。', style: ts(Fs.body, color: C.ink2)),
                if (error.isNotEmpty) _ErrorText(error),
                const SizedBox(height: 20),
                DangerButton(busy ? '正在刪除…' : '刪除這個牌照', enabled: !busy, onTap: submit),
              ]),
            ),
            bottom: 12,
          ),
        ],
      ],
    ];
    return AppPage(title: '刪除牌照', child: PageBody(children: [Blocks(blocks)]));
  }

  Widget _factsCard(Map i) {
    Widget num(String text) => NumText(text);
    return CardBox(
      margin: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Kv([
          ('牌照', Text(str(i['label']))),
          if (truthy(i['cardNumber'])) ('批文卡編號', num(str(i['cardNumber']))),
          if (truthy(i['drivers'])) ('司機登記', num('${jsString(i['drivers'])} 位')),
          if (truthy(i['rentals'])) ('出租記錄', num('${jsString(i['rentals'])} 份')),
        ]),
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text('連同批文卡正本、口岸記錄、到期提醒和已辦記錄。${truthy(i['vehicleKept']) ? '車輛資料會保留，只解除和這個牌照的連結。' : ''}已完成的委託和收費記錄會保留。', style: ts(Fs.body, color: C.ink2)),
        ),
      ]),
    );
  }

  Widget _blockedCard(Map i) {
    final reqs = listOf(i['openRequests']);
    return CardBox(
      margin: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(str(i['error']), style: ts(Fs.h, weight: w800, color: C.overdue))),
        for (final (n, item) in reqs.indexed)
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => openRequest(at(item, 'id')),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(border: n == reqs.length - 1 ? null : const Border(bottom: BorderSide(color: C.rule))),
              child: Row(children: [
                Expanded(child: Text(str(at(item, 'title')), style: ts(Fs.h, weight: w700))),
                const SizedBox(width: 8),
                const Chev(),
              ]),
            ),
          ),
        const SizedBox(height: 12),
        Btn('聯絡我們', kind: BtnKind.line, expand: true, onTap: () => context.push('/messages')),
      ]),
    );
  }

  Widget _companiesCard(List<dynamic> companies) => CardBox(
        margin: EdgeInsets.zero,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          for (final (n, c) in companies.indexed)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10),
              decoration: BoxDecoration(border: n == companies.length - 1 ? null : const Border(bottom: BorderSide(color: C.rule))),
              child: WdCheckbox(
                label: '${jsString(at(c, 'jurisdiction'))}公司 · ${jsString(at(c, 'name'))}',
                value: picked[jsString(at(c, 'id'))] == true,
                onChanged: (v) => _set(() => picked = {...picked, jsString(at(c, 'id')): v}),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text('這些公司是跟這個牌照一起建立的，沒有其他牌照。輸入錯誤時通常也要一併刪除；取消勾選就會保留。', style: ts(Fs.body, color: C.ink2)),
          ),
        ]),
      );
}

// .error：上距 8、紅色粗體 14
class _ErrorText extends StatelessWidget {
  const _ErrorText(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 8), child: Text(text, style: ts(Fs.body, weight: w700, color: C.overdue)));
}

// .primary.danger：紅底主按鈕；送出中不可按（uni-button[disabled] 灰底，見 DBtn）
class DangerButton extends StatelessWidget {
  const DangerButton(this.text, {super.key, this.enabled = true, this.onTap});
  final String text;
  final bool enabled;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => enabled ? Btn(text, danger: true, onTap: onTap) : DBtn(text, enabled: false);
}

// 頁面關掉後還要顯示提示：在最上層導航器裏找一個還在的位置（提示放在最上層 Overlay）
BuildContext? _entryContext(NavigatorState nav) {
  BuildContext? found;
  void visit(Element e) {
    if (found != null) return;
    if (Overlay.maybeOf(e) != null) {
      found = e;
      return;
    }
    e.visitChildren(visit);
  }

  final root = nav.overlay?.context;
  if (root is Element && root.mounted) root.visitChildren(visit);
  return found;
}
