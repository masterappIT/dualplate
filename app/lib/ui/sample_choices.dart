// 組件樣板頁的 1a 區塊：單選、勾選、提示。排法照 mobile/ 實際用的頁面（company-new、rental-new、plate-delete、signup），
// 選項和提示文字逐字取自這些頁面。只在開發時用。
import 'package:flutter/widgets.dart';
import 'base.dart';
import 'choices.dart';
import 'toast.dart';
import 'tokens.dart';

class SampleChoices extends StatefulWidget {
  const SampleChoices({super.key});
  @override
  State<SampleChoices> createState() => _SampleChoicesState();
}

class _SampleChoicesState extends State<SampleChoices> {
  String jurisdiction = '香港';
  String plate = '';
  String lessor = 'person';
  bool company = true;
  bool driver = false;
  bool agree = false;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const SectionTitle('單選和勾選'),
        // company-new：頁面覆寫 .wd-radio{margin:0;padding:10px 0}
        CardBox(
          child: WdRadioGroup<String>(
            value: jurisdiction,
            options: const [('香港', '香港公司'), ('澳門', '澳門公司'), ('內地', '內地公司')],
            onChanged: (v) => setState(() => jurisdiction = v),
            rowMargin: 0,
            rowPadding: 10,
          ),
        ),
        CardBox(
          child: WdRadioGroup<String>(
            value: plate,
            options: const [('', '不屬於任何牌照'), ('p1', '粵ZA123港 · HK1234')],
            onChanged: (v) => setState(() => plate = v),
            rowMargin: 0,
            rowPadding: 10,
          ),
        ),
        // rental-new：沒有覆寫，每個選項 margin-top 10，外面 .choices{margin-top:8px}
        CardBox(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Subtle('建議以香港身份或香港公司簽署。'),
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: WdRadioGroup<String>(
                value: lessor,
                options: const [('person', '陳大文（香港身份）'), ('company', '示範貿易有限公司（香港公司）')],
                onChanged: (v) => setState(() => lessor = v),
              ),
            ),
          ]),
        ),
        // plate-delete 的 .choice-row{padding:10px 0;border-bottom:1px solid var(--rule)}；rental-new 的 .choice-row{padding:8px 0}
        CardBox(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: C.rule))),
              child: WdCheckbox(label: '香港公司 · 示範貿易有限公司', value: company, onChanged: (v) => setState(() => company = v)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: WdCheckbox(label: '陳大文（已登記）', value: driver, onChanged: (v) => setState(() => driver = v)),
            ),
          ]),
        ),
        // signup 的 .agree-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
        Wrap(spacing: 4, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          WdCheckbox(label: '我已閱讀並同意', value: agree, block: false, onChanged: (v) => setState(() => agree = v)),
          LinkText('服務條款', onTap: () {}),
          const Subtle('及'),
          LinkText('私隱聲明', onTap: () {}),
        ]),
        const SectionTitle('提示'),
        Row(children: [
          Btn('短提示', kind: BtnKind.small, onTap: () => showToast(context, '已複製')),
          const SizedBox(width: 8),
          Btn('長提示', kind: BtnKind.small, onTap: () => showToast(context, '這張照片無法讀取，請改用相機拍攝或選 JPG、PNG 照片')),
          const SizedBox(width: 8),
          Btn('2.6 秒', kind: BtnKind.small, onTap: () => showToast(context, '已記錄，下次請在 2027-03-31 前過關', duration: const Duration(milliseconds: 2600))),
        ]),
      ]);
}
