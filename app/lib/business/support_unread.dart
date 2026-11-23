// 線上客服的紅點（管理者 11-23「先做第一種，H5 和 App 一起改」）：App 開著、客戶已登入時，在看不見的內嵌網頁用背景模式打開客服頁
// （deploy/web/support/index.html?bg=1：不打開對話、不放區塊），MasterBox 小視窗送出未讀數，網頁經 DualplateSupport 通道送「unread:數字」。
// 未讀數顯示在底部「我的」分頁和「聯絡客服」按鈕（超過 99 寫 99+）。App 關著時沒有提示（要第二步的 Webhook 和推送）。
// - 和前景的客服頁同一網域、同一個網頁資料區（iOS WKWebView、安卓 WebView 的預設），所以是同一位訪客、同一段對話。
// - 登入後或啟動時已登入就開始；退出登入或登入失效時先清掉帶入的資料（clearData）再收起，紅點歸零。未登入的畫面不載入。
// - 載入失敗、沒有網絡：不顯示紅點，也不提示。
// - 客戶打開客服頁時紅點歸零（對話全屏，看得見就算讀了），這段時間不理背景送來的數字；關上客服頁後重新載入背景網頁，拿最新的未讀數。
//   App 回到前景時也重新載入（在背景時網頁可能被系統暫停）。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../core/session.dart';
import 'support.dart';

// 「unread:3」→ 3；其他訊息、不是數字回傳 null；負數當 0
int? parseUnread(String message) {
  if (!message.startsWith('unread:')) return null;
  final n = int.tryParse(message.substring(7).trim());
  return n == null ? null : (n < 0 ? 0 : n);
}

// 紅點上的字：超過 99 寫 99+
String badgeText(int count) => count > 99 ? '99+' : '$count';

abstract final class SupportUnread {
  // 現在的未讀數（紅點聽這個）
  static final count = ValueNotifier<int>(0);
  static bool _viewing = false;
  static VoidCallback? _reload;

  // 背景網頁送來的數字：客服頁開著時不理（客戶正在看）
  static void report(int value) {
    if (!_viewing) count.value = value;
  }

  // 客服頁打開：紅點歸零；關上：重新載入背景網頁拿最新的數字。
  // 由客服頁的 initState、dispose 呼叫，那時正在建構畫面，所以等這一輪做完才改（不在建構中要求重畫）
  static void viewingStarted() {
    _viewing = true;
    scheduleMicrotask(() {
      if (_viewing) count.value = 0;
    });
  }

  static void viewingEnded() {
    _viewing = false;
    scheduleMicrotask(() => _reload?.call());
  }

  // 只給測試用
  static void debugReset() {
    _viewing = false;
    _reload = null;
    count.value = 0;
  }
}

// 放在 App 最外層：已登入時在畫面最底下放一個 1×1 的內嵌網頁（被頁面蓋住、不能點），其他時候甚麼都不放
class SupportBackground extends StatefulWidget {
  const SupportBackground({super.key, required this.child});
  final Widget child;
  // 測試用：代替內嵌網頁，畫出要打開的網址；沒有設定而且測試環境沒有內嵌網頁時，整個功能不啟動
  static Widget Function(String url)? debugView;
  @override
  State<SupportBackground> createState() => SupportBackgroundState();
}

class SupportBackgroundState extends State<SupportBackground> {
  WebViewController? controller;
  String? url;
  String? _token; // 開始時的登入 token：換了人就重新開始
  int _run = 0; // 每次開始、重新載入或收起加一：舊的載入完成時已過時就丟掉
  bool _starting = false;
  late final AppLifecycleListener _life;

  static bool get _available => SupportBackground.debugView != null || WebViewPlatform.instance != null;

  @override
  void initState() {
    super.initState();
    _life = AppLifecycleListener(onResume: reload);
    Session.changes.addListener(_sync);
    SupportUnread._reload = reload;
    _sync();
  }

  @override
  void dispose() {
    Session.changes.removeListener(_sync);
    if (SupportUnread._reload == reload) SupportUnread._reload = null;
    _life.dispose();
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  bool get running => url != null || _starting;

  // 登入狀態變了：登入了就開始（換了人重新開始）；退出了就收起
  void _sync() {
    if (signedIn) {
      if (!running) {
        unawaited(_start());
      } else if (_token != getToken()) {
        reload();
      }
    } else if (running) {
      unawaited(_stop());
    }
  }

  Future<void> _start() async {
    if (!_available) return;
    final run = ++_run;
    _starting = true;
    _token = getToken();
    try {
      final next = await buildSupportUrl(background: true);
      if (!mounted || run != _run || !signedIn) return;
      if (SupportBackground.debugView != null) return _set(() => url = next);
      final c = WebViewController();
      await c.setJavaScriptMode(JavaScriptMode.unrestricted);
      await c.addJavaScriptChannel('DualplateSupport', onMessageReceived: (m) {
        final n = parseUnread(m.message);
        if (n != null && run == _run) SupportUnread.report(n);
      });
      // 背景網頁不換到別的網址
      await c.setNavigationDelegate(NavigationDelegate(onNavigationRequest: (r) => r.isMainFrame && !isSupportPage(r.url) ? NavigationDecision.prevent : NavigationDecision.navigate));
      await c.loadRequest(Uri.parse(next));
      if (!mounted || run != _run || !signedIn) return;
      _set(() {
        controller = c;
        url = next;
      });
    } catch (_) {
      // 載入不了：不顯示紅點、不提示
    } finally {
      if (run == _run) _starting = false;
    }
  }

  // 退出登入：先清掉這個網站帶入的資料（換人用不會混），再拿走網頁；紅點歸零
  Future<void> _stop() async {
    final run = ++_run;
    _starting = false;
    SupportUnread.count.value = 0;
    final c = controller;
    if (c != null) {
      try {
        await c.runJavaScript("window.MasterBoxChat && window.MasterBoxChat.push(['clearData'])").timeout(const Duration(seconds: 2));
      } catch (_) {}
    }
    if (run == _run) {
      _set(() {
        controller = null;
        url = null;
      });
    }
  }

  // 重新載入（關上客服頁、App 回到前景、換了人）：重新組網址，資料也跟著更新
  void reload() {
    if (!signedIn || !running) return;
    _set(() {
      controller = null;
      url = null;
    });
    unawaited(_start());
  }

  // 結構固定（網頁那一格一直在，沒有網頁時是空的），開始或收起時頁面不會重建
  @override
  Widget build(BuildContext context) {
    final c = controller, u = url, debug = SupportBackground.debugView;
    final view = u == null ? null : (debug != null ? debug(u) : (c == null ? null : WebViewWidget(controller: c)));
    return Stack(textDirection: TextDirection.ltr, children: [
      Positioned(
        key: const ValueKey('support-background'),
        left: 0,
        bottom: 0,
        width: 1,
        height: 1,
        child: view == null ? const SizedBox.shrink() : IgnorePointer(child: ExcludeSemantics(child: view)),
      ),
      Positioned.fill(key: const ValueKey('support-background-app'), child: widget.child),
    ]);
  }
}
