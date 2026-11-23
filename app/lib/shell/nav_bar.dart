// 頂部導航列：對應 pages.json globalStyle（#F7F6F1 底、黑字）和 uni-app App 端原生標題欄（titleNView）。
// 標題置中、17px 一般粗細、左右各留 88px、太長尾部省略；可以返回時左邊顯示返回箭頭（DCloud 圖示字型 ，27px，黑色）。
// 不用 Material AppBar：沒有陰影、沒有分隔線、標題不靠左、沒有水波紋。
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import '../ui/dialogs.dart';
import 'system_bars.dart';
import '../ui/tokens.dart';

class NavBar extends StatelessWidget {
  const NavBar(this.title, {super.key, this.back, this.action});
  final String title;
  // null：按所在頁面能否返回自動決定（分頁頁面沒有返回箭頭，和 uni-app 的 isQuit 頁面一樣）
  final bool? back;
  // 右上角的文字按鈕（線上客服頁的「完成」）；沒有時不放
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    final showBack = back ?? (ModalRoute.of(context)?.canPop ?? false);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark, // navigationBarTextStyle black：狀態列黑色字
      child: Container(
        height: top + Shell.navHeight,
        padding: EdgeInsets.only(top: top),
        color: C.paper,
        child: Stack(children: [
          Positioned(
            left: Shell.navTitleInset,
            right: Shell.navTitleInset,
            top: 0,
            bottom: 0,
            child: Center(
              child: Transform.translate(
                offset: const Offset(0, Shell.navTitleDy),
                child: Text(title,
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: ts(Shell.navTitleSize, weight: Shell.navTitleWeight, color: Shell.navText, height: 1.2)),
              ),
            ),
          ),
          if (showBack) Positioned(left: 0, top: 0, bottom: 0, child: BackArrow(onTap: () => Navigator.of(context).maybePop())),
          if (action != null) Positioned(right: 0, top: 0, bottom: 0, child: action!),
        ]),
      ),
    );
  }
}

class BackArrow extends StatelessWidget {
  const BackArrow({super.key, required this.onTap});
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => GestureDetector(
        key: const ValueKey('nav-back'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: const SizedBox(
          width: Shell.navHeight,
          height: Shell.navHeight,
          child: Padding(
            padding: EdgeInsets.only(left: Shell.backInset),
            child: Align(alignment: Alignment.centerLeft, child: CustomPaint(size: Size.square(Shell.backIconSize), painter: _BackPainter())),
          ),
        ),
      );
}

// DCloud SDK PandoraApi.bundle/iconfont.ttf 的 uniE601 字形（1024 單位，ascent 960），照輪廓畫，不另外打包字型
class _BackPainter extends CustomPainter {
  const _BackPainter();
  static final Path _glyph = Path()
    ..moveTo(697, 709)
    ..lineTo(407, 434)
    ..lineTo(697, 159)
    ..quadraticBezierTo(705, 151, 705, 139.5)
    ..quadraticBezierTo(705, 128, 697, 121)
    ..quadraticBezierTo(689, 113, 678.5, 113)
    ..quadraticBezierTo(668, 113, 660, 121)
    ..lineTo(352, 413)
    ..quadraticBezierTo(347, 417, 345.5, 422.5)
    ..quadraticBezierTo(344, 428, 344, 434)
    ..quadraticBezierTo(344, 439, 345.5, 444.5)
    ..quadraticBezierTo(347, 450, 352, 454)
    ..lineTo(660, 746)
    ..quadraticBezierTo(668, 754, 678.5, 754)
    ..quadraticBezierTo(689, 754, 697, 746)
    ..quadraticBezierTo(705, 739, 705, 727.5)
    ..quadraticBezierTo(705, 716, 697, 709)
    ..close();

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.height / 1024;
    canvas
      ..save()
      ..translate(0, 960 * scale)
      ..scale(scale, -scale)
      ..drawPath(_glyph, Paint()..color = Shell.navText..isAntiAlias = true)
      ..restore();
  }

  @override
  bool shouldRepaint(_BackPainter old) => false;
}

// 有導航列的頁面：紙色底，導航列在上，內容填滿其餘位置（manifest safearea.background #F7F6F1，底部安全區也是紙色）。
// 內容區就是現有 App 的 WebView：確認框、選單只蓋這一塊（DialogArea，見 dialogs.dart），狀態列和導航列不變暗。
class AppPage extends StatelessWidget {
  const AppPage({super.key, required this.title, this.back, this.action, this.child});
  final String title;
  final bool? back;
  final Widget? action;
  final Widget? child;
  @override
  Widget build(BuildContext context) => ColoredBox(
        color: C.paper,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          NavBar(title, back: back, action: action),
          // 安卓：底部導航列那一條畫紙色，在彈窗區之內，遮罩蓋得到（system_bars.dart BottomStrip，nav-bar.js）
          Expanded(child: MediaQuery.removePadding(context: context, removeTop: true, child: DialogArea(child: BottomStrip(color: C.paper, child: child ?? const SizedBox.shrink())))),
        ]),
      );
}
