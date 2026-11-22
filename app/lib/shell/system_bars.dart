// 安卓底部導航列那一條：對應 mobile/src/lib/nav-bar.js 和 android/ 的 LaunchNavBar.java。
// 現有 App 的網頁停在導航列上面，所以由原生層把那一條塗成 iPhone 上同一位置的顏色：
// 有標籤列的頁面跟標籤列（白），其他頁面用頁面底色 #F7F6F1（批文卡相機頁黑），彈窗打開時疊上遮罩（標籤頁的遮罩蓋不到標籤列，不變），
// 啟動期間深綠；淺色底配深色按鍵，深色底配淺色按鍵；彈窗開關時按鍵顏色在變色一半時才換。
// Flutter 版整個畫面延伸到導航列後面（edge-to-edge；Android 15 起系統不再讓 App 指定導航列底色），所以由頁面自己在那一條畫實色（BottomStrip），
// 內容停在它上面，和現有 App 一樣：有導航列的頁面（AppPage）和登入頁畫頁面底色，彈窗區（DialogArea）的遮罩蓋到它，打開彈窗時跟着變暗；
// 分頁的標籤列本來就延伸到最底（白），不另外畫；批文卡相機頁自己留黑色（card_capture_page.dart）。
// 導航列本身透明、不加系統的半透明襯底，按鍵深淺跟那一條的顏色（Flutter 讀畫面最底那一點的 AnnotatedRegion）。
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import '../ui/tokens.dart';

// back-close.js 的 WOT_OVERLAY rgba(0,0,0,.65)
const wotOverlay = Color(0xA6000000);

// 'rgba(r,g,b,a)' 疊在 '#RRGGBB' 上的顏色（nav-bar.js blend）
Color blendOver(Color mask, Color base) {
  final a = mask.a;
  int ch(double m, double b) => ((m * a + b * (1 - a)) * 255).round().clamp(0, 255);
  return Color.fromARGB(255, ch(mask.r, base.r), ch(mask.g, base.g), ch(mask.b, base.b));
}

// 淺色底配深色圖示（LaunchNavBar.isLight）
bool isLightColor(Color c) {
  int v(double x) => (x * 255).round();
  return v(c.r) * 299 + v(c.g) * 587 + v(c.b) * 114 >= 128000;
}

// 那一條是 under 這個顏色時的導航列設定（只有導航列的欄位，狀態列交給頂部的設定）
SystemUiOverlayStyle navBarStyle(Color under) => SystemUiOverlayStyle(
      systemNavigationBarColor: const Color(0x00000000),
      systemNavigationBarDividerColor: const Color(0x00000000),
      systemNavigationBarIconBrightness: isLightColor(under) ? Brightness.dark : Brightness.light,
      systemNavigationBarContrastEnforced: false,
    );

// 頁面整頁的設定（狀態列字色 + 那一條）：login、批文卡相機頁用
SystemUiOverlayStyle pageStyle(SystemUiOverlayStyle status, Color bottom) {
  final nav = navBarStyle(bottom);
  return status.copyWith(
    systemNavigationBarColor: nav.systemNavigationBarColor,
    systemNavigationBarDividerColor: nav.systemNavigationBarDividerColor,
    systemNavigationBarIconBrightness: nav.systemNavigationBarIconBrightness,
    systemNavigationBarContrastEnforced: false,
  );
}

// 全 App 預設：頁面底色（分頁的標籤列白色也是淺色，一樣配深色按鍵）
Widget navBarDefault(Widget child) => AnnotatedRegion<SystemUiOverlayStyle>(value: navBarStyle(C.paper), child: child);

// 彈窗遮罩：變色一半（遮罩淡入一半）時那一條換成遮罩疊在頁面底色上的顏色。
// 標籤頁的彈窗區停在標籤列上面，畫面最底那一點不在遮罩裏，自然不變（和 nav-bar.js 一樣）
class MaskNavBar extends StatelessWidget {
  const MaskNavBar({super.key, required this.animation, required this.child});
  final Animation<double> animation;
  final Widget child;
  static final _style = navBarStyle(blendOver(wotOverlay, C.paper));
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: animation,
        child: child,
        builder: (context, child) => animation.value >= .5 ? AnnotatedRegion<SystemUiOverlayStyle>(value: _style, child: child!) : child!,
      );
}

// 安卓：整個畫面延伸到狀態列和導航列後面（Android 15 起系統本來就這樣；較舊的版本也照做，各版本一致）
Future<void> setupSystemBars() async {
  if (defaultTargetPlatform != TargetPlatform.android) return;
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(navBarStyle(C.paper));
}

// 安卓：底部導航列那一條畫實色 color，child 排在它上面（畫面高度扣掉那一條、底部安全區當作 0、鍵盤高度扣掉那一條）。iOS 照舊鋪滿到最底
class BottomStrip extends StatelessWidget {
  const BottomStrip({super.key, required this.color, required this.child});
  final Color color;
  final Widget child;
  @override
  Widget build(BuildContext context) {
    if (defaultTargetPlatform != TargetPlatform.android) return child;
    final media = MediaQuery.of(context);
    final inset = media.viewPadding.bottom;
    if (inset <= 0) return child;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(
        child: MediaQuery(
          // 現有 App 的網頁停在那一條上面：畫面高度（vh）、底部安全區、鍵盤高度都按網頁的範圍算
          data: media.copyWith(
            size: Size(media.size.width, media.size.height - inset),
            padding: media.padding.copyWith(bottom: 0),
            viewPadding: media.viewPadding.copyWith(bottom: 0),
            viewInsets: media.viewInsets.copyWith(bottom: math.max(0.0, media.viewInsets.bottom - inset)),
          ),
          child: child,
        ),
      ),
      SizedBox(height: inset, child: ColoredBox(color: color)),
    ]);
  }
}
