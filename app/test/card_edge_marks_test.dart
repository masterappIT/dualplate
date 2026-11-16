// 拍卡頁的四邊標示和自動拍（階段 2b）：提示何時改為「可以拍了」、框線何時重畫、何時自動拍、拍後停止找邊、相機畫面怎樣換成找邊資料。
// 鏡頭畫面、找邊結果和拍照用 CaptureDemo 注入（只供開發和測試）；找邊本身見 card_edges_test.dart。
// 自動拍用計時器，測試用假時鐘（tester.pump）控制時間。
import 'package:camera/camera.dart';
import 'package:dualplate/business/card_capture_page.dart';
import 'package:dualplate/business/card_edges.dart';
import 'package:dualplate/business/card_stage.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

const ready = CardEdges(left: true, top: true, right: true, bottom: true, sharpness: 900);
const blurry = CardEdges(left: true, top: true, right: true, bottom: true, sharpness: 20);
const tilted = CardEdges(left: true, top: true, right: true, bottom: true, tilt: 5, sharpness: 900);
const partial = CardEdges(left: true, top: true, sharpness: 900);
const shotData = 'data:image/jpeg;base64,AAAA';

// iPhone 17 Pro：402×874，狀態列 62、底部橫條 34
void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(1206, 2622);
  tester.view.devicePixelRatio = 3;
  tester.view.viewPadding = const FakeViewPadding(top: 186, bottom: 102);
  tester.view.padding = const FakeViewPadding(top: 186, bottom: 102);
  addTearDown(tester.view.reset);
}

// 測試用的拍卡頁：記下拍了幾次、找邊有沒有被停止、頁面回傳甚麼
class Rig {
  final feed = ManualEdgeFeed();
  final results = <String?>[];
  var shots = 0;
  bool failShot = false;

  Future<String> takePicture() async {
    shots++;
    if (failShot) throw StateError('拍照失敗');
    return shotData;
  }

  Future<void> send(WidgetTester tester, CardEdges e, [Duration then = Duration.zero]) async {
    feed.add(e);
    await tester.pump(then);
  }
}

Future<Rig> open(WidgetTester tester, {CardEdges? first, ImagePicker? picker}) async {
  phone(tester);
  final rig = Rig();
  await tester.pumpWidget(WidgetsApp(
    color: C.paper,
    pageRouteBuilder: <T>(settings, builder) => PageRouteBuilder<T>(settings: settings, pageBuilder: (context, _, _) => builder(context)),
    home: Builder(
      builder: (context) => GestureDetector(
        onTap: () async => rig.results.add(await Navigator.of(context).push<String?>(PageRouteBuilder(
          pageBuilder: (_, _, _) => CardCapturePage(side: 'front', picker: picker, demo: CaptureDemo(preview: const ColoredBox(color: C.ink), feed: rig.feed, takePicture: rig.takePicture)),
        ))),
        child: const ColoredBox(color: C.paper, child: Center(child: Text('打開'))),
      ),
    ),
  ));
  await tester.tap(find.text('打開'));
  await tester.pumpAndSettle();
  if (first != null) await rig.send(tester, first);
  return rig;
}

final normalHint = captureHint(camera: true, picked: false, side: 'front');

FramePainter painter(WidgetTester tester) => tester.widgetList<CustomPaint>(find.byType(CustomPaint)).map((p) => p.painter).whereType<FramePainter>().single;

// 預設按 iOS 排版（Flutter 測試預設是安卓平台）
void testIos(String name, WidgetTesterCallback body) => testWidgets(name, body, variant: TargetPlatformVariant.only(TargetPlatform.iOS));

class _Picker extends ImagePicker {
  _Picker(this.bytes);
  final Uint8List bytes;
  @override
  Future<XFile?> pickImage({required ImageSource source, double? maxWidth, double? maxHeight, int? imageQuality, CameraDevice preferredCameraDevice = CameraDevice.rear, bool requestFullMetadata = true}) async =>
      XFile.fromData(bytes, mimeType: 'image/png');
}

void main() {
  test('自動拍要維持 600 毫秒', () {
    expect(autoShotHold, const Duration(milliseconds: 600));
  });

  group('提示文字', () {
    testIos('未對齊：提示照舊', (tester) async {
      await open(tester, first: CardEdges.none);
      expect(find.text(normalHint), findsOneWidget);
      expect(find.text(readyHint), findsNothing);
    });

    testIos('四邊都對齊、不歪、清楚：提示改為「可以拍了」', (tester) async {
      await open(tester, first: ready);
      expect(find.text(readyHint), findsOneWidget);
      expect(find.text(normalHint), findsNothing);
    });

    testIos('「可以拍了」在原來提示的位置（框底下方 18）', (tester) async {
      await open(tester, first: ready);
      final f = cardFrame(const Size(402, 874), 62);
      expect(tester.getTopLeft(find.text(readyHint)).dy, f.bottom + CaptureStyle.hintBelow);
    });

    testIos('只有部分邊對齊：提示照舊', (tester) async {
      await open(tester, first: partial);
      expect(find.text(normalHint), findsOneWidget);
    });

    testIos('對齊但模糊：提示照舊', (tester) async {
      await open(tester, first: blurry);
      expect(find.text(normalHint), findsOneWidget);
    });

    testIos('對齊但歪超過 3°：提示照舊', (tester) async {
      await open(tester, first: tilted);
      expect(find.text(normalHint), findsOneWidget);
    });

    testIos('對齊後又移開：提示改回原來的', (tester) async {
      final rig = await open(tester, first: ready);
      expect(find.text(readyHint), findsOneWidget);
      await rig.send(tester, partial);
      expect(find.text(normalHint), findsOneWidget);
      expect(find.text(readyHint), findsNothing);
    });
  });

  group('框線', () {
    testIos('找邊結果傳給框線（鏡頭模式）', (tester) async {
      final rig = await open(tester, first: partial);
      expect(painter(tester).edges, partial);
      await rig.send(tester, ready);
      expect(painter(tester).edges, ready);
    });

    test('四邊對齊情況改變時重畫，只是清楚度不同時不重畫', () {
      const f = FrameBox(20, 282, 362, 230);
      expect(const FramePainter(f, edges: partial).shouldRepaint(const FramePainter(f)), isTrue);
      expect(const FramePainter(f, edges: ready).shouldRepaint(const FramePainter(f, edges: CardEdges(left: true, top: true, right: true, bottom: true, sharpness: 300))), isFalse);
    });
  });

  group('自動拍', () {
    testIos('未對齊不拍', (tester) async {
      final rig = await open(tester);
      for (var i = 0; i < 30; i++) {
        await rig.send(tester, partial, const Duration(milliseconds: 100));
      }
      expect(rig.shots, 0);
      expect(rig.results, isEmpty);
    });

    testIos('傾斜超過 3° 不拍', (tester) async {
      final rig = await open(tester);
      for (var i = 0; i < 30; i++) {
        await rig.send(tester, tilted, const Duration(milliseconds: 100));
      }
      expect(rig.shots, 0);
    });

    testIos('不清楚不拍', (tester) async {
      final rig = await open(tester);
      for (var i = 0; i < 30; i++) {
        await rig.send(tester, blurry, const Duration(milliseconds: 100));
      }
      expect(rig.shots, 0);
    });

    testIos('維持時間不夠不拍：可以拍了 500 毫秒後中斷一張，重新計時', (tester) async {
      final rig = await open(tester);
      for (var round = 0; round < 3; round++) {
        await rig.send(tester, ready, const Duration(milliseconds: 500));
        await rig.send(tester, partial, const Duration(milliseconds: 100));
      }
      await tester.pump(const Duration(seconds: 2));
      expect(rig.shots, 0);
    });

    testIos('全部符合並維持 600 毫秒：自動拍一次，回傳截圖', (tester) async {
      final rig = await open(tester);
      await rig.send(tester, ready, const Duration(milliseconds: 599));
      expect(rig.shots, 0);
      await tester.pump(const Duration(milliseconds: 2));
      expect(rig.shots, 1);
      await tester.pumpAndSettle();
      expect(rig.results, [shotData]);
    });

    testIos('連續送來的合格結果不會延後計時', (tester) async {
      final rig = await open(tester);
      for (var i = 0; i < 6; i++) {
        await rig.send(tester, ready, const Duration(milliseconds: 100));
      }
      await tester.pump(const Duration(milliseconds: 10));
      expect(rig.shots, 1);
    });

    testIos('拍後停止找邊（image stream），之後再合格也不再自動拍', (tester) async {
      final rig = await open(tester)..failShot = true; // 拍照失敗時留在頁面上，才看得到之後會不會再拍
      await rig.send(tester, ready, const Duration(milliseconds: 700));
      expect(rig.shots, 1);
      expect(rig.feed.stopped, isTrue);
      for (var i = 0; i < 20; i++) {
        await rig.send(tester, ready, const Duration(milliseconds: 100));
      }
      expect(rig.shots, 1);
      expect(rig.results, isEmpty);
      expect(find.text(readyHint), findsNothing); // 停止後不再標示
    });

    testIos('按快門照舊：未對齊時按下即拍，停止找邊', (tester) async {
      final rig = await open(tester, first: partial);
      await tester.tap(find.byKey(const ValueKey('capture-shutter')));
      await tester.pumpAndSettle();
      expect(rig.shots, 1);
      expect(rig.feed.stopped, isTrue);
      expect(rig.results, [shotData]);
    });

    testIos('拍照失敗後仍可按快門再拍', (tester) async {
      final rig = await open(tester)..failShot = true;
      await rig.send(tester, ready, const Duration(milliseconds: 700));
      expect(rig.shots, 1);
      rig.failShot = false;
      await tester.tap(find.byKey(const ValueKey('capture-shutter')));
      await tester.pumpAndSettle();
      expect(rig.shots, 2);
      expect(rig.results, [shotData]);
    });

    testIos('合格計時中按 ✕ 離開：停止找邊，不會再拍', (tester) async {
      final rig = await open(tester, first: ready);
      await tester.tap(find.byKey(const ValueKey('capture-close')));
      await tester.pumpAndSettle();
      expect(rig.feed.stopped, isTrue);
      await tester.pump(const Duration(seconds: 2));
      expect(rig.shots, 0);
      expect(rig.results, [null]);
    });

    testIos('頁面被移除（例如系統返回）：停止找邊', (tester) async {
      final rig = await open(tester, first: partial);
      await tester.pumpWidget(const SizedBox());
      expect(rig.feed.stopped, isTrue);
    });

    testIos('改為從相冊選：停止找邊，相片模式不會自動拍', (tester) async {
      final rig = await open(tester, picker: _Picker(img.encodePng(img.Image(width: 80, height: 60))));
      await tester.tap(find.byKey(const ValueKey('capture-album')));
      await tester.runAsync(() async {
        for (var i = 0; i < 200 && find.text('重選').evaluate().isEmpty; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
      });
      expect(find.text('重選'), findsOneWidget);
      expect(rig.feed.stopped, isTrue);
      rig.feed.add(ready); // 已停止：送不進去
      await tester.pump(const Duration(seconds: 2));
      expect(rig.shots, 0);
      expect(find.text(readyHint), findsNothing);
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
