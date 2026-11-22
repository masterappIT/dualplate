// 安卓 App 檢查新版本：一比一移植 mobile/src/lib/app-update.js（App Store 版由商店更新，iOS 不做）。
// 讀網站上的 /download/version.json（deploy/web/download/version.json），比對已安裝 APK 的 versionCode。
// 有新版本：問「稍後／立即更新」，每次打開 App 只問一次；低於 minVersionCode：必須更新，提示不能關閉。
// 立即更新：在 App 內下載新 APK（顯示進度），核對下載到的確實是本 App 的新版本，才交給系統安裝。
// check() 一定會完成、不會出錯，而且要等更新提示關掉才完成：頁面自己的提示（例如服務條款）放在它之後，兩個提示框不會疊在一起。
// 首頁和登入頁每次顯示（onShow）時呼叫。
//
// 下載：現有 App 用 plus.downloader（逾時 30 秒、重試 2 次）存到 App 自己的 _downloads/；這裏用 http 照樣做，存到同名資料夾。
// 安裝：現有 App 用 DCloud 的 plus.runtime.install（FileProvider + ACTION_VIEW 打開系統安裝畫面）；這裏經 MainActivity 的原生通道照做。
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import '../ui/dialogs.dart';
import '../ui/loading.dart';
import '../ui/toast.dart';
import '../core/api.dart' show Api, AppNav, apiBase;

// App 長時間留在背景，回到前台時隔這麼久才再讀一次版本
const recheckAfter = Duration(hours: 6);

class AppVersion {
  const AppVersion({required this.versionCode, required this.versionName, required this.minVersionCode, required this.notes, required this.url});
  final int versionCode, minVersionCode;
  final String versionName, notes, url;
}

// 版本檔的內容合格才用：versionCode 是整數、url 是 http(s) 網址；其餘欄位有預設。讀不到或格式不對就當沒有新版本，不打擾用戶
AppVersion? parseVersion(int statusCode, Object? data) {
  if (statusCode != 200 || data is! Map) return null;
  final code = _integer(data['versionCode']), url = data['url'];
  if (code == null || url is! String || !RegExp(r'^https?://').hasMatch(url)) return null;
  final name = data['versionName'];
  return AppVersion(
    versionCode: code,
    // String(data.versionName || data.versionCode)
    versionName: _jsTruthy(name) ? _jsText(name) : '$code',
    minVersionCode: _integer(data['minVersionCode']) ?? 0,
    notes: data['notes'] is String ? data['notes'] as String : '',
    url: url,
  );
}

// Number.isInteger：3.0 也算整數
int? _integer(Object? v) => v is int ? v : (v is double && v.isFinite && v == v.roundToDouble()) ? v.toInt() : null;
bool _jsTruthy(Object? v) => !(v == null || v == false || v == 0 || v == '' || (v is double && v.isNaN));
String _jsText(Object? v) => v is double && v == v.roundToDouble() && v.isFinite ? '${v.toInt()}' : '$v';

// 必須更新：已安裝的版本低於 minVersionCode
bool mustUpdate(int current, AppVersion latest) => current < latest.minVersionCode;

// 必須更新時的提示內容：更新說明（有的話）加一行停用說明
String forceMessage(AppVersion latest) => '${latest.notes.isNotEmpty ? '${latest.notes}\n' : ''}這個版本已停止使用，請先更新。';

// 下載檔名：_downloads/dualplate-<versionCode>.apk
String downloadName(int versionCode) => 'dualplate-$versionCode.apk';
final _downloadPattern = RegExp(r'^dualplate-\d+\.apk$');

// 網址帶上版本編號，每個版本都不同，不會拿到伺服器或網絡快取的舊 APK
String downloadUrl(String url, int versionCode) => '$url${url.contains('?') ? '&' : '?'}v=$versionCode';

// 下載到的必須是本 App、而且不舊於 version.json 寫的版本
bool apkOk(({String? name, int? code, String? own})? info, int versionCode) =>
    info != null && info.name != null && info.name == info.own && info.code != null && info.code! >= versionCode;

class UpdateFailure implements Exception {
  UpdateFailure(this.message);
  final String message;
  @override
  String toString() => message;
}

const downloadFailed = '下載失敗，請檢查網絡後再試';
const incompleteFile = '下載的檔案不完整，請再試一次';
const installFailed = '未能安裝，請到下載頁下載新版本';

// 系統功能（原生通道 dualplate/system，MainActivity.kt）；測試換成假的
class UpdatePlatform {
  const UpdatePlatform();
  static const _channel = MethodChannel('dualplate/system');

  // 已安裝 APK 的 versionCode：App 啟動時讀一次（main.dart 呼叫 load），之後直接用；讀不到是 0（不檢查）。
  // 不在每次檢查時才問原生層：首頁的條款提示和導覽要等檢查完成，不能因為原生層沒有回應而卡住
  static int _installed = 0;
  static Future<void> load() async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      _installed = (await _channel.invokeMethod<int>('versionCode')) ?? 0;
    } catch (_) {
      _installed = 0;
    }
  }

  Future<int> installedVersion() async => _installed;

  // App 自己的下載資料夾（files/_downloads），不需要儲存權限
  Future<String> downloadDir() async => (await _channel.invokeMethod<String>('downloadDir'))!;

  // APK 檔的包名和 versionCode，以及本 App 的包名；讀不到回傳 null
  Future<({String? name, int? code, String? own})?> apkInfo(String path) async {
    try {
      final r = await _channel.invokeMapMethod<String, Object?>('apkInfo', path);
      if (r == null) return null;
      return (name: r['name'] as String?, code: (r['code'] as num?)?.toInt(), own: r['own'] as String?);
    } catch (_) {
      return null;
    }
  }

  // 打開系統安裝畫面；打開不了回傳 false
  Future<bool> install(String path) async {
    try {
      return (await _channel.invokeMethod<bool>('installApk', path)) ?? false;
    } catch (_) {
      return false;
    }
  }

  // 下載：逾時 30 秒、失敗再試 2 次（plus.downloader 的 timeout:30, retry:2）；onProgress 收到 0–100
  Future<void> download(String url, String path, void Function(int percent) onProgress) async {
    Object? error;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final response = await Api.client.send(http.Request('GET', Uri.parse(url))).timeout(const Duration(seconds: 30));
        if (response.statusCode != 200) throw UpdateFailure(downloadFailed);
        final total = response.contentLength ?? 0;
        final sink = File(path).openWrite();
        var got = 0;
        try {
          await for (final chunk in response.stream.timeout(const Duration(seconds: 30))) {
            sink.add(chunk);
            got += chunk.length;
            if (total > 0) onProgress((got / total * 100).floor());
          }
        } finally {
          await sink.close();
        }
        return;
      } catch (e) {
        error = e;
      }
    }
    throw error ?? UpdateFailure(downloadFailed);
  }
}

// 每次打開 App 的狀態（現有 App 是 JS 模組變數；App 結束後重新開始）
class AppUpdate {
  AppUpdate({this.platform = const UpdatePlatform(), DateTime Function()? now}) : _now = now ?? DateTime.now;
  UpdatePlatform platform;
  final DateTime Function() _now;
  AppVersion? latest;
  DateTime? fetchedAt;
  bool asked = false;
  Future<void>? _running;

  // 只在安卓 App 做；正在檢查或下載時再呼叫，等同一次完成，不會另開提示
  Future<void> check(BuildContext context) {
    if (defaultTargetPlatform != TargetPlatform.android) return Future.value();
    return _running ??= run(context).catchError((Object _) {}).whenComplete(() => _running = null);
  }

  Future<AppVersion?> fetchLatest() async {
    try {
      final url = Uri.parse('$apiBase/download/version.json?t=${_now().millisecondsSinceEpoch}');
      final response = await http.Response.fromStream(await Api.client.send(http.Request('GET', url)).timeout(const Duration(seconds: 8))).timeout(const Duration(seconds: 8));
      Object? data;
      try {
        data = jsonDecode(utf8.decode(response.bodyBytes, allowMalformed: true));
      } catch (_) {
        data = null;
      }
      return parseVersion(response.statusCode, data);
    } catch (_) {
      return null;
    }
  }

  // 已是最新版：刪掉以前下載的更新檔（每個約 30MB）
  Future<void> removeDownloads() async {
    try {
      final dir = Directory(await platform.downloadDir());
      await for (final entry in dir.list()) {
        if (entry is File && _downloadPattern.hasMatch(entry.uri.pathSegments.last)) await entry.delete();
      }
    } catch (_) {}
  }

  @visibleForTesting
  Future<void> run(BuildContext context) async {
    final current = await platform.installedVersion();
    if (current == 0) return;
    final page = AppNav.currentPath();
    final at = fetchedAt;
    if (latest == null || at == null || _now().difference(at) > recheckAfter) {
      final found = await fetchLatest();
      if (found != null) {
        latest = found;
        fetchedAt = _now();
      }
    }
    final target = latest;
    if (target == null || target.versionCode <= current) return removeDownloads();
    final force = mustUpdate(current, target);
    // 讀版本期間用戶已轉到別頁：不在看不見的頁面彈提示，下次回來再問
    if ((asked && !force) || AppNav.currentPath() != page || !context.mounted) return;
    asked = true;
    final title = '有新版本 ${target.versionName}';
    if (force) {
      await notice(context, title: title, msg: forceMessage(target), ok: '立即更新', locked: true);
      if (!context.mounted || !await _stillOn(context, page)) return;
    } else if (await ask(context, title: title, msg: target.notes, ok: '立即更新', cancel: '稍後') != 'confirm') {
      return;
    }
    // 必須更新時失敗了只能再試；一般更新失敗就提示，下次打開 App 再問
    for (;;) {
      if (!context.mounted) return;
      try {
        final path = await _download(context, target);
        await _checkApk(path, target.versionCode);
        return await _install(path);
      } catch (e) {
        final msg = e is UpdateFailure ? e.message : '更新失敗，請到下載頁下載新版本';
        if (!context.mounted) return;
        if (!force) return showToast(context, msg, duration: const Duration(milliseconds: 3000));
        await notice(context, title: '更新失敗', msg: msg, ok: '再試一次', locked: true);
        if (!context.mounted || !await _stillOn(context, page)) return;
      }
    }
  }

  // 鎖定提示框被返回鍵關掉而頁面已離開（現有 App 這時提示框跟頁面一起消失，不會下載）：停下，不再繼續
  Future<bool> _stillOn(BuildContext context, String page) async {
    await WidgetsBinding.instance.endOfFrame;
    return context.mounted && AppNav.currentPath() == page;
  }

  Future<String> _download(BuildContext context, AppVersion target) async {
    final path = '${await platform.downloadDir()}/${downloadName(target.versionCode)}';
    // 同名檔存在時先刪掉
    try {
      await File(path).delete();
    } catch (_) {}
    var shown = -1;
    void progress(int percent) {
      if (percent == shown || !context.mounted) return;
      shown = percent;
      updateLoading(context, '正在下載新版本 $percent%');
    }

    progress(0);
    try {
      await platform.download(downloadUrl(target.url, target.versionCode), path, progress);
    } catch (_) {
      throw UpdateFailure(downloadFailed);
    } finally {
      await hideLoading();
    }
    return path;
  }

  // 否則（檔案不完整、拿到舊檔）不交給系統安裝
  Future<void> _checkApk(String path, int versionCode) async {
    if (apkOk(await platform.apkInfo(path), versionCode)) return;
    try {
      await File(path).delete();
    } catch (_) {}
    throw UpdateFailure(incompleteFile);
  }

  // 交給系統安裝；第一次系統會要求允許本 App「安裝未知應用」（系統安裝畫面自己處理）。
  // App 一轉到背景（系統安裝畫面已在前面，即 plus.globalEvent 的 pause）就當交給系統成功；10 秒內沒有轉到背景才當失敗
  Future<void> _install(String path) async {
    final done = Completer<bool>();
    final listener = AppLifecycleListener(onInactive: () {
      if (!done.isCompleted) done.complete(true);
    });
    final timer = Timer(const Duration(seconds: 10), () {
      if (!done.isCompleted) done.complete(false);
    });
    try {
      if (!await platform.install(path) && !done.isCompleted) done.complete(false);
      if (!await done.future) throw UpdateFailure(installFailed);
    } finally {
      timer.cancel();
      listener.dispose();
    }
  }
}

final appUpdate = AppUpdate();
