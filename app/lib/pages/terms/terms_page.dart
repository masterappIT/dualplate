// 服務條款及私隱聲明：一比一移植 mobile/src/pages/terms/terms.vue（App 端）。
// 未登入可看（登入頁、申請使用的連結，讀 /public/terms）；登入後讀 /my/terms，未同意最新版本時可在這裏同意。
// 強制模式（管理者設定）由 core/api.dart 的 openTerms(true) 以 reLaunch 打開：同意前不能使用其他功能，只可「不同意，退出登入」。
// 只在打開時載入一次（onLoad，不是 onShow）。?tab=privacy 先顯示私隱聲明。計算在 terms_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DBtn;
import 'terms_logic.dart';

// 模板 {{ }} 顯示：null 顯示空白
String shown(Object? v) => v == null ? '' : jsString(v);

class TermsPage extends StatefulWidget {
  const TermsPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<TermsPage> createState() => TermsPageState();
}

class TermsPageState extends State<TermsPage> {
  Map? doc;
  bool loaded = false, agreed = false, saving = false;
  late String tab = widget.query['tab'] == 'privacy' ? 'privacy' : 'terms';

  @override
  void initState() {
    super.initState();
    unawaited(load());
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  Future<void> load() async {
    try {
      final value = getUser() != null ? myTermsDoc(await api('/my/terms')) : await publicApi('/public/terms');
      _set(() => doc = value is Map ? value : null);
    } catch (_) {
      _set(() => doc = null);
    } finally {
      _set(() => loaded = true);
    }
  }

  Future<void> accept() async {
    if (!agreed || saving) return;
    _set(() => saving = true);
    try {
      await api('/my/terms/accept', 'POST', {'version': doc!['version']});
      if (!mounted) return;
      showToast(context, '已同意，多謝');
      final router = GoRouter.of(context);
      Timer(const Duration(milliseconds: 600), () => router.go('/index'));
    } catch (e) {
      if (mounted) showToast(context, e is ApiError ? e.message : '$e');
      if (e is ApiError && e.status == 409) unawaited(load());
    } finally {
      _set(() => saving = false);
    }
  }

  // uni.navigateBack，沒有上一頁（例如強制同意後改為提示模式）時回首頁
  void later() => context.canPop() ? context.pop() : context.go('/index');

  void logout() {
    clearSession();
    context.go('/login');
  }

  // .link.later：整行、置中、上內距 16
  Widget laterLink(String text, VoidCallback onTap) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.only(top: 16), child: Text(text, textAlign: TextAlign.center, softWrap: false, style: ts(Fs.body, weight: w700, color: C.jade))),
      );

  Widget acceptCard(bool forced) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // .check：方框 24、圓角 4、間距 12；文字行高 24
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => setState(() => agreed = !agreed),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              key: const ValueKey('terms-check'),
              width: 24,
              height: 24,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: agreed ? C.jade : C.card, border: Border.all(color: agreed ? C.jade : C.rule), borderRadius: BorderRadius.circular(R.control)),
              child: agreed ? Text('✓', style: ts(Fs.meta, weight: w800, color: C.card, height: 1)) : null,
            ),
            const SizedBox(width: 12),
            Expanded(child: Text('我已閱讀並同意服務條款及私隱聲明', style: ts(Fs.body, height: 24 / Fs.body))),
          ]),
        ),
        Padding(padding: const EdgeInsets.only(top: 16), child: DBtn(saving ? '正在提交…' : '同意並繼續', enabled: agreed && !saving, onTap: accept)),
        forced ? laterLink('不同意，退出登入', logout) : laterLink('稍後再看', later),
      ]);

  @override
  Widget build(BuildContext context) {
    final d = doc, need = termsNeedAccept(d), forced = termsForced(d);
    final banner = need ? termsBanner(d!) : null;
    final blocks = <Blk>[
      if (banner != null) Blk(CardBox(warn: true, margin: EdgeInsets.zero, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [ListTitle(banner.$1), ListSub(banner.$2)])), bottom: 12),
      if (loaded && d == null)
        Blk(
          CardBox(
            margin: EdgeInsets.zero,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
            child: Text('服務條款尚未發佈。', textAlign: TextAlign.center, style: ts(Fs.body, color: C.ink3, height: 1.6)),
          ),
          bottom: 12,
        ),
      if (d != null) ...[
        Blk(Segmented<String>(options: const [('terms', '服務條款'), ('privacy', '私隱聲明')], value: tab, onChanged: (v) => setState(() => tab = v)), bottom: 8),
        Blk(
          Subtle('第 ${shown(d['version'])} 版 · ${friendlyDate(d['publishedAt'])} 發佈${truthy(d['accepted']) ? ' · 你已於 ${friendlyDate(d['acceptedAt'])} 同意' : ''}'),
          bottom: 12,
        ),
        Blk(CardBox(margin: EdgeInsets.zero, child: Text(shown(tab == 'terms' ? d['terms'] : d['privacy']), style: ts(Fs.body, height: 1.8))), bottom: 12),
        if (need) Blk(CardBox(margin: EdgeInsets.zero, child: acceptCard(forced)), bottom: 12),
      ],
    ];
    return AppPage(title: '服務條款及私隱聲明', child: PageBody(children: [Blocks(blocks)]));
  }
}
