// 線上客服卡（docs/mockups/support-widget.html 草稿 ①②⑤）：取代原來的「聯絡我們」卡（WhatsApp、微信、在 app 內發訊息）。
// 和 H5 的 mobile/src/components/SupportCard.vue 文字、排列一樣。
// - 已登入（「我的」頁）：圖示、標題「線上客服」、說明、主按鈕「聯絡客服」；打開時帶入客戶資料。
//   App 沒有紅點：只在打開客服頁時才載入 MasterBox，關著時拿不到未讀數（計劃「第一步做不到的」）。
// - public（登入頁、申請使用、審批中）：標題可另給（例如「忘記密碼？」）、說明一句、線框按鈕「聯絡客服」；不帶客戶資料。
// 工作時間提示（草稿的「辦公時間，現在有人回覆」）讀不到 MasterBox 的設定，照計劃不寫。
// 外距（.support margin-top 16、.card margin-bottom 12）由所在頁面按外距合併處理，這裏只畫卡本身。
import 'package:flutter/widgets.dart';

import 'num_text.dart';
import '../ui/base.dart';
import '../ui/tokens.dart';
import 'support.dart';
import 'support_unread.dart';

const supportIntro = '有問題直接發訊息，可以傳相片和文件。下班後也可以留言，我們上班後回覆。';
const supportPublicIntro = '發訊息給客服，我們會盡快回覆。';

class SupportCard extends StatelessWidget {
  const SupportCard({super.key, this.public = false, this.title = '', this.intro = ''});
  final bool public;
  final String title, intro;

  @override
  Widget build(BuildContext context) {
    final head = public
        ? Text(
            title.isNotEmpty ? title : '線上客服',
            style: ts(Fs.h, weight: w800, color: C.jadeDeep),
          )
        // .support-head：圓形淺綠底 40×40 的對話圖示（22×22），間距 12
        : Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(color: C.jadeSoft, shape: BoxShape.circle),
                child: const Center(
                  child: CustomPaint(size: Size.square(22), painter: ChatIconPainter()),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  '線上客服',
                  style: ts(Fs.h, weight: w800, color: C.jadeDeep),
                ),
              ),
            ],
          );
    return CardBox(
      margin: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          head,
          // .intro：上距 8
          Padding(padding: const EdgeInsets.only(top: 8), child: Subtle(intro.isNotEmpty ? intro : (public ? supportPublicIntro : supportIntro))),
          // .open-btn：撐滿、上距 12；已登入用主按鈕，未登入用線框按鈕
          Padding(
            padding: const EdgeInsets.only(top: 12),
            // 已登入版：客服回覆了有紅點（未讀數，超過 99 寫 99+；business/support_unread.dart）；未登入版沒有
            child: ValueListenableBuilder<int>(
              valueListenable: SupportUnread.count,
              builder: (context, unread, _) => Btn(
                '聯絡客服',
                kind: public ? BtnKind.line : BtnKind.primary,
                expand: true,
                trailing: !public && unread > 0 ? UnreadDot(unread) : null,
                onTap: () => openSupport(context, public: public),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// 「聯絡客服」按鈕上的紅點：照 SupportCard.vue 的 .dot（最少寬 20、高 20、圓角 10、左右內距 6、紅底白字 12 號）
class UnreadDot extends StatelessWidget {
  const UnreadDot(this.count, {super.key});
  final int count;
  @override
  Widget build(BuildContext context) => Container(
        key: const ValueKey('support-dot'),
        constraints: const BoxConstraints(minWidth: 20),
        height: 20,
        padding: const EdgeInsets.symmetric(horizontal: 6),
        decoration: BoxDecoration(color: C.overdue, borderRadius: BorderRadius.circular(10)),
        child: Center(widthFactor: 1, child: Text(badgeText(count), softWrap: false, style: numStyle(ts(Fs.cap, weight: w700, color: C.card, height: 1)))),
      );
}

// mobile/src/static/chat.svg：viewBox 24、綠色 2px 線、圓角接點的對話泡泡
class ChatIconPainter extends CustomPainter {
  const ChatIconPainter();
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    final path = Path()
      ..moveTo(21, 12)
      ..arcToPoint(const Offset(9.4, 19.1), radius: const Radius.circular(8))
      ..lineTo(4, 20)
      ..lineTo(5, 15.4)
      ..arcToPoint(const Offset(21, 12), radius: const Radius.circular(8), largeArc: true)
      ..close();
    canvas
      ..save()
      ..scale(s)
      ..drawPath(
        path,
        Paint()
          ..color = C.jade
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..strokeJoin = StrokeJoin.round
          ..isAntiAlias = true,
      )
      ..restore();
  }

  @override
  bool shouldRepaint(ChatIconPainter old) => false;
}
