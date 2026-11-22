// 安卓返回鍵在分頁和第一頁：照 uni-app-plus 的 quit()（@dcloudio/uni-app-plus dist/uni.runtime.esm.js，navigateBack 遇 meta.isQuit）。
// 四個分頁，以及用 reLaunch 打開或第一個打開的頁面（啟動時未登入的登入頁）是 isQuit：
// 先關最上層彈窗（back-close.js 的 onBackPress）；沒有彈窗時，第一次按顯示系統提示「再按一次退出應用」，2 秒內再按就退出 App。
// 提示是原生 toast（plus.nativeUI.toast），文字按手機的語言（uni-app 內建的 uni.app.quit）；退出是 plus.runtime.quit()：關掉畫面，程序可能留着。
// 其他頁面照常返回。iOS 沒有返回鍵，不經這裏。
import 'dart:ui' show Locale, PlatformDispatcher;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import '../ui/back_gate.dart';
import '../ui/loading.dart';
import '../ui/toast.dart';

// uni-app 內建的 uni.app.quit；語言照 uni-i18n 的 normalizeLocale（zh-Hant／TW／HK／MO 用繁體，其餘中文用簡體，找不到的語言用英文）
String quitText(Locale locale) {
  final tag = locale.toLanguageTag().toLowerCase();
  if (tag.startsWith('zh')) {
    if (tag.contains('-hans')) return '再按一次退出应用';
    if (tag.contains('-hant') || ['-tw', '-hk', '-mo', '-cht'].any(tag.contains)) return '再按一次退出應用';
    return '再按一次退出应用';
  }
  if (tag.startsWith('fr')) return "Appuyez à nouveau pour quitter l'application";
  if (tag.startsWith('es')) return 'Pulse otra vez para salir';
  return 'Press back button again to exit';
}

abstract final class BackQuit {
  static const _channel = MethodChannel('dualplate/system');
  static DateTime? _first;
  // 測試換成假的
  static void Function(String text) nativeToast = (text) => _channel.invokeMethod<void>('toast', text).catchError((Object _) {});
  static void Function() quitApp = () => _channel.invokeMethod<void>('quit').catchError((Object _) {});
  static DateTime Function() now = DateTime.now;

  static void press() {
    // navigateBack 先 uni.hideToast()、uni.hideLoading()
    hideToast();
    hideLoading();
    // 2 秒內再按就退出；否則重新計時並提示（uni-app 用 setTimeout 2 秒後清掉第一次的時間，效果相同）
    final first = _first, t = now();
    if (first != null && t.difference(first) < const Duration(seconds: 2)) {
      _first = null;
      quitApp();
      return;
    }
    _first = t;
    nativeToast(quitText(PlatformDispatcher.instance.locale));
  }

  @visibleForTesting
  static void reset() => _first = null;
}

// 包在分頁外殼和登入頁外面：這一頁是第一頁（沒有上一頁）時，安卓返回鍵照上面處理
class QuitOnBack extends StatefulWidget {
  const QuitOnBack({super.key, required this.child});
  final Widget child;
  @override
  State<QuitOnBack> createState() => _QuitOnBackState();
}

class _QuitOnBackState extends State<QuitOnBack> {
  late final _entry = _QuitEntry(this);
  ModalRoute<dynamic>? _route;

  bool get _android => defaultTargetPlatform == TargetPlatform.android;

  @override
  void initState() {
    super.initState();
    if (_android) BackGate.rootBack = BackQuit.press;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route == _route) return;
    _route?.unregisterPopEntry(_entry);
    _route = route;
    route?.registerPopEntry(_entry);
  }

  @override
  void dispose() {
    _route?.unregisterPopEntry(_entry);
    _entry.canPop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final first = ModalRoute.of(context)?.isFirst ?? false;
    // 不在 build 裏通知路由（見 page_show.dart syncBack）
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _entry.canPop.value = !(_android && first);
    });
    return widget.child;
  }
}

class _QuitEntry extends PopEntry<Object?> {
  _QuitEntry(this.owner);
  final _QuitOnBackState owner;
  final canPop = ValueNotifier<bool>(true);
  @override
  ValueListenable<bool> get canPopNotifier => canPop;
  @override
  void onPopInvokedWithResult(bool didPop, Object? result) {
    final route = owner._route;
    if (didPop || route == null || !route.isFirst || !owner._android) return;
    // 有彈窗或浮層：這一下由它們關掉（back-close.js closeTopLayer 回傳 true），不算退出
    if (BackGate.blocked(route)) return;
    BackQuit.press();
  }
}
