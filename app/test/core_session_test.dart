// 登入狀態（lib/core/session.dart）：對應 api.js 的 saveSession、clearSession、rememberMode、getUser、getToken。
import 'dart:convert';
import 'package:dualplate/core/session.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<void> start({Map<String, String> secure = const {}, Map<String, Object> prefs = const {}}) async {
  FlutterSecureStorage.setMockInitialValues(Map.of(secure));
  SharedPreferences.setMockInitialValues(Map.of(prefs));
  await Session.load();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('沒有存過：未登入', () async {
    await start();
    expect([getToken(), getUser(), signedIn], [null, null, false]);
  });

  test('讀入已存的 token 和 user', () async {
    await start(secure: {'token': 'abc'}, prefs: {'user': jsonEncode({'id': 'u1', 'role': 'customer'})});
    expect([getToken(), getUser()?['id'], signedIn], ['abc', 'u1', true]);
  });

  test('只有 token 沒有 user（例如 iOS 重裝後 Keychain 留下的 token）：未登入', () async {
    await start(secure: {'token': 'abc'});
    expect(signedIn, false);
  });

  test('只有 user 沒有 token：未登入', () async {
    await start(prefs: {'user': jsonEncode({'id': 'u1'})});
    expect(signedIn, false);
  });

  test('token 是空字串：未登入', () async {
    await start(secure: {'token': ''}, prefs: {'user': jsonEncode({'id': 'u1'})});
    expect(signedIn, false);
  });

  test('存的 user 壞了：當作沒有', () async {
    await start(secure: {'token': 'abc'}, prefs: {'user': '{壞'});
    expect([getUser(), signedIn], [null, false]);
  });

  test('存的 user 不是物件：當作沒有', () async {
    await start(secure: {'token': 'abc'}, prefs: {'user': '[1,2]'});
    expect(getUser(), isNull);
  });

  test('saveSession 存 token 和 user，並寫入儲存', () async {
    await start();
    saveSession({'token': 't1', 'user': {'id': 'u2', 'serviceMode': '自管'}});
    await Session.flush();
    expect([getToken(), getUser()?['id']], ['t1', 'u2']);
    await Session.load();
    expect([getToken(), getUser()?['id'], signedIn], ['t1', 'u2', true]);
  });

  test('saveSession 刪掉上一個帳戶記下的自管／托管', () async {
    await start(prefs: {'serviceMode': '自管'});
    saveSession({'token': 't1', 'user': {'id': 'u2'}});
    await Session.flush();
    await Session.load();
    expect(Session.serviceMode, isNull);
  });

  test('clearSession 刪掉 token、user、自管／托管和首頁緩存', () async {
    await start(secure: {'token': 'abc'}, prefs: {'user': jsonEncode({'id': 'u1'}), 'serviceMode': '自管', 'homeCache': '{}', 'loginArea': '+853'});
    clearSession();
    await Session.flush();
    final prefs = await SharedPreferences.getInstance();
    await Session.load();
    expect([getToken(), getUser(), Session.serviceMode, prefs.getString('homeCache')], [null, null, null, null]);
  });

  test('clearSession 保留登入頁記下的區號', () async {
    await start(prefs: {'loginArea': '+853'});
    clearSession();
    await Session.flush();
    await Session.load();
    expect(Session.loginArea, '+853');
  });

  test('rememberMode 沒有值時記為托管', () async {
    await start();
    rememberMode(null);
    expect(Session.serviceMode, '托管');
  });

  test('rememberMode 空字串時記為托管', () async {
    await start();
    rememberMode('');
    expect(Session.serviceMode, '托管');
  });

  test('rememberMode 記下自管並寫入儲存', () async {
    await start();
    rememberMode('自管');
    await Session.flush();
    await Session.load();
    expect(Session.serviceMode, '自管');
  });

  test('登入頁記下區號', () async {
    await start();
    Session.rememberLoginArea('+86');
    await Session.flush();
    await Session.load();
    expect(Session.loginArea, '+86');
  });
}
