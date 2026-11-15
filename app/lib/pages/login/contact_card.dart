// 聯絡方式卡：照搬 mobile/src/components/ContactCard.vue 的公開版本（登入頁的「忘記密碼？」和申請審批中）。
// 只列出已設定的 WhatsApp／微信；都沒有設定時整張卡不顯示。App 內訊息（messages）要登入後才有，到階段 3a 連同組件搬到 lib/business/ 再做。
// 現有 App 按渠道按鈕時不會打開 WhatsApp：openLink 在 App 端只複製連結並提示（api.js 只有網頁版才開新視窗），照舊。
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/wording.dart';
import '../../ui/base.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import 'svg_icon.dart';

// 說明只提已設定的渠道；有另給標題（例如「忘記密碼？」）時不寫「也」。中英之間才留空格
String contactIntro(Map contact, {bool messages = false, String title = ''}) {
  final names = [
    if (truthy(contact['whatsappLink'])) 'WhatsApp',
    if (truthy(contact['wechatId']) || truthy(contact['wecomLink']) || truthy(contact['wechatQr'])) '微信',
  ].join('、');
  String spaced(String t) => '${RegExp(r'^[A-Za-z]').hasMatch(t) ? ' ' : ''}$t${RegExp(r'[A-Za-z]$').hasMatch(t) ? ' ' : ''}';
  if (messages) return names.isNotEmpty ? '有問題可以在 app 內發訊息，或用${spaced(names)}找我們。' : '有問題可以在 app 內發訊息給我們。';
  return '${title.isNotEmpty ? '' : '也'}可以用${spaced(names)}找我們。';
}

bool hasChannel(Map contact) => ['whatsappLink', 'wechatId', 'wecomLink', 'wechatQr'].any((k) => truthy(contact[k]));

// api.js 的 copyText：複製後提示
void copyText(BuildContext context, Object? value, [String title = '已複製']) {
  if (!truthy(value)) return;
  Clipboard.setData(ClipboardData(text: jsString(value))).then((_) {
    if (context.mounted) showToast(context, title);
  });
}

// api.js 的 openLink：App 端不能直接開外部網址，改為複製連結
void openLink(BuildContext context, Object? url) {
  if (!truthy(url)) return;
  copyText(context, url, '連結已複製，請在瀏覽器打開');
}

class ContactCard extends StatefulWidget {
  const ContactCard({super.key, this.title = ''});
  final String title;
  @override
  State<ContactCard> createState() => _ContactCardState();
}

class _ContactCardState extends State<ContactCard> {
  Map contact = const {'whatsapp': '', 'whatsappLink': '', 'wechatId': '', 'wechatQr': '', 'wecomLink': ''};

  @override
  void initState() {
    super.initState();
    // 取不到就不顯示（照舊不提示錯誤）
    publicApi('/public/contact').then((value) {
      if (mounted && value is Map) setState(() => contact = value);
    }, onError: (Object _) {});
  }

  @override
  Widget build(BuildContext context) {
    if (!hasChannel(contact)) return const SizedBox.shrink();
    final c = contact;
    // .btn-sm.channel：撐滿、高 40、淺綠底綠字，標誌 20×20 右距 8；按下效果同 Btn
    Widget channel(SvgIcon icon, String text, VoidCallback onTap) => Pressable(
          onTap: onTap,
          child: Container(
            height: H.small,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(color: C.jadeSoft, borderRadius: BorderRadius.circular(R.control)),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              SvgImage(icon, width: 20, height: 20),
              const SizedBox(width: 8),
              Flexible(child: Text(text, softWrap: false, overflow: TextOverflow.clip, style: ts(Fs.body, weight: w700, color: C.jade, height: 1))),
            ]),
          ),
        );
    final buttons = [
      if (truthy(c['whatsappLink'])) channel(whatsappIcon, 'WhatsApp ${phoneText(c['whatsapp'])}', () => openLink(context, c['whatsappLink'])),
      if (truthy(c['wecomLink'])) channel(wechatIcon, '打開微信客服', () => openLink(context, c['wecomLink'])),
      if (truthy(c['wechatId'])) channel(wechatIcon, '複製微信號 ${jsString(c['wechatId'])}', () => copyText(context, c['wechatId'], '微信號已複製，請到微信搜尋添加')),
    ];
    // .card.contact：margin-top 16、內距 16（.card 的 margin-bottom 12 照舊）
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: CardBox(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(widget.title.isNotEmpty ? widget.title : '其他聯絡方式', style: ts(Fs.h, weight: w800, color: C.jadeDeep)),
          Subtle(contactIntro(c, title: widget.title)),
          if (buttons.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                for (final (i, b) in buttons.indexed) ...[if (i > 0) const SizedBox(height: 8), b],
              ]),
            ),
          if (truthy(c['wechatQr']))
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Row(children: [
                SizedBox(width: 96, height: 96, child: _qr(jsString(c['wechatQr']))),
                const SizedBox(width: 12),
                const Expanded(child: Subtle('掃描或長按二維碼添加微信客服')),
              ]),
            ),
        ]),
      ),
    );
  }

  // 二維碼：伺服器給的是 data URL 或網址；現有 App 點擊後用系統圖片檢視器放大（未做，見 1d 報告）
  Widget _qr(String src) {
    final data = RegExp(r'^data:[^;]+;base64,(.*)$').firstMatch(src);
    if (data != null) {
      try {
        return Image.memory(base64Decode(data[1]!), fit: BoxFit.contain);
      } catch (_) {
        return const SizedBox.shrink();
      }
    }
    return Image.network(src, fit: BoxFit.contain, errorBuilder: (_, _, _) => const SizedBox.shrink());
  }
}
