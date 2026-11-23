// 線上客服（docs/tasks/support-masterbox-plan.md 第 2 部分）：App 用內嵌網頁打開本產品網站的 /support/，那一頁再全屏打開 MasterBox 對話。
// App 把資料放在網址 # 後面（base64url 的 JSON：{ data, text }），# 後面不會送到任何伺服器：
//   data：已登入客戶的資料，給客服參考（欄位照計劃的表，和 H5 的 mobile/src/lib/support.js 一樣）；未登入的畫面不帶
//   text：「問客服」預先放進輸入框的第一句，客戶自己按送出
// 這些資料是客戶裝置傳的，未經伺服器驗證；第二步改用伺服器簽的憑證。App 關著客服頁時拿不到未讀數，所以 App 沒有紅點（計劃已寫明）。
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import '../core/api.dart';
import '../core/js.dart';
import '../core/session.dart';

// 本產品網站的客服頁；開發時可用 --dart-define=SUPPORT_URL=http://... 改
const supportUrl = String.fromEnvironment('SUPPORT_URL', defaultValue: 'https://dualplate.masterappinc.com/support/');
const adminCustomerUrl = 'https://dualplateadmin.masterappinc.com/#/customers/';

// 「來自」：iPhone App 1.1.0、Android App 1.1.0
String supportSource({required bool ios, required String version}) => '${ios ? 'iPhone' : 'Android'} App${version.isEmpty ? '' : ' $version'}';

// 只收文字、去掉前後空白、每項最多 200 字（MasterBox 的限制）
String text200(Object? value) {
  final t = value == null ? '' : jsString(value).trim();
  return t.length > 200 ? t.substring(0, 200) : t;
}

// 已登入客戶要帶入的資料（沒有值的不寫）。user 是登入時存下的帳戶；profile、overview、plates 是三個接口的回應，讀不到時是 null
Map<String, String> supportData({required Map? user, Object? profile, Object? overview, Object? plates, required String source}) {
  Object? at(Object? m, String k) => m is Map ? m[k] : null;
  final me = at(profile, 'me'), customer = at(profile, 'customer');
  final email = text200(user?['email']);
  final mode = truthy(at(overview, 'serviceMode')) ? at(overview, 'serviceMode') : user?['serviceMode'];
  final customerId = text200(user?['customerId']);
  final fields = <String, Object?>{
    'name': truthy(at(me, 'name')) ? at(me, 'name') : user?['name'],
    // 只用手機號碼開通的帳戶，電郵是系統佔位，不寫
    'email': email.endsWith('@phone.invalid') ? '' : email,
    'phone': truthy(at(me, 'phone')) ? at(me, 'phone') : at(customer, 'phone'),
    '客戶編號': customerId,
    '後台連結': customerId.isEmpty ? '' : '$adminCustomerUrl$customerId',
    '管理方式': mode,
    '顧問': mode == '自管' ? '' : at(at(overview, 'advisor'), 'name'),
    '牌照': plates is List
        ? [
            for (final p in plates)
              if (truthy(at(p, 'mainland_plate'))) jsString(at(p, 'mainland_plate')),
          ].join('、')
        : '',
    '來自': source,
  };
  return {
    for (final MapEntry(:key, :value) in fields.entries)
      if (text200(value).isNotEmpty) key: text200(value),
  };
}

// 網址 # 後面的內容：base64url（不補 =）的 JSON；沒有資料又沒有預填句子時是空字串
String supportPayload({Map<String, String>? data, String text = ''}) {
  final body = <String, Object>{if (data != null && data.isNotEmpty) 'data': data, if (text.isNotEmpty) 'text': text};
  if (body.isEmpty) return '';
  return base64Url.encode(utf8.encode(jsonEncode(body))).replaceAll('=', '');
}

// background：背景模式（?bg=1），只拿未讀數、不打開對話（business/support_unread.dart）
String supportPageUrl(String payload, {bool background = false}) {
  final base = background ? '$supportUrl?bg=1' : supportUrl;
  return payload.isEmpty ? base : '$base#$payload';
}

// 客服頁網址是不是本頁（換頁時只有本頁留在內嵌網頁裏，其他連結用瀏覽器打開）
bool isSupportPage(String url) {
  final u = Uri.tryParse(url), s = Uri.parse(supportUrl);
  return u != null && u.scheme == s.scheme && u.host == s.host && u.port == s.port && u.path == s.path;
}

// App 頁面路徑：/support?text=…（預填句子）&public=1（未登入的畫面，不帶資料）
String supportPath({String text = '', bool public = false}) {
  final query = {if (text.isNotEmpty) 'text': text, if (public) 'public': '1'};
  return query.isEmpty ? '/support' : Uri(path: '/support', queryParameters: query).toString();
}

void openSupport(BuildContext context, {String text = '', bool public = false}) => unawaited(context.push(supportPath(text: text, public: public)));

// 已安裝的版本（pubspec.yaml version 的 + 前面），經原生通道 dualplate/system 的 versionName 讀；讀不到是空字串
const _system = MethodChannel('dualplate/system');
String? _version;
Future<String> Function()? debugAppVersion;
Future<String> appVersion() async {
  if (debugAppVersion != null) return debugAppVersion!();
  if (_version != null) return _version!;
  try {
    _version = await _system.invokeMethod<String>('versionName') ?? '';
  } catch (_) {
    _version = '';
  }
  return _version!;
}

// 打開客服頁時的網址：public 或未登入時不帶資料（客服頁會 clearData）；已登入時讀三個接口，任何一個讀不到就少寫那幾項，不擋客服。
// 每個接口最多等 4 秒，免得網絡慢時客服頁一直空白。background：背景模式的網址（只在已登入時用），帶同樣的資料、沒有預填句子
Future<String> buildSupportUrl({String text = '', bool public = false, bool background = false}) async {
  final user = getUser();
  if (public || !signedIn || user == null) return supportPageUrl(supportPayload(text: background ? '' : text), background: background);
  Future<Object?> read(String path) => api(path).timeout(const Duration(seconds: 4)).then<Object?>((v) => v, onError: (Object _) => null);
  final r = await Future.wait([read('/my/profile'), read('/my/overview'), read('/plate-assets'), appVersion()]);
  final data = supportData(
    user: user,
    profile: r[0],
    overview: r[1],
    plates: r[2],
    source: supportSource(ios: defaultTargetPlatform == TargetPlatform.iOS, version: r[3] as String),
  );
  return supportPageUrl(supportPayload(data: data, text: background ? '' : text), background: background);
}
