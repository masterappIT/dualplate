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
