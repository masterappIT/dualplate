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

// 字型：App.vue 的 font-family 次序；CSS 的 line-height 把多出的行距平均分到上下（half-leading），
// Flutter 要用 TextLeadingDistribution.even 才會一樣，否則每行高低位置差一兩個像素。
const fontFallback = ['PingFang TC', 'Noto Sans TC', 'PingFang SC'];

TextStyle ts(double size, {FontWeight weight = FontWeight.w400, Color color = C.ink, double height = 1.5, double? letterSpacing}) => TextStyle(
      fontSize: size,
      fontWeight: weight,
      color: color,
      height: height,
      letterSpacing: letterSpacing,
      leadingDistribution: TextLeadingDistribution.even,
      fontFamilyFallback: fontFallback,
      decoration: TextDecoration.none,
    );

// font-weight 700 / 800
const w700 = FontWeight.w700;
const w800 = FontWeight.w800;

// 外殼（階段 1c）：頂部導航列、底部分頁、換頁動畫。現在 App 這幾樣由 DCloud 原生層畫，數值取自 uni-app App 端預設：
// @dcloudio/uni-shared NAVBAR_HEIGHT 44、TABBAR_HEIGHT 50；uni-cli-shared DEFAULT_TAB_BAR（字 10px、圖示 24px、間距 3px）；
// pages.json tabBar.borderStyle "white" → rgba(255,255,255,.4)；HTML5+ titleNView 標題 17px、左右留 88px、返回圖示 27px；
// uni-app-plus 換頁 pop-in、300ms；SDK PandoraApi.bundle/left-shadow-img@2x.png（10pt 寬，黑色由 0 到約 10%）。
abstract final class Shell {
  static const navHeight = 44.0;
  static const navTitleSize = 17.0;
  static const navTitleWeight = FontWeight.w400; // 現有 App 截圖是一般粗細（網頁版是粗體）
  static const navTitleInset = 88.0;
  static const navText = Color(0xFF000000); // navigationBarTextStyle black
  static const backIconSize = 27.0;
  static const backInset = 5.0; // uni-app 網頁版導航列 padding 3 + 按鈕 margin 2（原生層未能核對）
  static const tabHeight = 50.0;
  static const tabIcon = 24.0;
  // 網頁版 uni-app 預設圖示置中、spacing 3px；原生分頁列不同。量 iPhone 16 Pro Max 現有 App 截圖（3 倍）：
  // 圖示頂距分頁列頂 6.5pt，圖示底到文字行（行高 14）頂 1/3pt，照現有 App
  static const tabIconTop = 6.5;
  static const tabSpacing = 1 / 3;
  static const tabFontSize = 10.0;
  static const tabBorder = Color(0x66FFFFFF);
  static const pageDuration = Duration(milliseconds: 300);
  static const pageCurve = Cubic(0.42, 0.0, 0.58, 1.0); // 未能從 SDK 查到，暫用 iOS UIView 預設 easeInOut
  static const pageParallax = 1 / 3; // 上一頁向左移的比例，未能從 SDK 查到
  static const edgeShadowWidth = 10.0;
  static const edgeShadow = Color(0x19000000);
  static const swipeEdge = 20.0; // iOS 從左邊緣右滑的感應寬度
}
