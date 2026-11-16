// 拍卡頁的四邊標示（階段 2b）：提示文字何時改為「可以拍了」、框線何時重畫、相機畫面怎樣換成找邊用的資料。
// 鏡頭畫面和找邊結果用 CaptureDemo 注入（只供開發和測試）；找邊本身見 card_edges_test.dart。
import 'package:camera/camera.dart';
import 'package:dualplate/business/card_capture_page.dart';
import 'package:dualplate/business/card_edges.dart';
import 'package:dualplate/business/card_stage.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

const aligned = CardEdges(left: true, top: true, right: true, bottom: true, sharpness: 900);
const blurry = CardEdges(left: true, top: true, right: true, bottom: true, sharpness: 20);
const tilted = CardEdges(left: true, top: true, right: true, bottom: true, tilt: 5, sharpness: 900);
const partial = CardEdges(left: true, top: true, sharpness: 900);

// iPhone 17 Pro：402×874，狀態列 62、底部橫條 34
void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(1206, 2622);
  tester.view.devicePixelRatio = 3;
  tester.view.viewPadding = const FakeViewPadding(top: 186, bottom: 102);
  tester.view.padding = const FakeViewPadding(top: 186, bottom: 102);
  addTearDown(tester.view.reset);
}

Future<ValueNotifier<CardEdges>> open(WidgetTester tester, {EdgeMarkStyle style = EdgeMarkStyle.linesAndHint, CardEdges edges = CardEdges.none}) async {
  phone(tester);
  final notifier = ValueNotifier(edges);
  await tester.pumpWidget(WidgetsApp(
    color: C.paper,
    builder: (context, _) => CardCapturePage(side: 'front', markStyle: style, demo: CaptureDemo(preview: const ColoredBox(color: C.ink), edges: notifier)),
  ));
  await tester.pump();
  return notifier;
}

final normalHint = captureHint(camera: true, picked: false, side: 'front');

FramePainter painter(WidgetTester tester) => tester.widgetList<CustomPaint>(find.byType(CustomPaint)).map((p) => p.painter).whereType<FramePainter>().single;

void main() {
  group('提示文字', () {
    testWidgets('未對齊：提示照舊', (tester) async {
      await open(tester);
      expect(find.text(normalHint), findsOneWidget);
      expect(find.text(readyHint), findsNothing);
    });

    testWidgets('四邊都對齊、不歪、清楚：提示改為「可以拍了」', (tester) async {
      await open(tester, edges: aligned);
      expect(find.text(readyHint), findsOneWidget);
      expect(find.text(normalHint), findsNothing);
    });

    testWidgets('「可以拍了」在原來提示的位置（框底下方 18）', (tester) async {
      await open(tester, edges: aligned);
      final f = cardFrame(const Size(402, 874), 62);
      expect(tester.getTopLeft(find.text(readyHint)).dy, f.bottom + CaptureStyle.hintBelow);
    }, variant: TargetPlatformVariant.only(TargetPlatform.iOS)); // iOS 排版：框按全螢幕高度算

    testWidgets('只有部分邊對齊：提示照舊', (tester) async {
      await open(tester, edges: partial);
      expect(find.text(normalHint), findsOneWidget);
    });

    testWidgets('對齊但模糊：提示照舊', (tester) async {
      await open(tester, edges: blurry);
      expect(find.text(normalHint), findsOneWidget);
    });

    testWidgets('對齊但歪超過 3°：提示照舊', (tester) async {
      await open(tester, edges: tilted);
      expect(find.text(normalHint), findsOneWidget);
    });

    testWidgets('樣式「邊線」「四角」不改提示', (tester) async {
      for (final style in [EdgeMarkStyle.lines, EdgeMarkStyle.corners]) {
        await open(tester, style: style, edges: aligned);
        expect(find.text(normalHint), findsOneWidget, reason: style.name);
        expect(find.text(readyHint), findsNothing, reason: style.name);
      }
    });

    testWidgets('對齊後又移開：提示改回原來的', (tester) async {
      final edges = await open(tester, edges: aligned);
      expect(find.text(readyHint), findsOneWidget);
      edges.value = partial;
      await tester.pump();
      expect(find.text(normalHint), findsOneWidget);
      expect(find.text(readyHint), findsNothing);
    });
  });

  group('框線', () {
    testWidgets('找邊結果傳給框線（鏡頭模式）', (tester) async {
      final edges = await open(tester, style: EdgeMarkStyle.corners, edges: partial);
      expect(painter(tester).edges, partial);
      expect(painter(tester).style, EdgeMarkStyle.corners);
      edges.value = aligned;
      await tester.pump();
      expect(painter(tester).edges, aligned);
    });

    test('四邊對齊情況改變時重畫，只是清楚度不同時不重畫', () {
      const f = FrameBox(20, 282, 362, 230);
      expect(const FramePainter(f, edges: partial).shouldRepaint(const FramePainter(f)), isTrue);
      expect(const FramePainter(f, edges: aligned).shouldRepaint(const FramePainter(f, edges: CardEdges(left: true, top: true, right: true, bottom: true, sharpness: 300))), isFalse);
      expect(const FramePainter(f, style: EdgeMarkStyle.corners).shouldRepaint(const FramePainter(f)), isTrue);
    });
  });

  group('相機畫面換成找邊資料（previewFrameFrom）', () {
    PreviewFrame? convert(int w, int h, ImageFormatGroup group, int planes, {int sensor = 90, bool android = true}) => previewFrameFrom(
          group: group,
          width: w,
          height: h,
          planes: [for (var i = 0; i < planes; i++) (bytes: Uint8List(8), rowStride: w, pixelStride: i == 0 ? 1 : 2)],
          sensorOrientation: sensor,
          android: android,
        );

    test('Android 橫向 YUV420：按鏡頭 sensorOrientation 轉', () {
      final frame = convert(1920, 1080, ImageFormatGroup.yuv420, 3)!;
      expect(frame.format, FramePixels.yuv420);
      expect(frame.rotation, 90);
      expect([frame.uprightW, frame.uprightH], [1080, 1920]);
      expect(frame.pixelStrides, [1, 2, 2]);
    });

    test('Android 鏡頭 270°', () {
      expect(convert(1920, 1080, ImageFormatGroup.yuv420, 3, sensor: 270)!.rotation, 270);
    });

    test('iOS 直向 BGRA：不轉', () {
      final frame = convert(1080, 1920, ImageFormatGroup.bgra8888, 1, android: false)!;
      expect(frame.format, FramePixels.bgra8888);
      expect(frame.rotation, 0);
    });

    test('iOS 收到橫向畫面：當作要轉 90°', () {
      expect(convert(1920, 1080, ImageFormatGroup.bgra8888, 1, sensor: 0, android: false)!.rotation, 90);
    });

    test('其他格式（NV21、JPEG）不找邊', () {
      expect(convert(1920, 1080, ImageFormatGroup.nv21, 1), isNull);
      expect(convert(1920, 1080, ImageFormatGroup.jpeg, 1), isNull);
    });
  });
}
