// 階段 4 截圖用（不是測試）：在模擬器上照順序打開條款同意框（安卓）、更新提示（安卓，一般和必須）、斷網時的首頁和一個沒有緩存的頁面。
// 每到一個要截圖的畫面，把名稱寫進 <DP_DIR>/want，等外面的指令截圖後刪掉它才繼續；名稱是 stop-server 時外面停掉本機伺服器（等同斷網）。
// 只連本機自己開的 API；密碼只經 --dart-define 傳入：
//   cd app && flutter test integration_test/stage4_shots_test.dart -d <裝置> \
//     --dart-define=API_BASE=http://localhost:4140 --dart-define=DP_PASS=… --dart-define=DP_DIR=/private/tmp/dp4/run
// 版本檔 /download/version.json 本機伺服器沒有，在 App 內代答（其餘請求照常送到本機伺服器）；已安裝版本是這個建置的 versionCode（pubspec 的 +1）。
import 'dart:convert';
import 'dart:io';

import 'package:dualplate/business/app_update.dart';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/login/login_page.dart';
import 'package:dualplate/shell/launch_view.dart';
import 'package:dualplate/shell/system_bars.dart' show setupSystemBars;
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const password = String.fromEnvironment('DP_PASS');
const dir = String.fromEnvironment('DP_DIR', defaultValue: '/private/tmp/dp4/run');
const localApi = String.fromEnvironment('API_BASE');

Map<String, Object?>? served;

class _VersionProxy extends http.BaseClient {
  final _inner = http.Client();
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path == '/download/version.json') {
      final body = served;
      final bytes = utf8.encode(body == null ? 'not found' : jsonEncode(body));
      return http.StreamedResponse(Stream.value(bytes), body == null ? 404 : 200, contentLength: bytes.length);
    }
    return _inner.send(request);
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  final android = defaultTargetPlatform == TargetPlatform.android;

  testWidgets('stage 4 shots', (tester) async {
    if (!localApi.startsWith('http://localhost:')) fail('只可連本機 API');
    Future<void> wait(int ms) => tester.pump(Duration(milliseconds: ms));
    Directory(dir).createSync(recursive: true);
    final log = File('$dir/log')..writeAsStringSync('start\n');
    void note(String s) => log.writeAsStringSync('$s\n', mode: FileMode.append);

    Future<void> until(Finder f, String what, {int seconds = 20}) async {
      for (var i = 0; i < seconds * 10; i++) {
        if (f.evaluate().isNotEmpty) return;
        await wait(100);
      }
      note('MISSING $what');
    }

    Future<void> shot(String name) async {
      await wait(600);
      final want = File('$dir/want')..writeAsStringSync(name);
      for (var i = 0; i < 600 && want.existsSync(); i++) {
        await wait(100);
      }
      note('shot $name');
    }

    var n = 0;
    Future<void> launch() async {
      await tester.pumpWidget(LaunchGate(key: ValueKey('launch${n++}'), app: (next) => DualplateApp(initialLocation: next)));
    }

    await setupSystemBars(); // 和 main() 一樣
    Api.client = _VersionProxy();
    await UpdatePlatform.load(); // 和 main() 一樣讀已安裝的版本
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    await Session.load();
    clearSession();
    await Session.flush();

    if (android) {
      // 1. 條款同意框
      await launch();
      await until(find.text('服務條款及私隱聲明'), 'privacy');
      await shot('privacy');
      await tester.tap(find.text('不同意'));
      await until(find.text('需要你的同意'), 'privacy second');
      await shot('privacy-second');
      await tester.tap(find.text('同意並繼續'));
      await until(find.byType(LoginPage), 'login');
      await wait(800);

      // 2. 更新提示：一般、必須
      final login = tester.element(find.byType(LoginPage));
      served = {'versionCode': 2, 'versionName': '0.1.1', 'notes': '改善相片上傳的速度。', 'url': '$localApi/download/none.apk'};
      appUpdate
        ..latest = null
        ..asked = false;
      appUpdate.check(login);
      await until(find.text('有新版本 0.1.1'), 'update');
      await shot('update');
      await tester.tap(find.text('稍後'));
      await wait(800);
      served = {...served!, 'minVersionCode': 2};
      appUpdate
        ..latest = null
        ..asked = false;
      appUpdate.check(login);
      await until(find.text('立即更新'), 'update force');
      await shot('update-force');
      served = null;
    }

    // 3. 斷網：先在線打開首頁（安卓存下首頁緩存），停掉伺服器，再重新打開 App
    final r = await api('/login', 'POST', {'email': 'customer@demo.local', 'password': password});
    saveSession(Map<String, dynamic>.from(r as Map));
    await Session.flush();
    await launch();
    await until(find.textContaining('陳先生'), 'home online', seconds: 30);
    await wait(2000);
    await Session.flush();
    note('homeCache ${Session.readString('homeCache') == null ? 'missing' : 'saved'}');
    if (android) {
      // 首頁按一次返回鍵：系統提示「再按一次退出應用」（不按第二次，免得結束測試本身）
      await tester.binding.handlePopRoute();
      await wait(200);
      await shot('home-back');
      await wait(2500);
    }
    await shot('stop-server');
    await launch();
    await wait(android ? 3000 : 6000);
    await shot('offline-home');
    // 頁面載入失敗時照現有 App 只出提示（toast，1.5 秒），趁它還在時截圖
    AppNav.push('/notifications');
    await wait(100);
    await shot('offline-page');
    note('done');
  });
}
