// 啟動時先取首頁資料和安卓首頁緩存（lib/core/launch.dart）：對應 mobile/src/lib/launch.js 的 prefetchHome、quickHome、saveHome、takeHome。
// 伺服器用 MockClient 代替。
import 'dart:convert';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/launch.dart';
import 'package:dualplate/core/session.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const overview = {'serviceMode': '自管', 'customerName': '陳先生', 'counts': {'pending': 0, 'ok': 1, 'due': 0, 'overdue': 0}};
const notices = [
  {'id': 'n1', 'title': '通知'},
];

final requests = <String>[];

Future<void> start({Map<String, String> secure = const {}, Map<String, Object> prefs = const {}}) async {
  FlutterSecureStorage.setMockInitialValues(Map.of(secure));
  SharedPreferences.setMockInitialValues(Map.of(prefs));
  await Session.load();
  debugResetHome();
  requests.clear();
}

Future<void> signedIn(String id, {Map<String, Object> prefs = const {}}) =>
    start(secure: {'token': 't-$id'}, prefs: {'user': jsonEncode({'id': id}), ...prefs});

// 伺服器：overview、notifications 的回應碼可分別指定；null 表示連不上
void server({int? overviewStatus = 200, int? noticesStatus = 200}) {
  Api.client = MockClient((r) async {
    requests.add(r.url.path);
    final path = r.url.path;
    final status = path.endsWith('/overview') ? overviewStatus : noticesStatus;
    if (status == null) throw http.ClientException('no network');
    final body = status != 200 ? {'error': 'x'} : path.endsWith('/overview') ? overview : {'items': notices};
    return http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});
  });
}

String cacheOf(String id) => jsonEncode({'userId': id, 'overview': overview, 'notices': notices});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  group('prefetchHome', () {
    test('未登入：去登入頁，不連網絡', () async {
      await start();
      server();
      expect(await prefetchHome(), '/login');
      expect(requests, isEmpty);
    });

    test('已登入：取首頁和通知，去首頁，資料交給首頁', () async {
      await signedIn('u1');
      server();
      expect(await prefetchHome(), '/index');
      expect(requests, ['/api/my/overview', '/api/my/notifications']);
      final home = takeHome();
      expect(home?.overview['customerName'], '陳先生');
      expect(home?.notices.length, 1);
    });

    test('取到首頁時記下自管／托管', () async {
      await signedIn('u1');
      server();
      await prefetchHome();
      expect(Session.serviceMode, '自管');
    });

    test('通知取不到：通知當作空，仍然去首頁', () async {
      await signedIn('u1');
      server(noticesStatus: 500);
      expect(await prefetchHome(), '/index');
      expect(takeHome()?.notices, isEmpty);
    });

    test('首頁 401（登入已失效）：清登入狀態，去登入頁', () async {
      await signedIn('u1');
      server(overviewStatus: 401);
      expect(await prefetchHome(), '/login');
      expect(getUser(), isNull);
      expect(takeHome(), isNull);
    });

    test('首頁其他錯誤：仍去首頁（由首頁提示），沒有預先取好的資料', () async {
      await signedIn('u1');
      server(overviewStatus: 500);
      expect(await prefetchHome(), '/index');
      expect(takeHome(), isNull);
      expect(getUser(), isNotNull);
    });

    test('連不上伺服器：仍去首頁，沒有預先取好的資料', () async {
      await signedIn('u1');
      server(overviewStatus: null, noticesStatus: null);
      expect(await prefetchHome(), '/index');
      expect(takeHome(), isNull);
    });
  });

  group('takeHome', () {
    test('只用一次：第二次是空', () async {
      await signedIn('u1');
      server();
      await prefetchHome();
      expect(takeHome(), isNotNull);
      expect(takeHome(), isNull);
    });
  });

  group('saveHome（安卓才存）', () {
    test('安卓：按帳戶存下首頁和通知', () async {
      await signedIn('u1');
      saveHome(Map.of(overview), notices);
      await Session.flush();
      final saved = jsonDecode(Session.readString('homeCache')!);
      expect(saved['userId'], 'u1');
      expect(saved['overview']['customerName'], '陳先生');
      expect(saved['notices'].length, 1);
    });

    test('iOS：不存', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      await signedIn('u1');
      saveHome(Map.of(overview), notices);
      await Session.flush();
      expect(Session.readString('homeCache'), isNull);
    });

    test('沒有 user.id：不存', () async {
      await start(secure: {'token': 't'}, prefs: {'user': jsonEncode({'name': '陳'})});
      saveHome(Map.of(overview), notices);
      await Session.flush();
      expect(Session.readString('homeCache'), isNull);
    });

    test('prefetchHome 取到資料時在安卓存下', () async {
      await signedIn('u1');
      server();
      await prefetchHome();
      await Session.flush();
      expect(jsonDecode(Session.readString('homeCache')!)['userId'], 'u1');
    });

    test('退出登入時刪掉', () async {
      await signedIn('u1', prefs: {'homeCache': cacheOf('u1')});
      clearSession();
      await Session.flush();
      await Session.load();
      expect(Session.readString('homeCache'), isNull);
    });
  });

  group('quickHome（安卓啟動）', () {
    test('未登入：去登入頁', () async {
      await start(prefs: {'homeCache': cacheOf('u1')});
      server();
      expect(await quickHome(), '/login');
      expect(requests, isEmpty);
    });

    test('有同一帳戶的緩存：直接去首頁，不等網絡', () async {
      await signedIn('u1', prefs: {'homeCache': cacheOf('u1')});
      server();
      expect(await quickHome(), '/index');
      expect(requests, isEmpty);
      expect(takeHome()?.overview['customerName'], '陳先生');
    });

    test('緩存是別的帳戶的：不用，等網絡取', () async {
      await signedIn('u2', prefs: {'homeCache': cacheOf('u1')});
      server();
      expect(await quickHome(), '/index');
      expect(requests, ['/api/my/overview', '/api/my/notifications']);
    });

    test('沒有緩存：等網絡取', () async {
      await signedIn('u1');
      server();
      expect(await quickHome(), '/index');
      expect(requests, isNotEmpty);
    });

    test('緩存壞了：等網絡取', () async {
      await signedIn('u1', prefs: {'homeCache': '{壞'});
      server();
      expect(await quickHome(), '/index');
      expect(requests, isNotEmpty);
    });

    test('緩存沒有 overview：等網絡取', () async {
      await signedIn('u1', prefs: {'homeCache': jsonEncode({'userId': 'u1', 'notices': []})});
      server();
      await quickHome();
      expect(requests, isNotEmpty);
    });

    test('沒有緩存而登入已失效：去登入頁', () async {
      await signedIn('u1');
      server(overviewStatus: 401);
      expect(await quickHome(), '/login');
    });

    test('有緩存時登入失效也先去首頁（由首頁的 api() 轉去登入頁）', () async {
      await signedIn('u1', prefs: {'homeCache': cacheOf('u1')});
      server(overviewStatus: 401);
      expect(await quickHome(), '/index');
    });
  });
}
