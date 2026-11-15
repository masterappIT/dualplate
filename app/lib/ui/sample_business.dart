// 組件樣板頁的 1b 區塊：三款仿真車牌、PlateChip、DueDate、StampMark，排出 mobile/src 裏用到的每種屬性組合。
// 每組旁邊寫明對應哪一頁的用法，方便和現有 App 同一組件並排對照。
import 'package:flutter/widgets.dart';
import '../business/due_date.dart';
import '../business/plate_chip.dart';
import '../business/plates.dart';
import '../business/stamp_mark.dart';
import 'base.dart';
import 'tokens.dart';

class SampleBusiness extends StatefulWidget {
  const SampleBusiness({super.key});
  @override
  State<SampleBusiness> createState() => _SampleBusinessState();
}

class _SampleBusinessState extends State<SampleBusiness> {
  int replay = 0; // 改 key 讓印章重新播放

  Widget _cap(String t) => Padding(padding: const EdgeInsets.only(top: 8, bottom: 8), child: Subtle(t));

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SectionTitle('仿真車牌'),
        _cap('登入頁（login.vue）：立體、寬 107／159 px、字縮 0.8／0.7'),
        CardBox(
          deep: true,
          child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              MainlandPlate(plate: '粵Z·A123港', widthPx: 107, textScale: .8, relief: true),
              SizedBox(width: 8),
              HongKongPlate(plate: 'HK 1234', widthPx: 159, textScale: .8, relief: true),
            ]),
            SizedBox(height: 8),
            Row(children: [
              MainlandPlate(plate: '粵Z·A123澳', widthPx: 107, textScale: .8, relief: true),
              SizedBox(width: 8),
              MacauPlate(plate: 'MA-12-34', widthPx: 159, textScale: .7, relief: true),
            ]),
          ]),
        ),
        _cap('牌照詳情（plate-detail.vue）：平面、寬 300 rpx，左右各半'),
        CardBox(
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: _plateItem('內地港澳入出境號牌', const MainlandPlate(plate: '粵ZA123港', width: 300))),
            const SizedBox(width: 12),
            Expanded(child: _plateItem('香港號牌', const HongKongPlate(plate: 'HK1234', width: 300))),
          ]),
        ),
        _cap('預設寬 600 rpx（平面）'),
        const Center(child: MainlandPlate(plate: '粤z a123 港')),
        const SizedBox(height: 12),
        const Center(child: HongKongPlate(plate: 'AB 8')),
        const SizedBox(height: 12),
        const Center(child: MacauPlate(plate: 'm 12 34')),
        _cap('號碼格式不符：內地牌整串置中；香港牌自訂字串；澳門牌整串一組'),
        const Center(child: MainlandPlate(plate: '粵Z12345', width: 400)),
        const SizedBox(height: 12),
        const Center(child: HongKongPlate(plate: 'LOVE', width: 400)),
        const SizedBox(height: 12),
        const Center(child: HongKongPlate(plate: '1', width: 400)),
        const SizedBox(height: 12),
        const Center(child: MacauPlate(plate: 'XY1', width: 400)),
        const SectionTitle('車牌徽章 PlateChip'),
        _cap('三種大小（sm 首頁／辦理記錄、md 牌照列表、lg 牌照詳情）'),
        const Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          PlateChip(plate: '粵ZA123港', region: '內地', size: PlateChipSize.sm),
          PlateChip(plate: '粵ZA123港', region: '內地'),
          PlateChip(plate: '粵ZA123港', region: '內地', size: PlateChipSize.lg),
        ]),
        const SizedBox(height: 8),
        const Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          PlateChip(plate: 'HK1234', region: '香港'),
          PlateChip(plate: 'HK1234', region: '香港', size: PlateChipSize.lg),
          PlateChip(plate: 'MA1234', region: '澳門'),
          PlateChip(plate: 'MA1234', region: '澳門', size: PlateChipSize.lg),
        ]),
        _cap('自動判斷（公司頁 plateParts）、待補充、判斷不了'),
        const Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          PlateChip(plate: '粵ZB456澳'),
          PlateChip(plate: 'HK 1234'),
          PlateChip(plate: 'MM-12-34'),
          PlateChip(plate: ''),
          PlateChip(plate: '車隊一號'),
          PlateChip(plate: 'AB1234', region: '其他'),
        ]),
        const SectionTitle('到期徽章 DueDate'),
        _cap('伺服器給天數和等級（首頁、到期日、公司、牌照詳情、月報）'),
        const Wrap(spacing: 16, runSpacing: 12, children: [
          DueDate(date: '2026-11-01', days: -14, level: 'overdue'),
          DueDate(date: '2026-11-15', days: 0, level: 'due'),
          DueDate(date: '2026-12-01', days: 16, level: 'due'),
          DueDate(date: '2027-01-20', days: 66, level: 'upcoming'),
          DueDate(date: '2027-06-30', days: 227, level: 'ok'),
        ]),
        _cap('只有日期（過關提醒 nextDueOn），按今天自動計；沒有日期'),
        Wrap(spacing: 16, runSpacing: 12, children: [
          DueDate(date: _ymd(DateTime.now().add(const Duration(days: 10)))),
          DueDate(date: _ymd(DateTime.now().add(const Duration(days: 90)))),
          DueDate(date: _ymd(DateTime.now().subtract(const Duration(days: 3)))),
          const DueDate(),
        ]),
        const SectionTitle('印章 StampMark'),
        _cap('登入、申請、過關後播放蓋章動效；按「重播」再看一次'),
        Wrap(key: ValueKey(replay), spacing: 24, runSpacing: 16, crossAxisAlignment: WrapCrossAlignment.center, children: const [
          StampMark(text: '已登入', tone: 'jade', play: true),
          StampMark(text: '已收到', tone: 'jade', play: true),
          StampMark(text: '已過關', tone: 'jade', play: true),
          StampMark(),
          StampMark(tone: 'overdue'),
        ]),
        const SizedBox(height: 12),
        Row(children: [Btn('重播', kind: BtnKind.small, onTap: () => setState(() => replay++))]),
      ]);

  static String _ymd(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  // .plate-item / .plate-label：字 12、ink-3、下距 8；車牌 margin:0 auto 置中
  Widget _plateItem(String label, Widget plate) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(label, style: ts(Fs.cap, color: C.ink3))),
        Center(child: plate),
      ]);
}
