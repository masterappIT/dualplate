// 我的資料：一比一移植 mobile/src/pages/profile/profile.vue（App 端）。
// 登入帳號（顯示名稱可改）、修改密碼、委託人／帳單名義（個人或公司、名稱、電話；托管客戶改了由顧問核對）、其他可登入的人、多人登入（自管）、註銷帳號。
// 自管與否看 /my/profile 的 serviceMode（載入前當托管）；每次顯示都重新載入（onShow）。計算在 profile_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DBtn;
import 'profile_logic.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<ProfilePage> createState() => ProfilePageState();
}

class ProfilePageState extends State<ProfilePage> with PageShow {
  Map me = {'name': '', 'email': '', 'phone': '', 'wechatBound': false};
  Map customer = {'name': '', 'kind': '個人', 'phone': ''};
  List otherLogins = [];
  Map<String, String> customerDraft = {'name': '', 'kind': '個人', 'phone': ''};
  bool selfManaged = false, savingName = false, savingPw = false, savingCustomer = false, customerPending = false;
  String pwError = '';
  final nameCtl = TextEditingController(), customerName = TextEditingController(), customerPhone = TextEditingController();
  final pwCurrent = TextEditingController(), pwNext = TextEditingController(), pwAgain = TextEditingController();

  @override
  String get showPath => '/profile';

  @override
  void onShow() => unawaited(load());

  @override
  void dispose() {
    for (final c in [nameCtl, customerName, customerPhone, pwCurrent, pwNext, pwAgain]) {
      c.dispose();
    }
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  void toast(String text) {
    if (mounted) showToast(context, text);
  }

  String _s(Object? v) => truthy(v) ? jsString(v) : '';

  void putCustomer(Map c) {
    customerDraft = {for (final k in customerKeys) k: _s(c[k])};
    customerName.text = customerDraft['name']!;
    customerPhone.text = customerDraft['phone']!;
  }

  Future<List> pendingList() async {
    try {
      final p = await api('/my/pending');
      return p is List ? p : [];
    } catch (_) {
      return [];
    }
  }

  Future<void> load() async {
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final results = await Future.wait([api('/my/profile'), pendingList()]);
      final data = results[0] as Map;
      _set(() {
        me = data['me'] is Map ? data['me'] as Map : me;
        customer = data['customer'] is Map ? data['customer'] as Map : customer;
        otherLogins = data['otherLogins'] is List ? data['otherLogins'] as List : [];
        nameCtl.text = _s(me['name']);
        putCustomer(customer);
        selfManaged = data['serviceMode'] == '自管';
        customerPending = customerPendingIn(results[1]);
      });
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    }
  }

  Future<void> saveName() async {
    if (savingName) return;
    _set(() => savingName = true);
    try {
      final r = await api('/my/profile/name', 'PATCH', {'name': nameCtl.text}) as Map;
      _set(() {
        me = {...me, 'name': r['name']};
        nameCtl.text = _s(r['name']);
      });
      Session.updateUser({...?getUser(), 'name': r['name']});
      toast('顯示名稱已更新');
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    } finally {
      _set(() => savingName = false);
    }
  }

  Future<void> savePassword() async {
    if (savingPw) return;
    final problem = passwordProblem(pwCurrent.text, pwNext.text, pwAgain.text);
    _set(() => pwError = problem);
    if (problem.isNotEmpty) return;
    _set(() => savingPw = true);
    try {
      await api('/me/password', 'POST', {'currentPassword': pwCurrent.text, 'newPassword': pwNext.text});
      pwCurrent.clear();
      pwNext.clear();
      pwAgain.clear();
      toast('密碼已更改');
    } catch (e) {
      _set(() => pwError = e is ApiError ? e.message : '$e');
    } finally {
      _set(() => savingPw = false);
    }
  }

  Future<void> saveCustomer() async {
    if (savingCustomer) return;
    _set(() => savingCustomer = true);
    try {
      final r = await api('/my/customer', 'PATCH', customerChanges(customerDraft, customer)) as Map;
      _set(() {
        customer = r;
        putCustomer(r);
      });
      final pending = await pendingList();
      _set(() => customerPending = customerPendingIn(pending));
      toast(selfManaged ? '已更新' : '已更新，顧問會再核對');
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    } finally {
      _set(() => savingCustomer = false);
    }
  }

  // .field-label.first：上距 0
  Widget label(String text, {bool first = false}) => Padding(padding: EdgeInsets.only(top: first ? 0 : 16, bottom: 8), child: Text(text, style: ts(Fs.body, weight: w700, color: C.ink2)));
  Widget note(String text) => Padding(padding: const EdgeInsets.only(top: 12), child: Text(text, style: ts(Fs.body, color: C.ink2, height: 1.5)));
  Widget lineSub(String text) => Text(text, style: ts(Fs.body, color: C.ink2, height: 1.5));
  // .btn-sm.solid.save：撐滿、上距 16
  Widget save(String text, bool enabled, VoidCallback onTap) => Padding(padding: const EdgeInsets.only(top: 16), child: DBtn(text, kind: BtnKind.small, solid: true, enabled: enabled, onTap: onTap));
  Blk card(List<Widget> children) => Blk(CardBox(margin: EdgeInsets.zero, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children)), bottom: 12);
  Blk section(String text) => Blk(SectionTitle(text, bare: true), top: 28, bottom: 12);

  @override
  Widget build(BuildContext context) {
    final company = customerDraft['kind'] == '公司';
    final blocks = <Blk>[
      Blk(Text(selfManaged ? '你的登入帳號和帳單名義，修改後立即生效。' : '你的登入帳號和委託人資料。委託人資料修改後立即生效，顧問會再核對。', style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 8),
      section('登入帳號'),
      card([
        label('顯示名稱', first: true),
        Field(controller: nameCtl, placeholder: '例如 陳大文', onChanged: (_) => _set(() {})),
        save(savingName ? '正在儲存…' : '儲存顯示名稱', !(savingName || !nameChanged(nameCtl.text, me['name'])), saveName),
        const TicketRule(),
        Kv([
          ('登入電郵', Text(truthy(me['email']) ? jsString(me['email']) : '未設定', style: ts(Fs.body, height: 1.5))),
          ('登入手機', Text(truthy(me['phone']) ? jsString(me['phone']) : '未設定', style: numStyle(ts(Fs.body, height: 1.5)))),
          ('微信', Text(truthy(me['wechatBound']) ? '已綁定' : '未綁定', style: ts(Fs.body, height: 1.5))),
        ]),
        note(selfManaged ? '要更改登入電郵或手機，請聯絡我們核實身份後代為更改。' : '要更改登入電郵或手機，請聯絡你的顧問核實身份後代為更改。'),
      ]),
      section('修改密碼'),
      card([
        label('目前密碼', first: true),
        Field(controller: pwCurrent, obscure: true, placeholder: '輸入目前的密碼'),
        label('新密碼'),
        Field(controller: pwNext, obscure: true, placeholder: '至少 10 個字元'),
        label('再輸入一次新密碼'),
        Field(controller: pwAgain, obscure: true, placeholder: '再輸入一次'),
        if (pwError.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(pwError, style: ts(Fs.body, color: C.overdue))),
        save(savingPw ? '正在更改…' : '更改密碼', !savingPw, savePassword),
        note('更改後，其他手機或電腦上的登入會自動登出。請不要使用你在其他網站或服務用的密碼。'),
      ]),
      Blk(SectionRow(title: selfManaged ? '帳單名義' : '委託人（合約及帳單上的名義）', trailing: customerPending ? const Pill('已修改，待核對', tone: Tone.amber) : null), top: 28, bottom: 12),
      card([
        label('類型', first: true),
        Segmented<String>(options: const [('個人', '個人'), ('公司', '公司')], value: customerDraft['kind']!, onChanged: (v) => _set(() => customerDraft['kind'] = v)),
        Padding(padding: const EdgeInsets.only(top: 4), child: Subtle(selfManaged ? '以個人還是公司名義收帳單' : '以個人還是公司名義委託我們')),
        label(company ? '公司名稱' : '姓名'),
        Field(controller: customerName, placeholder: company ? '例如 李氏貿易（香港）有限公司' : '例如 李大文', onChanged: (v) => _set(() => customerDraft['name'] = v)),
        label('聯絡電話'),
        Field(controller: customerPhone, placeholder: '例如 +852 9123 4567', onChanged: (v) => _set(() => customerDraft['phone'] = v)),
        save(savingCustomer ? '正在儲存…' : selfManaged ? '儲存帳單名義' : '儲存委託人資料', !(savingCustomer || !customerChanged(customerDraft, customer)), saveCustomer),
        if (!selfManaged) note('委託人名稱會用在合約和帳單，修改後由顧問核對。'),
      ]),
      if (otherLogins.isNotEmpty) ...[
        section('其他可登入的人'),
        Blk(
          CardBox(
            margin: EdgeInsets.zero,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final (i, name) in otherLogins.indexed)
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  decoration: BoxDecoration(border: i == otherLogins.length - 1 ? null : const Border(bottom: BorderSide(color: C.rule))),
                  child: Text(jsString(name), style: ts(Fs.h, weight: w700)),
                ),
            ]),
          ),
          bottom: 12,
        ),
        Blk(const Subtle('要新增或停用登入，請聯絡你的顧問。'), top: 12),
      ],
      if (selfManaged) ...[
        section('多人登入'),
        card([lineSub('讓助手或同事用自己的帳號一起管理。之後推出，屬收費功能。')]),
      ],
      section('註銷帳號'),
      card([
        lineSub(selfManaged ? '不再使用的話，可以註銷帳號。帳號和全部資料會即時刪除，不能復原。' : '托管客戶要終止服務和註銷帳號，請聯絡你的顧問。'),
        if (selfManaged) Padding(padding: const EdgeInsets.only(top: 12), child: Btn('註銷帳號', kind: BtnKind.line, expand: true, onTap: () => context.push('/close-account'))),
      ]),
    ];
    return AppPage(
      title: '我的資料',
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(children: [Blocks(blocks)]));
        }),
      ),
    );
  }
}
