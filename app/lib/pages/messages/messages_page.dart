// 聯絡我們：一比一移植 mobile/src/pages/messages/messages.vue（App 端）。
// 自管客戶的 App 內文字訊息：可發訊息（canSend）時下面有輸入框和「其他聯絡方式」卡；托管客戶只看我們發的訊息。
// 打開即視為已讀我們的回覆（伺服器處理）；每次顯示都重新載入（onShow）。計算在 messages_logic.dart。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/page_show.dart';
import '../../business/uni_textarea.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../login/contact_card.dart';
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DBtn;
import 'messages_logic.dart';

class MessagesPage extends StatefulWidget {
  const MessagesPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<MessagesPage> createState() => MessagesPageState();
}

class MessagesPageState extends State<MessagesPage> with PageShow {
  List messages = [];
  bool canSend = false, loaded = false, sending = false;
  String error = '';
  final draft = TextEditingController();

  @override
  String get showPath => '/messages';

  @override
  void onShow() => unawaited(load());

  @override
  void dispose() {
    draft.dispose();
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
      final data = await api('/my/messages') as Map;
      _set(() {
        messages = data['messages'] is List ? data['messages'] as List : [];
        canSend = truthy(data['canSend']);
      });
    } catch (e) {
      if (mounted) showToast(context, e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  Future<void> send() async {
    if (sending) return;
    final problem = messageProblem(draft.text);
    if (problem.isNotEmpty) return _set(() => error = problem);
    _set(() {
      sending = true;
      error = '';
    });
    try {
      final r = await api('/my/messages', 'POST', {'body': draft.text}) as Map;
      _set(() => messages = r['messages'] is List ? r['messages'] as List : []);
      draft.clear();
      if (mounted) showToast(context, '已發送');
    } catch (e) {
      _set(() => error = e is ApiError ? e.message : '$e');
    } finally {
      _set(() => sending = false);
    }
  }

  // .bubble：最寬 85%、內距 10 12、圓角 12、細線；我們發的靠左白底，你發的靠右淺綠底
  Widget bubble(Map item) {
    final mine = !truthy(item['fromStaff']);
    return LayoutBuilder(builder: (context, box) => Align(
          alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: box.maxWidth * .85),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(color: mine ? C.jadeSoft : C.card, border: Border.all(color: C.rule), borderRadius: BorderRadius.circular(R.panel)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(senderLine(item), style: ts(Fs.cap, weight: w700, color: C.ink3)),
                Padding(padding: const EdgeInsets.only(top: 4), child: Text(jsString(item['body']), style: ts(Fs.body, height: 1.6))),
              ]),
            ),
          ),
        ));
  }

  @override
  Widget build(BuildContext context) {
    final blocks = <Blk>[
      Blk(Text(messagesIntro(canSend), style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 12),
      if (loaded && messages.isEmpty) Blk(const CardBox(margin: EdgeInsets.zero, padding: EdgeInsets.zero, child: Empty('還沒有訊息。寫下你的問題，我們會盡快回覆。')), bottom: 12),
      for (final item in messages.whereType<Map>()) Blk(bubble(item), top: 12),
      if (canSend) ...[
        Blk(
          CardBox(
            margin: EdgeInsets.zero,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              UniTextArea(controller: draft, height: MessagesStyle.draftHeight, maxLength: 1000, placeholder: '輸入訊息，最多 1000 字'),
              if (error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error, style: ts(Fs.body, color: C.overdue))),
              Padding(padding: const EdgeInsets.only(top: 12), child: DBtn(sending ? '正在發送…' : '發送', enabled: !sending, onTap: send)),
            ]),
          ),
          top: 16,
          bottom: 12,
        ),
        Blk(const ContactCard(messages: false, public: false, bare: true), top: 16, bottom: 12),
      ],
    ];
    return AppPage(
      title: '聯絡我們',
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(children: [Blocks(blocks)]));
        }),
      ),
    );
  }
}
