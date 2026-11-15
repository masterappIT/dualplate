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
