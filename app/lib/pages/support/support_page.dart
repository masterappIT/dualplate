// 線上客服頁（docs/tasks/support-masterbox-plan.md 第 2 部分，草稿 ③）：App 自己的標題列（「線上客服」、右上「完成」），下面是內嵌網頁。
// 內嵌網頁打開本產品網站的 /support/（deploy/web/support/index.html），由它全屏打開 MasterBox 對話；網址 # 後面帶客戶資料和預填句子（business/support.dart）。
// 網址：/support?text=<預填句子>&public=1（未登入的畫面，不帶資料）。
// - 「完成」、或對話自己關上（網頁經 DualplateSupport 通道送 close）都回到原頁。
// - 安卓的內嵌網頁預設不能選檔案：setOnShowFileSelector 接上現有的選相片（pick_image.dart，image_picker）；相片和影片以外的檔案用 file_picker。
//   iOS 由系統的網頁選檔畫面處理（相機、相簿的說明文字已在 Info.plist）。
// - 對話以外的連結（例如 MasterBox 的服務條款）用手機的瀏覽器打開，不在客服頁裏換頁。
import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/widgets.dart';
import 'package:image_picker/image_picker.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../../business/pick_image.dart';
import '../../business/support.dart';
import '../../core/external.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/tokens.dart';

enum AcceptKind { image, media, file }

// 網頁要選甚麼：accept 全部是相片（image/… 或圖片副檔名）→ image；相片和影片（MasterBox 的「相片和影片」）→ media；
// 有其他檔案或沒寫 accept → file
AcceptKind acceptKind(List<String> acceptTypes) {
  final types = [for (final t in acceptTypes) for (final x in t.split(',')) if (x.trim().isNotEmpty) x.trim().toLowerCase()];
  const imageExt = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'};
  bool image(String t) => t.startsWith('image/') || imageExt.contains(t);
  if (types.isEmpty) return AcceptKind.file;
  if (types.every(image)) return AcceptKind.image;
  if (types.every((t) => image(t) || t.startsWith('video/'))) return AcceptKind.media;
  return AcceptKind.file;
}

// 客服頁網址是不是本頁（換頁時只有本頁留在內嵌網頁裏，其他連結用瀏覽器打開）
bool isSupportPage(String url) {
  final u = Uri.tryParse(url), s = Uri.parse(supportUrl);
  return u != null && u.scheme == s.scheme && u.host == s.host && u.port == s.port && u.path == s.path;
}

class SupportPage extends StatefulWidget {
  const SupportPage({super.key, this.query = const {}});
  final Map<String, String> query;
  // 測試用：代替內嵌網頁，畫出要打開的網址（測試環境沒有原生的內嵌網頁）
  static Widget Function(String url)? debugView;
  @override
  State<SupportPage> createState() => SupportPageState();
}

class SupportPageState extends State<SupportPage> {
  WebViewController? controller;
  String? url;
  bool failed = false, closing = false;

  @override
  void initState() {
    super.initState();
    unawaited(_start());
  }

  Future<void> _start() async {
    final url = await buildSupportUrl(text: widget.query['text'] ?? '', public: widget.query['public'] == '1');
    if (!mounted) return;
    if (SupportPage.debugView != null) return _set(() => this.url = url);
    final c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(C.paper)
      ..addJavaScriptChannel(
        'DualplateSupport',
        onMessageReceived: (m) {
          if (m.message == 'close') done();
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            if (!request.isMainFrame || isSupportPage(request.url) || request.url == 'about:blank') return NavigationDecision.navigate;
            unawaited(launchExternal(request.url));
            return NavigationDecision.prevent;
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame ?? true) _set(() => failed = true);
          },
        ),
      );
    final platform = c.platform;
    if (platform is AndroidWebViewController) {
      await platform.setOnShowFileSelector(_pickFiles);
      await platform.setMediaPlaybackRequiresUserGesture(false);
    }
    await c.loadRequest(Uri.parse(url));
    _set(() => controller = c);
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  // 「完成」和對話關上：回到原頁（只關一次）
  void done() {
    if (closing || !mounted) return;
    closing = true;
    Navigator.of(context).maybePop();
  }

  void retry() {
    _set(() {
      failed = false;
      controller = null;
    });
    unawaited(_start());
  }

  // 安卓：網頁要選檔案。網頁要求拍照（MasterBox 的「相機」）時開相機；相片、相片和影片（「相片和影片」）開相冊；其他檔案（「檔案」）用系統的檔案選擇器。
  // 相機和相冊照現有的選相片先申請權限（pick_image.dart）。取消、被拒或出錯回傳空清單
  Future<List<String>> _pickFiles(FileSelectorParams params) async {
    if (!mounted) return const [];
    final kind = acceptKind(params.acceptTypes);
    if (params.isCaptureEnabled || kind == AcceptKind.image) {
      final file = await pickPhoto(context, params.isCaptureEnabled ? PhotoSource.camera : PhotoSource.album);
      return file == null ? const [] : [Uri.file(file.path).toString()];
    }
    if (kind == AcceptKind.media) {
      if (!await askPermission(context, PhotoSource.album)) {
        if (mounted) notifyDenied(context, PhotoSource.album);
        return const [];
      }
      try {
        final file = await ImagePicker().pickMedia(requestFullMetadata: false);
        return file == null ? const [] : [Uri.file(file.path).toString()];
      } catch (_) {
        return const [];
      }
    }
    try {
      final files = await FilePicker.pickFiles();
      return [for (final f in files) f.uri.toString()];
    } catch (_) {
      return const [];
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = controller, debug = SupportPage.debugView;
    // 鍵盤升起時內嵌網頁縮到鍵盤上方，輸入框不被蓋住
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return AppPage(
      title: '線上客服',
      back: false,
      action: _DoneButton(onTap: done),
      child: failed
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Empty('連不上客服，請檢查網絡後再試'),
                  Btn('重新載入', kind: BtnKind.line, onTap: retry),
                ],
              ),
            )
          : debug != null && url != null
          ? debug(url!)
          : c == null
          ? const SizedBox.expand()
          : Padding(
              padding: EdgeInsets.only(bottom: keyboard),
              child: WebViewWidget(controller: c),
            ),
    );
  }
}

// 「完成」：標題列右邊，綠色粗體（草稿 ③ .navbar .right），點擊範圍和返回箭頭一樣高
class _DoneButton extends StatelessWidget {
  const _DoneButton({required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(
    key: const ValueKey('support-done'),
    behavior: HitTestBehavior.opaque,
    onTap: onTap,
    child: SizedBox(
      height: Shell.navHeight,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Center(
          widthFactor: 1,
          child: Text(
            '完成',
            style: ts(Fs.h, weight: w700, color: C.jade, height: 1),
          ),
        ),
      ),
    ),
  );
}
