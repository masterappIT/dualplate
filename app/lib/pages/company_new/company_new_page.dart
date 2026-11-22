// 新增公司：一比一移植 mobile/src/pages/company-new/company-new.vue（App 端）。
// 只填註冊地和名稱，選填屬於哪個牌照；成功後返回上一頁（沒有上一頁時到「我的公司」），400ms 後提示。
// 內地公司名稱有繁體字時，伺服器回傳簡體建議，下面出現「改用「…」 ›」。計算在 company_new_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/company_editor.dart' show suggestionOf;
import '../../core/api.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/choices.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DBtn;
import 'company_new_logic.dart';

class CompanyNewPage extends StatefulWidget {
  const CompanyNewPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<CompanyNewPage> createState() => CompanyNewPageState();
}

class CompanyNewPageState extends State<CompanyNewPage> {
  final bool selfManaged = isSelfManaged();
  String jurisdiction = '香港', plateId = '', error = '', suggestion = '';
  List<PlateChoice> plates = [];
  bool busy = false;
  final name = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => load());
  }

  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  List<PlateChoice> get choices => choicesFor(jurisdiction, plates);

  Future<void> load() async {
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final overview = await api('/my/overview');
      _set(() => plates = plateChoices(overview));
    } catch (_) {
      _set(() => plates = []);
    }
  }

  void setJurisdiction(String v) => _set(() {
        jurisdiction = v;
        plateId = keepPlate(plateId, choices);
      });

  void useSuggestion() {
    name.text = suggestion;
    _set(() {
      suggestion = '';
      error = '';
    });
  }

  Future<void> submit() async {
    _set(() {
      error = '';
      suggestion = '';
    });
    if (name.text.trim().isEmpty) return _set(() => error = '請填寫公司名稱');
    _set(() => busy = true);
    try {
      await api('/my/companies', 'POST', companyNewBody(jurisdiction, name.text, plateId));
      if (!mounted) return;
      // 提示放在根導航器的浮層上：這一頁關掉後仍然顯示
      final root = Overlay.of(context, rootOverlay: true);
      final text = selfManaged ? '公司已新增' : '公司已新增，顧問會再核對';
      // 直接打開這一頁（例如重新整理後）沒有上一頁可返回：改到「我的公司」
      if (context.canPop()) {
        context.pop();
      } else {
        context.go('/companies');
      }
      Timer(const Duration(milliseconds: 400), () {
        showToastOn(root, text);
      });
    } catch (e) {
      _set(() {
        error = e is ApiError ? e.message : '$e';
        suggestion = suggestionOf(e) ?? '';
      });
    } finally {
      _set(() => busy = false);
    }
  }

  Widget label(String text, {bool first = false}) => Padding(padding: EdgeInsets.only(top: first ? 0 : 16, bottom: 8), child: Text(text, style: ts(Fs.body, weight: w700, color: C.ink2)));

  @override
  Widget build(BuildContext context) {
    final list = choices;
    final blocks = <Blk>[
      Blk(const Intro('先填公司名稱；英文名稱、登記號碼和成立日期，之後可在「修改公司資料」補上。')),
      Blk(
        CardBox(
          margin: EdgeInsets.zero,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            label('公司註冊地', first: true),
            WdRadioGroup<String>(
              value: jurisdiction,
              rowMargin: 0,
              rowPadding: 10,
              options: const [('香港', '香港公司'), ('澳門', '澳門公司'), ('內地', '內地公司')],
              onChanged: setJurisdiction,
            ),
            label('公司名稱'),
            Field(controller: name, placeholder: companyNamePlaceholder(jurisdiction), maxLength: 160),
            if (error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error, style: ts(Fs.body, weight: w700, color: C.overdue))),
            if (suggestion.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Align(alignment: Alignment.centerLeft, child: LinkText('改用「$suggestion」 ›', onTap: useSuggestion))),
          ]),
        ),
        bottom: 12,
      ),
      if (list.isNotEmpty) ...[
        Blk(const SectionTitle('屬於哪個牌照（選填）', bare: true), top: 28, bottom: 12),
        Blk(
          CardBox(
            margin: EdgeInsets.zero,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              WdRadioGroup<String>(
                value: plateId,
                rowMargin: 0,
                rowPadding: 10,
                options: [('', '不屬於任何牌照'), for (final p in list) (p.id, p.label)],
                onChanged: (v) => _set(() => plateId = v),
              ),
              Padding(padding: const EdgeInsets.only(top: 8), child: Text('選了牌照，這間公司會和牌照放在同一組，牌照頁也會顯示它。', style: ts(Fs.body, color: C.ink2, height: 1.5))),
            ]),
          ),
          bottom: 12,
        ),
      ],
      Blk(DBtn(busy ? '正在新增…' : '新增公司', enabled: !busy, onTap: submit), top: 20),
    ];
    return AppPage(
      title: '新增公司',
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(children: [Blocks(blocks)]));
        }),
      ),
    );
  }
}
