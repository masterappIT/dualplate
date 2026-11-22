// 安卓 App 內更新（lib/business/app_update.dart）：對應 mobile/src/lib/app-update.js。
// 規則（版本檔格式、何時問、必須更新、只問一次、6 小時再讀、下載和核對失敗）每個情況一個測試；系統功能換成假的。
import 'dart:convert';
import 'dart:io';
import 'package:dualplate/business/app_update.dart';
import 'package:dualplate/core/api.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class FakePlatform extends UpdatePlatform {
  FakePlatform(this.dir);
  final String dir;
  int installed = 5;
  ({String? name, int? code, String? own})? info = (name: 'com.masterappinc.dualplate', code: 7, own: 'com.masterappinc.dualplate');
  bool downloadFails = false, installOk = true;
  final downloads = <String>[];
  final installs = <String>[];
  @override
  Future<int> installedVersion() async => installed;
  @override
  Future<String> downloadDir() async => dir;
  @override
  Future<({String? name, int? code, String? own})?> apkInfo(String path) async => info;
  @override
  Future<bool> install(String path) async {
    installs.add(path);
    return installOk;
  }

  @override
  Future<void> download(String url, String path, void Function(int percent) onProgress) async {
    downloads.add(url);
    if (downloadFails) throw Exception('offline');
    onProgress(50);
    File(path).writeAsStringSync('apk');
    onProgress(100);
  }
}

Map<String, Object?> versionFile({int code = 7, int? min, String notes = '修正錯誤'}) =>
    {'versionCode': code, 'versionName': '1.0.$code', 'minVersionCode': ?min, 'notes': notes, 'url': 'https://dualplate.masterappinc.com/download/dualplate.apk'};

void main() {
  late Directory dir;
  late FakePlatform platform;
  late AppUpdate update;
  late DateTime now;
  var fetches = 0;
  Object? served;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('dp-update');
    platform = FakePlatform(dir.path);
    now = DateTime(2026, 11, 22, 10);
    update = AppUpdate(platform: platform, now: () => now);
    fetches = 0;
    served = versionFile();
    Api.client = MockClient((r) async {
      fetches++;
      return http.Response.bytes(utf8.encode(jsonEncode(served)), 200);
    });
    AppNav.currentPath = () => '/index';
  });
  tearDown(() => dir.deleteSync(recursive: true));

  // 一個頁面：按鈕呼叫 check，結果記在 done
  Future<BuildContext> page(WidgetTester tester) async {
    late BuildContext ctx;
    await tester.pumpWidget(WidgetsApp(
      color: const Color(0xFFFFFFFF),
      builder: (context, _) => Navigator(onGenerateRoute: (_) => PageRouteBuilder<void>(pageBuilder: (context, _, _) {
        ctx = context;
        return const SizedBox.expand();
      })),
    ));
    return ctx;
  }

  // 讀版本檔和檔案操作要真的跑完，再推進畫面
  Future<void> settle(WidgetTester tester) async {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
  }

  // 下載流程裏有真的檔案操作，和畫面計時交替推進幾輪
  Future<void> drive(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  group('版本檔', () {
    test('合格：取出各欄', () {
      final v = parseVersion(200, versionFile(code: 7, min: 3))!;
      expect([v.versionCode, v.versionName, v.minVersionCode, v.notes], [7, '1.0.7', 3, '修正錯誤']);
    });
    test('不是 200：當作沒有新版本', () => expect(parseVersion(404, versionFile()), isNull));
    test('不是物件：當作沒有新版本', () => expect(parseVersion(200, '<html>'), isNull));
    test('versionCode 不是整數：當作沒有新版本', () => expect(parseVersion(200, {...versionFile(), 'versionCode': '7'}), isNull));
    test('versionCode 是 7.0：照樣當整數（Number.isInteger）', () => expect(parseVersion(200, {...versionFile(), 'versionCode': 7.0})?.versionCode, 7));
    test('versionCode 是 7.5：當作沒有新版本', () => expect(parseVersion(200, {...versionFile(), 'versionCode': 7.5}), isNull));
    test('url 不是 http(s)：當作沒有新版本', () => expect(parseVersion(200, {...versionFile(), 'url': 'ftp://x/a.apk'}), isNull));
    test('沒有 url：當作沒有新版本', () => expect(parseVersion(200, {...versionFile()}..remove('url')), isNull));
    test('沒有 versionName：用 versionCode', () => expect(parseVersion(200, {...versionFile()}..remove('versionName'))?.versionName, '7'));
    test('versionName 是空字串：用 versionCode', () => expect(parseVersion(200, {...versionFile(), 'versionName': ''})?.versionName, '7'));
    test('minVersionCode 不是整數：當作 0', () => expect(parseVersion(200, {...versionFile(), 'minVersionCode': '9'})?.minVersionCode, 0));
    test('notes 不是字串：當作空', () => expect(parseVersion(200, {...versionFile(), 'notes': 3})?.notes, ''));
  });

  group('規則', () {
    test('低於 minVersionCode：必須更新', () => expect(mustUpdate(5, parseVersion(200, versionFile(min: 6))!), isTrue));
    test('等於 minVersionCode：一般更新', () => expect(mustUpdate(6, parseVersion(200, versionFile(min: 6))!), isFalse));
    test('必須更新的說明：更新說明加一行停用說明', () => expect(forceMessage(parseVersion(200, versionFile())!), '修正錯誤\n這個版本已停止使用，請先更新。'));
    test('必須更新而沒有更新說明：只有停用說明', () => expect(forceMessage(parseVersion(200, versionFile(notes: ''))!), '這個版本已停止使用，請先更新。'));
    test('下載網址加上版本編號', () => expect(downloadUrl('https://x/a.apk', 7), 'https://x/a.apk?v=7'));
    test('下載網址已有查詢參數：用 & 接上', () => expect(downloadUrl('https://x/a.apk?s=1', 7), 'https://x/a.apk?s=1&v=7'));
    test('下載檔名', () => expect(downloadName(7), 'dualplate-7.apk'));
    test('核對：本 App 而且不舊於版本檔', () => expect(apkOk((name: 'a', code: 7, own: 'a'), 7), isTrue));
    test('核對：別的 App 不行', () => expect(apkOk((name: 'b', code: 7, own: 'a'), 7), isFalse));
    test('核對：舊檔不行', () => expect(apkOk((name: 'a', code: 6, own: 'a'), 7), isFalse));
    test('核對：讀不到不行', () => expect(apkOk(null, 7), isFalse));
  });

  group('檢查流程', () {
    testWidgets('iOS：不檢查', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      debugDefaultTargetPlatformOverride = null;
      expect(fetches, 0);
    });

    testWidgets('讀不到已安裝版本：不檢查', (tester) async {
      platform.installed = 0;
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      expect(fetches, 0);
    });

    testWidgets('已是最新版：不問，並刪掉以前下載的更新檔', (tester) async {
      platform.installed = 7;
      File('${dir.path}/dualplate-6.apk').writeAsStringSync('old');
      File('${dir.path}/other.txt').writeAsStringSync('keep');
      final ctx = await page(tester);
      await tester.runAsync(() => update.check(ctx));
      await tester.pump();
      expect(find.text('有新版本 1.0.7'), findsNothing);
      expect(File('${dir.path}/dualplate-6.apk').existsSync(), isFalse);
      expect(File('${dir.path}/other.txt').existsSync(), isTrue);
    });

    testWidgets('有新版本：問「稍後／立即更新」，按稍後就完成', (tester) async {
      final ctx = await page(tester);
      var done = false;
      update.check(ctx).then((_) => done = true);
      await settle(tester);
      expect(find.text('有新版本 1.0.7'), findsOneWidget);
      expect(find.text('修正錯誤'), findsOneWidget);
      expect(find.text('稍後'), findsOneWidget);
      await tester.tap(find.text('稍後'));
      await settle(tester);
      expect(done, isTrue);
      expect(platform.downloads, isEmpty);
    });

    testWidgets('一般更新：同一次打開 App 只問一次', (tester) async {
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      await tester.tap(find.text('稍後'));
      await tester.pumpAndSettle();
      update.check(ctx);
      await settle(tester);
      expect(find.text('有新版本 1.0.7'), findsNothing);
    });

    testWidgets('6 小時內再檢查：不再讀版本檔', (tester) async {
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      await tester.tap(find.text('稍後'));
      await tester.pumpAndSettle();
      now = now.add(const Duration(hours: 5));
      update.check(ctx);
      await settle(tester);
      expect(fetches, 1);
    });

    testWidgets('超過 6 小時再檢查：重新讀版本檔', (tester) async {
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      await tester.tap(find.text('稍後'));
      await tester.pumpAndSettle();
      now = now.add(const Duration(hours: 7));
      update.check(ctx);
      await settle(tester);
      expect(fetches, 2);
    });

    testWidgets('讀版本期間轉到別頁：不在看不見的頁面彈提示', (tester) async {
      var path = '/index';
      AppNav.currentPath = () => path;
      Api.client = MockClient((r) async {
        path = '/vehicles';
        return http.Response.bytes(utf8.encode(jsonEncode(served)), 200);
      });
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      expect(find.text('有新版本 1.0.7'), findsNothing);
      expect(update.asked, isFalse);
    });

    testWidgets('必須更新：提示只有「立即更新」，點框外關不了', (tester) async {
      served = versionFile(min: 6);
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      expect(find.text('修正錯誤\n這個版本已停止使用，請先更新。'), findsOneWidget);
      expect(find.text('稍後'), findsNothing);
      await tester.tapAt(const Offset(5, 5));
      await tester.pumpAndSettle();
      expect(find.text('立即更新'), findsOneWidget);
    });

    testWidgets('必須更新：已問過也照樣再問', (tester) async {
      served = versionFile(min: 6);
      update.asked = true;
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      expect(find.text('立即更新'), findsOneWidget);
    });

    testWidgets('立即更新：下載（網址帶版本）、核對、交給系統安裝', (tester) async {
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      await tester.tap(find.text('立即更新'));
      await drive(tester);
      await tester.pump();
      expect(platform.downloads, ['https://dualplate.masterappinc.com/download/dualplate.apk?v=7']);
      expect(platform.installs, ['${dir.path}/dualplate-7.apk']);
      await tester.pump(const Duration(seconds: 11));
      await drive(tester);
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
    });

    testWidgets('一般更新下載失敗：提示 3 秒，不再問', (tester) async {
      platform.downloadFails = true;
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      await tester.tap(find.text('立即更新'));
      await drive(tester);
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('下載失敗，請檢查網絡後再試'), findsOneWidget);
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
      expect(find.text('下載失敗，請檢查網絡後再試'), findsNothing);
    });

    testWidgets('下載的檔案核對不過：刪掉，提示不完整', (tester) async {
      platform.info = (name: 'com.masterappinc.dualplate', code: 6, own: 'com.masterappinc.dualplate');
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      await tester.tap(find.text('立即更新'));
      await drive(tester);
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('下載的檔案不完整，請再試一次'), findsOneWidget);
      expect(File('${dir.path}/dualplate-7.apk').existsSync(), isFalse);
      expect(platform.installs, isEmpty);
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
    });

    testWidgets('必須更新而下載失敗：鎖定提示「更新失敗」，按「再試一次」再下載', (tester) async {
      served = versionFile(min: 6);
      platform.downloadFails = true;
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      await tester.tap(find.text('立即更新'));
      await drive(tester);
      await tester.pumpAndSettle();
      expect(find.text('更新失敗'), findsOneWidget);
      expect(find.text('下載失敗，請檢查網絡後再試'), findsOneWidget);
      platform.downloadFails = false;
      await tester.tap(find.text('再試一次'));
      await drive(tester);
      await tester.pump();
      expect(platform.downloads.length, 2);
      expect(platform.installs.length, 1);
      await tester.pump(const Duration(seconds: 11));
      await drive(tester);
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
    });

    testWidgets('系統安裝畫面打不開：提示未能安裝', (tester) async {
      platform.installOk = false;
      final ctx = await page(tester);
      update.check(ctx);
      await settle(tester);
      await tester.tap(find.text('立即更新'));
      await drive(tester);
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('未能安裝，請到下載頁下載新版本'), findsOneWidget);
      await tester.pump(const Duration(seconds: 4));
      await tester.pumpAndSettle();
    });

    testWidgets('檢查中再呼叫：等同一次，不另開提示', (tester) async {
      final ctx = await page(tester);
      update.check(ctx);
      update.check(ctx);
      await settle(tester);
      expect(find.text('有新版本 1.0.7'), findsOneWidget);
      expect(fetches, 1);
      await tester.tap(find.text('稍後'));
      await tester.pumpAndSettle();
    });
  });
}
