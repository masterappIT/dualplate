// 申請使用：一比一移植 mobile/src/pages/signup/signup.vue（App 端）。
// 自行申請（docs/requirements.md 5.6.2）：管理員聯絡申請人核實號碼後批准，批准後用這個號碼和密碼登入。
// 條款載入完才決定顯示表格或「暫時不能在網上申請」（避免表格先閃出再換成提示）。檢查和送出內容在 signup_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/stamp_mark.dart';
import '../../core/api.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/choices.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/tokens.dart';
import '../login/area_picker.dart';
import '../../business/support_card.dart';
import '../login/login_page.dart' show areaCodes, areaIndexOf;
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DBtn;
import 'signup_logic.dart';

class SignupPage extends StatefulWidget {
  const SignupPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<SignupPage> createState() => SignupPageState();
}

class SignupPageState extends State<SignupPage> {
  // 區號與登入頁相同，記住上次選的
  int areaIndex = areaIndexOf(Session.loginArea);
  final phone = TextEditingController(), name = TextEditingController(), password = TextEditingController(), again = TextEditingController();
  final scroll = ScrollController();
  bool agree = false, busy = false, sent = false, loaded = false;
  String error = '';
  Map? terms;

  @override
  void initState() {
    super.initState();
    unawaited(loadTerms().whenComplete(() => _set(() => loaded = true)));
  }

  @override
  void dispose() {
    for (final c in [phone, name, password, again]) {
      c.dispose();
    }
    scroll.dispose();
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  // 取不到就當作沒有條款（照舊不提示錯誤）
  Future<void> loadTerms() async {
    try {
      final t = await publicApi('/public/terms');
      _set(() => terms = t is Map ? t : null);
    } catch (_) {}
  }

  Future<void> pickArea() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final picked = await showAreaPicker(context, [for (final a in areaCodes) a.label], areaIndex);
    if (picked == null || !mounted) return;
    setState(() => areaIndex = picked);
    Session.rememberLoginArea(areaCodes[picked].code);
  }

  void openTerms(String tab) => context.push('/terms?tab=$tab');
  void goLogin() => context.go('/login');

  Future<void> submit() async {
    _set(() => error = '');
    final area = areaCodes[areaIndex];
    final problem = signupProblem(area: area, phone: phone.text.trim(), name: name.text, password: password.text, again: again.text, agree: agree);
    if (problem.isNotEmpty) return _set(() => error = problem);
    _set(() => busy = true);
    try {
      await api('/public/signup', 'POST', signupBody(area: area, phone: phone.text.trim(), name: name.text, password: password.text, termsVersion: terms?['version']));
      _set(() => sent = true);
      if (scroll.hasClients) scroll.jumpTo(0);
    } catch (e) {
      final message = e is ApiError ? e.message : '$e';
      // 條款剛更新：重新載入最新版本，請客戶再看一次
      if (e is ApiError && termsChanged(e.status, message)) {
        _set(() => agree = false);
        await loadTerms();
      }
      _set(() => error = message);
    } finally {
      _set(() => busy = false);
    }
  }

  // .field-label.first：上距 0
  Widget label(String text, {bool first = false}) => Padding(padding: EdgeInsets.only(top: first ? 0 : 16, bottom: 8), child: Text(text, style: ts(Fs.body, weight: w700, color: C.ink2)));
  Blk card(Widget child) => Blk(CardBox(margin: EdgeInsets.zero, child: child), bottom: 12);

  Widget form() {
    final area = areaCodes[areaIndex];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      label('手機號碼', first: true),
      // .phone-row：flex、間距 8，區號和號碼等高（align-items 預設 stretch）
      IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _AreaButton(label: area.label, onTap: pickArea),
          const SizedBox(width: 8),
          Expanded(child: Field(controller: phone, placeholder: area.hint, keyboardType: TextInputType.number)),
        ]),
      ),
      label('稱呼'),
      Field(controller: name, placeholder: '例如 陳先生', maxLength: 40),
      label('設定密碼'),
      Field(controller: password, obscure: true, placeholder: '至少 10 個字元'),
      label('再輸入一次密碼'),
      Field(controller: again, obscure: true, placeholder: '再輸入一次'),
      // class="line-sub note"：本頁沒有 .line-sub 樣式，只有 .note 的上距 8，字照頁面預設（14、深色、行高 1.5）
      Padding(padding: const EdgeInsets.only(top: 8), child: Text('請不要使用你在其他網站或服務用的密碼。', style: ts(Fs.body, height: 1.5))),
      // .agree-row：換行排列、垂直置中、間距 4、上距 16
      Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Wrap(spacing: 4, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          WdCheckbox(label: '我已閱讀並同意', value: agree, block: false, onChanged: (v) => setState(() => agree = v)),
          LinkText('服務條款', onTap: () => openTerms('terms')),
          const Subtle('及'),
          LinkText('私隱聲明', onTap: () => openTerms('privacy')),
        ]),
      ),
      if (error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error, style: ts(Fs.body, weight: w700, color: C.overdue))),
      Padding(padding: const EdgeInsets.only(top: 20), child: DBtn(busy ? '正在提交…' : '提交申請', enabled: !(busy || !loaded), onTap: submit)),
    ]);
  }

  // .notice-title：16、特粗、深綠、下距 4
  Widget noticeTitle(String text) => Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(text, style: ts(Fs.h, weight: w800, color: C.jadeDeep)));

  // .sent：直排、靠左、間距 8；「返回登入」撐滿、另加上距 8
  Widget sentCard() => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const StampMark(text: '已收到', tone: 'jade', play: true),
        const SizedBox(height: 8),
        noticeTitle('申請已收到'),
        const SizedBox(height: 8),
        const Subtle('我們會先聯絡你核實手機號碼，管理員批准後，即可用這個號碼和密碼登入。'),
        const SizedBox(height: 16),
        SizedBox(width: double.infinity, child: Btn('返回登入', kind: BtnKind.line, expand: true, onTap: goLogin)),
      ]);

  @override
  Widget build(BuildContext context) {
    final blocks = <Blk>[
      if (!sent) ...[
        Blk(Text('免費使用，自己管理牌照、公司和到期日。提交後我們會先聯絡你核實手機號碼，批准後即可登入。', style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
        if (loaded && terms == null)
          card(Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [noticeTitle('暫時不能在網上申請'), const Subtle('請按下面「聯絡客服」找我們，我們會為你開通帳戶。')]))
        else if (terms != null)
          card(form()),
      ] else
        card(sentCard()),
      // 線上客服（未登入版，不帶客戶資料）：上距 16（和上一張卡的下距 12 合併）
      if (sent || (loaded && terms == null)) Blk(const SupportCard(public: true), top: 16, bottom: 12),
      // .help：上距 16、置中、13 號淺字；連結也是 13 號
      if (!sent && loaded)
        Blk(
          Text.rich(
            TextSpan(children: [
              const TextSpan(text: '已有帳戶？'),
              WidgetSpan(
                alignment: PlaceholderAlignment.baseline,
                baseline: TextBaseline.alphabetic,
                child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: goLogin, child: Text('返回登入', style: ts(Fs.meta, weight: w700, color: C.jade))),
              ),
            ]),
            textAlign: TextAlign.center,
            style: ts(Fs.meta, color: C.ink3),
          ),
          top: 16,
        ),
    ];
    return AppPage(
      title: '申請使用',
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(controller: scroll, children: [Blocks(blocks)]));
        }),
      ),
    );
  }
}

// 區號：.field.picker.area，寬 128，文字和「›」左右分開（同登入頁）
class _AreaButton extends StatelessWidget {
  const _AreaButton({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(
        key: const ValueKey('signup-area'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          width: LoginStyle.areaWidth,
          constraints: const BoxConstraints(minHeight: H.field),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: C.card, border: Border.all(color: C.rule), borderRadius: BorderRadius.circular(R.control)),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Flexible(child: Text(label, softWrap: false, overflow: TextOverflow.clip, style: ts(Fs.h))),
            const SizedBox(width: 4),
            const Chev(),
          ]),
        ),
      );
}
