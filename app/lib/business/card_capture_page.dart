// 全螢幕拍批文卡頁（一比一照 mobile/src/components/CardCapture.vue 的 App 版和 pages/card-capture）。
// - 打開即開鏡頭：全螢幕預覽、對準框和四角、標題「拍批文卡」、「① 正面 ② 背面」、提示、快門、左下「從相冊選」。
// - 開不了鏡頭（拒絕權限、沒有鏡頭，例如 iOS 模擬器）：標題改「對準批文卡」，下面「從相冊選／拍照」（拍照用系統相機）。
// - 選了相片：雙指縮放、拖動對框，「重選／確認」；確認截出框內卡面（card_stage.dart）。
// - 安卓開鏡頭前先申請相機權限，同時頂部顯示用途說明；拒絕了照樣繼續，鏡頭開不了就改為「拍照／從相冊選」（pick_image.dart）。
// 和現有 App 不同的只有系統畫的部分（系統權限框、系統相冊、系統相機頁），以及鏡頭改用原生相機（計劃第一節）。
// 階段 2b 新增（現有 App 沒有，管理者 2026-11-16 批准、選定樣式三）：鏡頭模式下即時找卡邊（card_edges.dart，背景 isolate），
// 對齊的框線轉綠；四邊都對齊、不歪、清楚時提示「可以拍了」，維持 autoShotHold 就自動拍（和快門同一條路），拍一次後停止找邊。
import 'dart:async';
import 'dart:ui' as ui;
import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:image_picker/image_picker.dart';
import '../ui/toast.dart';
import '../ui/tokens.dart';
import 'card_edges.dart';
import 'card_stage.dart';
import 'pick_image.dart';

const unreadablePhoto = '這張照片無法讀取，請改用相機拍攝或選 JPG、PNG 照片';

/// 找到卡邊時新加的提示（管理者 2026-11-16 同意）
const readyHint = '可以拍了';

/// 找邊結果的來源。正式流程是 [CameraEdgeFeed]（相機 image stream＋背景 isolate）；開發截圖和測試用 [ManualEdgeFeed]。
abstract class EdgeFeed {
  Stream<CardEdges> get edges;

  /// 停止找邊（正式流程同時停止 image stream）；可重複呼叫
  Future<void> stop();
}

/// 只供開發截圖和測試：由外面逐個送入找邊結果，記下有沒有被停止
class ManualEdgeFeed implements EdgeFeed {
  final _out = StreamController<CardEdges>.broadcast(sync: true);
  bool stopped = false;
  @override
  Stream<CardEdges> get edges => _out.stream;
  void add(CardEdges e) {
    if (!stopped) _out.add(e);
  }

  @override
  Future<void> stop() async {
    if (stopped) return;
    stopped = true;
    await _out.close();
  }
}

/// 只供開發截圖和測試（模擬器沒有鏡頭）：不開鏡頭，用 [preview] 當鏡頭畫面，找邊結果由 [feed] 提供，
/// 拍照由 [takePicture] 代替（回傳截出的 data URL；拋出錯誤當作拍照失敗；不傳時快門和自動拍都不做事）。正式流程不傳。
class CaptureDemo {
  const CaptureDemo({required this.preview, required this.feed, this.takePicture});
  final Widget preview;
  final EdgeFeed feed;
  final Future<String> Function()? takePicture;
}

String captureHint({required bool camera, required bool picked, required String side}) {
  final name = side == 'back' ? '背面' : '正面';
  if (camera) return '把批文卡$name對準框內，四角對齊框線\n光線充足、避免反光';
  if (picked) return '雙指縮放、拖動相片，讓卡面對齊框線\n框外的部分不會保存';
  return '無法開啟鏡頭\n請按下面「拍照」或「從相冊選」，拍一張批文卡$name相片';
}

class CardCapturePage extends StatefulWidget {
  const CardCapturePage({super.key, required this.side, this.picker, this.cameras, this.demo});
  final String side; // 'front' 或 'back'
  final ImagePicker? picker; // 測試用
  final Future<List<CameraDescription>> Function()? cameras; // 測試用，預設 availableCameras
  final CaptureDemo? demo; // 只供開發截圖和測試
  @override
  State<CardCapturePage> createState() => CardCapturePageState();
}

class CardCapturePageState extends State<CardCapturePage> {
  bool camera = true, picked = false;
  CameraController? _controller;
  bool _cameraReady = false, _busy = false, _settled = false;
  int _generation = 0;
  PhotoSource _lastSource = PhotoSource.album;
  ui.Image? _photo;
  StageView? _view;
  FrameBox _frame = const FrameBox(20, 300, 350, 222);
  Size _box = Size.zero;
  final Map<int, Offset> _pointers = {};
  ({double gap, double cx, double cy})? _pinch;
  // 即時找卡邊（只在鏡頭模式）
  EdgeFeed? _feed;
  StreamSubscription<CardEdges>? _feedSub;
  CardEdges _edges = CardEdges.none;
  Timer? _hold; // 可以拍了之後開始計時，維持 autoShotHold 才自動拍
  bool _shot = false; // 已拍過（自動或快門）：不再自動拍

  String get _side => widget.side == 'back' ? 'back' : 'front';
  bool get _android => defaultTargetPlatform == TargetPlatform.android;

  @override
  void initState() {
    super.initState();
    final demo = widget.demo;
    if (demo != null) {
      _attachFeed(demo.feed);
      return;
    }
    // 現有 App 在頁面 onReady 時開鏡頭
    WidgetsBinding.instance.addPostFrameCallback((_) => _open());
  }

  @override
  void dispose() {
    _stopCamera();
    _photo?.dispose();
    super.dispose();
  }

  Future<void> _open() async {
    if (!mounted) return;
    // 安卓：開鏡頭前先問相機權限（頂部同時顯示用途說明）；被拒時頂部提示到設定開啟。iOS 由系統在開鏡頭時自動詢問
    if (_android && !await askPermission(context, PhotoSource.camera) && mounted) notifyDenied(context, PhotoSource.camera);
    await _startCamera();
  }

  Future<void> _startCamera() async {
    final mine = ++_generation;
    CameraController? controller;
    try {
      final list = await (widget.cameras ?? availableCameras)();
      if (list.isEmpty) throw CameraException('nocamera', '沒有鏡頭');
      final back = list.firstWhere((c) => c.lensDirection == CameraLensDirection.back, orElse: () => list.first);
      // 找邊用的畫面格式：Android YUV420、iOS BGRA（card_edges.dart sampleMargin 兩種都會讀）
      controller = CameraController(back, ResolutionPreset.max, enableAudio: false, imageFormatGroup: _android ? ImageFormatGroup.yuv420 : ImageFormatGroup.bgra8888);
      await controller.initialize();
      // 鏡頭開得太慢、期間已關閉或改用相片：關掉這次的鏡頭，不動畫面
      if (mine != _generation || !mounted) {
        await controller.dispose();
        return;
      }
      try {
        await controller.lockCaptureOrientation(DeviceOrientation.portraitUp);
      } catch (_) {}
      setState(() {
        _controller = controller;
        _cameraReady = true;
      });
      await _startEdges(controller, mine);
    } catch (error) {
      await controller?.dispose();
      if (mine != _generation || !mounted) return;
      debugPrint('[CardCapture] 無法開啟鏡頭 $error');
      setState(() => camera = false);
    }
  }

  void _stopCamera() {
    _generation++;
    final c = _controller;
    _controller = null;
    _cameraReady = false;
    final stopping = _stopEdges();
    // 先停 image stream 再關鏡頭（dispose 不會自己停）
    if (c != null) stopping.catchError((_) {}).whenComplete(c.dispose);
  }

  // 開始即時找卡邊：鏡頭畫面經 image stream 送到背景 isolate，一次只處理一張，處理中的畫面直接丟掉
  Future<void> _startEdges(CameraController controller, int mine) async {
    try {
      final feed = await CameraEdgeFeed.start(controller, android: _android, region: (w, h) {
        if (_box == Size.zero) return null;
        final ps = controller.value.previewSize;
        return shootRect(_box, w, h, _frame, previewAspect: ps == null ? null : ps.shortestSide / ps.longestSide);
      });
      if (mine != _generation || !mounted || _controller != controller || _shot) {
        await feed.stop();
        return;
      }
      _attachFeed(feed);
    } catch (error) {
      // 找不到邊不影響拍照：快門照舊可按
      debugPrint('[CardEdges] 無法開始找卡邊 $error');
    }
  }

  void _attachFeed(EdgeFeed feed) {
    _feed = feed;
    _feedSub = feed.edges.listen(_onEdges);
  }

  // 停止找邊和自動拍計時；正式流程同時停止 image stream
  Future<void> _stopEdges() {
    _hold?.cancel();
    _hold = null;
    _feedSub?.cancel();
    _feedSub = null;
    final feed = _feed;
    _feed = null;
    _edges = CardEdges.none;
    return feed?.stop() ?? Future.value();
  }

  void _onEdges(CardEdges edges) {
    if (!mounted || !camera || _shot) return;
    final before = _edges;
    _edges = edges;
    // 只在標示會變時重畫（清楚度每張都不同）
    if (before.left != edges.left || before.top != edges.top || before.right != edges.right || before.bottom != edges.bottom || before.ready != edges.ready) setState(() {});
    // 自動拍：可以拍了（四邊對齊、不歪、清楚）連續維持 autoShotHold；中途有一張不是就重新計時
    if (edges.ready) {
      _hold ??= Timer(autoShotHold, _autoShoot);
    } else {
      _hold?.cancel();
      _hold = null;
    }
  }

  void _autoShoot() {
    _hold = null;
    if (!mounted || _shot || _busy || !camera || !_edges.ready) return;
    shoot();
  }

  void _settle(String? result) {
    if (_settled) return;
    _settled = true;
    _stopCamera();
    if (mounted) Navigator.of(context).pop(result);
  }

  void cancel() => _settle(null);

  // 快門和自動拍都走這裏。鏡頭一直沒有畫面（例如裝置沒有鏡頭時不回應）就按快門：改為用系統相機拍或從相冊選
  Future<void> shoot() async {
    final demo = widget.demo;
    final c = _controller;
    if (demo == null && (!_cameraReady || c == null)) {
      setState(() {
        _stopCamera();
        camera = false;
      });
      return;
    }
    if (_busy) return;
    if (demo != null && demo.takePicture == null) return;
    _busy = true;
    // 拍一次後停止找邊（不會再自動拍）；拍照失敗時仍可按快門再拍
    _shot = true;
    await _stopEdges();
    if (mounted) setState(() {});
    try {
      _settle(demo != null ? await demo.takePicture!() : await _takeAndCrop(c!));
    } catch (error) {
      debugPrint('[CardCapture] 拍照失敗 $error');
    } finally {
      _busy = false;
    }
  }

  Future<String> _takeAndCrop(CameraController c) async {
    final file = await c.takePicture();
    final image = await _decode(await file.readAsBytes());
    final preview = c.value.previewSize;
    final rect = shootRect(_box, image.width, image.height, _frame, previewAspect: preview == null ? null : preview.shortestSide / preview.longestSide);
    final data = await _crop(image, rect);
    image.dispose();
    return data;
  }

  Future<ui.Image> _decode(Uint8List bytes) async {
    final codec = await ui.instantiateImageCodec(bytes);
    try {
      return (await codec.getNextFrame()).image;
    } finally {
      codec.dispose();
    }
  }

  Future<String> _crop(ui.Image image, SourceRect rect) async {
    final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    if (data == null) throw StateError('no pixels');
    return cropCardInBackground(data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes), image.width, image.height, rect);
  }

  Future<void> _pick(PhotoSource source) async {
    if (_busy) return;
    _lastSource = source;
    final file = await pickPhoto(context, source, picker: widget.picker);
    if (file == null || !mounted) return;
    ui.Image image;
    try {
      image = await _decode(await file.readAsBytes());
    } catch (_) {
      if (mounted) showToast(context, unreadablePhoto);
      return;
    }
    if (!mounted) {
      image.dispose();
      return;
    }
    setState(() {
      _stopCamera();
      _photo?.dispose();
      _photo = image;
      _view = StageView.place(_frame, image.width, image.height);
      _pointers.clear();
      _pinch = null;
      camera = false;
      picked = true;
    });
  }

  void pickAlbum() => _pick(PhotoSource.album);
  void pickCamera() => _pick(PhotoSource.camera);
  void repick() => _pick(_lastSource);

  Future<void> confirm() async {
    final photo = _photo, view = _view;
    if (photo == null || view == null) return pickAlbum();
    if (_busy) return;
    _busy = true;
    try {
      _settle(await _crop(photo, view.confirmRect(_frame)));
    } catch (error) {
      debugPrint('[CardCapture] 截圖失敗 $error');
    } finally {
      _busy = false;
    }
  }

  // 拖動、雙指縮放（card-stage.js 的 down／move／up）
  void _down(PointerDownEvent e) => _pointers[e.pointer] = e.localPosition;
  void _move(PointerMoveEvent e) {
    final view = _view;
    final last = _pointers[e.pointer];
    if (view == null || last == null) return;
    _pointers[e.pointer] = e.localPosition;
    if (_pointers.length == 1) {
      setState(() {
        view.x += e.localPosition.dx - last.dx;
        view.y += e.localPosition.dy - last.dy;
      });
      return;
    }
    final points = _pointers.values.toList();
    final a = points[0], b = points[1];
    final gap = (a - b).distance, cx = (a.dx + b.dx) / 2, cy = (a.dy + b.dy) / 2;
    final pinch = _pinch;
    if (pinch != null) {
      setState(() {
        view.x += cx - pinch.cx;
        view.y += cy - pinch.cy;
        view.zoomAt(cx, cy, view.s * gap / pinch.gap);
      });
    }
    _pinch = (gap: gap, cx: cx, cy: cy);
  }

  void _up(PointerEvent e) {
    _pointers.remove(e.pointer);
    if (_pointers.length < 2) _pinch = null;
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final safeTop = media.viewPadding.top;
    // 安卓：網頁停在底部導航列上面，不多留導航列高度；iOS 鋪滿全螢幕，底部按鈕避開橫條
    final navBar = _android ? media.viewPadding.bottom : 0.0;
    final safeBottom = _android ? 0.0 : media.viewPadding.bottom;
    final box = Size(media.size.width, media.size.height - navBar);
    _box = box;
    _frame = cardFrame(box, safeTop);
    final f = _frame;
    final white = ts(Fs.body, color: CaptureStyle.fg);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light, // navigationBarTextStyle white
      child: ColoredBox(
        color: CaptureStyle.bg,
        child: Align(
          alignment: Alignment.topCenter,
          child: SizedBox.fromSize(
            size: box,
            child: DefaultTextStyle(
              style: white,
              child: Stack(children: [
                Positioned.fill(child: _stage()),
                Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: FramePainter(f, edges: camera ? _edges : CardEdges.none)))),
                // .top：標題置中，左邊 ✕
                Positioned(
                  left: 0,
                  right: 0,
                  top: safeTop,
                  height: CaptureStyle.topHeight,
                  child: Stack(children: [
                    Center(child: Text(camera ? '拍批文卡' : '對準批文卡', style: ts(CaptureStyle.titleSize, weight: CaptureStyle.titleWeight, color: CaptureStyle.fg))),
                    Positioned(
                      left: CaptureStyle.closeLeft,
                      top: (CaptureStyle.topHeight - CaptureStyle.closeSize) / 2,
                      width: CaptureStyle.closeSize,
                      height: CaptureStyle.closeSize,
                      child: GestureDetector(
                        key: const ValueKey('capture-close'),
                        behavior: HitTestBehavior.opaque,
                        onTap: cancel,
                        child: Center(child: Text('✕', style: ts(CaptureStyle.closeFont, weight: CaptureStyle.closeWeight, color: CaptureStyle.fg, height: CaptureStyle.closeSize / CaptureStyle.closeFont))),
                      ),
                    ),
                  ]),
                ),
                // .sides：框頂上方 48
                Positioned(
                  left: 0,
                  right: 0,
                  top: f.top - CaptureStyle.sidesAbove,
                  child: IgnorePointer(
                    child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      _sideTag('① 正面', _side == 'front'),
                      const SizedBox(width: CaptureStyle.sidesGap),
                      _sideTag('② 背面', _side == 'back'),
                    ]),
                  ),
                ),
                // .hint：框底下方 18
                Positioned(
                  left: CaptureStyle.hintSide,
                  right: CaptureStyle.hintSide,
                  top: f.bottom + CaptureStyle.hintBelow,
                  child: IgnorePointer(
                    child: camera && _edges.ready
                        ? Text(readyHint, key: const ValueKey('capture-ready'), textAlign: TextAlign.center, style: ts(CaptureStyle.readySize, weight: CaptureStyle.readyWeight, color: CaptureStyle.edgeOn, height: CaptureStyle.hintLine))
                        : Text(captureHint(camera: camera, picked: picked, side: _side), textAlign: TextAlign.center, style: ts(Fs.body, color: CaptureStyle.hint, height: CaptureStyle.hintLine)),
                  ),
                ),
                if (camera) Positioned(left: 0, right: 0, bottom: safeBottom, height: CaptureStyle.bottomHeight, child: _cameraBar()) else _buttons(box.width, safeBottom),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  Widget _stage() {
    final c = _controller, photo = _photo, view = _view, demo = widget.demo;
    if (camera && demo != null) return demo.preview;
    if (camera && c != null && _cameraReady && c.value.previewSize != null) {
      final ps = c.value.previewSize!;
      // object-fit:cover
      return ClipRect(
        child: FittedBox(fit: BoxFit.cover, child: SizedBox(width: ps.shortestSide, height: ps.longestSide, child: CameraPreview(c))),
      );
    }
    if (picked && photo != null && view != null) {
      return Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: _down,
        onPointerMove: _move,
        onPointerUp: _up,
        onPointerCancel: _up,
        child: ClipRect(
          child: Stack(children: [
            Positioned(
              left: 0,
              top: 0,
              width: photo.width.toDouble(),
              height: photo.height.toDouble(),
              child: Transform(
                key: const ValueKey('capture-photo'),
                transform: Matrix4.identity()
                  ..translateByDouble(view.x, view.y, 0, 1)
                  ..scaleByDouble(view.s, view.s, 1, 1),
                child: RawImage(image: photo, fit: BoxFit.fill, filterQuality: FilterQuality.medium),
              ),
            ),
          ]),
        ),
      );
    }
    return const SizedBox.expand();
  }

  Widget _sideTag(String text, bool on) => Container(
        padding: const EdgeInsets.symmetric(horizontal: CaptureStyle.sidePadH, vertical: CaptureStyle.sidePadV),
        decoration: BoxDecoration(color: on ? C.jadeSoft : CaptureStyle.sideOff, borderRadius: BorderRadius.circular(R.control)),
        child: Text(text, style: ts(Fs.body, weight: CaptureStyle.sideWeight, color: on ? C.jade : CaptureStyle.fg)),
      );

  // .bottom：左「從相冊選」、中快門、右邊留空
  Widget _cameraBar() => Padding(
        padding: const EdgeInsets.fromLTRB(CaptureStyle.bottomPadH, 0, CaptureStyle.bottomPadH, CaptureStyle.bottomPadB),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          GestureDetector(
            key: const ValueKey('capture-album'),
            behavior: HitTestBehavior.opaque,
            onTap: pickAlbum,
            child: SizedBox(
              width: CaptureStyle.albumWidth,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Container(
                  width: CaptureStyle.albumIcon,
                  height: CaptureStyle.albumIcon,
                  decoration: BoxDecoration(border: Border.all(color: CaptureStyle.fg, width: CaptureStyle.albumIconBorder), borderRadius: BorderRadius.circular(R.card)),
                ),
                const SizedBox(height: CaptureStyle.albumGap),
                Text('從相冊選', style: ts(Fs.meta, color: CaptureStyle.fg)),
              ]),
            ),
          ),
          GestureDetector(
            key: const ValueKey('capture-shutter'),
            behavior: HitTestBehavior.opaque,
            onTap: shoot,
            child: Container(
              width: CaptureStyle.shutter,
              height: CaptureStyle.shutter,
              padding: const EdgeInsets.all(CaptureStyle.shutterGap),
              decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: CaptureStyle.fg, width: CaptureStyle.shutterBorder)),
              child: const DecoratedBox(decoration: BoxDecoration(shape: BoxShape.circle, color: CaptureStyle.fg)),
            ),
          ),
          const SizedBox(width: CaptureStyle.albumWidth),
        ]),
      );

  // .buttons：選了相片時「重選／確認」，否則「從相冊選／拍照」
  Widget _buttons(double width, double safeBottom) {
    final w = (width - CaptureStyle.buttonsInset).clamp(0.0, CaptureStyle.frameSideMax);
    final (left, right) = picked ? (('重選', repick), ('確認', confirm)) : (('從相冊選', pickAlbum), ('拍照', pickCamera));
    return Positioned(
      left: (width - w) / 2,
      width: w,
      bottom: CaptureStyle.buttonsBottom + safeBottom,
      height: CaptureStyle.buttonHeight,
      child: Row(children: [
        Expanded(child: _button(left.$1, left.$2, ghost: true)),
        const SizedBox(width: CaptureStyle.buttonsGap),
        Expanded(child: _button(right.$1, right.$2, ghost: false)),
      ]),
    );
  }

  // uni-app 的按下樣式（.button-hover）被 .ghost／.confirm 蓋過，按下時沒有變化
  Widget _button(String text, VoidCallback onTap, {required bool ghost}) => GestureDetector(
        key: ValueKey('capture-$text'),
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          height: CaptureStyle.buttonHeight,
          decoration: BoxDecoration(
            color: ghost ? null : C.jade,
            borderRadius: BorderRadius.circular(R.control),
            border: ghost ? Border.all(color: CaptureStyle.ghostBorder) : null,
          ),
          alignment: Alignment.center,
          child: Text(text, style: ts(CaptureStyle.buttonFont, weight: CaptureStyle.buttonWeight, color: CaptureStyle.fg, height: 1)),
        ),
      );
}

/// 框外變暗（box-shadow 0 0 0 2000px rgba(0,0,0,.58)，框內圓角 12）和四角白色 L 形（.corner：30×30、4px、外移 2px、外角圓角 12）。
/// 2b：對齊的框線畫成綠色，四邊都對齊時四角也轉綠（[edges]）。
class FramePainter extends CustomPainter {
  const FramePainter(this.frame, {this.edges = CardEdges.none});
  final FrameBox frame;
  final CardEdges edges;

  @override
  void paint(Canvas canvas, Size size) {
    final f = frame;
    final hole = RRect.fromLTRBR(f.left, f.top, f.right, f.bottom, const Radius.circular(CaptureStyle.frameRadius));
    canvas.drawPath(
      Path()
        ..fillType = PathFillType.evenOdd
        ..addRect(Offset.zero & size)
        ..addRRect(hole),
      Paint()..color = CaptureStyle.mask,
    );
    const s = CaptureStyle.cornerSize, b = CaptureStyle.cornerBorder, o = CaptureStyle.cornerOffset, r = CaptureStyle.frameRadius;
    final white = Paint()..color = CaptureStyle.fg;
    final green = Paint()..color = CaptureStyle.edgeOn;
    final e = edges;
    // 對齊的框線：在兩個角之間接着角的線條畫一段綠線，和角的線一樣粗、一樣外移
    if (e.top) canvas.drawRect(Rect.fromLTRB(f.left - o + s, f.top - o, f.right + o - s, f.top - o + b), green);
    if (e.bottom) canvas.drawRect(Rect.fromLTRB(f.left - o + s, f.bottom + o - b, f.right + o - s, f.bottom + o), green);
    if (e.left) canvas.drawRect(Rect.fromLTRB(f.left - o, f.top - o + s, f.left - o + b, f.bottom + o - s), green);
    if (e.right) canvas.drawRect(Rect.fromLTRB(f.right + o - b, f.top - o + s, f.right + o, f.bottom + o - s), green);
    // 四邊都對齊時四角也轉綠
    final cornerPaint = e.aligned ? green : white;
    // CSS 邊框：外框圓角 12，內框圓角 12 - 4 = 8；沒有邊框的兩邊直切
    void corner(double left, double top, {required bool right, required bool bottom, required Paint paint}) {
      final outer = Rect.fromLTWH(left, top, s, s);
      final inner = Rect.fromLTRB(right ? outer.left : outer.left + b, bottom ? outer.top : outer.top + b, right ? outer.right - b : outer.right, bottom ? outer.bottom - b : outer.bottom);
      RRect rounded(Rect rect, double radius) => RRect.fromRectAndCorners(
            rect,
            topLeft: !right && !bottom ? Radius.circular(radius) : Radius.zero,
            topRight: right && !bottom ? Radius.circular(radius) : Radius.zero,
            bottomLeft: !right && bottom ? Radius.circular(radius) : Radius.zero,
            bottomRight: right && bottom ? Radius.circular(radius) : Radius.zero,
          );
      canvas.drawPath(Path.combine(PathOperation.difference, Path()..addRRect(rounded(outer, r)), Path()..addRRect(rounded(inner, r - b))), paint);
    }

    corner(f.left - o, f.top - o, right: false, bottom: false, paint: cornerPaint);
    corner(f.right + o - s, f.top - o, right: true, bottom: false, paint: cornerPaint);
    corner(f.left - o, f.bottom + o - s, right: false, bottom: true, paint: cornerPaint);
    corner(f.right + o - s, f.bottom + o - s, right: true, bottom: true, paint: cornerPaint);
  }

  @override
  bool shouldRepaint(FramePainter old) =>
      old.frame.left != frame.left ||
      old.frame.top != frame.top ||
      old.frame.width != frame.width ||
      old.frame.height != frame.height ||
      old.edges.left != edges.left ||
      old.edges.top != edges.top ||
      old.edges.right != edges.right ||
      old.edges.bottom != edges.bottom;
}

/// 正式流程的找邊來源：相機 image stream 的畫面送到背景 isolate（[EdgeWorker]），一次只處理一張，處理中的畫面直接丟掉。
/// [region] 回傳直向畫面座標的框內範圍（畫面還沒排好時回傳 null，該張不處理）。除錯版每 5 秒印出每秒找邊次數和最近結果。
class CameraEdgeFeed implements EdgeFeed {
  CameraEdgeFeed._(this._controller, this._worker, this._region, this._android);
  final CameraController _controller;
  final EdgeWorker _worker;
  final SourceRect? Function(int uprightW, int uprightH) _region;
  final bool _android;
  final _out = StreamController<CardEdges>.broadcast();
  bool _stopped = false;
  int _analysed = 0;
  DateTime _since = DateTime.now();

  static Future<CameraEdgeFeed> start(CameraController controller, {required SourceRect? Function(int uprightW, int uprightH) region, required bool android}) async {
    final worker = await EdgeWorker.start();
    final feed = CameraEdgeFeed._(controller, worker, region, android);
    try {
      await controller.startImageStream(feed._onFrame);
    } catch (_) {
      worker.close();
      rethrow;
    }
    return feed;
  }

  @override
  Stream<CardEdges> get edges => _out.stream;

  void _onFrame(CameraImage image) {
    if (_stopped || _worker.busy) return;
    final frame = previewFrameOf(image, sensorOrientation: _controller.description.sensorOrientation, android: _android);
    if (frame == null) return;
    final inner = _region(frame.uprightW, frame.uprightH);
    if (inner == null) return;
    _worker.detect(frame, inner).then((edges) {
      if (edges == null || _stopped) return;
      _analysed++;
      final now = DateTime.now(), seconds = now.difference(_since).inMilliseconds / 1000;
      if (kDebugMode && seconds >= 5) {
        debugPrint('[CardEdges] 每秒 ${(_analysed / seconds).toStringAsFixed(1)} 次，畫面 ${image.width}×${image.height}，$edges');
        _analysed = 0;
        _since = now;
      }
      _out.add(edges);
    });
  }

  @override
  Future<void> stop() async {
    if (_stopped) return;
    _stopped = true;
    _worker.close();
    try {
      if (_controller.value.isStreamingImages) await _controller.stopImageStream();
    } catch (_) {}
    await _out.close();
  }
}

/// 相機 image stream 的一張畫面換成純資料（可送到背景 isolate）。
/// Android：YUV420 三個平面，畫面按鏡頭的 sensorOrientation 橫放（通常要順時針轉 90°）；
/// iOS：BGRA 一個平面，相機套件已按直向輸出；萬一收到橫向畫面，當作要轉 90°。其他格式回傳 null（不找邊）。
PreviewFrame? previewFrameOf(CameraImage image, {required int sensorOrientation, required bool android}) => previewFrameFrom(
      group: image.format.group,
      width: image.width,
      height: image.height,
      planes: [for (final p in image.planes) (bytes: p.bytes, rowStride: p.bytesPerRow, pixelStride: p.bytesPerPixel)],
      sensorOrientation: sensorOrientation,
      android: android,
    );

/// [previewFrameOf] 的換算部分（不用 CameraImage，方便測試）
PreviewFrame? previewFrameFrom({
  required ImageFormatGroup group,
  required int width,
  required int height,
  required List<({Uint8List bytes, int rowStride, int? pixelStride})> planes,
  required int sensorOrientation,
  required bool android,
}) {
  final format = switch (group) {
    ImageFormatGroup.yuv420 when planes.length >= 3 => FramePixels.yuv420,
    ImageFormatGroup.bgra8888 => FramePixels.bgra8888,
    _ => null,
  };
  if (format == null) return null;
  final rotation = width > height ? (android ? sensorOrientation % 360 : 90) : 0;
  return PreviewFrame(
    width: width,
    height: height,
    format: format,
    planes: [for (final p in planes) p.bytes],
    rowStrides: [for (final p in planes) p.rowStride],
    pixelStrides: [for (final p in planes) p.pixelStride ?? (format == FramePixels.bgra8888 ? 4 : 1)],
    rotation: rotation,
  );
}
