// 相機和相片權限、選相片（對應 mobile/src/lib/pick-image.js 的 askPermission、notifyDenied 和單一來源的 pickImage）。
// 安卓：申請相機或讀相片權限時，同時在畫面頂部說明用途（內地要求申請權限時同步告知目的）；已有權限就不顯示。
// 被拒時頂部提示到設定開啟（約 5 秒後自動收起，按一下也會收起）。說明卡出現時系統權限框會把整個畫面調暗，這是系統畫的，App 不能蓋過。
// iOS 用 Info.plist 的用途說明，由系統自動詢問，不經這裏（askPermission 對 iOS 直接回傳 true），和現有 App 一樣。
// 系統相片選擇器、系統相機頁由系統畫，和現有 App（DCloud 的相冊、相機）不同，計劃第二節准許。
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import '../ui/tokens.dart';

enum PhotoSource { camera, album }

typedef PermissionTip = ({String title, String text});

// 文字照搬 pick-image.js
const Map<PhotoSource, PermissionTip> permissionTips = {
  PhotoSource.camera: (title: '相機權限使用說明', text: '用來拍攝批文卡、證件或車輛相片，用於你正在填寫的資料。'),
  PhotoSource.album: (title: '相片權限使用說明', text: '用來選擇批文卡、證件或車輛相片，只會讀取你選的相片。'),
};
const Map<PhotoSource, PermissionTip> deniedTips = {
  PhotoSource.camera: (title: '未取得相機權限', text: '如要拍照，請到手機「設定 › 應用程式 › 跨境車牌管家 › 權限」開啟相機。'),
  PhotoSource.album: (title: '未取得相片權限', text: '如要選相片，請到手機「設定 › 應用程式 › 跨境車牌管家 › 權限」開啟相片。'),
};

bool get _android => defaultTargetPlatform == TargetPlatform.android;

// 安卓系統版本（MainActivity 的 dualplate/system 通道）；讀不到回傳 0
const _system = MethodChannel('dualplate/system');
Future<int> androidSdk() async {
  try {
    return await _system.invokeMethod<int>('sdkInt') ?? 0;
  } catch (_) {
    return 0;
  }
}

// Android 13 起讀相片要 READ_MEDIA_IMAGES；12 或以下讀儲存空間（pick-image.js permissionsFor）。
// Android 14 起系統框有「允許部分相片」（READ_MEDIA_VISUAL_USER_SELECTED，系統自動加給要求 READ_MEDIA_IMAGES 的 App）：
// 權限套件回報 limited，這裏當作取得，和 pick-image.js 任何一項取得就算取得（hasAny）相同。
Permission _permissionFor(PhotoSource source, int sdk) => source == PhotoSource.camera ? Permission.camera : sdk >= 33 ? Permission.photos : Permission.storage;

/// 安卓：申請相機或讀相片權限，申請時在頂部顯示用途說明；回傳是否取得。
/// 已有權限、Android 6 以前、讀不到版本或申請出錯都當取得（之後交給系統相機或選擇器自己處理）。其他平台直接回傳 true。
/// 等系統真正回覆才回傳；等不到時只收起說明卡，不當作拒絕。被拒時本函數不提示，由呼叫的地方用 [notifyDenied] 提示。
Future<bool> askPermission(BuildContext context, PhotoSource source) async {
  if (!_android) return true;
  final overlay = Overlay.maybeOf(context, rootOverlay: true);
  final top = MediaQuery.maybeViewPaddingOf(context)?.top ?? 24;
  Permission permission;
  try {
    final sdk = await androidSdk();
    if (sdk > 0 && sdk < 23) return true;
    permission = _permissionFor(source, sdk);
    final status = await permission.status;
    if (status.isGranted || status.isLimited) return true;
  } catch (_) {
    return true;
  }
  final hide = overlay == null ? () {} : showPermissionCard(overlay, permissionTips[source]!, top: top);
  final granted = await _requestWithStall(permission, hide);
  hide();
  return granted;
}

/// 安卓：權限被拒時在頂部提示到設定開啟（約 5 秒後自動收起，按一下也會收起）。其他平台不做事。
void notifyDenied(BuildContext context, PhotoSource source) {
  if (!_android) return;
  final overlay = Overlay.maybeOf(context, rootOverlay: true);
  if (overlay == null) return;
  final hide = showPermissionCard(overlay, deniedTips[source]!, top: MediaQuery.maybeViewPaddingOf(context)?.top ?? 24, tapToClose: true);
  Timer(PermCardStyle.deniedFor, hide);
}

// 申請權限，回傳系統的結果（拒絕或允許都等系統真正回覆才回傳；慢的手機系統框可能 20 秒以上才出現）。
// 等不到回應時只收起說明卡（onStall），不當作拒絕：30 秒內系統框都沒出現（App 視窗沒有失去焦點），或系統框關上後 5 秒仍未回覆。
// 系統權限框出現時 App 失去焦點，Flutter 報 inactive（照 pick-image.js 看 hasWindowFocus 的做法）。
Future<bool> _requestWithStall(Permission permission, VoidCallback onStall) async {
  var settled = false, sawDialog = false, idle = 0;
  var focused = true;
  final listener = AppLifecycleListener(onStateChange: (state) => focused = state == AppLifecycleState.resumed);
  void tick() {
    if (settled) return;
    if (!focused) {
      sawDialog = true;
      idle = 0;
    } else {
      idle += 500;
      if (idle >= (sawDialog ? 5000 : 30000)) {
        onStall();
        return;
      }
    }
    Timer(const Duration(milliseconds: 500), tick);
  }

  Timer(const Duration(milliseconds: 500), tick);
  try {
    final status = await permission.request();
    return status.isGranted || status.isLimited;
  } catch (_) {
    return true;
  } finally {
    settled = true;
    listener.dispose();
  }
}

/// 畫面頂部的卡片：用途說明和拒絕提示共用；回傳收起函數。
/// 照 pick-image.js showCard：頂 = 狀態列 + 8、左右 12；高度按字數估算（每字當 14 寬），長句換行完整顯示；tapToClose 時按一下收起。
VoidCallback showPermissionCard(OverlayState overlay, PermissionTip tip, {required double top, bool tapToClose = false}) {
  OverlayEntry? entry;
  void close() {
    entry?.remove();
    entry = null;
  }

  entry = OverlayEntry(builder: (context) => PermissionCard(tip: tip, top: top, onTap: tapToClose ? close : null));
  overlay.insert(entry!);
  return close;
}

class PermissionCard extends StatelessWidget {
  const PermissionCard({super.key, required this.tip, required this.top, this.onTap});
  final PermissionTip tip;
  final double top;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final windowWidth = MediaQuery.sizeOf(context).width;
    final width = windowWidth - PermCardStyle.side * 2, textWidth = width - PermCardStyle.padH * 2;
    final perLine = (textWidth / PermCardStyle.charWidth).floor().clamp(1, 1 << 20);
    final lines = (tip.text.length / perLine).ceil().clamp(1, 1 << 20);
    final textHeight = lines * PermCardStyle.lineHeight;
    final card = Container(
      width: width,
      height: PermCardStyle.baseHeight + textHeight,
      decoration: BoxDecoration(
        color: PermCardStyle.bg,
        borderRadius: BorderRadius.circular(PermCardStyle.radius),
        border: Border.all(color: PermCardStyle.border),
      ),
      child: Stack(children: [
        Positioned(
          left: PermCardStyle.padH,
          top: PermCardStyle.titleTop,
          width: textWidth,
          height: PermCardStyle.titleHeight,
          child: Text(tip.title, maxLines: 1, style: ts(PermCardStyle.titleSize, weight: w700, color: PermCardStyle.title, height: PermCardStyle.titleHeight / PermCardStyle.titleSize)),
        ),
        Positioned(
          left: PermCardStyle.padH,
          top: PermCardStyle.textTop,
          width: textWidth,
          height: textHeight,
          child: Text(tip.text, style: ts(PermCardStyle.textSize, color: PermCardStyle.text, height: PermCardStyle.textLine)),
        ),
      ]),
    );
    return Positioned(
      top: top + PermCardStyle.top,
      left: PermCardStyle.side,
      child: onTap == null ? IgnorePointer(child: card) : GestureDetector(onTap: onTap, child: card),
    );
  }
}

/// 從相機或相冊選一張相片（原圖）；取消或打不開回傳 null。
/// 安卓先經 [askPermission] 申請權限，被拒時提示到設定開啟，當作取消（pick-image.js withPermission）。
Future<XFile?> pickPhoto(BuildContext context, PhotoSource source, {ImagePicker? picker}) async {
  if (_android) {
    if (!await askPermission(context, source)) {
      if (context.mounted) notifyDenied(context, source);
      return null;
    }
  }
  try {
    return await (picker ?? ImagePicker()).pickImage(source: source == PhotoSource.camera ? ImageSource.camera : ImageSource.gallery, requestFullMetadata: false);
  } catch (_) {
    // 例如模擬器沒有相機：現有 App 的 uni.chooseImage 失敗時也是甚麼都不做
    return null;
  }
}
