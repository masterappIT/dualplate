// 批文卡對準框（對應 mobile/src/components/CardCapture.vue、lib/card-stage.js、pages/card-capture）。
//
// 階段 2 的共用接口（負責人 2026-11-16 定）：
// - 2a 負責實作本檔（全螢幕拍卡頁、相冊拖動縮放、截出 2274×1445 JPEG、Android 權限說明）。
// - 2c（牌照詳情頁）只呼叫 openCardCapture，不改本檔。
// - 函數名、參數和回傳格式不可更改；要改先在報告寫明，由負責人決定。

import 'package:flutter/widgets.dart';
import '../shell/page_route.dart';
import 'card_capture_page.dart';

/// 框內卡面連框外一圈（每邊 6%）的固定輸出尺寸，和伺服器 api/src/card-face.js 一致。
const int cardOutW = 2030, cardOutH = 1290;
const double cardMargin = 0.06;
final int cardFullW = (cardOutW * (1 + 2 * cardMargin)).round(); // 2274
final int cardFullH = (cardOutH * (1 + 2 * cardMargin)).round(); // 1445

/// 打開全螢幕對準框，[side] 為 'front' 或 'back'。
///
/// 回傳框內卡面的 JPEG data URL（`data:image/jpeg;base64,...`，2274×1445），
/// 和現有 App `capture.open({ side })` 回傳的 `photo.data` 相同，可直接作為
/// `/plate-assets/:id/card/:side` 的 `image` 送出。用戶取消、用手勢或返回鍵離開時回傳 null。
///
/// 和現有 App 一樣另開一頁全螢幕（蓋住導航列），從右邊滑入；iOS 可從左邊緣右滑返回，安卓返回鍵返回，都當作取消。
Future<String?> openCardCapture(BuildContext context, {required String side}) =>
    Navigator.of(context, rootNavigator: true).push<String?>(PopInRoute<String?>(page: PopInPage<String?>(child: CardCapturePage(side: side == 'back' ? 'back' : 'front'))));
