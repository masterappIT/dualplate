// 登入頁：一比一照搬 mobile/src/pages/login/login.vue（App 端）。文字逐字照抄，數值見 tokens.dart 的 LoginStyle。
// 上半：深通行綠畫布（扭索紋、口岸網絡、立體車牌示例）；下半：證件式登入卡（手機號碼／電郵、密碼、錯誤提示、聯絡方式、條款連結）。
// 登入成功：卡右上蓋「已登入」印章、畫布擴散，700ms 後轉到首頁分頁（uni.switchTab）。
// 不搬：微信登入和綁定（只在小程序）；安卓 App 內更新檢查（階段 4）。
import 'package:flutter/material.dart' show Material, MaterialType, TextField, InputDecoration, InputBorder;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/plates.dart';
import '../../business/stamp_mark.dart';
import '../../core/api.dart';
import '../../core/session.dart';
import '../../ui/base.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/tokens.dart';
import 'area_picker.dart';
import 'contact_card.dart';
import 'ports_canvas.dart';
import 'svg_icon.dart';

// 手機登入要選區號：香港、澳門 8 位，內地 1 字頭 11 位；記住上次選的區號
class AreaCode {
  const AreaCode(this.code, this.label, this.hint, this.digits, this.pattern);
  final String code, label, hint;
  final int digits;
  final String pattern;
  bool accepts(String value) => RegExp(pattern).hasMatch(value);
}

const areaCodes = [
  AreaCode('+852', '香港 +852', '8 位手機號碼', 8, r'^\d{8}$'),
  AreaCode('+853', '澳門 +853', '8 位手機號碼', 8, r'^\d{8}$'),
  AreaCode('+86', '內地 +86', '11 位手機號碼', 11, r'^1\d{10}$'),
];

int areaIndexOf(String? code) => areaCodes.indexWhere((a) => a.code == code).clamp(0, areaCodes.length - 1);

// 送出前的檢查（login.vue 的 login() 前兩步）；沒問題回傳 null
String? checkLogin({required bool phoneMode, required AreaCode area, required String phone, required String email, required String password}) {
  final digits = phone.replaceAll(RegExp(r'\D'), '');
  if (phoneMode ? digits.isEmpty || password.isEmpty : email.isEmpty || password.isEmpty) return phoneMode ? '請填寫手機號碼和密碼' : '請填寫電郵和密碼';
  if (phoneMode && !area.accepts(digits)) return '${area.label.split(' ')[0]}手機號碼應為 ${area.hint.replaceFirst('手機號碼', '').trim()}';
  return null;
}

// 搖動：每段 keyframe 之間用 ease 曲線（CSS animation-timing-function 套在每兩個影格之間）
double shakeOffset(double t) {
  const frames = LoginStyle.shakeFrames;
  final n = frames.length - 1, at = (t.clamp(0.0, 1.0) * n), i = at.floor().clamp(0, n - 1);
  return frames[i] + (frames[i + 1] - frames[i]) * Motion.ease.transform(at - i);
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> with SingleTickerProviderStateMixin {
  final phone = TextEditingController(), email = TextEditingController(), password = TextEditingController();
  final scroll = ScrollController();
  final ports = PortsController();
  final platesKey = GlobalKey(), heroKey = GlobalKey();
  late final AnimationController shake = AnimationController(vsync: this, duration: LoginStyle.shake, value: 1);
  bool phoneMode = true, loading = false, done = false, scrolledDown = false;
  int areaIndex = areaIndexOf(Session.loginArea);
  String error = '';
  ({bool pending, String text})? application;
  double? platesBottom;

  @override
  void initState() {
    super.initState();
    scroll.addListener(_scrolled);
    WidgetsBinding.instance.addPostFrameCallback((_) => _measure());
  }

  @override
  void dispose() {
    for (final c in [phone, email, password]) {
      c.dispose();
    }
    scroll.dispose();
    shake.dispose();
    super.dispose();
  }

  // 量車牌示例底邊（相對畫布），口岸網絡排在它下面
  void _measure() {
    final plates = platesKey.currentContext?.findRenderObject() as RenderBox?, hero = heroKey.currentContext?.findRenderObject() as RenderBox?;
    if (plates == null || hero == null || !mounted) return;
    final bottom = plates.localToGlobal(Offset(0, plates.size.height), ancestor: hero).dy;
    if (bottom != platesBottom) setState(() => platesBottom = bottom);
  }

  // 往下滑超過 4px（或鍵盤彈出，見 build）時，狀態列下面蓋一條深綠
  void _scrolled() {
    final on = scroll.offset > 4;
    if (on != scrolledDown) setState(() => scrolledDown = on);
  }

  Future<void> pickArea() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final picked = await showAreaPicker(context, [for (final a in areaCodes) a.label], areaIndex);
    if (picked == null || !mounted) return;
    setState(() => areaIndex = picked);
    Session.rememberLoginArea(areaCodes[picked].code);
  }

  void fail(String message) {
    setState(() => error = message);
    // shake=false 再 10ms 後 true：重新播一次
    Future.delayed(const Duration(milliseconds: 10), () {
      if (mounted && !MediaQuery.disableAnimationsOf(context)) shake.forward(from: 0);
    });
  }

  Future<void> login() async {
    setState(() {
      error = '';
      application = null;
    });
    final area = areaCodes[areaIndex], digits = phone.text.trim().replaceAll(RegExp(r'\D'), '');
    final problem = checkLogin(phoneMode: phoneMode, area: area, phone: phone.text.trim(), email: email.text.trim(), password: password.text);
    if (problem != null) return fail(problem);
    setState(() => loading = true);
    try {
      final result = await api('/login', 'POST', {'login': phoneMode ? '${area.code}$digits' : email.text.trim(), 'password': password.text});
      final user = result is Map ? result['user'] : null;
      // 伺服器沒有回傳 user 時，現有 App（iOS）顯示 JavaScriptCore 的錯誤原文
      if (user is! Map) throw ApiError("undefined is not an object (evaluating 'result.user.role')");
      if (user['role'] != 'customer') throw ApiError('此帳號請使用管理端登入');
      enter(Map<String, dynamic>.from(result as Map));
    } on ApiError catch (e) {
      if (e.code == 'SIGNUP_PENDING' || e.code == 'SIGNUP_REJECTED') {
        setState(() => application = (pending: e.code == 'SIGNUP_PENDING', text: e.message));
      } else {
        fail(e.message);
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void enter(Map<String, dynamic> result) {
    saveSession(result);
    setState(() => done = true);
    ports.burst();
    // App 端的 reduced 一直是 false（login.vue 在邏輯層讀不到 window），所以一定等 700ms
    Future.delayed(LoginStyle.enterDelay, () {
      if (mounted) GoRouter.of(context).go('/index');
    });
  }

  // 鍵盤上方的「⌃ ⌄ 完成」列（只在 iOS）；頁面在列裏面量 viewInsets，自然讓出列的位置
  @override
  Widget build(BuildContext context) => KeyboardBarArea(child: Builder(builder: _page));

  Widget _page(BuildContext context) {
    final media = MediaQuery.of(context);
    final keyboard = media.viewInsets.bottom;
    final wide = media.size.width >= 780;
    final heroHeight = (media.size.height * (wide ? LoginStyle.heroVhWide : LoginStyle.heroVh) + LoginStyle.heroExtra).clamp(LoginStyle.heroMin, double.infinity);
    final overlap = wide ? LoginStyle.sheetOverlapWide : LoginStyle.sheetOverlap;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light, // navigationBarTextStyle white
      child: ColoredBox(
        color: C.paper,
        child: Stack(children: [
          Padding(
            padding: EdgeInsets.only(bottom: keyboard),
            child: SingleChildScrollView(
              controller: scroll,
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: media.size.height),
                child: Stack(children: [
                  _hero(heroHeight, media.padding.top, overlap),
                  Padding(
                    padding: wide ? EdgeInsets.only(top: heroHeight - overlap) : EdgeInsets.fromLTRB(16, heroHeight - overlap, 16, 24),
                    child: wide ? Center(child: SizedBox(width: LoginStyle.sheetWidthWide, child: _sheet())) : _sheet(),
                  ),
                ]),
              ),
            ),
          ),
          if (scrolledDown || keyboard > 0) Positioned(left: 0, right: 0, top: 0, height: media.padding.top, child: const ColoredBox(color: C.jadeDeep)),
        ]),
      ),
    );
  }

  Widget _hero(double height, double statusBar, double overlap) => SizedBox(
        key: heroKey,
        height: height,
        child: ColoredBox(
          color: C.jadeDeep,
          child: Guilloche(
            color: C.onDeep,
            child: Stack(fit: StackFit.expand, children: [
              if (platesBottom != null) PortsCanvas(controller: ports, top: platesBottom, bottom: height - overlap),
              IgnorePointer(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(24, statusBar + LoginStyle.heroTop, 24, 0),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      const SvgImage(brandMark, width: LoginStyle.brandMarkW, height: LoginStyle.brandMarkH, fit: BoxFit.contain),
                      const SizedBox(width: 8),
                      Text('車牌管家', style: ts(Fs.h, weight: w800, color: LoginStyle.white, letterSpacing: 2)),
                    ]),
                    const SizedBox(height: 20),
                    Text('兩地牌、公司與到期事項', style: ts(Fs.title, weight: w800, color: LoginStyle.white, height: 1.4)),
                    Text('一處管好。', style: ts(Fs.title, weight: w800, color: LoginStyle.white, height: 1.4)),
                    const SizedBox(height: 16),
                    // 車牌示例：上行粵港、下行粵澳；仿真車牌加立體壓印，同一高度（約 34px）
                    Column(key: platesKey, crossAxisAlignment: CrossAxisAlignment.start, children: const [
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
                  ]),
                ),
              ),
            ]),
          ),
        ),
      );

  Widget _sheet() => AnimatedBuilder(
        animation: shake,
        builder: (context, child) => Transform.translate(offset: Offset(shake.isAnimating ? shakeOffset(shake.value) : 0, 0), child: child),
        child: Container(
          key: const ValueKey('login-sheet'),
          decoration: BoxDecoration(color: C.card, borderRadius: BorderRadius.circular(R.panel), border: Border.all(color: C.rule), boxShadow: Shadows.float),
          child: Stack(clipBehavior: Clip.none, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('登入客戶帳戶', style: ts(Fs.title, weight: w800, color: C.jadeDeep)),
                const SizedBox(height: 4),
                Text('查看你的牌照、公司和辦理進度', style: ts(Fs.body, color: C.ink2)),
                // .sheet .ticket-rule：上 16、下 4；下距 4 和分段的上距 16 合併成 16（CSS 外距合併）
                const SizedBox(height: 17, child: Stack(clipBehavior: Clip.none, children: [Positioned(left: 0, right: 0, top: 0, child: TicketRule())])),
                const SizedBox(height: 16),
                Segmented<bool>(options: const [(true, '手機號碼'), (false, '電郵')], value: phoneMode, onChanged: (v) => setState(() => phoneMode = v)),
                if (phoneMode) ...[
                  const FieldLabel('手機號碼'),
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    _AreaButton(label: areaCodes[areaIndex].label, onTap: pickArea),
                    const SizedBox(width: 8),
                    Expanded(
                      child: LoginInput(
                        key: const ValueKey('login-phone'),
                        controller: phone,
                        placeholder: areaCodes[areaIndex].hint,
                        keyboardType: TextInputType.phone,
                        maxLength: areaCodes[areaIndex].digits,
                        invalid: error.isNotEmpty && phone.text.trim().isEmpty,
                      ),
                    ),
                  ]),
                ] else ...[
                  const FieldLabel('電郵'),
                  LoginInput(key: const ValueKey('login-email'), controller: email, placeholder: 'name@example.com', invalid: error.isNotEmpty && email.text.trim().isEmpty),
                ],
                const FieldLabel('密碼'),
                LoginInput(
                  key: const ValueKey('login-password'),
                  controller: password,
                  placeholder: '輸入密碼',
                  obscure: true,
                  invalid: error.isNotEmpty && password.text.isEmpty,
                  onSubmitted: (_) => login(),
                ),
                if (error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error, style: ts(Fs.body, weight: w700, color: C.overdue))),
                // 自行申請仍在審批或未獲批准：只顯示狀態和聯絡方式，不能進入 app
                if (application != null)
                  Container(
                    margin: const EdgeInsets.only(top: 16),
                    padding: const EdgeInsets.only(top: 16),
                    decoration: const BoxDecoration(border: Border(top: BorderSide(color: C.rule))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(application!.text, style: ts(Fs.h, weight: w800, color: C.jadeDeep))),
                      if (application!.pending) const Subtle('我們會先聯絡你核實手機號碼。'),
                      const ContactCard(),
                    ]),
                  ),
                const SizedBox(height: 20),
                _LoginButton(loading: loading, onTap: login),
                const SizedBox(height: 12),
                Btn('沒有帳戶？申請使用', kind: BtnKind.line, expand: true, onTap: () => context.push('/signup')),
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text('托管客戶的帳戶由顧問開通。忘記密碼請聯絡我們。', textAlign: TextAlign.center, style: ts(Fs.meta, color: C.ink3)),
                ),
                // 忘記密碼：列出已設定的 WhatsApp／微信；都沒有設定時不顯示。卡的下距 12 和條款連結的上距 12 重疊（CSS 外距合併）
                if (application == null) const _CollapsedContact(),
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    _TermsLink('服務條款', () => context.push('/terms?tab=terms')),
                    const SizedBox(width: 8),
                    Text('·', style: ts(Fs.meta, color: C.ink3)),
                    const SizedBox(width: 8),
                    _TermsLink('私隱聲明', () => context.push('/terms?tab=privacy')),
                  ]),
                ),
              ]),
            ),
            if (done) const Positioned(right: 16, top: 16, child: StampMark(text: '已登入', tone: 'jade', play: true)),
          ]),
        ),
      );
}

// ContactCard 的 margin-bottom 12 和條款連結的 margin-top 12 合併成 12：這裏去掉卡的下距
class _CollapsedContact extends StatelessWidget {
  const _CollapsedContact();
  @override
  Widget build(BuildContext context) => const _NoBottomMargin(child: ContactCard(title: '忘記密碼？'));
}

class _NoBottomMargin extends SingleChildRenderObjectWidget {
  const _NoBottomMargin({required super.child});
  @override
  RenderObject createRenderObject(BuildContext context) => _RenderNoBottomMargin();
}

// 子組件高度減 12（CardBox 的下距），沒有內容時高度 0
class _RenderNoBottomMargin extends RenderProxyBox {
  @override
  void performLayout() {
    child!.layout(constraints.loosen(), parentUsesSize: true);
    final h = child!.size.height;
    size = constraints.constrain(Size(child!.size.width, h > 12 ? h - 12 : h));
  }
}

class _TermsLink extends StatelessWidget {
  const _TermsLink(this.text, this.onTap);
  final String text;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Text(text, softWrap: false, style: ts(Fs.meta, weight: w700, color: C.jade)),
      );
}

// 區號：.field.picker.area，寬 128、高 50（字 16 行高 24＋內距 12＋邊框），文字和「›」左右分開
class _AreaButton extends StatelessWidget {
  const _AreaButton({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(
        key: const ValueKey('login-area'),
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

// 「登入」按鈕：.primary.login-button。送出中顯示「登入中」並不能按；
// 不能按時 uni-button[disabled] 的灰底淡黑字蓋過綠底（按原始碼推算，見 1d 報告），再加 .busy 的 opacity .85。
// .login-button 的 transition 只寫了 width 和 border-radius，蓋掉 .primary 的過渡：底色和按下效果都是即時變化，沒有 .18s 過渡
class _LoginButton extends StatefulWidget {
  const _LoginButton({required this.loading, required this.onTap});
  final bool loading;
  final VoidCallback onTap;
  @override
  State<_LoginButton> createState() => _LoginButtonState();
}

class _LoginButtonState extends State<_LoginButton> {
  bool down = false;
  void press(bool v) => setState(() => down = v);
  @override
  Widget build(BuildContext context) {
    final busy = widget.loading, pressed = down && !busy;
    return GestureDetector(
      key: const ValueKey('login-button'),
      behavior: HitTestBehavior.opaque,
      onTapDown: busy ? null : (_) => press(true),
      onTapUp: busy ? null : (_) => press(false),
      onTapCancel: busy ? null : () => press(false),
      onTap: busy ? null : widget.onTap,
      child: Transform.scale(
        scale: pressed ? Motion.pressScale : 1,
        child: Opacity(
          opacity: busy ? LoginStyle.busyOpacity : pressed ? Motion.pressOpacity : 1,
          child: Container(
            height: H.primary,
            decoration: BoxDecoration(color: busy ? LoginStyle.busyBg : C.jade, borderRadius: BorderRadius.circular(R.control)),
            alignment: Alignment.center,
            child: Text(busy ? '登入中' : '登入', softWrap: false, style: ts(Fs.h, weight: w700, color: busy ? LoginStyle.busyText : LoginStyle.white, height: 1)),
          ),
        ),
      ),
    );
  }
}

// 輸入框：.field 加 uni-input。高 48（uni-input height 1.4em 小於 min-height）、字 16、行高 22、左右內距 12；
// 聚焦時綠框加 3px 牌照黃光暈；.invalid 時紅框（即使聚焦也是紅框）。點框外收起鍵盤（uni-input 點別處會失焦）。
class LoginInput extends StatefulWidget {
  const LoginInput({super.key, required this.controller, this.placeholder = '', this.obscure = false, this.keyboardType, this.maxLength, this.invalid = false, this.onSubmitted});
  final TextEditingController controller;
  final String placeholder;
  final bool obscure, invalid;
  final TextInputType? keyboardType;
  final int? maxLength;
  final ValueChanged<String>? onSubmitted;
  @override
  State<LoginInput> createState() => _LoginInputState();
}

class _LoginInputState extends State<LoginInput> {
  final focus = FocusNode();
  @override
  void initState() {
    super.initState();
    focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final on = focus.hasFocus;
    final style = ts(Fs.h, height: LoginStyle.inputLine);
    return AnimatedContainer(
      duration: Motion.fast,
      curve: Motion.ease,
      height: H.field,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: C.card,
        border: Border.all(color: widget.invalid ? C.overdue : on ? C.jade : C.rule),
        borderRadius: BorderRadius.circular(R.control),
        boxShadow: on ? const [BoxShadow(color: LoginStyle.focusRing, spreadRadius: 3)] : const [BoxShadow(color: Color(0x00F2C230), spreadRadius: 3)],
      ),
      alignment: Alignment.centerLeft,
      child: Material(
        type: MaterialType.transparency,
        child: TextField(
          controller: widget.controller,
          focusNode: focus,
          obscureText: widget.obscure,
          obscuringCharacter: '●',
          keyboardType: widget.keyboardType,
          // 網頁輸入框預設：首字母大寫、自動校正（密碼欄除外）；按鍵盤「完成」收起鍵盤，密碼欄另會登入
          textCapitalization: widget.obscure || widget.keyboardType == TextInputType.phone ? TextCapitalization.none : TextCapitalization.sentences,
          autocorrect: !widget.obscure,
          enableSuggestions: !widget.obscure,
          textInputAction: TextInputAction.done,
          inputFormatters: widget.maxLength == null ? null : [LengthLimitingTextInputFormatter(widget.maxLength)],
          onSubmitted: widget.onSubmitted,
          onTapOutside: (_) => focus.unfocus(),
          cursorColor: LoginStyle.caret,
          style: style,
          decoration: InputDecoration(
            isCollapsed: true,
            border: InputBorder.none,
            hintText: widget.placeholder,
            hintStyle: style.copyWith(color: LoginStyle.placeholder),
          ),
        ),
      ),
    );
  }
}
