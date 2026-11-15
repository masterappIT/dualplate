// 連伺服器：對應 mobile/src/lib/api.js 的 api、publicApi、checkTerms。
// 行為照舊：成功（2xx）回傳內容；401（登入和微信接口除外）清登入狀態並打開登入頁；
// 403 TERMS_REQUIRED 先轉服務條款頁；其餘失敗用伺服器的 error 作訊息，沒有就寫「操作失敗」；連不上寫「連不上伺服器，請檢查網絡後再試」。
// 頁面跳轉經 AppNav（shell/router.dart 設定），core 不引用 go_router。
import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'js.dart';
import 'session.dart';

// 正式網站；開發時可用 --dart-define=API_BASE=http://... 改
const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://dualplate.masterappinc.com');

class ApiError implements Exception {
  ApiError(this.message, {this.status, this.data});
  final String message;
  final int? status;
  final Object? data;
  // e.data?.code（例如 SIGNUP_PENDING、TERMS_REQUIRED）
  Object? get code => data is Map ? (data as Map)['code'] : null;
  @override
  String toString() => message;
}

// 頁面跳轉：由 shell/router.dart 接上 GoRouter
abstract final class AppNav {
  static String Function() currentPath = () => '';
  static void Function(String path) push = (_) {};
  static void Function(String path) reLaunch = (_) {};
}

abstract final class Api {
  static http.Client client = http.Client();
  // uni.request 預設逾時 60 秒
  static Duration timeout = const Duration(seconds: 60);
}

const offlineMessage = '連不上伺服器，請檢查網絡後再試';

// uni.request 的 dataType 預設 json：內容能解析就用解析後的值，否則用原文
Object? _decode(http.Response response) {
  final text = utf8.decode(response.bodyBytes, allowMalformed: true);
  try {
    return jsonDecode(text);
  } catch (_) {
    return text;
  }
}

// GET 的 data 變成網址參數（uni.request 的做法）；其他方法送 JSON
Uri _url(String path, String method, Object? data) {
  final url = Uri.parse('$apiBase/api$path');
  if (method != 'GET' || data is! Map || data.isEmpty) return url;
  final query = url.query.isEmpty ? '' : '${url.query}&';
  return url.replace(query: query + data.entries.map((e) => '${Uri.encodeQueryComponent('${e.key}')}=${Uri.encodeQueryComponent(jsString(e.value))}').join('&'));
}

Future<dynamic> api(String path, [String method = 'GET', Object? data]) async {
  final token = getToken();
  final request = http.Request(method, _url(path, method, data))
    ..headers['authorization'] = (token ?? '').isNotEmpty ? 'Bearer $token' : ''
    ..headers['content-type'] = 'application/json';
  if (method != 'GET' && data != null) request.body = jsonEncode(data);
  final http.Response response;
  try {
    response = await http.Response.fromStream(await Api.client.send(request).timeout(Api.timeout)).timeout(Api.timeout);
  } catch (_) {
    throw ApiError(offlineMessage);
  }
  final body = _decode(response), status = response.statusCode;
  if (status >= 200 && status < 300) return body;
  if (status == 401 && path != '/login' && !path.startsWith('/wechat/')) {
    clearSession();
    // uni-app 的 navigatorLock：正在前往同一頁時不重複打開（首頁同時有幾個請求收到 401）
    if (AppNav.currentPath() != '/login') AppNav.push('/login');
  }
  // 管理者設定「強制同意」而未同意最新條款：先到條款頁（同一時間只轉一次）
  if (status == 403 && body is Map && body['code'] == 'TERMS_REQUIRED') openTerms(true);
  final error = body is Map ? body['error'] : null;
  throw ApiError(truthy(error) ? jsString(error) : '操作失敗', status: status, data: body);
}

// 不用登入的請求（登入頁的「忘記密碼？」聯絡方式；日後自助註冊）
Future<dynamic> publicApi(String path) async {
  final http.Response response;
  try {
    response = await http.Response.fromStream(await Api.client.send(http.Request('GET', Uri.parse('$apiBase/api$path'))).timeout(Api.timeout)).timeout(Api.timeout);
  } catch (_) {
    throw ApiError(offlineMessage);
  }
  final body = _decode(response), status = response.statusCode;
  if (status >= 200 && status < 300) return body;
  final error = body is Map ? body['error'] : null;
  throw ApiError(truthy(error) ? jsString(error) : '載入失敗', status: status);
}

// 服務條款：強制時 reLaunch（不能返回）；提示時每次開啟 App 只彈一次，可稍後再看
bool _termsOpening = false, _termsDone = false;
Future<String?>? _termsCheck;
Timer? _termsTimer;

void openTerms(bool force) {
  if (_termsOpening || AppNav.currentPath() == '/terms') return;
  _termsOpening = true;
  _termsTimer?.cancel();
  _termsTimer = Timer(const Duration(milliseconds: 1500), () => _termsOpening = false);
  force ? AppNav.reLaunch('/terms') : AppNav.push('/terms');
}

// ask：頁面的確認框（ui/dialogs.dart 的 ask），回傳 'confirm' 才打開條款頁
typedef TermsAsk = Future<String> Function({required String title, required String msg, required String ok, required String cancel});

// 回傳 'opened' 表示已轉到條款頁；首頁據此延後使用導覽。同一時間多次呼叫共用同一次檢查；每次打開 App 只提示一次。
// 檢查失敗時回傳 null，下次再試（照 api.js：.then(..., () => { termsCheck = null })）
Future<String?> checkTerms(TermsAsk? ask) {
  if (getUser() == null || _termsDone) return Future.value(null);
  return _termsCheck ??= _runTermsCheck(ask).then((result) {
    _termsDone = true;
    return result;
  }, onError: (Object _) {
    _termsCheck = null;
    return null;
  });
}

// 換帳戶登入或退出時重新檢查
void resetTermsCheck() {
  _termsCheck = null;
  _termsDone = false;
}

Future<String?> _runTermsCheck(TermsAsk? ask) async {
  final terms = await api('/my/terms');
  if (terms is! Map || !truthy(terms['published']) || truthy(terms['accepted'])) return null;
  if (terms['mode'] == 'force') {
    openTerms(true);
    return 'opened';
  }
  final (title, msg) = truthy(terms['everAccepted'])
      ? ('服務條款已更新', '請查看並同意最新的服務條款及私隱聲明。')
      : ('請先閱讀服務條款', '開始使用前，請查看並同意服務條款及私隱聲明。');
  if (ask != null && await ask(title: title, msg: msg, ok: '查看', cancel: '稍後') == 'confirm') {
    openTerms(false);
    return 'opened';
  }
  return null;
}

// 只給測試用
void debugResetApi() {
  resetTermsCheck();
  _termsOpening = false;
  _termsTimer?.cancel();
}
