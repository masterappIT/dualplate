// 安卓底部導航列那一條（lib/shell/system_bars.dart）：顏色和按鍵深淺照 mobile/src/lib/nav-bar.js、android/ 的 LaunchNavBar.java。
import 'package:dualplate/shell/system_bars.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('遮罩疊在頁面底色上：#F7F6F1 加 rgba(0,0,0,.65) = #565654', () {
    // nav-bar.js blend：Math.round(m*a + b*(1-a))
    final c = blendOver(wotOverlay, C.paper);
    expect(c.toARGB32(), 0xFF565654);
  });

  test('頁面底色是淺色：配深色按鍵', () => expect(navBarStyle(C.paper).systemNavigationBarIconBrightness, Brightness.dark));
  test('標籤列白色是淺色：配深色按鍵', () => expect(navBarStyle(const Color(0xFFFFFFFF)).systemNavigationBarIconBrightness, Brightness.dark));
  test('啟動期間深綠：配淺色按鍵', () => expect(navBarStyle(C.jadeDeep).systemNavigationBarIconBrightness, Brightness.light));
  test('彈窗遮罩疊上後是深色：配淺色按鍵', () => expect(navBarStyle(blendOver(wotOverlay, C.paper)).systemNavigationBarIconBrightness, Brightness.light));
  test('批文卡相機頁黑色：配淺色按鍵', () => expect(navBarStyle(const Color(0xFF000000)).systemNavigationBarIconBrightness, Brightness.light));
  test('導航列本身透明、不加系統襯底', () {
    final s = navBarStyle(C.paper);
    expect(s.systemNavigationBarColor, const Color(0x00000000));
    expect(s.systemNavigationBarContrastEnforced, isFalse);
  });
  test('深綠就是啟動畫面的 #0B3B30', () => expect(C.jadeDeep.toARGB32(), 0xFF0B3B30));
}
