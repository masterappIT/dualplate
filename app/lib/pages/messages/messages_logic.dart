// 聯絡我們頁的計算：照 mobile/src/pages/messages/messages.vue。
import '../../core/js.dart';

// 訊息時間：toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month/day/hour/minute 兩位、24 小時 }) → 「22/11 03:05」（日／月 時:分）。
// 香港沒有夏令時間，固定加 8 小時。沒有時間時空白；格式不對時照 JS 寫「Invalid Date」
String messageTime(Object? value) {
  if (!truthy(value)) return '';
  final t = DateTime.tryParse(jsString(value));
  if (t == null) return 'Invalid Date';
  final hk = t.toUtc().add(const Duration(hours: 8));
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(hk.day)}/${two(hk.month)} ${two(hk.hour)}:${two(hk.minute)}';
}

// 送出前檢查：空白（只有空格）不送
String messageProblem(String draft) => draft.trim().isEmpty ? '請輸入訊息' : '';

String messagesIntro(bool canSend) => canSend ? '在這裏留言，我們會在辦公時間內回覆；回覆時會通知你。' : '這裏是我們發給你的訊息。有問題請直接聯絡你的顧問。';

// 「陳顧問 · 22/11 03:05」：我們發的寫發訊人（沒有名字寫「我們」），客戶自己發的寫「你」
String senderLine(Map item) =>
    '${truthy(item['fromStaff']) ? (truthy(item['senderName']) ? jsString(item['senderName']) : '我們') : '你'} · ${messageTime(item['createdAt'])}';
