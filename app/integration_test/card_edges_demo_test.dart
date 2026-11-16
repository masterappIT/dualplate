// 即時找卡邊的標示樣式（階段 2b，給管理者選樣式用；不是單元測試）。
// iOS 模擬器沒有鏡頭：用程式畫的「桌面上一張卡」當鏡頭畫面（CaptureDemo，只供開發截圖），
// 找邊結果由正式的 detectInFrame 在同一張圖上算出（和鏡頭畫面走同一條換算），不是手寫的假結果。
// 印出 SHOT:名稱 時由外面截圖，之後等約 2 秒：
//   cd app && flutter test integration_test/card_edges_demo_test.dart -d <裝置> --plain-name 樣式
// 「找邊速度」只在 Android 模擬器（虛擬鏡頭）跑：開真正的拍卡頁 20 秒，除錯版每 5 秒印出每秒找邊次數。
// 不連伺服器、不改任何資料；畫面上沒有帳號或號碼。
import 'package:dualplate/business/card_capture.dart';
import 'package:dualplate/business/card_capture_page.dart';
import 'package:dualplate/business/card_edges.dart';
import 'package:dualplate/business/card_stage.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:integration_test/integration_test.dart';

/// 鏡頭畫面（[w]×[h] 像素，和畫面同比例）：灰色桌面（和 2a 示意相片同色）上一張淺黃卡、幾行深色字條、一個紅印（不是真卡，沒有號碼）。
/// [card] 是卡在畫面上的範圍（畫面座標），[scale] 是像素對畫面點的倍數。
img.Image demoScene(int w, int h, double scale, Rect card) {
  final image = img.Image(width: w, height: h);
  var seed = 11;
  for (final p in image) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    final n = seed % 9 - 4 + ((p.y ~/ 6) % 5 == 0 ? -6 : 0);
    p.setRgb(96 + n, 100 + n, 104 + n);
  }
  int x(double v) => (v * scale).round();
  int y(double v) => (v * scale).round();
  final l = card.left, t = card.top, cw = card.width, ch = card.height;
  img.fillRect(image, x1: x(l), y1: y(t), x2: x(l + cw) - 1, y2: y(t + ch) - 1, color: img.ColorRgb8(238, 232, 205), radius: 6 * scale);
  for (var i = 0; i < 8; i++) {
    final top = t + ch * (0.12 + i * 0.09);
    img.fillRect(image, x1: x(l + cw * 0.08), y1: y(top), x2: x(l + cw * (0.38 + (i * 0.173) % 0.3)), y2: y(top + ch * 0.025), color: img.ColorRgb8(60, 60, 60));
  }
  img.fillRect(image, x1: x(l + cw * 0.72), y1: y(t + ch * 0.15), x2: x(l + cw * 0.9), y2: y(t + ch * 0.45), color: img.ColorRgb8(180, 60, 50));
  return image;
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('樣式：三款標示 × 未對齊、部分對齊、全部對齊', (tester) async {
    Future<void> wait(int ms) => tester.pump(Duration(milliseconds: ms));
    late Size box;
    late double safeTop;
    await tester.pumpWidget(WidgetsApp(
      color: C.paper,
      builder: (context, _) {
        final media = MediaQuery.of(context);
        box = media.size;
        safeTop = media.viewPadding.top;
        return const SizedBox.expand();
      },
    ));
    await wait(300);
    final frame = cardFrame(box, safeTop);
    final f = Rect.fromLTWH(frame.left, frame.top, frame.width, frame.height);
    // 三個狀態：卡在畫面上的位置
    final states = <String, Rect>{
      'none': Rect.fromLTWH(f.left + 38, f.top + 46, f.width * 0.72, f.height * 0.72), // 卡小、偏右下
      'partial': Rect.fromLTRB(f.left, f.top, f.right - f.width * 0.12, f.bottom - f.height * 0.14), // 左上對齊
      'all': f, // 四邊都對齊
    };
    const scale = 2.0;
    final w = (box.width * scale).round(), h = (box.height * scale).round();
    final results = <String, (Uint8List, CardEdges)>{};
    for (final MapEntry(key: name, value: card) in states.entries) {
      final scene = demoScene(w, h, scale, card);
      final rgb = scene.getBytes(order: img.ChannelOrder.rgb);
      final edges = detectInFrame(PreviewFrame.rgb(rgb, w, h), shootRect(box, w, h, frame));
      // ignore: avoid_print
      print('EDGES:$name $edges');
      results[name] = (img.encodePng(scene, level: 1), edges);
    }
    expect(results['none']!.$2.left || results['none']!.$2.top || results['none']!.$2.right || results['none']!.$2.bottom, isFalse);
    expect([results['partial']!.$2.left, results['partial']!.$2.top, results['partial']!.$2.right, results['partial']!.$2.bottom], [true, true, false, false]);
    expect(results['all']!.$2.ready, isTrue);

    for (final style in EdgeMarkStyle.values) {
      for (final MapEntry(key: name, value: (png, edges)) in results.entries) {
        final notifier = ValueNotifier(edges);
        await tester.pumpWidget(WidgetsApp(
          key: ValueKey('${style.name}-$name'),
          color: C.paper,
          debugShowCheckedModeBanner: false,
          builder: (context, _) => CardCapturePage(
            side: 'front',
            markStyle: style,
            demo: CaptureDemo(preview: Image.memory(png, fit: BoxFit.fill, width: box.width, height: box.height, gaplessPlayback: true), edges: notifier),
          ),
        ));
        await wait(1200);
        // ignore: avoid_print
        print('SHOT:${style.name}-$name');
        await wait(2500);
      }
    }
  });

  testWidgets('找邊速度：Android 虛擬鏡頭 20 秒', (tester) async {
    late BuildContext host;
    await tester.pumpWidget(WidgetsApp(
      color: C.paper,
      pageRouteBuilder: <T>(settings, builder) => PageRouteBuilder<T>(settings: settings, pageBuilder: (context, _, _) => builder(context)),
      home: Builder(builder: (context) {
        host = context;
        return const ColoredBox(color: C.paper, child: SizedBox.expand());
      }),
    ));
    await tester.pump(const Duration(milliseconds: 500));
    openCardCapture(host, side: 'front');
    for (var i = 0; i < 260; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    // ignore: avoid_print
    print('SHOT:android-rate');
    await tester.pump(const Duration(seconds: 2));
  }, skip: defaultTargetPlatform != TargetPlatform.android);
}
