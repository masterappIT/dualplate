// 帳單：一比一移植 mobile/src/pages/billing/billing.vue（App 端）。
// 尚未付款合計（深綠卡）、請你確認的分期款項（按「確認金額」）、款項清單（未付／全部）。每次顯示都重新載入（onShow）。
// 計算在 billing_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
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
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DBtn;
import 'billing_logic.dart';

class BillingPage extends StatefulWidget {
  const BillingPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<BillingPage> createState() => BillingPageState();
}

class BillingPageState extends State<BillingPage> with PageShow {
  List items = [];
  Map outstanding = {};
  bool loaded = false;
  String busy = '', filter = 'open';

  @override
  String get showPath => '/billing';

  @override
  void onShow() => unawaited(load());

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
      final result = await api('/my/fees') as Map;
      _set(() {
        items = result['items'] is List ? result['items'] as List : [];
        outstanding = result['outstanding'] is Map ? result['outstanding'] as Map : {};
      });
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  Future<void> confirm(Map item) async {
    _set(() => busy = jsString(item['id']));
    try {
      await api('/my/fees/${jsString(item['id'])}/confirm', 'POST');
      // uni.showToast icon:'success'：App 端是原生等待框（圖示由 DCloud 畫），這裏只顯示文字（同 3b 辦理進度）
      toast('已確認');
      await load();
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    } finally {
      _set(() => busy = '');
    }
  }

  // 金額：.num，16、800、ink，不縮
  Widget amount(Map item) => Text(money(item['currency'], item['amount']), softWrap: false, style: numStyle(ts(Fs.h, weight: w800)));

  Widget confirmCard(Map item) {
    final mine = busy == jsString(item['id']);
    return CardBox(
      warn: true,
      margin: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [Expanded(child: ListTitle(jsString(item['description']))), const SizedBox(width: 12), amount(item)]),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text.rich(
            TextSpan(text: '到期 ', children: [
              TextSpan(text: friendlyDate(item['dueOn']), style: numStyle(ts(Fs.body, color: C.ink2, height: 1.5))),
              TextSpan(text: '。確認金額無誤後，${forMode('顧問', '我們')}會按此收款。'),
            ]),
            style: ts(Fs.body, color: C.ink2, height: 1.5),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: DBtn(mine ? '確認中' : '確認金額', kind: BtnKind.small, expand: false, enabled: !mine, onTap: () => confirm(item)),
        ),
      ]),
    );
  }

  Widget line(Map item, bool last) => Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.rule))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(jsString(item['description']), style: ts(Fs.h, weight: w700, height: 1.4))),
            const SizedBox(width: 12),
            amount(item),
          ]),
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Row(children: [
              Expanded(child: Text('${jsString(item['kindLabel'])}${truthy(item['dueOn']) ? ' · 到期 ${friendlyDate(item['dueOn'])}' : ''}', style: ts(Fs.meta, color: C.ink2))),
              const SizedBox(width: 12),
              Pill(feeLabel(item), tone: toneOf(feeTone(item))),
            ]),
          ),
          if (item['status'] == '部分收') ListNote('已付 ${money(item['currency'], item['paid'])}，尚欠 ${money(item['currency'], item['outstanding'])}', tone: NoteTone.amber),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final totals = feeTotals(outstanding), toConfirm = feesToConfirm(items), shown = feesShown(items, filter);
    final blocks = <Blk>[
      Blk(Text('${forMode('年費、代辦費、政府規費和代墊款項。', '代辦費、政府規費和代墊款項。')}不同幣種分開計算。', style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
      Blk(
        CardBox(
          deep: true,
          guilloche: true,
          margin: EdgeInsets.zero,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Kicker('尚未付款'),
            if (totals.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  for (final (currency, value) in totals) Text(money(currency, value), style: numStyle(ts(Fs.stat, weight: w800, height: 1.3, color: BillingStyle.white))),
                ]),
              )
            else
              Padding(padding: const EdgeInsets.only(top: 4), child: Text('目前沒有未付款項', style: ts(Fs.h, weight: w800, color: BillingStyle.white))),
          ]),
        ),
        bottom: 12,
      ),
      if (toConfirm.isNotEmpty) ...[
        Blk(const SectionRow(title: '請你確認的分期款項'), top: 28, bottom: 12),
        for (final item in toConfirm) Blk(confirmCard(item), bottom: 12),
      ],
      Blk(
        SectionRow(
          title: '款項',
          trailing: Segmented<String>(inline: true, options: const [('open', '未付'), ('all', '全部')], value: filter, onChanged: (v) => _set(() => filter = v)),
        ),
        top: 28,
        bottom: 12,
      ),
      if (shown.isNotEmpty)
        Blk(
          CardBox(
            margin: EdgeInsets.zero,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [for (final (i, item) in shown.indexed) line(item, i == shown.length - 1)]),
          ),
          bottom: 12,
        ),
      if (loaded && shown.isEmpty) Blk(CardBox(margin: EdgeInsets.zero, padding: EdgeInsets.zero, child: Empty(emptyFeesText(filter))), bottom: 12),
      Blk(
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Text(forMode('付款方式與收據請向你的顧問查詢。', '付款方式與收據請在「我的 › 聯絡我們」查詢。'), textAlign: TextAlign.center, style: ts(Fs.meta, color: C.ink2, height: 1.6)),
        ),
      ),
    ];
    return AppPage(title: '帳單', child: PageBody(children: [Blocks(blocks)]));
  }
}
