// 註銷帳號：一比一移植 mobile/src/pages/close-account/close-account.vue（App 端）。
// 自管客戶註銷帳號（docs/requirements.md 5.6.2）：不設冷靜期，輸入密碼確認後即時刪除，不能復原。
// 照現在的行為搬，不送 retain（「停用 30 天後刪除」計劃未批准）。每次顯示都重新載入（onShow）。
// 有未完成的委託時伺服器回 allowed:false，列出委託和「聯絡我們」。送出內容在 close_account_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../business/uni_textarea.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/choices.dart';
import '../../ui/dialogs.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DBtn;
import 'close_account_logic.dart';

class CloseAccountPage extends StatefulWidget {
  const CloseAccountPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<CloseAccountPage> createState() => CloseAccountPageState();
}

class CloseAccountPageState extends State<CloseAccountPage> with PageShow {
  Map? info;
  String loadError = '', reason = '', error = '';
  bool busy = false;
  final password = TextEditingController(), reasonText = TextEditingController();

  @override
  String get showPath => '/close-account';

  @override
  void onShow() => unawaited(load());

  @override
  void dispose() {
    password.dispose();
    reasonText.dispose();
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  Future<void> load() async {
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final value = await api('/my/account/close');
      _set(() {
        info = value is Map ? value : null;
        loadError = '';
      });
    } catch (e) {
      _set(() => loadError = e is ApiError ? e.message : '$e');
    }
  }

  void openRequest(Object? id) => context.push('/request-detail?id=${jsString(id)}');
  void goMessages() => context.push('/messages');

  Future<void> submit() async {
    _set(() => error = '');
    if (password.text.isEmpty) return _set(() => error = '請輸入登入密碼');
    FocusManager.instance.primaryFocus?.unfocus();
    final r = await ask(context, title: '確定註銷帳號？', msg: '你的帳號和全部資料會即時刪除，不能復原。', ok: '註銷', cancel: '取消', danger: true);
    if (r != 'confirm' || !mounted) return;
    _set(() => busy = true);
    try {
      await api('/my/account/close', 'POST', closeBody(password: password.text, reason: reason, reasonText: reasonText.text));
      if (!mounted) return;
      clearSession();
      // uni.reLaunch 到登入頁，400 毫秒後提示（本頁已關，提示放在最上層浮層）
      final root = Overlay.of(context, rootOverlay: true);
      context.go('/login');
      Timer(const Duration(milliseconds: 400), () {
        if (root.mounted) showToastOn(root, '帳號已註銷，多謝你曾使用');
      });
    } catch (e) {
      _set(() => error = e is ApiError ? e.message : '$e');
      if (e is ApiError && e.status == 409) unawaited(load());
    } finally {
      _set(() => busy = false);
    }
  }

  // .error：上距 8、14 號粗體紅字
  Widget errorText(String text) => Padding(padding: const EdgeInsets.only(top: 8), child: Text(text, style: ts(Fs.body, weight: w700, color: C.overdue)));
  Blk card(List<Widget> children) => Blk(CardBox(margin: EdgeInsets.zero, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children)), bottom: 12);
  Blk section(String text) => Blk(SectionTitle(text, bare: true), top: 28, bottom: 12);

  // .blocked：紅色標題（下距 8）、未完成的委託逐行（上下 12、底線，最後一行沒有）、「聯絡我們」撐滿上距 12
  Blk blockedCard(Map i) {
    final open = i['openRequests'] is List ? i['openRequests'] as List : const [];
    return card([
      Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(i['error'] == null ? '' : jsString(i['error']), style: ts(Fs.h, weight: w800, color: C.overdue))),
      for (final (n, item) in open.indexed)
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => openRequest(item is Map ? item['id'] : null),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(border: n == open.length - 1 ? null : const Border(bottom: BorderSide(color: C.rule))),
            child: Row(children: [
              Expanded(child: Text(item is Map && item['title'] != null ? jsString(item['title']) : '', style: ts(Fs.h, weight: w700))),
              const SizedBox(width: 8),
              const Chev(),
            ]),
          ),
        ),
      Padding(padding: const EdgeInsets.only(top: 12), child: Btn('聯絡我們', kind: BtnKind.line, expand: true, onTap: goMessages)),
    ]);
  }

  List<Blk> allowedBlocks(Map i) {
    final reasons = [for (final r in (i['reasons'] is List ? i['reasons'] as List : const [])) jsString(r)];
    return [
      section('註銷原因（選填）'),
      card([
        WdRadioGroup<String>(value: reason.isEmpty ? null : reason, options: [for (final r in reasons) (r, r)], rowMargin: 0, rowPadding: 10, onChanged: (v) => setState(() => reason = v)),
        if (reason == '其他') Padding(padding: const EdgeInsets.only(top: 12), child: UniTextArea(controller: reasonText, height: 96, maxLength: 200, placeholder: '請告訴我們原因（最多 200 字）')),
      ]),
      section('確認身份'),
      card([
        Padding(padding: const EdgeInsets.only(bottom: 8), child: Text('登入密碼', style: ts(Fs.body, weight: w700, color: C.ink2))),
        Field(controller: password, obscure: true, placeholder: '輸入你的登入密碼'),
        if (error.isNotEmpty) errorText(error),
        Padding(padding: const EdgeInsets.only(top: 20), child: busy ? const DBtn('正在註銷…', enabled: false) : Btn('註銷帳號', danger: true, onTap: submit)),
      ]),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final i = info;
    Widget num(String text) => Text(text, style: numStyle(ts(Fs.body, height: 1.5)));
    final blocks = <Blk>[
      Blk(Text('註銷後會即時刪除你的帳號和全部資料，不能復原。', style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
      if (loadError.isNotEmpty)
        card([errorText(loadError)])
      else if (i != null) ...[
        section('會刪除的資料'),
        card([
          Kv([
            ('牌照', num(countText(i['counts'], 'plates', '個'))),
            ('公司', num(countText(i['counts'], 'companies', '間'))),
            ('車輛', num(countText(i['counts'], 'vehicles', '部'))),
            ('司機', num(countText(i['counts'], 'drivers', '位'))),
          ]),
          Padding(padding: const EdgeInsets.only(top: 12), child: Text('連同批文卡和證件相片、到期提醒、訊息和修改記錄。曾經付費的委託，只保留法律要求的收費記錄，不含你的個人資料。', style: ts(Fs.body, color: C.ink2, height: 1.5))),
        ]),
        if (!truthy(i['allowed'])) blockedCard(i) else ...allowedBlocks(i),
      ],
    ];
    return AppPage(
      title: '註銷帳號',
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(children: [Blocks(blocks)]));
        }),
      ),
    );
  }
}
