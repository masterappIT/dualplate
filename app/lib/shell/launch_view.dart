// App 版第一頁（啟動畫面）：一比一移植 mobile/src/pages/launch/launch.vue，和接手的原生層（android/ 的 LaunchCover、LaunchNavBar）。
//
// iOS：第一幀與原生啟動圖（ios/Runner/Base.lproj/LaunchScreen.storyboard，= 現有 App 的 ios/app/HBuilder-Hello/LaunchScreen.storyboard）
// 同一張圖、同一位置：深翠綠 #0B3B30，正中 180pt 的 launch-logo.png（整個螢幕正中，不按安全區）。原生啟動畫面要等 Flutter 畫出第一幀才拿走，
// 所以第一幀等這張圖載入好才畫（main.dart deferFirstFrame），切換時看不出來。之後換上分層（assets/launch/，由 SVG 原樣渲染）播「雙牌合位」：
// 黃色香港牌與黑色內地牌分開再彈回合上，螺絲一閃；等候時反光掃過兩塊玻璃牌。至少停留 2 秒；資料慢就繼續反光等資料；
// 離開時標誌淡出並縮小（0.22 秒），再直接換成登入頁或首頁（reLaunch，不播換頁動畫）。
//
// 安卓（管理者 2026-11-15 決定）：不播動畫，只有一個靜態畫面——深綠底、正中白色 M 雲 100×76dp（= 系統啟動畫面、視窗底 launch_background），
// 蓋住整個螢幕連狀態列、導航列，登入頁或首頁畫好才淡出（0.18 秒）；萬一一直沒有完成，15 秒後也拿走。
// 有上次的首頁資料（homeCache）就不等網絡。第一次打開先問條款同意框（core/privacy.dart），同意前不載入 App。
import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show ImageFilter;
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import '../core/external.dart' show launchExternal;
import '../core/launch.dart';
import '../core/privacy.dart';
import '../pages/login/svg_icon.dart' show SvgImage, brandMark;
import '../ui/tokens.dart';
import 'system_bars.dart';

const _channel = MethodChannel('dualplate/system');

// 第一幀：iOS 等 launch-logo.png 載入好才畫（closeSplash）；最多等 0.8 秒（launch.vue setTimeout(closeSplash, 800)）
abstract final class FirstFrame {
  static bool _deferred = false;
  static void defer() {
    if (_deferred) return;
    _deferred = true;
    WidgetsBinding.instance.deferFirstFrame();
  }

  static void allow() {
    if (!_deferred) return;
    _deferred = false;
    WidgetsBinding.instance.allowFirstFrame();
  }
}

// ---------------------------------------------------------------------------------------------------
// 安卓：靜態啟動畫面（LaunchCover）

// 蓋着整個畫面；hide() 淡出 0.18 秒後拿走（LaunchCover FADE_MS = 180）
class LaunchCover extends StatefulWidget {
  const LaunchCover({super.key, required this.hidden, this.onGone, this.markVisible = true});
  final bool hidden;
  final VoidCallback? onGone;
  // 條款同意框開着時只有深綠底（現有 App 在同意框後面看不到標誌，2026-11-22 模擬器截圖）
  final bool markVisible;
  static const fade = Duration(milliseconds: 180);
  @override
  State<LaunchCover> createState() => _LaunchCoverState();
}

class _LaunchCoverState extends State<LaunchCover> {
  @override
  Widget build(BuildContext context) {
    final cover = IgnorePointer(
      ignoring: widget.hidden,
      child: AnimatedOpacity(
        opacity: widget.hidden ? 0 : 1,
        duration: LaunchCover.fade,
        onEnd: widget.hidden ? widget.onGone : null,
        child: ColoredBox(
          color: C.jadeDeep,
          child: Center(child: widget.markVisible ? const SvgImage(brandMark, width: 100, height: 76) : const SizedBox.shrink()),
        ),
      ),
    );
    // 啟動期間狀態列白字、導航列深綠配淺色按鍵；淡出時交回頁面（LaunchNavBar.restore 在頁面出現時就換）
    return widget.hidden ? cover : AnnotatedRegion<SystemUiOverlayStyle>(value: pageStyle(SystemUiOverlayStyle.light, C.jadeDeep), child: cover);
  }
}

// ---------------------------------------------------------------------------------------------------
// 安卓：條款同意框（DCloud 私隱同意框 template 的樣子，數值按 2026-11-22 Android 17 模擬器現有 App 截圖量得）

abstract final class PrivacyStyle {
  // 系統對話框的變暗 0.6（截圖：深綠變成 #041813）。按「不同意」後再問一次也用這個深翠綠
  //（現有 App 再問時是深灰 #141414，管理者 2026-11-23 決定兩次一樣）
  static const dim = Color(0x99000000);
  static const width = 320.0;
  static const radius = 12.0; // androidPrivacy.json styles.borderRadius
  static const title = Color(0xFF14201B); // styles.title.color
  static const content = Color(0xFF14201B); // styles.content.color
  static const accept = Color(0xFF0F5C4A); // styles.buttonAccept.color
  static const refuse = Color(0xFF6B7A73); // styles.buttonRefuse.color
  static const link = Color(0xFF0000FF); // 安卓 TextView 連結預設藍色，沒有底線（截圖）
  static const titleSize = 16.0;
  static const contentSize = 14.0;
  static const contentLine = 20.75; // 行距（截圖 54.5px ÷ 2.625）
  static const buttonSize = 14.0;
  static const buttonHeight = 52.0; // 兩個按鈕中線相距 51.9
}

class PrivacyDialog extends StatelessWidget {
  const PrivacyDialog({super.key, required this.prompt, required this.onAccept, required this.onRefuse, this.onLink});
  final PrivacyPrompt prompt;
  final VoidCallback onAccept, onRefuse;
  final void Function(String url)? onLink;

  @override
  Widget build(BuildContext context) {
    final width = math.min(PrivacyStyle.width, MediaQuery.sizeOf(context).width - 32);
    TextStyle style(double size, Color color, {FontWeight weight = FontWeight.w400, double height = 1.45}) =>
        ts(size, color: color, weight: weight, height: height).copyWith(decoration: TextDecoration.none);
    final lines = <InlineSpan>[];
    for (var i = 0; i < prompt.message.length; i++) {
      if (i > 0) lines.add(const TextSpan(text: '\n'));
      for (final span in prompt.message[i]) {
        final link = span.link;
        lines.add(TextSpan(
          text: span.text,
          style: link == null ? null : const TextStyle(color: PrivacyStyle.link),
          recognizer: link == null ? null : (TapGestureRecognizer()..onTap = () => (onLink ?? openLink)(link)),
        ));
      }
    }
    Widget button(String text, Color color, VoidCallback onTap) => GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: SizedBox(
            height: PrivacyStyle.buttonHeight,
            child: Center(child: Text(text, style: style(PrivacyStyle.buttonSize, color, weight: FontWeight.w500))),
          ),
        );
    final backdrop = blendOver(PrivacyStyle.dim, C.jadeDeep);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: pageStyle(SystemUiOverlayStyle.light, backdrop),
      child: ColoredBox(
        color: backdrop,
        child: Center(
          child: Container(
            width: width,
            decoration: BoxDecoration(color: const Color(0xFFFFFFFF), borderRadius: BorderRadius.circular(PrivacyStyle.radius)),
            padding: const EdgeInsets.fromLTRB(0, 20, 0, 7),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(prompt.title, textAlign: TextAlign.center, style: style(PrivacyStyle.titleSize, PrivacyStyle.title, weight: FontWeight.w700)),
              ),
              const SizedBox(height: 18),
              Padding(
                // 截圖量得：字由框左 14dp 開始，一行最多 20 個 14sp 中文字（框內可用 280–293dp）
                padding: const EdgeInsets.fromLTRB(14, 0, 18, 0),
                child: Text.rich(TextSpan(children: lines), style: style(PrivacyStyle.contentSize, PrivacyStyle.content, height: PrivacyStyle.contentLine / PrivacyStyle.contentSize)),
              ),
              const SizedBox(height: 7),
              button(prompt.accept, PrivacyStyle.accept, onAccept),
              button(prompt.refuse, PrivacyStyle.refuse, onRefuse),
            ]),
          ),
        ),
      ),
    );
  }

  // 連結：現有 App 用 DCloud 自帶的網頁視窗（hrefLoader default）打開網站的條款頁；這裏交給系統瀏覽器（core/external.dart，不加網頁套件）；打不開就不做甚麼
  static void openLink(String url) => launchExternal(url);
}

// ---------------------------------------------------------------------------------------------------
// iOS：雙牌合位

// 以 Figma 的 1024 座標排版，再整體縮到 180pt（launch.vue .art transform:scale(.17578125)）
const _k = 180 / 1024;

class _Box {
  const _Box(this.x, this.y, this.w, this.h, [this.r = 0]);
  final double x, y, w, h, r;
  Rect get rect => Rect.fromLTWH(x * _k, y * _k, w * _k, h * _k);
}

const _yellowPlate = _Box(194, 88, 796, 456);
const _frame = _Box(272, 136, 640, 302);
const _screwLeft = _Box(316, 225, 48, 48);
const _screwRight = _Box(820, 225, 48, 48);
const _yellowShine = _Box(252, 116, 680, 340, 88);
const _glass = _Box(112, 372, 800, 520, 128);
const _blackPlate = _Box(54, 344, 916, 636);
const _blackShine = _Box(112, 372, 800, 520, 128);
const _m = _Box(252, 434.4, 520, 396);
// 反光斜帶：以整個圖示的座標 top:-200、left:-480、180×1400，transform translateX() rotate(20deg)
const _band = _Box(-480, -200, 180, 1400);

const launchLogo = 'assets/launch/launch-logo.png';
const _layers = ['yellow', 'frame', 'screw', 'black', 'm'];
String _layer(String name) => 'assets/launch/$name.png';

// 動畫數值（launch.vue 的 @keyframes；時間以毫秒計，由開始播放起計）
abstract final class LaunchMotion {
  static const minShow = 2000; // 至少停留 2 秒
  static const fade = 220; // 離開時淡出
  static const plates = 1000; // yellow-move、black-move 1s
  static const settleDelay = 840, settleTime = 260; // .26s ease-out .84s
  static const glintDelay = 880, glintTime = 360; // .36s ease-out .88s
  static const sweepDelay = 1100, sweepTime = 1600; // 1.6s ease-in-out 1.1s infinite
  static const apart = Offset(64, -48); // 44% 時黃牌的位置；黑牌相反
  static const spread = Cubic(.2, .8, .3, 1);
  static const snap = Cubic(.34, 1.56, .64, 1);

  // 黃牌位移（1024 座標）；黑牌是它的相反
  static Offset yellow(double ms) {
    final p = (ms / plates).clamp(0.0, 1.0);
    if (p <= .12) return Offset.zero;
    if (p <= .44) return apart * spread.transform((p - .12) / .32);
    return apart * (1 - snap.transform((p - .44) / .56));
  }

  // 合上一刻圖示輕壓：0%,100% scale(1)，40% scale(.975)；每段 ease-out
  static double settle(double ms) {
    final t = (ms - settleDelay) / settleTime;
    if (t <= 0 || t >= 1) return 1;
    if (t <= .4) return 1 - .025 * Curves.easeOut.transform(t / .4);
    return .975 + .025 * Curves.easeOut.transform((t - .4) / .6);
  }

  // 螺絲一閃：brightness 1 → 1.9（35%）→ 1；每段 ease-out
  static double glint(double ms) {
    final t = (ms - glintDelay) / glintTime;
    if (t <= 0 || t >= 1) return 1;
    if (t <= .35) return 1 + .9 * Curves.easeOut.transform(t / .35);
    return 1.9 - .9 * Curves.easeOut.transform((t - .35) / .65);
  }

  // 反光：0% 不透明 translateX(0)；44% translateX(1500px)；45%–100% 透明。開始前透明
  static ({double x, double opacity}) sweep(double ms) {
    if (ms < sweepDelay) return (x: 0, opacity: 0);
    final c = ((ms - sweepDelay) % sweepTime) / sweepTime;
    if (c <= .44) return (x: 1500 * Curves.easeInOut.transform(c / .44), opacity: 1);
    if (c <= .45) return (x: 1500, opacity: 1 - Curves.easeInOut.transform((c - .44) / .01));
    return (x: 1500, opacity: 0);
  }
}

class LaunchAnimation extends StatefulWidget {
  const LaunchAnimation({super.key, required this.next, required this.onDone});
  // 下一頁（prefetchHome）
  final Future<String> next;
  final void Function(String next) onDone;
  @override
  State<LaunchAnimation> createState() => _LaunchAnimationState();
}

class _LaunchAnimationState extends State<LaunchAnimation> with SingleTickerProviderStateMixin {
  late final DateTime start = DateTime.now();
  late final Ticker _ticker = createTicker((elapsed) => setState(() => ms = elapsed.inMicroseconds / 1000));
  double ms = 0;
  bool closed = false, ready = false, leave = false, broken = false, _precached = false;
  int count = 0;
  String? next;
  Timer? _fallback;

  @override
  void initState() {
    super.initState();
    _fallback = Timer(const Duration(milliseconds: 800), closeSplash); // 圖片萬一沒有載入完成，也不讓啟動畫面卡住
    widget.next.then((url) {
      next = url;
      go();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_precached) return;
    _precached = true;
    precacheImage(const AssetImage(launchLogo), context, onError: (_, _) => shown()).then((_) => shown());
    for (final name in _layers) {
      var failedOnce = false;
      precacheImage(AssetImage(_layer(name)), context, onError: (_, _) {
        failedOnce = true;
        broken = true;
      }).then((_) {
        if (!failedOnce) loaded();
      });
    }
  }

  @override
  void dispose() {
    _fallback?.cancel();
    _ticker.dispose();
    FirstFrame.allow();
    super.dispose();
  }

  void shown() => Timer(const Duration(milliseconds: 16), closeSplash);

  void closeSplash() {
    if (closed || !mounted) return;
    closed = true;
    _fallback?.cancel();
    FirstFrame.allow();
    play();
    go();
  }

  // 分層全部載入才換上；有一層載入失敗就保留靜態圖示，不播動畫
  void loaded() {
    count++;
    play();
  }

  void play() {
    if (!closed || broken || count < _layers.length || ready || !mounted) return;
    setState(() => ready = true);
    if (!MediaQuery.disableAnimationsOf(context)) _ticker.start();
  }

  void go() {
    final url = next;
    if (!closed || url == null || !mounted) return;
    final wait = math.max(0, start.millisecondsSinceEpoch + LaunchMotion.minShow - LaunchMotion.fade - DateTime.now().millisecondsSinceEpoch);
    Timer(Duration(milliseconds: wait), () {
      if (!mounted) return;
      setState(() => leave = true);
      Timer(const Duration(milliseconds: LaunchMotion.fade), () {
        if (mounted) widget.onDone(url);
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final still = MediaQuery.disableAnimationsOf(context); // prefers-reduced-motion:reduce
    final t = still ? 0.0 : ms;
    final fade = still ? Duration.zero : const Duration(milliseconds: LaunchMotion.fade);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: pageStyle(SystemUiOverlayStyle.light, C.jadeDeep), // navigationBarTextStyle white
      child: ColoredBox(
        color: C.jadeDeep,
        child: Stack(children: [
          // 圖示畫布 180pt，置於整個螢幕正中（與 storyboard 的 centerY 一致，不按安全區）
          Positioned(
            left: size.width / 2 - 90,
            top: size.height / 2 - 90,
            width: 180,
            height: 180,
            child: AnimatedOpacity(
              opacity: leave ? 0 : 1,
              duration: fade,
              curve: Curves.easeIn,
              child: AnimatedScale(
                scale: leave ? .94 : 1,
                duration: fade,
                curve: Curves.easeIn,
                child: Stack(children: [
                  if (!ready) Image.asset(launchLogo, width: 180, height: 180, filterQuality: FilterQuality.medium),
                  if (ready) Transform.scale(scale: LaunchMotion.settle(t), child: _art(t)),
                ]),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _image(String name, _Box box) => Positioned.fromRect(rect: box.rect, child: Image.asset(_layer(name), fit: BoxFit.fill, filterQuality: FilterQuality.medium));

  Widget _shine(_Box clip, double t) {
    final sweep = LaunchMotion.sweep(t);
    final band = _band.rect.shift(-clip.rect.topLeft);
    return Positioned.fromRect(
      rect: clip.rect,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(clip.r * _k),
        child: Stack(clipBehavior: Clip.none, children: [
          Positioned.fromRect(
            rect: band,
            child: Opacity(
              opacity: sweep.opacity,
              child: Transform(
                alignment: Alignment.center,
                transform: Matrix4.translationValues(sweep.x * _k, 0, 0)..rotateZ(20 * math.pi / 180),
                child: const DecoratedBox(
                  decoration: BoxDecoration(gradient: LinearGradient(colors: [Color(0x00FFFFFF), Color(0x57FFFFFF), Color(0x00FFFFFF)])),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _art(double t) {
    final yellow = LaunchMotion.yellow(t) * _k;
    final b = LaunchMotion.glint(t);
    final glint = ColorFilter.matrix([b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]);
    Widget screw(_Box box) => Positioned.fromRect(
          rect: box.rect,
          child: ColorFiltered(colorFilter: glint, child: Image.asset(_layer('screw'), fit: BoxFit.fill, filterQuality: FilterQuality.medium)),
        );
    return SizedBox(
      width: 180,
      height: 180,
      child: Stack(clipBehavior: Clip.none, children: [
        Transform.translate(
          offset: yellow,
          child: SizedBox(
            width: 180,
            height: 180,
            child: Stack(clipBehavior: Clip.none, children: [
              _image('yellow', _yellowPlate),
              _image('frame', _frame),
              screw(_screwLeft),
              screw(_screwRight),
              _shine(_yellowShine, t),
            ]),
          ),
        ),
        Transform.translate(
          offset: -yellow,
          child: SizedBox(
            width: 180,
            height: 180,
            child: Stack(clipBehavior: Clip.none, children: [
              // 煙灰玻璃：Figma 的背景模糊（64）在這裏做，牌移動時透出的黃牌也跟着模糊（backdrop-filter:blur(32px)，1024 座標）
              Positioned.fromRect(
                rect: _glass.rect,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(_glass.r * _k),
                  child: BackdropFilter(filter: ImageFilter.blur(sigmaX: 32 * _k, sigmaY: 32 * _k), child: const SizedBox.expand()),
                ),
              ),
              _image('black', _blackPlate),
              _shine(_blackShine, t),
              _image('m', _m),
            ]),
          ),
        ),
      ]),
    );
  }
}

// ---------------------------------------------------------------------------------------------------
// 啟動流程

// 啟動畫面在登入頁或首頁上面：iOS 播完動畫才換頁；安卓的靜態畫面在新頁面畫好後才淡出
class LaunchGate extends StatefulWidget {
  const LaunchGate({super.key, required this.app});
  // 下一頁決定後建立 App（initialLocation = 下一頁）
  final Widget Function(String next) app;
  @override
  State<LaunchGate> createState() => _LaunchGateState();
}

class _LaunchGateState extends State<LaunchGate> with WidgetsBindingObserver {
  final bool android = defaultTargetPlatform == TargetPlatform.android;
  String? next;
  // 安卓：0 不用問、1 第一個同意框、2 再問一次
  int consent = 0;
  bool coverHidden = false, coverGone = false;
  Future<String>? _ios;
  Timer? _coverFallback;

  @override
  void initState() {
    super.initState();
    if (!android) {
      _ios = prefetchHome();
      return;
    }
    if (privacyNeeded()) {
      consent = 1;
      // 同意框開着時返回鍵不起作用（backToExit:false）
      WidgetsBinding.instance.addObserver(this);
      SystemNavigator.setFrameworkHandlesBack(true);
    } else {
      _startAndroid();
    }
  }

  @override
  Future<bool> didPopRoute() async => consent != 0;

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _coverFallback?.cancel();
    super.dispose();
  }

  void _accept() {
    privacyAgreed();
    WidgetsBinding.instance.removeObserver(this);
    setState(() => consent = 0);
    _startAndroid();
  }

  void _refuse() {
    if (consent == 1) return setState(() => consent = 2);
    _channel.invokeMethod<void>('exitApp').catchError((Object _) {});
  }

  // 有上次的首頁資料就不等網絡；萬一一直沒有網絡回應，15 秒後也拿走啟動畫面
  void _startAndroid() {
    _coverFallback = Timer(const Duration(seconds: 15), _hideCover);
    quickHome().then((url) {
      if (!mounted) return;
      setState(() => next = url);
      // 登入頁或首頁顯示好才拿走（reLaunch success）；萬一沒有畫出來，3 秒後也拿走
      WidgetsBinding.instance.endOfFrame.then((_) => WidgetsBinding.instance.endOfFrame).then((_) => _hideCover());
      Timer(const Duration(seconds: 3), _hideCover);
    });
  }

  void _hideCover() {
    if (!mounted || coverHidden) return;
    setState(() => coverHidden = true);
  }

  @override
  Widget build(BuildContext context) {
    final url = next;
    final content = url != null
        ? widget.app(url)
        : android
            ? const ColoredBox(color: C.jadeDeep)
            : LaunchAnimation(next: _ios!, onDone: (url) => setState(() => next = url));
    // MaterialApp 建立前沒有 MediaQuery 和文字方向
    Widget frame(Widget child) => MediaQuery.fromView(view: View.of(context), child: Directionality(textDirection: TextDirection.ltr, child: child));
    if (!android) return url != null ? content : frame(content);
    return frame(
      Stack(children: [
        Positioned.fill(child: content),
        if (!coverGone)
          Positioned.fill(child: LaunchCover(hidden: coverHidden, markVisible: consent == 0, onGone: () => setState(() => coverGone = true))),
        if (consent != 0) Positioned.fill(child: PrivacyDialog(prompt: consent == 1 ? privacyFirst : privacySecond, onAccept: _accept, onRefuse: _refuse)),
      ]),
    );
  }
}
