// 組件樣板頁（flutter-app-plan.md 階段 1）：把每個通用組件排出來，和現有 App 一比一對照，管理者確認後才用來做頁面。
// 只在開發時打開，不進正式版的頁面跳轉。
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'base.dart';
import 'dialogs.dart';
import 'sample_choices.dart';
import 'sample_business.dart';
import 'tokens.dart';

class SamplePage extends StatefulWidget {
  const SamplePage({super.key});
  @override
  State<SamplePage> createState() => _SamplePageState();
}

class _SamplePageState extends State<SamplePage> {
  String seg = '粵港';
  int chip = 0;
  String last = '';

  @override
  Widget build(BuildContext context) => ColoredBox(
        color: C.paper,
        child: SafeArea(
          bottom: false,
          child: PageBody(children: [
            const PageTitle('組件樣板'),
            const Intro('每個組件對照 mobile/src/App.vue 的同名樣式類別。'),
            Btn('打開外殼（底部分頁和示範子頁）', kind: BtnKind.line, onTap: () => context.go('/index')),
            Segmented<String>(options: const [('粵港', '粵港'), ('粵澳', '粵澳')], value: seg, onChanged: (v) => setState(() => seg = v)),
            Chips(children: [for (final (i, t) in ['全部', '快到期', '已逾期'].indexed) Chip(t, active: chip == i, onTap: () => setState(() => chip = i))]),
            const SectionTitle('狀態標籤'),
            const Wrap(spacing: 8, runSpacing: 8, children: [Pill('正常'), Pill('快到期', tone: Tone.amber), Pill('已逾期', tone: Tone.red), Pill('辦理中', tone: Tone.blue), Pill('已完成', tone: Tone.gray)]),
            SectionHead(title: '列表卡', trailing: LinkText('查看全部', onTap: () {})),
            ListCard(
              onTap: () {},
              child: const Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [ListTitle('粵ZA123港 · HK1234'), ListSub('批文卡有效期'), ListNote('還有 12 天', tone: NoteTone.amber), Who('自行辦理')])),
                SizedBox(width: 12),
                Chev(),
              ]),
            ),
            CardBox(child: Kv([('公司', const Text('示範貿易有限公司')), ('口岸', const Text('深圳灣')), ('到期日', const Text('2027-03-31'))])),
            const CardBox(warn: true, child: Text('這是 .warn-card 提示卡。')),
            CardBox(
              deep: true,
              guilloche: true,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Kicker('本月'),
                Text('3', style: ts(Fs.stat, weight: w800, color: C.onDeep, height: 1.3)),
                const TicketRule(deep: true),
                Text('件事項待處理', style: ts(Fs.body, color: C.onDeep2)),
              ]),
            ),
            const CardBox(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Text('票根分隔'), TicketRule(), Text('下半部')])),
            const FieldLabel('手機號碼'),
            const Field(placeholder: '請輸入手機號碼', keyboardType: TextInputType.phone),
            const SizedBox(height: 16),
            Btn('主要按鈕', onTap: () {}),
            const SizedBox(height: 12),
            Btn('不可按', enabled: false, onTap: () {}),
            const SizedBox(height: 12),
            Btn('註銷帳號', danger: true, onTap: () {}),
            const SizedBox(height: 12),
            Row(children: [
              Btn('次要按鈕', kind: BtnKind.secondary, onTap: () {}),
              const SizedBox(width: 8),
              Btn('小按鈕', kind: BtnKind.small, onTap: () {}),
              const SizedBox(width: 8),
              Btn('實心', kind: BtnKind.small, solid: true, onTap: () {}),
            ]),
            const SizedBox(height: 12),
            Btn('線框按鈕', kind: BtnKind.line, onTap: () {}),
            const SectionTitle('確認框和選單'),
            Row(children: [
              Btn('確認框', kind: BtnKind.small, onTap: () async {
                final r = await ask(context, title: '刪除這張牌照？', msg: '刪除後不能復原。', ok: '刪除', danger: true);
                setState(() => last = r);
              }),
              const SizedBox(width: 8),
              Btn('提示框', kind: BtnKind.small, onTap: () => notice(context, title: '已送出', msg: '我們會盡快處理。')),
              const SizedBox(width: 8),
              Btn('底部選單', kind: BtnKind.small, onTap: () async {
                final r = await choose(context, '有變動？', const [ChoiceItem('換車', '車輛有變，更新車牌和車輛資料'), ChoiceItem('換司機', '加入或移除司機'), '其他']);
                setState(() => last = '選了 $r');
              }),
            ]),
            if (last.isNotEmpty) Subtle('結果：$last'),
            const SampleChoices(),
            const Empty('暫時沒有記錄'),
            const SampleBusiness(),
          ]),
        ),
      );
}
