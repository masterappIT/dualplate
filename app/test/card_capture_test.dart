// 拍批文卡頁（lib/business/card_capture_page.dart、card_capture.dart）的各狀態和操作。
// 測試環境沒有鏡頭和相冊：鏡頭由 cameras 參數控制，相冊用假的 ImagePicker 回傳測試圖（不用實卡樣本）。
import 'dart:async';
import 'dart:convert';
import 'package:camera/camera.dart';
import 'package:dualplate/business/card_capture.dart';
import 'package:dualplate/business/card_capture_page.dart';
import 'package:dualplate/business/card_stage.dart';
import 'package:dualplate/business/pick_image.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

class FakePicker extends ImagePicker {
  FakePicker(this.bytes);
  Uint8List? bytes;
  final calls = <ImageSource>[];
  @override
  Future<XFile?> pickImage({required ImageSource source, double? maxWidth, double? maxHeight, int? imageQuality, CameraDevice preferredCameraDevice = CameraDevice.rear, bool requestFullMetadata = true}) async {
    calls.add(source);
    final b = bytes;
    return b == null ? null : XFile.fromData(b, mimeType: 'image/png');
  }
}

// 測試圖：800×600，左半紅、右半藍
Uint8List testPhoto() {
  final image = img.Image(width: 800, height: 600);
  for (final p in image) {
    p.setRgb(p.x < 400 ? 255 : 0, 0, p.x < 400 ? 0 : 255);
  }
  return img.encodePng(image);
}

Future<List<CameraDescription>> noCamera() async => const [];
// 鏡頭一直開不好（不建立計時器，測試結束時沒有遺留）
Future<List<CameraDescription>> slowCamera() => Completer<List<CameraDescription>>().future;

// 預設按 iOS 排版（Flutter 測試預設是安卓平台）；安卓的差別另寫測試
// （測試包裝）
void testIos(String name, WidgetTesterCallback body) => testWidgets(name, body, variant: TargetPlatformVariant.only(TargetPlatform.iOS));

// iPhone 17 Pro：402×874，狀態列 62、底部橫條 34
void phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(1206, 2622);
  tester.view.devicePixelRatio = 3;
  tester.view.viewPadding = const FakeViewPadding(top: 186, bottom: 102);
  tester.view.padding = const FakeViewPadding(top: 186, bottom: 102);
  addTearDown(tester.view.reset);
}

// 從一頁按按鈕打開拍卡頁，結果記在 results
class Host extends StatelessWidget {
  const Host({super.key, required this.page, required this.results});
  final Widget Function() page;
  final List<String?> results;
  @override
  Widget build(BuildContext context) => WidgetsApp(
        color: C.paper,
        pageRouteBuilder: <T>(settings, builder) => PageRouteBuilder<T>(settings: settings, pageBuilder: (context, _, _) => builder(context)),
        home: Builder(
          builder: (context) => GestureDetector(
            onTap: () async => results.add(await Navigator.of(context).push<String?>(PageRouteBuilder(pageBuilder: (_, _, _) => page()))),
            child: const ColoredBox(color: C.paper, child: Center(child: Text('打開'))),
          ),
        ),
      );
}

Future<void> openPage(WidgetTester tester, Widget Function() page, List<String?> results) async {
  phone(tester);
  await tester.pumpWidget(Host(page: page, results: results));
  await tester.tap(find.text('打開'));
  await tester.pumpAndSettle();
}

// 讀相片、截圖、平台通道的回覆要真的等（不受假時鐘控制）：等到 [until] 出現為止，最多約 4 秒
Future<void> waitFor(WidgetTester tester, Finder until) async {
  await tester.runAsync(() async {
    for (var i = 0; i < 200 && until.evaluate().isEmpty; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await tester.pump();
    }
  });
  await tester.pump();
}

// 按下後等一會（沒有指定等甚麼時固定等約 1 秒）
Future<void> tapAndWait(WidgetTester tester, Finder finder, {Finder? until}) async {
  await tester.tap(finder);
  if (until != null) return waitFor(tester, until);
  await tester.runAsync(() async {
    for (var i = 0; i < 50; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      await tester.pump();
    }
  });
  await tester.pump();
}

Matrix4 photoTransform(WidgetTester tester) => tester.widget<Transform>(find.byKey(const ValueKey('capture-photo'))).transform;

void main() {
  group('提示文字（逐字照 CardCapture.vue 的 App 版）', () {
    test('鏡頭模式', () {
      expect(captureHint(camera: true, picked: false, side: 'front'), '把批文卡正面對準框內，四角對齊框線\n光線充足、避免反光');
      expect(captureHint(camera: true, picked: false, side: 'back'), '把批文卡背面對準框內，四角對齊框線\n光線充足、避免反光');
    });
    test('選了相片', () {
      expect(captureHint(camera: false, picked: true, side: 'front'), '雙指縮放、拖動相片，讓卡面對齊框線\n框外的部分不會保存');
    });
    test('開不了鏡頭', () {
      expect(captureHint(camera: false, picked: false, side: 'back'), '無法開啟鏡頭\n請按下面「拍照」或「從相冊選」，拍一張批文卡背面相片');
    });
  });

  group('安卓權限說明文字（照 pick-image.js）', () {
    test('申請時的用途說明', () {
      expect(permissionTips[PhotoSource.camera], (title: '相機權限使用說明', text: '用來拍攝批文卡、證件或車輛相片，用於你正在填寫的資料。'));
      expect(permissionTips[PhotoSource.album], (title: '相片權限使用說明', text: '用來選擇批文卡、證件或車輛相片，只會讀取你選的相片。'));
    });
    test('被拒後的提示', () {
      expect(deniedTips[PhotoSource.camera], (title: '未取得相機權限', text: '如要拍照，請到手機「設定 › 應用程式 › 跨境車牌管家 › 權限」開啟相機。'));
      expect(deniedTips[PhotoSource.album], (title: '未取得相片權限', text: '如要選相片，請到手機「設定 › 應用程式 › 跨境車牌管家 › 權限」開啟相片。'));
    });
  });

  testIos('說明卡位置和高度照 pick-image.js 估算：狀態列下 8、左右 12、卡高 54 + 行數 × 21', (tester) async {
    phone(tester);
    await tester.pumpWidget(const Directionality(textDirection: TextDirection.ltr, child: Stack(children: [PermissionCard(tip: (title: '相機權限使用說明', text: '用來拍攝批文卡、證件或車輛相片，用於你正在填寫的資料。'), top: 62)])));
    final rect = tester.getRect(find.byType(Container));
    // 卡寬 378、字寬 346、每行 24 字；內文 27 字 → 2 行
    expect(rect, const Rect.fromLTWH(12, 70, 378, 54 + 2 * 21));
  });

  testIos('鏡頭模式（鏡頭還在開）：標題、正面標籤、提示、從相冊選和快門', (tester) async {
    await openPage(tester, () => CardCapturePage(side: 'front', cameras: slowCamera), []);
    expect(find.text('拍批文卡'), findsOneWidget);
    expect(find.text('① 正面'), findsOneWidget);
    expect(find.text('② 背面'), findsOneWidget);
    expect(find.text(captureHint(camera: true, picked: false, side: 'front')), findsOneWidget);
    expect(find.text('從相冊選'), findsOneWidget);
    expect(find.byKey(const ValueKey('capture-shutter')), findsOneWidget);
    expect(find.text('拍照'), findsNothing);
  });

  testIos('正面時「① 正面」淺綠底綠字，「② 背面」半透明白底白字', (tester) async {
    await openPage(tester, () => CardCapturePage(side: 'front', cameras: slowCamera), []);
    Color bg(String t) => ((tester.widget<Container>(find.ancestor(of: find.text(t), matching: find.byType(Container)).first).decoration! as BoxDecoration).color)!;
    expect(bg('① 正面'), C.jadeSoft);
    expect(bg('② 背面'), CaptureStyle.sideOff);
    expect(tester.widget<Text>(find.text('① 正面')).style!.color, C.jade);
  });

  testIos('背面時「② 背面」亮起，提示寫背面', (tester) async {
    await openPage(tester, () => CardCapturePage(side: 'back', cameras: slowCamera), []);
    Color bg(String t) => ((tester.widget<Container>(find.ancestor(of: find.text(t), matching: find.byType(Container)).first).decoration! as BoxDecoration).color)!;
    expect(bg('② 背面'), C.jadeSoft);
    expect(find.text(captureHint(camera: true, picked: false, side: 'back')), findsOneWidget);
  });

  testIos('元素位置：標籤在框頂上方 48、提示在框底下方 18、快門列貼底部橫條上', (tester) async {
    await openPage(tester, () => CardCapturePage(side: 'front', cameras: slowCamera), []);
    final f = cardFrame(const Size(402, 874), 62); // (20, 282, 362, 230)
    expect(tester.getTopLeft(find.ancestor(of: find.text('① 正面'), matching: find.byType(Row))).dy, f.top - 48);
    expect(tester.getTopLeft(find.text(captureHint(camera: true, picked: false, side: 'front'))).dy, f.bottom + 18);
    // .bottom 高 170、底距 34，內容區 138 高、置中；快門 76
    expect(tester.getCenter(find.byKey(const ValueKey('capture-shutter'))), Offset(201, 874 - 34 - 170 + 138 / 2));
    expect(tester.getSize(find.byKey(const ValueKey('capture-shutter'))), const Size(76, 76));
    // ✕：左 8、48×48，在狀態列下面的 64 高標題列內置中
    expect(tester.getRect(find.byKey(const ValueKey('capture-close'))), const Rect.fromLTWH(8, 62 + 8, 48, 48));
  });

  testIos('開不了鏡頭：標題「對準批文卡」，下面「從相冊選／拍照」，沒有快門', (tester) async {
    await openPage(tester, () => const CardCapturePage(side: 'front', cameras: noCamera), []);
    await tester.pump();
    expect(find.text('對準批文卡'), findsOneWidget);
    expect(find.text(captureHint(camera: false, picked: false, side: 'front')), findsOneWidget);
    expect(find.text('從相冊選'), findsOneWidget);
    expect(find.text('拍照'), findsOneWidget);
    expect(find.byKey(const ValueKey('capture-shutter')), findsNothing);
    // .buttons：寬 402 - 40、底 48 + 34、高 48
    final row = tester.getRect(find.ancestor(of: find.text('拍照'), matching: find.byType(Row)));
    expect(row, const Rect.fromLTWH(20, 874 - 34 - 48 - 48, 362, 48));
  });

  testIos('鏡頭打不開的錯誤（例如沒有鏡頭套件）也改為「從相冊選／拍照」', (tester) async {
    Future<List<CameraDescription>> broken() async => throw CameraException('CameraAccessDenied', '拒絕');
    await openPage(tester, () => CardCapturePage(side: 'front', cameras: broken), []);
    await tester.pump();
    expect(find.text('對準批文卡'), findsOneWidget);
    expect(find.text('拍照'), findsOneWidget);
  });

  testIos('鏡頭還沒有畫面就按快門：改為「從相冊選／拍照」', (tester) async {
    await openPage(tester, () => CardCapturePage(side: 'front', cameras: slowCamera), []);
    await tester.tap(find.byKey(const ValueKey('capture-shutter')));
    await tester.pump();
    expect(find.text('對準批文卡'), findsOneWidget);
    expect(find.text('拍照'), findsOneWidget);
  });

  testIos('按 ✕ 取消，回傳 null', (tester) async {
    final results = <String?>[];
    await openPage(tester, () => CardCapturePage(side: 'front', cameras: slowCamera), results);
    await tester.tap(find.byKey(const ValueKey('capture-close')));
    await tester.pumpAndSettle();
    expect(results, [null]);
    expect(find.text('拍批文卡'), findsNothing);
  });

  testIos('返回鍵離開當作取消，回傳 null', (tester) async {
    final results = <String?>[];
    await openPage(tester, () => CardCapturePage(side: 'front', cameras: slowCamera), results);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(results, [null]);
  });

  testIos('鏡頭模式按「從相冊選」：選了相片後可以拖動縮放，下面「重選／確認」', (tester) async {
    final picker = FakePicker(testPhoto());
    await openPage(tester, () => CardCapturePage(side: 'front', cameras: slowCamera, picker: picker), []);
    await tapAndWait(tester, find.byKey(const ValueKey('capture-album')));
    expect(picker.calls, [ImageSource.gallery]);
    expect(find.text('對準批文卡'), findsOneWidget);
    expect(find.text(captureHint(camera: false, picked: true, side: 'front')), findsOneWidget);
    expect(find.text('重選'), findsOneWidget);
    expect(find.text('確認'), findsOneWidget);
    expect(find.byKey(const ValueKey('capture-photo')), findsOneWidget);
  });

  testIos('相冊取消：留在原來的畫面', (tester) async {
    final picker = FakePicker(null);
    await openPage(tester, () => CardCapturePage(side: 'front', cameras: slowCamera, picker: picker), []);
    await tapAndWait(tester, find.byKey(const ValueKey('capture-album')));
    expect(find.text('拍批文卡'), findsOneWidget);
    expect(find.byKey(const ValueKey('capture-photo')), findsNothing);
  });

  testIos('讀不了的相片：提示「這張照片無法讀取…」，畫面不變', (tester) async {
    final picker = FakePicker(Uint8List.fromList(utf8.encode('不是圖片')));
    await openPage(tester, () => const CardCapturePage(side: 'front', cameras: noCamera).copyWithPicker(picker), []);
    await tester.pump();
    await tapAndWait(tester, find.text('從相冊選'), until: find.text(unreadablePhoto));
    expect(find.text(unreadablePhoto), findsOneWidget);
    expect(find.text('拍照'), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
  });

  testIos('開不了鏡頭時按「拍照」用系統相機', (tester) async {
    final picker = FakePicker(testPhoto());
    await openPage(tester, () => const CardCapturePage(side: 'front', cameras: noCamera).copyWithPicker(picker), []);
    await tester.pump();
    await tapAndWait(tester, find.text('拍照'));
    expect(picker.calls, [ImageSource.camera]);
    expect(find.text('確認'), findsOneWidget);
  });

  testIos('「重選」用上次的來源（拍照後重選仍是相機）', (tester) async {
    final picker = FakePicker(testPhoto());
    await openPage(tester, () => const CardCapturePage(side: 'front', cameras: noCamera).copyWithPicker(picker), []);
    await tester.pump();
    await tapAndWait(tester, find.text('拍照'));
    await tapAndWait(tester, find.text('重選'));
    expect(picker.calls, [ImageSource.camera, ImageSource.camera]);
  });

  testIos('選好的相片先放大到剛好蓋滿框並置中', (tester) async {
    final picker = FakePicker(testPhoto());
    await openPage(tester, () => const CardCapturePage(side: 'front', cameras: noCamera).copyWithPicker(picker), []);
    await tester.pump();
    await tapAndWait(tester, find.text('從相冊選'));
    final f = cardFrame(const Size(402, 874), 62);
    final v = StageView.place(f, 800, 600);
    final m = photoTransform(tester);
    expect(m.storage[0], closeTo(v.s, 1e-9));
    expect(m.getTranslation().x, closeTo(v.x, 1e-9));
    expect(m.getTranslation().y, closeTo(v.y, 1e-9));
  });

  testIos('單指拖動相片', (tester) async {
    final picker = FakePicker(testPhoto());
    await openPage(tester, () => const CardCapturePage(side: 'front', cameras: noCamera).copyWithPicker(picker), []);
    await tester.pump();
    await tapAndWait(tester, find.text('從相冊選'));
    final before = photoTransform(tester).getTranslation();
    final gesture = await tester.startGesture(const Offset(200, 400));
    await gesture.moveBy(const Offset(30, -20));
    await gesture.up();
    await tester.pump();
    final after = photoTransform(tester).getTranslation();
    expect(after.x - before.x, closeTo(30, 1e-9));
    expect(after.y - before.y, closeTo(-20, 1e-9));
  });

  testIos('雙指張開放大，以兩指中心縮放', (tester) async {
    final picker = FakePicker(testPhoto());
    await openPage(tester, () => const CardCapturePage(side: 'front', cameras: noCamera).copyWithPicker(picker), []);
    await tester.pump();
    await tapAndWait(tester, find.text('從相冊選'));
    final s0 = photoTransform(tester).storage[0];
    final a = await tester.startGesture(const Offset(150, 400), pointer: 1);
    final b = await tester.startGesture(const Offset(250, 400), pointer: 2);
    await a.moveBy(const Offset(-1, 0));
    await b.moveBy(const Offset(1, 0)); // 第一次只記錄距離
    await a.moveBy(const Offset(-49, 0));
    await b.moveBy(const Offset(49, 0));
    await a.up();
    await b.up();
    await tester.pump();
    final s1 = photoTransform(tester).storage[0];
    expect(s1 / s0, greaterThan(1.3));
  });

  testIos('確認：回傳 2274×1445 的 JPEG data URL，頁面關閉', (tester) async {
    final picker = FakePicker(testPhoto());
    final results = <String?>[];
    await openPage(tester, () => const CardCapturePage(side: 'front', cameras: noCamera).copyWithPicker(picker), results);
    await tester.pump();
    await tapAndWait(tester, find.text('從相冊選'));
    await tapAndWait(tester, find.text('確認'));
    await tester.pumpAndSettle();
    expect(results, hasLength(1));
    final url = results.single!;
    expect(url, startsWith('data:image/jpeg;base64,'));
    final jpeg = img.decodeJpg(base64Decode(url.split(',').last))!;
    expect([jpeg.width, jpeg.height], [2274, 1445]);
    // 測試圖左紅右藍，沒有移動時框正中是兩色交界：左邊紅、右邊藍
    expect(jpeg.getPixel(600, 722).r, greaterThan(200));
    expect(jpeg.getPixel(1700, 722).b, greaterThan(200));
    expect(find.text('對準批文卡'), findsNothing);
  });

  testWidgets('安卓：畫面停在底部導航列上面，框按扣除導航列的高度置中，按鈕底距 48', (tester) async {
    await openPage(tester, () => const CardCapturePage(side: 'front', cameras: noCamera), []);
    await waitFor(tester, find.text('拍照')); // 安卓先查權限（測試裏沒有權限套件，當作已取得）
    final f = cardFrame(const Size(402, 874 - 34), 62);
    expect(tester.getTopLeft(find.text(captureHint(camera: false, picked: false, side: 'front'))).dy, f.bottom + 18);
    expect(tester.getRect(find.ancestor(of: find.text('拍照'), matching: find.byType(Row))).bottom, 874 - 34 - 48);
  }, variant: TargetPlatformVariant.only(TargetPlatform.android));

  testIos('openCardCapture：沒有鏡頭的環境打開後是「對準批文卡」，按 ✕ 回傳 null', (tester) async {
    phone(tester);
    final results = <String?>[];
    await tester.pumpWidget(WidgetsApp(
      color: C.paper,
      pageRouteBuilder: <T>(settings, builder) => PageRouteBuilder<T>(settings: settings, pageBuilder: (context, _, _) => builder(context)),
      home: Builder(builder: (context) => GestureDetector(onTap: () async => results.add(await openCardCapture(context, side: 'back')), child: const Center(child: Text('打開')))),
    ));
    await tester.tap(find.text('打開'));
    await tester.pumpAndSettle();
    await waitFor(tester, find.text('對準批文卡')); // 測試裏沒有鏡頭套件，開鏡頭出錯
    expect(find.text('對準批文卡'), findsOneWidget);
    expect(find.text(captureHint(camera: false, picked: false, side: 'back')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('capture-close')));
    await tester.pumpAndSettle();
    expect(results, [null]);
  });
}

extension on CardCapturePage {
  CardCapturePage copyWithPicker(ImagePicker picker) => CardCapturePage(side: side, cameras: cameras, picker: picker);
}
