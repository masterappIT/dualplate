// 在模擬器上自動操作拍批文卡頁，給截圖和並排對照用（階段 2a，不是單元測試）。
// 印出 SHOT:名稱 時由外面的指令截圖，之後等約 2 秒（安卓系統權限框由外面按「允許」）：
//   cd app && flutter test integration_test/card_capture_demo_test.dart -d <裝置>
// iOS 模擬器沒有鏡頭：走開不了鏡頭和相冊兩條路。安卓模擬器有虛擬鏡頭：先走申請權限和鏡頭預覽。
// 「選了相片」用程式畫的示意卡（不用實卡樣本）；不連伺服器、不改任何資料。
import 'dart:async';
import 'package:camera/camera.dart';
import 'package:dualplate/business/card_capture.dart';
import 'package:dualplate/business/card_capture_page.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';
import 'package:integration_test/integration_test.dart';

// 示意相片：灰色桌面上一張淡黃色、帶幾行深色字條的卡，略為歪斜偏左
Uint8List demoPhoto() {
  final image = img.Image(width: 3000, height: 4000);
  img.fill(image, color: img.ColorRgb8(96, 100, 104));
  img.fillRect(image, x1: 300, y1: 1300, x2: 2500, y2: 2700, color: img.ColorRgb8(238, 232, 205), radius: 60);
  for (var i = 0; i < 8; i++) {
    final y = 1450 + i * 150;
    img.fillRect(image, x1: 450, y1: y, x2: 450 + 700 + (i * 173) % 900, y2: y + 50, color: img.ColorRgb8(60, 60, 60));
  }
  img.fillRect(image, x1: 1900, y1: 1450, x2: 2350, y2: 2000, color: img.ColorRgb8(180, 60, 50));
  return img.encodeJpg(image, quality: 85);
}

class DemoPicker extends ImagePicker {
  DemoPicker(this.bytes);
  final Uint8List bytes;
  @override
  Future<XFile?> pickImage({required ImageSource source, double? maxWidth, double? maxHeight, int? imageQuality, CameraDevice preferredCameraDevice = CameraDevice.rear, bool requestFullMetadata = true}) async => XFile.fromData(bytes, mimeType: 'image/jpeg');
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('拍批文卡頁各狀態', (tester) async {
    Future<void> wait(int ms) => tester.pump(Duration(milliseconds: ms));
    Future<void> shot(String name, {int before = 800, int after = 2500}) async {
      await wait(before);
      // ignore: avoid_print
      print('SHOT:$name');
      await wait(after);
    }

    Future<void> until(Finder f, {int seconds = 40}) async {
      for (var i = 0; i < seconds * 10 && f.evaluate().isEmpty; i++) {
        await wait(100);
      }
    }

    final android = defaultTargetPlatform == TargetPlatform.android;
    final photo = demoPhoto();
    String? result = 'unset';
    late BuildContext host;
    await tester.pumpWidget(WidgetsApp(
      color: C.paper,
      pageRouteBuilder: <T>(settings, builder) => PageRouteBuilder<T>(settings: settings, pageBuilder: (context, _, _) => builder(context)),
      home: Builder(builder: (context) {
        host = context;
        return const ColoredBox(color: C.paper, child: SizedBox.expand());
      }),
    ));
    await wait(500);

    // 1. 真正的入口 openCardCapture（2c 用的）：iOS 模擬器沒有鏡頭 → 對準批文卡；安卓先申請相機權限、開虛擬鏡頭
    final done = openCardCapture(host, side: 'front').then((r) => result = r);
    if (android) {
      await shot('android-camera-permission', before: 2500, after: 6000); // 用途說明卡和系統權限框；外面按「允許」
      await until(find.byKey(const ValueKey('capture-shutter')));
      await shot('android-camera-preview', before: 3000);
      await tester.tap(find.byKey(const ValueKey('capture-shutter')));
      await done;
      // ignore: avoid_print
      print('RESULT:shoot ${result == null ? 'null' : '${result!.substring(0, 23)} ${result!.length}'}');
    } else {
      await until(find.text('對準批文卡'));
      await shot('ios-no-camera-front');
      await tester.tap(find.byKey(const ValueKey('capture-close')));
      await done;
      // ignore: avoid_print
      print('RESULT:close $result');
    }
    await wait(800);

    // 2. 鏡頭還在開時的畫面（快門、從相冊選），背面
    Future<List<CameraDescription>> never() => Completer<List<CameraDescription>>().future;
    final page = Navigator.of(host).push<String?>(PageRouteBuilder(pageBuilder: (_, _, _) => CardCapturePage(side: 'back', cameras: never, picker: DemoPicker(photo))));
    await wait(1200);
    await shot('camera-mode-back');

    // 3. 從相冊選了相片：拖動縮放狀態
    await tester.tap(find.byKey(const ValueKey('capture-album')));
    await until(find.text('確認'));
    await shot('album-picked-back');

    // 4. 拖動、雙指放大之後
    final a = await tester.startGesture(const Offset(160, 420), pointer: 1);
    final b = await tester.startGesture(const Offset(240, 420), pointer: 2);
    for (var i = 0; i < 10; i++) {
      await a.moveBy(const Offset(-4, 2));
      await b.moveBy(const Offset(4, 2));
      await wait(16);
    }
    await a.up();
    await b.up();
    await shot('album-zoomed-back');

    // 5. 確認：截出 2274×1445
    await tester.tap(find.text('確認'));
    final cropped = await page;
    final jpeg = cropped == null ? null : img.decodeJpg(Uint8List.fromList(UriData.parse(cropped).contentAsBytes()));
    // ignore: avoid_print
    print('RESULT:confirm ${jpeg == null ? 'null' : '${jpeg.width}x${jpeg.height}'}');
    expect([jpeg?.width, jpeg?.height], [2274, 1445]);
    await wait(800);

    // 6. 開不了鏡頭（正面、背面兩個標籤都看一次）
    Future<List<CameraDescription>> none() async => const [];
    final again = Navigator.of(host).push<String?>(PageRouteBuilder(pageBuilder: (_, _, _) => CardCapturePage(side: 'back', cameras: none, picker: DemoPicker(photo))));
    await until(find.text('拍照'));
    await shot('no-camera-back');
    await tester.tap(find.text('拍照'));
    await until(find.text('重選'));
    await shot('picked-from-camera-back');
    await tester.tap(find.byKey(const ValueKey('capture-close')));
    // ignore: avoid_print
    print('RESULT:cancel ${await again}');
    await wait(800);
  });
}
