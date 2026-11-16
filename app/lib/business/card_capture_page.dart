// 全螢幕拍批文卡頁（一比一照 mobile/src/components/CardCapture.vue 的 App 版和 pages/card-capture）。
// - 打開即開鏡頭：全螢幕預覽、對準框和四角、標題「拍批文卡」、「① 正面 ② 背面」、提示、快門、左下「從相冊選」。
// - 開不了鏡頭（拒絕權限、沒有鏡頭，例如 iOS 模擬器）：標題改「對準批文卡」，下面「從相冊選／拍照」（拍照用系統相機）。
// - 選了相片：雙指縮放、拖動對框，「重選／確認」；確認截出框內卡面（card_stage.dart）。
// - 安卓開鏡頭前先申請相機權限，同時頂部顯示用途說明；拒絕了照樣繼續，鏡頭開不了就改為「拍照／從相冊選」（pick_image.dart）。
// 和現有 App 不同的只有系統畫的部分（系統權限框、系統相冊、系統相機頁），以及鏡頭改用原生相機（計劃第一節）。
import 'dart:async';
import 'dart:ui' as ui;
import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:image_picker/image_picker.dart';
import '../ui/toast.dart';
import '../ui/tokens.dart';
import 'card_stage.dart';
import 'pick_image.dart';

const unreadablePhoto = '這張照片無法讀取，請改用相機拍攝或選 JPG、PNG 照片';

String captureHint({required bool camera, required bool picked, required String side}) {
  final name = side == 'back' ? '背面' : '正面';
  if (camera) return '把批文卡$name對準框內，四角對齊框線\n光線充足、避免反光';
  if (picked) return '雙指縮放、拖動相片，讓卡面對齊框線\n框外的部分不會保存';
  return '無法開啟鏡頭\n請按下面「拍照」或「從相冊選」，拍一張批文卡$name相片';
}

class CardCapturePage extends StatefulWidget {
  const CardCapturePage({super.key, required this.side, this.picker, this.cameras});
  final String side; // 'front' 或 'back'
  final ImagePicker? picker; // 測試用
  final Future<List<CameraDescription>> Function()? cameras; // 測試用，預設 availableCameras
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

  String get _side => widget.side == 'back' ? 'back' : 'front';
  bool get _android => defaultTargetPlatform == TargetPlatform.android;

  @override
  void initState() {
    super.initState();
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
      controller = CameraController(back, ResolutionPreset.max, enableAudio: false);
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
    c?.dispose();
  }

  void _settle(String? result) {
    if (_settled) return;
    _settled = true;
    _stopCamera();
    if (mounted) Navigator.of(context).pop(result);
  }

  void cancel() => _settle(null);

  // 鏡頭一直沒有畫面（例如裝置沒有鏡頭時不回應）就按快門：改為用系統相機拍或從相冊選
  Future<void> shoot() async {
    final c = _controller;
    if (!_cameraReady || c == null) {
      setState(() {
        _stopCamera();
        camera = false;
      });
      return;
    }
    if (_busy) return;
    _busy = true;
    try {
      final file = await c.takePicture();
      final image = await _decode(await file.readAsBytes());
      final preview = c.value.previewSize;
      final rect = shootRect(_box, image.width, image.height, _frame, previewAspect: preview == null ? null : preview.shortestSide / preview.longestSide);
      final data = await _crop(image, rect);
      image.dispose();
      _settle(data);
    } catch (error) {
      debugPrint('[CardCapture] 拍照失敗 $error');
    } finally {
      _busy = false;
    }
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
                Positioned.fill(child: IgnorePointer(child: CustomPaint(painter: FramePainter(f)))),
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
                    child: Text(captureHint(camera: camera, picked: picked, side: _side), textAlign: TextAlign.center, style: ts(Fs.body, color: CaptureStyle.hint, height: CaptureStyle.hintLine)),
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
    final c = _controller, photo = _photo, view = _view;
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

/// 框外變暗（box-shadow 0 0 0 2000px rgba(0,0,0,.58)，框內圓角 12）和四角白色 L 形（.corner：30×30、4px、外移 2px、外角圓角 12）
class FramePainter extends CustomPainter {
  const FramePainter(this.frame);
  final FrameBox frame;

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
    // CSS 邊框：外框圓角 12，內框圓角 12 - 4 = 8；沒有邊框的兩邊直切
    void corner(double left, double top, {required bool right, required bool bottom}) {
      final outer = Rect.fromLTWH(left, top, s, s);
      final inner = Rect.fromLTRB(right ? outer.left : outer.left + b, bottom ? outer.top : outer.top + b, right ? outer.right - b : outer.right, bottom ? outer.bottom - b : outer.bottom);
      RRect rounded(Rect rect, double radius) => RRect.fromRectAndCorners(
            rect,
            topLeft: !right && !bottom ? Radius.circular(radius) : Radius.zero,
            topRight: right && !bottom ? Radius.circular(radius) : Radius.zero,
            bottomLeft: !right && bottom ? Radius.circular(radius) : Radius.zero,
            bottomRight: right && bottom ? Radius.circular(radius) : Radius.zero,
          );
      canvas.drawPath(Path.combine(PathOperation.difference, Path()..addRRect(rounded(outer, r)), Path()..addRRect(rounded(inner, r - b))), white);
    }

    corner(f.left - o, f.top - o, right: false, bottom: false);
    corner(f.right + o - s, f.top - o, right: true, bottom: false);
    corner(f.left - o, f.bottom + o - s, right: false, bottom: true);
    corner(f.right + o - s, f.bottom + o - s, right: true, bottom: true);
  }

  @override
  bool shouldRepaint(FramePainter old) => old.frame.left != frame.left || old.frame.top != frame.top || old.frame.width != frame.width || old.frame.height != frame.height;
}
