// 修改公司資料的表單：一比一移植 mobile/src/components/CompanyEditor.vue（用在「我的公司」）。
// 只送出該司法區有的欄位：香港公司多英文名稱、公司編號；內地公司多納稅人類型（有選才送）。
// 內地公司名稱有繁體字時，伺服器給出簡體建議（e.data.suggestion），確認框讓客戶一鍵套用。
// 外框 .inline-editor：紙色底、圓角 8、左右下內距 12、上下外距 4／12。
import 'package:flutter/widgets.dart';
import '../core/api.dart';
import '../core/js.dart';
import '../core/wording.dart';
import '../pages/plate_detail/plate_detail_widgets.dart' show PickerBox, EditorActions;
import '../ui/base.dart';
import '../ui/dialogs.dart';
import '../ui/pickers.dart';
import '../ui/toast.dart';
import '../ui/tokens.dart';

const taxpayerTypes = ['小規模納稅人', '一般納稅人'];

String regLabelOf(Object? jurisdiction) => jurisdiction == '內地' ? '統一社會信用代碼' : jurisdiction == '澳門' ? '商業登記編號' : '商業登記號碼';

// 表單初值：沒有的欄位當作空字串（c.name||''）
Map<String, String> companyForm(Map c) => {
      for (final key in const ['name', 'nameEn', 'registrationNo', 'companyNumber', 'incorporatedOn', 'taxpayerType']) key: truthy(c[key]) ? jsString(c[key]) : '',
    };

// 送出的內容（payload）
Map<String, Object?> companyPayload(Object? jurisdiction, Map<String, String> f) {
  final body = <String, Object?>{'name': f['name'], 'registrationNo': f['registrationNo'], 'incorporatedOn': f['incorporatedOn']};
  if (jurisdiction == '香港') body.addAll({'nameEn': f['nameEn'], 'companyNumber': f['companyNumber']});
  if (jurisdiction == '內地' && (f['taxpayerType'] ?? '').isNotEmpty) body['taxpayerType'] = f['taxpayerType'];
  return body;
}

// 伺服器錯誤裏的簡體建議
String? suggestionOf(Object e) {
  if (e is! ApiError) return null;
  final data = e.data;
  final s = data is Map ? data['suggestion'] : null;
  return truthy(s) ? jsString(s) : null;
}

class CompanyEditor extends StatefulWidget {
  const CompanyEditor({super.key, required this.company, required this.onClose, required this.onSaved});
  final Map company;
  final VoidCallback onClose;
  final Future<void> Function() onSaved;

  // 「我的公司」的 CompaniesPage.editor 用
  static Widget builder(BuildContext context, Map company, VoidCallback close, Future<void> Function() saved) =>
      CompanyEditor(key: ValueKey('company-editor-${jsString(company['id'])}'), company: company, onClose: close, onSaved: saved);

  @override
  State<CompanyEditor> createState() => CompanyEditorState();
}

class CompanyEditorState extends State<CompanyEditor> {
  Map get c => widget.company;
  late final Map<String, String> form = companyForm(c);
  late final ctl = {for (final key in const ['name', 'nameEn', 'registrationNo', 'companyNumber']) key: TextEditingController(text: form[key])};
  bool saving = false;

  @override
  void dispose() {
    for (final x in ctl.values) {
      x.dispose();
    }
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  String get regLabel => regLabelOf(c['jurisdiction']);

  Future<void> save() async {
    if (saving) return;
    _set(() => saving = true);
    try {
      await api('/my/companies/${jsString(c['id'])}', 'PATCH', companyPayload(c['jurisdiction'], form));
      if (mounted) showToast(context, forMode('已更新，顧問會再核對', '已更新'));
      await widget.onSaved();
    } catch (e) {
      final s = suggestionOf(e);
      if (!mounted) return;
      if (s != null) {
        ask(context, title: '公司名稱要用簡體字', msg: '建議改為：$s', ok: '套用', cancel: '不用').then((r) {
          if (r == 'confirm') {
            _set(() => form['name'] = s);
            ctl['name']!.text = s;
          }
        });
      } else {
        showToast(context, e is ApiError ? e.message : '$e');
      }
    } finally {
      _set(() => saving = false);
    }
  }

  Widget _input(String key, String placeholder) => Field(controller: ctl[key], placeholder: placeholder, onChanged: (v) => form[key] = v);

  @override
  Widget build(BuildContext context) {
    final j = c['jurisdiction'];
    return Container(
      margin: const EdgeInsets.only(top: 4, bottom: 12),
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      decoration: BoxDecoration(color: C.paper, borderRadius: BorderRadius.circular(R.card)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const FieldLabel('公司名稱'),
        _input('name', j == '內地' ? '按營業執照填寫（簡體字）' : '按商業登記證填寫'),
        if (j == '香港') ...[const FieldLabel('英文名稱'), _input('nameEn', '按公司註冊證書填寫')],
        FieldLabel(regLabel),
        _input('registrationNo', '按證件填寫$regLabel'),
        if (j == '香港') ...[const FieldLabel('公司編號'), _input('companyNumber', '公司註冊證書上的編號')],
        const FieldLabel('成立日期'),
        PickerBox(
          text: form['incorporatedOn']!.isNotEmpty ? form['incorporatedOn']! : '選擇日期',
          onTap: () async {
            final v = await showDatePicker(context, value: form['incorporatedOn']!.isEmpty ? null : form['incorporatedOn']);
            if (v != null) _set(() => form['incorporatedOn'] = v);
          },
        ),
        if (j == '內地') ...[
          const FieldLabel('納稅人類型'),
          PickerBox(
            text: form['taxpayerType']!.isNotEmpty ? form['taxpayerType']! : '選擇類型',
            onTap: () async {
              // <picker :range> 沒有綁 value：每次從第一項開始
              final i = await showSelectorPicker(context, taxpayerTypes);
              if (i != null) _set(() => form['taxpayerType'] = taxpayerTypes[i]);
            },
          ),
        ],
        Padding(padding: const EdgeInsets.only(top: 12), child: Subtle(forMode('修改後立即生效，你的顧問會再核對。', '修改後立即生效。'))),
        EditorActions(onCancel: widget.onClose, save: saving ? '正在儲存…' : '儲存公司資料', saving: saving, onSave: save),
      ]),
    );
  }
}
