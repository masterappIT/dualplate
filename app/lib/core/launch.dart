// App 版載入頁先取好首頁資料：一比一移植 mobile/src/lib/launch.js（prefetchHome、quickHome、saveHome、takeHome）。
// 首頁打開時直接用，數字不會由 0 跳到實數。
// 不經 api()：它遇 401 會自己打開登入頁，和載入頁的 reLaunch 撞在一起；這裏失敗就交回首頁照常處理。
// 首頁緩存 homeCache 只在安卓 App 存（iOS 照舊每次等網絡）；退出登入時 Session.clear() 一併刪掉。
import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'api.dart' show Api, apiBase;
import 'session.dart';

const _cacheKey = 'homeCache';
// uni.request timeout: 5000
const launchTimeout = Duration(seconds: 5);

// 載入頁取好的首頁資料：overview 是 /my/overview，notices 是 /my/notifications 的 items
typedef HomeData = ({Map<String, dynamic> overview, List<dynamic> notices});

HomeData? _home;

// 只有安卓 App 存上次的首頁資料（iOS、網頁照舊）
bool get _android => defaultTargetPlatform == TargetPlatform.android;

class _Failed implements Exception {
  _Failed([this.status]);
  final int? status;
}

Future<dynamic> _get(String path) async {
  final request = http.Request('GET', Uri.parse('$apiBase/api$path'))..headers['authorization'] = 'Bearer ${getToken()}';
  final http.Response response;
  try {
    response = await http.Response.fromStream(await Api.client.send(request).timeout(launchTimeout)).timeout(launchTimeout);
  } catch (_) {
    throw _Failed();
  }
  if (response.statusCode < 200 || response.statusCode >= 300) throw _Failed(response.statusCode);
  try {
    return jsonDecode(utf8.decode(response.bodyBytes, allowMalformed: true));
  } catch (_) {
    throw _Failed();
  }
}

// 回傳下一頁：未登入或登入已失效 → 登入頁；其餘 → 首頁（取不到資料也去首頁，由首頁提示）
Future<String> prefetchHome() async {
  if (getUser() == null || (getToken() ?? '').isEmpty) return '/login';
  try {
    final r = await Future.wait([
      _get('/my/overview'),
      _get('/my/notifications').catchError((Object _) => <String, dynamic>{'items': []}),
    ], eagerError: true);
    final overview = r[0];
    if (overview is! Map) throw _Failed();
    final map = Map<String, dynamic>.from(overview);
    rememberMode(map['serviceMode'] is String ? map['serviceMode'] as String : null);
    final items = r[1] is Map ? (r[1] as Map)['items'] : null;
    _home = (overview: map, notices: items is List ? items : []);
    saveHome(_home!.overview, _home!.notices);
  } on _Failed catch (e) {
    if (e.status == 401) {
      clearSession();
      return '/login';
    }
  }
  return '/index';
}

// 安卓：先用手機裏上次的首頁資料打開首頁，不等網絡（安卓官方：啟動畫面只等本機的少量資料）。
// 首頁顯示時照常向伺服器取最新資料更新畫面；登入失效時由 api() 轉去登入頁。沒有存過資料才等網絡。
Future<String> quickHome() {
  final user = getUser();
  if (user == null || (getToken() ?? '').isEmpty) return Future.value('/login');
  try {
    final raw = Session.readString(_cacheKey);
    final saved = raw == null ? null : jsonDecode(raw);
    if (saved is Map && saved['userId'] != null && saved['userId'] == user['id'] && saved['overview'] is Map) {
      final notices = saved['notices'];
      _home = (overview: Map<String, dynamic>.from(saved['overview'] as Map), notices: notices is List ? notices : []);
      return Future.value('/index');
    }
  } catch (_) {
    // 讀不到就等網絡
  }
  return prefetchHome();
}

// 首頁取到最新資料後存下，下次打開直接用；按帳戶分開，換了帳戶不會顯示別人的資料
void saveHome(Map<String, dynamic> overview, List<dynamic> notices) {
  if (!_android) return;
  final user = getUser();
  if (user == null || user['id'] == null || user['id'] == '') return;
  try {
    Session.writeString(_cacheKey, jsonEncode({'userId': user['id'], 'overview': overview, 'notices': notices}));
  } catch (_) {
    // 存不到下次就等網絡
  }
}

// 只用一次：之後回到首頁照常即時載入
HomeData? takeHome() {
  final value = _home;
  _home = null;
  return value;
}

// 只給測試用
@visibleForTesting
void debugResetHome() => _home = null;
