// 車牌管家視覺識別「證件感」的數值，逐項照抄 mobile/src/App.vue 開頭的變量（docs/design-system.md 第二、八節）。
// 管理者 2026-11-15：App 必須按目前 UI 一比一完成。頁面只可引用這裏的數值，不可自寫顏色、字號、圓角、陰影。
// WebView 的 1px 等於 Flutter 的 1 個邏輯像素，數值不用換算。
import 'package:flutter/widgets.dart';

abstract final class C {
  static const jade = Color(0xFF0F5C4A);
  static const jadeDeep = Color(0xFF0B3B30);
  static const jadeSoft = Color(0xFFE3EFEA);
  static const plateYellow = Color(0xFFF2C230);
  static const paper = Color(0xFFF7F6F1);
  static const card = Color(0xFFFFFFFF);
  static const ink = Color(0xFF14201B);
  static const ink2 = Color(0xFF4E5D55);
  static const ink3 = Color(0xFF85918A);
  static const rule = Color(0xFFE2E1D8);
  static const overdue = Color(0xFFC2362A);
  static const overdueBg = Color(0xFFFBE9E7);
  static const due = Color(0xFFC47A00);
  static const dueBg = Color(0xFFFDF1DC);
  static const ok = Color(0xFF2E7D52);
  static const okBg = Color(0xFFE5F2EA);
  static const active = Color(0xFF2D63A6);
  static const activeBg = Color(0xFFE6EEF8);
  static const muted = Color(0xFF8A8F86);
  static const mutedBg = Color(0xFFEEEEE9);
  // 深綠底上的狀態字色（首頁、帳單、月報封面）
  static const onDeep = Color(0xFFE3EFEA);
  static const onDeep2 = Color(0xB8E3EFEA); // rgba(227,239,234,.72)
  static const onDeepOk = Color(0xFF9FD8B5);
  static const onDeepDue = Color(0xFFF2C230);
  static const onDeepOverdue = Color(0xFFF4A39A);
  // .warn-card
  static const warnBorder = Color(0xFFEBCF94);
  static const warnBg = Color(0xFFFFFBF0);
  // 底部分頁（pages.json tabBar）
  static const tabText = Color(0xFF85918A);
  static const tabSelected = Color(0xFF0F5C4A);
  static const tabBg = Color(0xFFFFFFFF);
}

// 字號只用五級（不隨螢幕寬度縮放），另有統計數字 28；輸入框 16
abstract final class Fs {
  static const title = 22.0;
  static const h = 16.0;
  static const body = 14.0;
  static const meta = 13.0;
  static const cap = 12.0;
  static const stat = 28.0;
}

abstract final class R {
  static const control = 4.0;
  static const card = 8.0;
  static const panel = 12.0;
  static const pill = 99.0;
}

abstract final class Shadows {
  // --float:0 12px 32px rgba(11,59,48,.14)
  static const float = [BoxShadow(offset: Offset(0, 12), blurRadius: 32, color: Color(0x240B3B30))];
  // .segmented .seg.on：0 1px 2px rgba(11,59,48,.12)
  static const seg = [BoxShadow(offset: Offset(0, 1), blurRadius: 2, color: Color(0x1F0B3B30))];
}

// 按鈕和控件高度：主要 48、次要 44、行內小按鈕 40、篩選小籤 36、分段 36、輸入框最少 48
abstract final class H {
  static const primary = 48.0;
  static const secondary = 44.0;
  static const small = 40.0;
  static const chip = 36.0;
  static const seg = 36.0;
  static const field = 48.0;
}

// 動畫：App.vue 的 transition .18s ease；按下 opacity .9、scale .985
abstract final class Motion {
  static const fast = Duration(milliseconds: 180);
  static const ease = Cubic(0.25, 0.1, 0.25, 1.0); // CSS ease
  static const pressOpacity = 0.9;
  static const pressScale = 0.985;
  static const disabledOpacity = 0.55;
}

// 字型：App.vue 的 font-family 次序（-apple-system 排第一，中文才落到 PingFang TC）。
// -apple-system 在 Flutter 是 '.AppleSystemUIFont'；不指定時英文數字會用蘋方，短橫較長，粗體英文還會畫成空心（1b 2026-11-15 實測）。
// Android 沒有這個字型，照 CSS 次序往下找。
// CSS 的 line-height 把多出的行距平均分到上下（half-leading），Flutter 要用 TextLeadingDistribution.even 才會一樣；
// WebView 又把行高向下取整到整數 px（例如 14px×1.6 = 22.4 → 22），所以 ts() 也取整。
const fontFamily = '.AppleSystemUIFont';
const fontFallback = ['PingFang TC', 'Noto Sans TC', 'PingFang SC'];

double cssLine(double size, double height) => (size * height + 1e-6).floorToDouble() / size;

TextStyle ts(double size, {FontWeight weight = FontWeight.w400, Color color = C.ink, double height = 1.5, double? letterSpacing}) => TextStyle(
      fontSize: size,
      fontWeight: weight,
      color: color,
      height: cssLine(size, height),
      fontFamily: fontFamily,
      letterSpacing: letterSpacing,
      leadingDistribution: TextLeadingDistribution.even,
      fontFamilyFallback: fontFallback,
      decoration: TextDecoration.none,
    );

// font-weight 700 / 800
const w700 = FontWeight.w700;
const w800 = FontWeight.w800;

// 單選、勾選（wd-radio shape="dot"、wd-checkbox shape="square"）：數值取自 wot-design-uni 1.14 的 common/abstracts/variable.scss、
// wd-radio/index.scss、wd-checkbox/index.scss；選中色是 App.vue 的 --wot-color-theme（= C.jade），其餘 App.vue 沒有覆寫。
abstract final class WotChoice {
  static const label = Color(0xD9000000); // $-checkbox-label-color rgba(0,0,0,.85)
  static const labelFs = 14.0; // $-checkbox-label-fs
  static const labelLine = 20.0; // .wd-radio__label / .wd-checkbox__txt line-height:20px
  static const border = Color(0xFFDCDCDC); // $-radio-dot-border-color、$-checkbox-border-color
  static const box = Color(0xFFFFFFFF); // $-checkbox-bg（勾選框未選時白底）
  static const check = Color(0xFFFFFFFF); // $-checkbox-check-color、單選圓點內的白點
  static const size = 16.0; // $-radio-size、$-checkbox-size
  static const borderWidth = 2.0;
  static const dot = 8.0; // $-radio-dot-size
  static const icon = 14.0; // $-checkbox-icon-size（check-bold 字形）
  static const squareRadius = 4.0; // $-checkbox-square-radius
  static const labelGap = 9.0; // $-checkbox-label-margin（勾選框和文字的距離）
  static const radioMargin = 10.0; // $-radio-margin：每個 .wd-radio 的 margin-top（第一個也有）
  static const duration = Duration(milliseconds: 200); // 圓點 transform .2s ease-in；勾選框底色 background .2s、勾號 opacity .2s
  static const easeIn = Cubic(0.42, 0.0, 1.0, 1.0); // CSS ease-in
}

// 提示（uni.showToast({ title, icon: 'none' })）：App 端是原生等待框 plus.nativeUI.showWaiting，
// uni-app-plus dist/uni.runtime.esm.js 傳 padding 10px、字 16px、不顯示 loading、modal:false（不擋操作）；
// 其餘用 5+ API 預設：背景 rgba(0,0,0,.7)、白字、圓角 10px、置中。iOS 的等待框是 MBProgressHUD 改版：淡入淡出 0.3 秒，文字最寬為螢幕寬減 4 倍內距。
abstract final class ToastStyle {
  static const bg = Color(0xB3000000); // rgba(0,0,0,.7)
  static const fg = Color(0xFFFFFFFF);
  static const fs = 16.0;
  static const line = 1.4; // UILabel 用系統字型的自然行高（PingFang 約 1.4 倍）
  static const padding = 10.0;
  static const radius = 10.0;
  static const fade = Duration(milliseconds: 300);
  static const duration = Duration(milliseconds: 1500); // uni.showToast 預設 duration 1500
}

// ── 1b 業務小組件（仿真車牌、PlateChip、DueDate、StampMark）的顏色，照抄 mobile/src/components/ 各組件的 <style> 和行內樣式 ──
abstract final class PlateC {
  // 內地、澳門牌：黑色金屬底 linear-gradient(180deg,#262626 0%,#0b0b0b 45%,#141414 100%)
  static const darkTop = Color(0xFF262626);
  static const darkMid = Color(0xFF0B0B0B);
  static const darkBottom = Color(0xFF141414);
  static const whiteText = Color(0xFFF5F5F5); // 白字、分隔點、澳門短橫
  static const rim = Color(0xFFF2F2F2); // 內地牌白色內框
  static const moEdge = Color(0xFFC9C9C9); // 澳門牌銀色細框
  static const rivetLight = Color(0xFFD9D9D9); // 內地、澳門牌鉚釘 radial-gradient
  static const rivetDark = Color(0xFF7A7A7A);
  static const rivetRing = Color(0xFF3A3A3A);
  // 香港牌：黃色反光底 linear-gradient(180deg,#ffd83a 0%,#f6c400 55%,#eab900 100%)
  static const hkTop = Color(0xFFFFD83A);
  static const hkMid = Color(0xFFF6C400);
  static const hkBottom = Color(0xFFEAB900);
  static const hkEdge = Color(0x8C3C2D00); // rgba(60,45,0,.55)
  static const hkText = Color(0xFF111111);
  static const screwLight = Color(0xFFF4F4F4);
  static const screwDark = Color(0xFF9A9A9A);
  static const screwRing = Color(0x59000000); // rgba(0,0,0,.35)
  // 陰影顏色（box-shadow、text-shadow）
  static const black = Color(0xFF000000);
  static const black95 = Color(0xF2000000);
  static const black90 = Color(0xE6000000);
  static const black70 = Color(0xB3000000);
  static const black55 = Color(0x8C000000);
  static const black50 = Color(0x80000000);
  static const black28 = Color(0x47000000);
  static const black22 = Color(0x38000000);
  static const white75 = Color(0xBFFFFFFF);
  static const white60 = Color(0x99FFFFFF);
  static const white55 = Color(0x8CFFFFFF);
  static const white45 = Color(0x73FFFFFF);
  static const white40 = Color(0x66FFFFFF);
  static const white32 = Color(0x52FFFFFF);
  static const white30 = Color(0x4DFFFFFF);
  static const white20 = Color(0x33FFFFFF);
  static const white18 = Color(0x2EFFFFFF);
  static const white12 = Color(0x1FFFFFFF);
  static const white06 = Color(0x0FFFFFFF);
  static const white0 = Color(0x00FFFFFF);
  static const hkShade90 = Color(0xE65A4100); // rgba(90,65,0,.9)
  static const hkShade55 = Color(0x8C785500); // rgba(120,85,0,.55)
  static const hkShade60 = Color(0x99503700); // rgba(80,55,0,.6)
  // PlateChip.vue
  static const chipMainland = Color(0xFF141414);
  static const chipWhite = Color(0xFFFFFFFF);
  static const chipInk = Color(0xFF111111);
  static const chipEdge = Color(0x2E000000); // rgba(0,0,0,.18)
}

// 車牌字型（照抄各組件 font-family 次序）
const plateLatinFont = 'DIN Alternate'; // MainlandPlate.vue 英文數字
const plateLatinFallback = ['DIN Condensed', 'Arial Narrow', 'Arial'];
const plateHanFont = 'PingFang SC'; // MainlandPlate.vue 粵、港、澳
const plateHanFallback = ['Heiti SC', 'Microsoft YaHei'];
const plateArialFont = 'Arial'; // HongKongPlate.vue、MacauPlate.vue
const plateArialFallback = ['Helvetica Neue'];

// 外殼（階段 1c）：頂部導航列、底部分頁、換頁動畫。現在 App 這幾樣由 DCloud 原生層畫，數值取自 uni-app App 端預設：
// @dcloudio/uni-shared NAVBAR_HEIGHT 44、TABBAR_HEIGHT 50；uni-cli-shared DEFAULT_TAB_BAR（字 10px、圖示 24px、間距 3px）；
// pages.json tabBar.borderStyle "white" → rgba(255,255,255,.4)；HTML5+ titleNView 標題 17px、左右留 88px、返回圖示 27px；
// uni-app-plus 換頁 pop-in、300ms。iOS 換頁和返回箭頭位置按 iPhone 16 Pro Max 現有 App 錄影量度（2026-11-15，/private/tmp/dualplate-flutter/1c/app/）。
abstract final class Shell {
  static const navHeight = 44.0;
  static const navTitleSize = 17.0;
  static const navTitleWeight = FontWeight.w400; // 現有 App 截圖是一般粗細（網頁版是粗體）
  static const navTitleInset = 88.0;
  // 1e 複核全局字型修正（8892462）後：iPhone 17 Flutter 版三個分頁標題的墨跡頂都比 16 Pro Max 現有 App 低 1/3pt（一個實際像素），
  // 高度、粗細相同，所以整行上移 1/3pt
  static const navTitleDy = -1 / 3;
  static const navText = Color(0xFF000000); // navigationBarTextStyle black
  static const backIconSize = 27.0;
  static const backInset = 7.0; // 現有 App 截圖：箭頭墨跡左距 16pt（字形本身左空 9pt）
  static const tabHeight = 50.0;
  static const tabIcon = 24.0;
  // 網頁版 uni-app 預設圖示置中、spacing 3px；原生分頁列不同。量 iPhone 16 Pro Max 現有 App 截圖（3 倍）：
  // 圖示頂距分頁列頂 6.5pt，圖示底到文字行（行高 14）頂 1/3pt，照現有 App
  static const tabIconTop = 6.5;
  static const tabSpacing = 1 / 3;
  static const tabFontSize = 10.0;
  static const tabBorder = Color(0x66FFFFFF);
  // iOS：量現有 App 錄影，推入和返回都是 300ms easeInOut（誤差約 1pt）；上一頁左移 25%、蓋上 20% 黑色（亮度到 0.8）；新頁邊緣沒有陰影
  static const pageDuration = Duration(milliseconds: 300);
  static const pageCurve = Cubic(0.42, 0.0, 0.58, 1.0);
  static const pageParallax = 0.25;
  static const pageDim = 0.2;
  // Android：DCloud SDK lib.5plus.base res/anim dcloud_page_open_enter/exit、dcloud_page_close_enter/exit
  // （pop-in 用這四個，見 AnimOptions、core/ui/i）：打開 300ms、返回 360ms，decelerate；上一頁左移 25%、透明度 1→0.6；沒有陰影
  static const pageDurationAndroid = Duration(milliseconds: 300);
  static const pageReverseDurationAndroid = Duration(milliseconds: 360);
  static const pageCurveAndroid = Curves.decelerate; // android decelerate_interpolator：1-(1-t)²
  static const pageParallaxAndroid = 0.25;
  static const pageDimAndroid = 0.6;
  static const swipeEdge = 20.0; // iOS 從左邊緣右滑的感應寬度
}
