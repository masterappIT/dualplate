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

// ── 1d 登入頁（mobile/src/pages/login/login.vue、lib/ports-canvas.js、ContactCard.vue）──
abstract final class LoginStyle {
  // .hero：深通行綠，字色 #E3EFEA（扭索紋 currentColor）；高 calc(52vh + 30px)，最少 350；寬 780 以上 46vh
  static const heroVh = .52;
  static const heroVhWide = .46;
  static const heroExtra = 30.0;
  static const heroMin = 350.0;
  static const heroTop = 28.0; // 狀態列高度 + 28
  static const sheetOverlap = 48.0; // .sheet margin-top:-48px（寬 780 以上 -80）
  static const sheetOverlapWide = 80.0;
  static const sheetWidthWide = 560.0;
  static const white = Color(0xFFFFFFFF);
  static const brandMarkW = 42.0;
  static const brandMarkH = 32.0;
  // 口岸網絡畫布（ports-canvas.js）
  static const portLine = Color(0x29E3EFEA); // rgba(227,239,234,.16)
  static const pulseHalo = Color(0x38F2C230); // rgba(242,194,48,.22)
  static const pulseDot = Color(0xFFF2C230);
  static const nodeHalo = Color(0x1FE3EFEA); // rgba(227,239,234,.12)
  static const node = Color(0xFFE3EFEA);
  static const portLabel = Color(0x9EE3EFEA); // rgba(227,239,234,.62)
  static const portLabelSize = 12.0;
  static const burstColor = Color(0xFFF2C230); // rgba(242,194,48,1-k)
  static const frame = Duration(microseconds: 16667); // requestAnimationFrame 60 幀／秒（WKWebView 預設上限）
  // 輸入框：.field 加 uni-input（height 1.4em → 高 48，字 16、行高 22）；佔位字 gray
  static const placeholder = Color(0xFF808080);
  static const inputLine = 1.4;
  static const caret = Color(0xFF007AFF); // WKWebView 的游標用 iOS 系統藍（App.vue 沒有設 caret-color）
  static const focusRing = Color(0x73F2C230); // .field:focus box-shadow 0 0 0 3px rgba(242,194,48,.45)
  static const areaWidth = 128.0;
  // 送出中：uni-button[disabled]:not([type]) 灰底、淡黑字，蓋過 .primary 的綠底；.login-button.busy opacity .85
  static const busyBg = Color(0xFFF7F7F7);
  static const busyText = Color(0x4D000000); // rgba(0,0,0,.3)
  static const busyOpacity = .85;
  // 錯誤時卡片搖動：.38s ease，0%→20%→40%→60%→80%→100% 的 translateX
  static const shake = Duration(milliseconds: 380);
  static const shakeFrames = [0.0, -7.0, 6.0, -4.0, 2.0, 0.0];
  static const enterDelay = Duration(milliseconds: 700); // 印章後 700ms 轉到首頁
  // 區號選擇器：uni-app App 端的 __uniapppicker（uni-app-vite/lib/template/__uniapppicker.js）
  static const pickerMask = Color(0x66000000); // iOS rgba(0,0,0,.4)
  static const pickerMaskAndroid = Color(0x99000000); // 安卓 rgba(0,0,0,.6)
  static const pickerDuration = Duration(milliseconds: 200);
  static const pickerHeight = 261.0; // 另加底部安全區
  static const pickerHeader = 45.0;
  static const pickerBody = 216.0;
  static const pickerRow = 34.0;
  static const pickerLine = Color(0xFFC8C9C9);
  static const pickerCancel = Color(0xFF888888);
  static const pickerConfirm = Color(0xFF007AFF);
  static const pickerText = Color(0xFF000000);
  static const pickerBg = Color(0xFFFFFFFF);
  static const pickerActionSize = 17.0;
  static const pickerItemSize = 16.0;
  static const pickerFadeTop = Color(0xF2FFFFFF); // picker-view 遮罩 hsla(0,0%,100%,.95) → .6
  static const pickerFadeMid = Color(0x99FFFFFF);
}

// ── 1d 鍵盤上方的「⌃ ⌄ 完成」列（ui/keyboard_bar.dart）──
// 量自現有 App（iPhone 16 Pro Max，iOS 18.4，WKWebView 的表單輔助列，硬件鍵盤時貼在畫面底部）：
// 高 44、底 #F0F0F1、頂部 1 物理像素細線 #919497；⌃ 中心離左 31.5、⌄ 中心離左 71.2，各 17.6×9.6；「完成」右邊離右 21.7
abstract final class KeyboardBarStyle {
  static const height = 44.0;
  static const bg = Color(0xFFF0F0F1);
  static const line = Color(0xFF919497);
  static const tint = Color(0xFF007AFF);
  static const disabled = Color(0xFFBCBCBC); // 不能按的箭頭
  static const doneSize = 17.0;
  static const chevronW = 17.6;
  static const chevronH = 9.6;
  static const chevronStroke = 2.2;
  static const sidePad = 11.5;
  static const itemW = 40.0; // 每個箭頭的觸控寬度：中心 31.5、71.5
  static const itemGap = 0.0;
  static const donePad = 10.0; // 「完成」左右內距：右邊離右 21.5
}

// ── 2a 拍批文卡（mobile/src/components/CardCapture.vue 的 <style scoped>、lib/pick-image.js 的說明卡）──
// 對準框的位置按畫面計算（CardCapture.vue 的 layout()），不在這裏
abstract final class CaptureStyle {
  static const bg = Color(0xFF000000); // .capture background:#000
  static const fg = Color(0xFFFFFFFF); // color:#fff
  static const mask = Color(0x94000000); // .frame box-shadow 0 0 0 2000px rgba(0,0,0,.58)
  static const frameRadius = 12.0;
  static const cornerSize = 30.0; // .corner 30×30、border 4px #fff、外移 2px
  static const cornerBorder = 4.0;
  static const cornerOffset = 2.0;
  static const frameSideMax = 560.0; // 框寬 min(畫面寬 - 40, 560)，高按 1015:645
  static const frameInset = 40.0;
  static const frameTopMin = 120.0; // 框頂最少離狀態列底 120，否則置中再上移 40
  static const frameLift = 40.0;
  static const topHeight = 64.0; // .top：高 64、字 17、粗 600
  static const titleSize = 17.0;
  static const titleWeight = FontWeight.w600;
  static const closeLeft = 8.0; // .close：左 8、48×48、字 24、粗 300
  static const closeSize = 48.0;
  static const closeFont = 24.0;
  static const closeWeight = FontWeight.w300;
  static const sidesAbove = 48.0; // .sides 在框頂上方 48
  static const sidesGap = 8.0;
  static const sidePadH = 12.0; // .side：padding 4px 12px、圓角 --r-control、字 --fs-body、粗 500
  static const sidePadV = 4.0;
  static const sideWeight = FontWeight.w500;
  static const sideOff = Color(0x29FFFFFF); // rgba(255,255,255,.16)
  static const hintBelow = 18.0; // .hint 在框底下方 18；左右 24；行高 1.6
  static const hintSide = 24.0;
  static const hintLine = 1.6;
  static const hint = Color(0xE0FFFFFF); // rgba(255,255,255,.88)
  static const bottomHeight = 170.0; // .bottom：高 170、padding 0 32px 32px
  static const bottomPadH = 32.0;
  static const bottomPadB = 32.0;
  static const albumWidth = 72.0; // .album：寬 72、間距 6、字 --fs-meta
  static const albumGap = 6.0;
  static const albumIcon = 36.0; // .album-icon：36×36、2px 白框、圓角 --r-card
  static const albumIconBorder = 2.0;
  static const shutter = 76.0; // .shutter：76 圓、4px 白框、5px 空隙、內圓白色
  static const shutterBorder = 4.0;
  static const shutterGap = 5.0;
  static const buttonsBottom = 48.0; // .buttons：寬 calc(100% - 40px)、最多 560、底 48、間距 12
  static const buttonsInset = 40.0;
  static const buttonsGap = 12.0;
  static const buttonHeight = 48.0; // .buttons button：高 48、字 16、粗 600、圓角 --r-control
  static const buttonFont = 16.0;
  static const buttonWeight = FontWeight.w600;
  static const ghostBorder = Color(0xB3FFFFFF); // .ghost border 1px rgba(255,255,255,.7)
  // 2b 即時找卡邊（現有 App 沒有，等管理者確認）：對齊的框線、四角和「可以拍了」用深綠底上的「正常」綠（C.onDeepOk），
  // 黑色遮罩和鏡頭畫面上都看得清；線粗和外移沿用四角（cornerBorder、cornerOffset）
  static const edgeOn = C.onDeepOk;
  static const readySize = Fs.h; // 「可以拍了」16、粗 600
  static const readyWeight = FontWeight.w600;
}

// 安卓申請權限時頂部的用途說明卡、被拒提示卡（pick-image.js showCard：plus.nativeObj.View 原生圖層）
abstract final class PermCardStyle {
  static const top = 8.0; // 狀態列高度 + 8
  static const side = 12.0; // 左 12、寬 = 畫面寬 - 24
  static const bg = Color(0xFFFFFFFF);
  static const border = Color(0xFFD9E0DC);
  static const radius = 12.0;
  static const padH = 16.0; // 字左 16，字寬 = 卡寬 - 32
  static const titleTop = 14.0; // 標題：頂 14、高 22、字 16 粗體 #14201B
  static const titleHeight = 22.0;
  static const titleSize = 16.0;
  static const title = Color(0xFF14201B);
  static const textTop = 40.0; // 內文：頂 40、字 14 #4A5852、lineSpacing 20%
  static const textSize = 14.0;
  static const text = Color(0xFF4A5852);
  static const textLine = 1.2;
  static const charWidth = 14.0; // 高度按字數估算：每字當 14 寬、每行 21 高，卡高 = 54 + 行數 × 21
  static const lineHeight = 21.0;
  static const baseHeight = 54.0;
  static const deniedFor = Duration(seconds: 5); // 被拒提示約 5 秒後自動收起
}

// ── 2c 牌照詳情頁（mobile/src/pages/plate-detail/plate-detail.vue、components/ApprovalCard.vue）──
// 按鈕不可按（:disabled）：uni-button[disabled]:not([type]) 的灰底淡字蓋過 .primary／.btn-sm 的底色和字色，
// 再加 App.vue 的 .primary[disabled]{opacity:.55}（1d 在登入頁核實同一規則）
abstract final class UniDisabled {
  static const bg = Color(0xFFF7F7F7);
  static const text = Color(0x4D000000); // rgba(0,0,0,.3)
}

// <switch color="#0F5C4A">：App 端是網頁組件 uni-switch（@dcloudio/uni-components/style/switch.css）
abstract final class UniSwitchStyle {
  static const width = 52.0;
  static const height = 32.0;
  static const marginRight = 5.0;
  static const off = Color(0xFFDFDFDF); // 邊框和底色
  static const inner = Color(0xFFFDFDFD); // :before 50×30，選中時 scale(0)
  static const knob = Color(0xFFFFFFFF); // :after 30×30
  static const knobShadow = [BoxShadow(offset: Offset(0, 1), blurRadius: 3, color: Color(0x66000000))]; // 0 1px 3px rgba(0,0,0,.4)
  static const travel = 20.0; // translateX(20px)
  static const colorDuration = Duration(milliseconds: 100); // background-color .1s, border .1s
  static const moveDuration = Duration(milliseconds: 300); // transform .3s（ease）
  static const disabledOpacity = .7;
}

// uni.showLoading({ title, mask:true })：App 端原生等待框 plus.nativeUI.showWaiting，有圖示時 140×112，內距 10、字 16（uni-app-plus _showToast）
abstract final class LoadingStyle {
  static const width = 140.0;
  static const height = 112.0;
  static const spinner = 37.0; // iOS UIActivityIndicatorView large（MBProgressHUD）
  static const spinnerColor = Color(0xFFFFFFFF);
}

// uni.previewImage：App 端原生圖片檢視器 plus.nativeUI.previewImage（indicator 'number'、loop false）
abstract final class PreviewStyle {
  static const bg = Color(0xFF000000);
  static const indicator = Color(0xFFFFFFFF);
  static const indicatorSize = 16.0;
  static const fade = Duration(milliseconds: 250);
  static const maxScale = 3.0;
}

// 牌照詳情頁各區塊（plate-detail.vue <style scoped>）
abstract final class PlateDetailStyle {
  static const notesHeight = 96.0; // .notes{height:96px}
  static const plateMissingRatio = 440 / 140; // .plate-missing aspect-ratio
  static const macauRatio = 460 / 100; // .physical-plate.macau aspect-ratio
  static const macauBg = Color(0xFF050505);
  static const macauText = Color(0xFFFFFFFF);
  static const macauRadius = 2.0;
  static const missingRadius = 4.0;
  static const scrollDuration = Duration(milliseconds: 200); // uni.pageScrollTo duration:200
  static const scrollDelay = Duration(milliseconds: 50);
  static const stampDelay = Duration(milliseconds: 10);
  static const crossToast = Duration(milliseconds: 2600);
}

// 批文卡（ApprovalCard.vue）：卡面比例 1013:643；字號、位置都是卡寬的百分比（cqw）
abstract final class ApprovalCardStyle {
  static const ratio = 1013 / 643;
  static const radiusRpx = 13.0;
  static const shadowYRpx = 3.0;
  static const shadowBlurRpx = 10.0;
  static const shadow = Color(0x301B3040); // #1b304030
  static const faceBg = Color(0xFFEDF2F1);
  static const perspective = 1200.0;
  static const flip = Duration(milliseconds: 650);
  static const flipCurve = Cubic(.22, .67, .22, 1);
  static const title = Color(0xFF15191B);
  static const label = Color(0xFF062F69);
  static const value = Color(0xFF252525);
  static const warning = Color(0xFF07386B);
  static const lineHeight = 1.12;
  // 卡面字型：CSS 是 'Songti SC','STSong','Noto Serif CJK SC',serif。
  // iOS 沒有預裝宋體（iOS 18.4、26 模擬器的系統字型都沒有 Songti、STSong），現有 App 落到 serif：英文數字 Times、中文蘋方。
  //   Flutter 版在 iOS 照這個結果畫（2c 在 iPhone 16 Pro Max 現有 App 截圖核實）。
  // Android 很多手機沒有 Noto Serif CJK：打包它的子集 DualplateSong（Noto Serif SC，產生方法和授權見 tool/song_subset.py）。
  static const iosLatin = 'Times New Roman';
  static const iosHan = ['PingFang TC'];
  static const androidSong = 'DualplateSong';
  static const arial = 'Arial';
  static const arialFallback = ['Helvetica Neue'];
  // 翻面切換鈕（.flip-controls，詳情頁隱藏，新增牌照頁用）
  static const ctrlBorder = Color(0xFFC4D5CD);
  static const ctrlBg = Color(0xFFF5F8F6);
  static const ctrlText = Color(0xFF345146);
  static const ctrlOn = Color(0xFF295A48);
  static const ctrlOnText = Color(0xFFFFFFFF);
  static const hint = Color(0xFF668076);
}
