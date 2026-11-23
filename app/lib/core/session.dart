// 登入狀態：對應 mobile/src/lib/api.js 的 getToken、getUser、saveSession、clearSession、rememberMode、isSelfManaged。
// 現有 App 用 uni.setStorageSync 同步存取；這裏先在啟動時一次讀入記憶體（Session.load），之後同步讀、背景寫入。
// token 放 Keychain／Keystore（flutter_secure_storage），其餘放 shared_preferences（docs/tasks/flutter-app-plan.md 第三節）。
// iOS 刪除 App 後 Keychain 不會清空；登入判斷照 lib/launch.js 要求 user 和 token 同時存在，user 在 shared_preferences，重裝後就會清空。
import 'dart:convert';
import 'package:flutter/foundation.dart' show ValueNotifier;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart' show resetTermsCheck;

abstract final class Session {
  static const _secure = FlutterSecureStorage();
  static SharedPreferences? _prefs;
  static String? _token;
  static Map<String, dynamic>? _user;
  static String? _mode;
  static String? _loginArea;
  static Future<void> _writing = Future.value();
  // 登入、退出登入、登入失效時加一：線上客服的背景網頁聽這個，登入後開始、退出後收起（business/support_unread.dart）
  static final changes = ValueNotifier<int>(0);

  // 啟動時讀入；測試可重複呼叫
  static Future<void> load() async {
    _prefs = await SharedPreferences.getInstance();
    _token = await _secure.read(key: 'token');
    final raw = _prefs!.getString('user');
    try {
      final value = raw == null ? null : jsonDecode(raw);
      _user = value is Map<String, dynamic> ? value : null;
    } catch (_) {
      _user = null;
    }
    _mode = _prefs!.getString('serviceMode');
    _loginArea = _prefs!.getString('loginArea');
    changes.value++;
  }

  // 等背景寫入完成（測試用）
  static Future<void> flush() => _writing;

  static void _write(Future<void> Function() job) => _writing = _writing.then((_) => job()).catchError((_) {});

  static String? get token => _token;
  static Map<String, dynamic>? get user => _user;
  static String? get serviceMode => _mode;
  static String? get loginArea => _loginArea;

  // 登入成功：存 token 和 user，刪掉上一個帳戶記下的自管／托管
  static void save(Map<String, dynamic> result) {
    final token = result['token'], user = result['user'];
    _token = token?.toString();
    _user = user is Map<String, dynamic> ? user : null;
    _mode = null;
    changes.value++;
    _write(() async {
      await (_token == null ? _secure.delete(key: 'token') : _secure.write(key: 'token', value: _token));
      await (_user == null ? _prefs?.remove('user') : _prefs?.setString('user', jsonEncode(_user)));
      await _prefs?.remove('serviceMode');
    });
    resetTermsCheck();
  }

  // 退出登入或登入失效：homeCache 是安卓 App 的首頁緩存（階段 4），一併刪掉
  static void clear() {
    _token = null;
    _user = null;
    _mode = null;
    changes.value++;
    _write(() async {
      await _secure.delete(key: 'token');
      await _prefs?.remove('user');
      await _prefs?.remove('serviceMode');
      await _prefs?.remove('homeCache');
    });
    resetTermsCheck();
  }

  // rememberMode：沒有值時當作托管
  static void rememberMode(String? mode) {
    _mode = (mode == null || mode.isEmpty) ? '托管' : mode;
    _write(() async => _prefs?.setString('serviceMode', _mode!));
  }

  // 只改 user（我的資料改了顯示名稱：uni.setStorageSync('user', { ...getUser(), name })），token 和自管／托管不變
  static void updateUser(Map<String, dynamic> user) {
    _user = user;
    _write(() async => _prefs?.setString('user', jsonEncode(user)));
  }

  // 登入頁記住上次選的區號
  static void rememberLoginArea(String code) {
    _loginArea = code;
    _write(() async => _prefs?.setString('loginArea', code));
  }

  // 其他本機資料（uni.getStorageSync／setStorageSync）：首頁緩存 homeCache（core/launch.dart）、安卓條款同意框的版本（core/privacy.dart）
  static String? readString(String key) => _prefs?.getString(key);
  static void writeString(String key, String value) => _write(() async => _prefs?.setString(key, value));

  // 只給測試用：直接設定記憶體內的狀態，不寫入
  static void debugSet({String? token, Map<String, dynamic>? user, String? mode}) {
    _token = token;
    _user = user;
    _mode = mode;
    changes.value++;
  }
}

String? getToken() => Session.token;
Map<String, dynamic>? getUser() => Session.user;
void saveSession(Map<String, dynamic> result) => Session.save(result);
void clearSession() => Session.clear();
void rememberMode(String? mode) => Session.rememberMode(mode);

// 有 user 和 token 才算已登入（lib/launch.js）
bool get signedIn => getUser() != null && (getToken() ?? '').isNotEmpty;

// 自管客戶：先看首頁、我的資料記下的 serviceMode，沒有再看登入時的 user.serviceMode
bool isSelfManaged() {
  final mode = Session.serviceMode;
  return ((mode != null && mode.isNotEmpty) ? mode : getUser()?['serviceMode']) == '自管';
}
