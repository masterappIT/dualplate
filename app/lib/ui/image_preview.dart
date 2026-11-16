// 看大圖：對應 uni.previewImage({ urls, current })。App 端是原生圖片檢視器 plus.nativeUI.previewImage：
// 全螢幕黑底，左右滑動換圖（不循環），雙指或雙擊放大，點一下關閉；indicator 'number' 顯示「目前／總數」。
// 長按「保存圖像」到相冊要另加套件，未做（報告已列出）。
import 'dart:typed_data';
import 'package:flutter/widgets.dart';
import 'tokens.dart';

Future<void> previewImages(BuildContext context, List<Uint8List> images, {int current = 0}) => Navigator.of(context, rootNavigator: true).push<void>(
      PageRouteBuilder<void>(
        opaque: false,
        barrierColor: const Color(0x00000000),
        transitionDuration: PreviewStyle.fade,
        reverseTransitionDuration: PreviewStyle.fade,
        pageBuilder: (context, animation, _) => FadeTransition(opacity: animation, child: ImagePreview(images: images, current: current)),
      ),
    );

class ImagePreview extends StatefulWidget {
  const ImagePreview({super.key, required this.images, this.current = 0});
  final List<Uint8List> images;
  final int current;
  @override
  State<ImagePreview> createState() => _ImagePreviewState();
}

class _ImagePreviewState extends State<ImagePreview> {
  late int index = widget.current.clamp(0, widget.images.length - 1);
  late final PageController pages = PageController(initialPage: index);
  final zooms = <int, TransformationController>{};
  bool zoomed = false;

  @override
  void dispose() {
    pages.dispose();
    for (final z in zooms.values) {
      z.dispose();
    }
    super.dispose();
  }

  TransformationController _zoom(int i) => zooms[i] ??= TransformationController()..addListener(() => _onZoom(i));

  void _onZoom(int i) {
    final z = zooms[i]!.value.getMaxScaleOnAxis() > 1.01;
    if (i == index && z != zoomed) setState(() => zoomed = z);
  }

  void _toggleZoom(int i, Offset at) {
    final z = _zoom(i);
    if (z.value.getMaxScaleOnAxis() > 1.01) {
      z.value = Matrix4.identity();
    } else {
      const s = 2.0;
      z.value = Matrix4.identity()
        ..translateByDouble(-at.dx * (s - 1), -at.dy * (s - 1), 0, 1)
        ..scaleByDouble(s, s, 1, 1);
    }
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return ColoredBox(
      color: PreviewStyle.bg,
      child: Stack(children: [
        PageView.builder(
          controller: pages,
          physics: zoomed ? const NeverScrollableScrollPhysics() : const PageScrollPhysics(),
          itemCount: widget.images.length,
          onPageChanged: (i) => setState(() {
            index = i;
            zoomed = false;
          }),
          itemBuilder: (context, i) {
            Offset at = Offset.zero;
            return GestureDetector(
              key: ValueKey('preview-$i'),
              behavior: HitTestBehavior.opaque,
              onTap: () => Navigator.of(context).pop(),
              onDoubleTapDown: (d) => at = d.localPosition,
              onDoubleTap: () => _toggleZoom(i, at),
              child: InteractiveViewer(
                transformationController: _zoom(i),
                maxScale: PreviewStyle.maxScale,
                child: Center(child: Image.memory(widget.images[i], fit: BoxFit.contain, gaplessPlayback: true)),
              ),
            );
          },
        ),
        if (widget.images.length > 1)
          Positioned(
            left: 0,
            right: 0,
            top: top + 12,
            child: IgnorePointer(
              child: Text('${index + 1}/${widget.images.length}', textAlign: TextAlign.center, style: ts(PreviewStyle.indicatorSize, color: PreviewStyle.indicator)),
            ),
          ),
      ]),
    );
  }
}
