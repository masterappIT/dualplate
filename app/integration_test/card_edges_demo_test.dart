// 即時找卡邊和自動拍（階段 2b）在模擬器上的示範，給截圖和錄影用（不是單元測試）。
// 模擬器的鏡頭拍不到卡（iOS 沒有鏡頭；Android 虛擬鏡頭是一個虛擬客廳）：用程式畫的「桌面上一張卡」當鏡頭畫面
// （CaptureDemo，只供開發），每一張的找邊結果由正式的 detectInFrame 在同一張圖上算出（和鏡頭畫面走同一條換算），
// 自動拍的計時、停止找邊、截圖都是正式流程；只有「拍照」改為截取當時的示意畫面。
//   cd app && flutter test integration_test/card_edges_demo_test.dart -d <裝置> --plain-name <狀態｜錄影｜找邊速度>
// 印出 SHOT:名稱 時由外面截圖；REC:start／REC:stop 時由外面開始、停止錄影。
// 「找邊速度」只在 Android 模擬器跑：開真正的拍卡頁 20 秒，除錯版每 5 秒印出每秒找邊次數。
// 不連伺服器、不改任何資料；畫面上沒有帳號或號碼。
import 'dart:convert';
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
/// [card] 是卡在畫面上的範圍（畫面座標），[scale] 是像素對畫面點的倍數，[blur] 是高斯模糊半徑（像素）。
img.Image demoScene(int w, int h, double scale, Rect card, {int blur = 0}) {
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
  return blur > 0 ? img.gaussianBlur(image, radius: blur) : image;
}

/// 拍卡頁的畫面範圍（和 CardCapturePage.build 相同：安卓不含底部導航列）
Size pageBox(MediaQueryData media) =>
    Size(media.size.width, media.size.height - (defaultTargetPlatform == TargetPlatform.android ? media.viewPadding.bottom : 0));

/// 示意鏡頭的一張畫面：圖、找邊結果、截圖用的像素
class DemoFrame {
  DemoFrame(this.png, this.edges, this.rgba, this.w, this.h);
  final Uint8List png, rgba;
  final CardEdges edges;
  final int w, h;
}

/// 示意畫面和真鏡頭一樣是 3:4（直向），按 cover 鋪滿畫面、左右超出畫面。
/// （畫面和鏡頭同比例時，框外擴 6% 的範圍在 411pt 寬的安卓手機上會超出畫面約 2pt，那部分當白色，背景色門檻被拉高而找不到邊；
/// 真鏡頭的畫面比螢幕寬，不會這樣。）[card] 是畫面座標。
DemoFrame demoFrame(Size box, FrameBox frame, double scale, Rect card, {int blur = 0}) {
  final h = (box.height * scale).round(), w = (h * 3 / 4).round();
  final ox = (w / scale - box.width) / 2;
  final scene = demoScene(w, h, scale, card.shift(Offset(ox, 0)), blur: blur);
  final edges = detectInFrame(PreviewFrame.rgb(scene.getBytes(order: img.ChannelOrder.rgb), w, h), shootRect(box, w, h, frame));
  return DemoFrame(img.encodePng(scene, level: 1), edges, scene.convert(numChannels: 4).getBytes(order: img.ChannelOrder.rgba), w, h);
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  Future<(Size, FrameBox)> measure(WidgetTester tester) async {
    late MediaQueryData media;
    await tester.pumpWidget(WidgetsApp(
      color: C.paper,
      builder: (context, _) {
        media = MediaQuery.of(context);
        return const SizedBox.expand();
      },
    ));
    await tester.pump(const Duration(milliseconds: 300));
    final box = pageBox(media);
    return (box, cardFrame(box, media.viewPadding.top));
  }

  testWidgets('狀態：未對齊、部分對齊、全部對齊', (tester) async {
    Future<void> wait(int ms) => tester.pump(Duration(milliseconds: ms));
    final (box, frame) = await measure(tester);
    final f = Rect.fromLTWH(frame.left, frame.top, frame.width, frame.height);
    final states = <String, Rect>{
      'none': Rect.fromLTWH(f.left + 38, f.top + 46, f.width * 0.72, f.height * 0.72), // 卡小、偏右下
      'partial': Rect.fromLTRB(f.left, f.top, f.right - f.width * 0.12, f.bottom - f.height * 0.14), // 左上對齊
      'all': f, // 四邊都對齊
    };
    for (final MapEntry(key: name, value: card) in states.entries) {
      final d = demoFrame(box, frame, 2, card);
      // ignore: avoid_print
      print('EDGES:$name ${d.edges}');
      final feed = ManualEdgeFeed();
      await tester.pumpWidget(WidgetsApp(
        key: ValueKey(name),
        color: C.paper,
        debugShowCheckedModeBanner: false,
        builder: (context, _) => CardCapturePage(side: 'front', demo: CaptureDemo(preview: Image.memory(d.png, fit: BoxFit.cover, width: box.width, height: box.height), feed: feed)),
      ));
      await wait(800);
      feed.add(d.edges);
      await wait(400);
      // ignore: avoid_print
      print('SHOT:$name');
      await wait(2500);
    }
  });

  testWidgets('錄影：卡移入框內、對齊、模糊、清楚後自動拍', (tester) async {
    Future<void> wait(int ms) => tester.pump(Duration(milliseconds: ms));
    final (box, frame) = await measure(tester);
    final f = Rect.fromLTWH(frame.left, frame.top, frame.width, frame.height);
    Rect lerp(Rect a, Rect b, double t) => Rect.lerp(a, b, t)!;
    final start = Rect.fromLTWH(f.left + 60, f.top + 70, f.width * 0.66, f.height * 0.66);
    final partial = Rect.fromLTRB(f.left, f.top, f.right - f.width * 0.14, f.bottom - f.height * 0.16);
    // 每一步：卡的位置、模糊、停留毫秒（0 = 一直送到自動拍為止）
    final steps = <(Rect, int, int)>[
      for (var i = 0; i <= 8; i++) (lerp(start, partial, i / 8), 0, 240), // 未對齊 → 左上對齊
      (partial, 0, 1200),
      for (var i = 1; i <= 5; i++) (lerp(partial, f, i / 5), 3, 240), // 對齊但模糊（手在動）
      (f, 3, 1500),
      (f, 0, 0), // 清楚：600 毫秒後自動拍
    ];
    const scale = 1.5;
    final frames = [for (final (card, blur, _) in steps) demoFrame(box, frame, scale, card, blur: blur)];
    for (final (i, d) in frames.indexed) {
      // ignore: avoid_print
      print('EDGES:$i ${d.edges}');
    }
    expect(frames.last.edges.ready, isTrue);
    expect(frames[steps.length - 2].edges.aligned, isTrue);
    expect(frames[steps.length - 2].edges.sharp, isFalse);

    final current = ValueNotifier(frames.first);
    final feed = ManualEdgeFeed();
    var shots = 0;
    String? result;
    late BuildContext host;
    await tester.pumpWidget(WidgetsApp(
      color: C.paper,
      debugShowCheckedModeBanner: false,
      pageRouteBuilder: <T>(settings, builder) => PageRouteBuilder<T>(settings: settings, pageBuilder: (context, _, _) => builder(context)),
      home: Builder(builder: (context) {
        host = context;
        return const ColoredBox(color: C.ink, child: SizedBox.expand());
      }),
    ));
    await wait(300);
    Navigator.of(host)
        .push<String?>(PageRouteBuilder(
          pageBuilder: (_, _, _) => CardCapturePage(
            side: 'front',
            demo: CaptureDemo(
              preview: ValueListenableBuilder<DemoFrame>(
                valueListenable: current,
                builder: (_, d, _) => Image.memory(d.png, fit: BoxFit.cover, width: box.width, height: box.height, gaplessPlayback: true),
              ),
              feed: feed,
              // 拍照：截取當時的示意畫面，和快門一樣截出 2274×1445 JPEG
              takePicture: () {
                final d = current.value;
                shots++;
                return cropCardInBackground(d.rgba, d.w, d.h, shootRect(box, d.w, d.h, frame));
              },
            ),
          ),
        ))
        .then((r) => result = r);
    await wait(800);
    // ignore: avoid_print
    print('REC:start');
    await wait(1500);
    for (final (i, (_, _, ms)) in steps.indexed) {
      current.value = frames[i];
      final sends = ms == 0 ? 20 : (ms / 120).ceil();
      for (var k = 0; k < sends && result == null; k++) {
        feed.add(frames[i].edges); // 像鏡頭一樣每 120 毫秒送一次結果
        await wait(120);
      }
    }
    for (var k = 0; k < 40 && result == null; k++) {
      await wait(100);
    }
    expect(shots, 1);
    expect(result, startsWith('data:image/jpeg;base64,'));
    // 拍下後回到上一頁，顯示截出的卡面（2274×1445）
    await tester.pumpWidget(WidgetsApp(
      color: C.paper,
      debugShowCheckedModeBanner: false,
      builder: (_, _) => ColoredBox(
        color: C.ink,
        child: Center(child: Padding(padding: const EdgeInsets.all(20), child: Image.memory(base64Decode(result!.split(',').last)))),
      ),
    ));
    await wait(2500);
    // ignore: avoid_print
    print('REC:stop');
    await wait(1500);
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
