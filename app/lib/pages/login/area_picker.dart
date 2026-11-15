// 區號選擇器：現有 App 的 <picker> 在 App 端打開 uni-app 自帶的選擇頁（uni-app-vite/lib/template/__uniapppicker.js），
// 是一個蓋住全螢幕（連狀態列）的透明頁：黑色遮罩淡入、白色面板由下滑上（都是 200ms），頂部「取消」「完成」，下面一欄滾輪。
// 按「完成」回傳選中的序號；按「取消」、點遮罩或返回鍵回傳 null。文字跟手機語言：中文「完成／取消」，其他「Done／Cancel」。
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../../ui/tokens.dart';

Future<int?> showAreaPicker(BuildContext context, List<String> labels, int index) => Navigator.of(context, rootNavigator: true).push<int>(
  PageRouteBuilder<int>(
    opaque: false,
    barrierDismissible: false,
    barrierColor: const Color(0x00000000),
    transitionDuration: LoginStyle.pickerDuration,
    reverseTransitionDuration: LoginStyle.pickerDuration,
    pageBuilder: (context, animation, _) => AreaPicker(animation: animation, labels: labels, index: index),
  ),
);

class AreaPicker extends StatefulWidget {
  const AreaPicker({super.key, required this.animation, required this.labels, required this.index});
  final Animation<double> animation;
  final List<String> labels;
  final int index;
  @override
  State<AreaPicker> createState() => _AreaPickerState();
}

class _AreaPickerState extends State<AreaPicker> {
  late final FixedExtentScrollController wheel = FixedExtentScrollController(initialItem: widget.index);
  bool closing = false;

  @override
  void dispose() {
    wheel.dispose();
    super.dispose();
  }

  void close([int? value]) {
    if (closing) return;
    closing = true;
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    final safe = MediaQuery.paddingOf(context);
    final zh = PlatformDispatcher.instance.locale.languageCode == 'zh';
    final android = defaultTargetPlatform == TargetPlatform.android;
    // weex animation 預設 linear；面板由 translateY(283 + 安全區) 滑到 0
    final action = TextStyle(
      fontWeight: FontWeight.w400, // 沒有全局字型樣式時，除錯版會繼承 w900
      fontSize: LoginStyle.pickerActionSize,
      height: LoginStyle.pickerHeader / LoginStyle.pickerActionSize,
      fontFamily: fontFamily,
      fontFamilyFallback: fontFallback,
      decoration: TextDecoration.none,
    );
    return AnimatedBuilder(
      animation: widget.animation,
      builder: (context, _) {
        final t = widget.animation.value, slide = (283 + safe.bottom) * (1 - t);
        return Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                key: const ValueKey('picker-mask'),
                onTap: close,
                child: ColoredBox(color: Color.lerp(const Color(0x00000000), android ? LoginStyle.pickerMaskAndroid : LoginStyle.pickerMask, t)!),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: -slide, // 由下滑上
              height: LoginStyle.pickerHeight + safe.bottom,
              child: Container(
                color: LoginStyle.pickerBg,
                padding: EdgeInsets.only(bottom: safe.bottom),
                child: Column(
                  children: [
                    Container(
                      height: LoginStyle.pickerHeader,
                      decoration: const BoxDecoration(
                        border: Border(bottom: BorderSide(color: LoginStyle.pickerLine, width: .5)),
                      ),
                      child: Row(
                        children: [
                          GestureDetector(
                            key: const ValueKey('picker-cancel'),
                            behavior: HitTestBehavior.opaque,
                            onTap: close,
                            child: Padding(
                              padding: EdgeInsets.only(left: 14 + safe.left, right: 14),
                              child: Text(zh ? '取消' : 'Cancel', style: action.copyWith(color: LoginStyle.pickerCancel)),
                            ),
                          ),
                          const Spacer(),
                          GestureDetector(
                            key: const ValueKey('picker-done'),
                            behavior: HitTestBehavior.opaque,
                            onTap: () => close(wheel.selectedItem.clamp(0, widget.labels.length - 1)),
                            child: Padding(
                              padding: EdgeInsets.only(left: 14, right: 14 + safe.right),
                              child: Text(zh ? '完成' : 'Done', style: action.copyWith(color: LoginStyle.pickerConfirm)),
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(
                      height: LoginStyle.pickerBody,
                      child: Stack(
                        children: [
                          ListWheelScrollView(
                            controller: wheel,
                            itemExtent: LoginStyle.pickerRow,
                            diameterRatio: 1000, // 平面滾輪（picker-view 沒有立體彎曲）
                            physics: const FixedExtentScrollPhysics(),
                            children: [
                              for (final label in widget.labels)
                                Center(
                                  child: Text(
                                    label,
                                    style: const TextStyle(
                                      fontSize: LoginStyle.pickerItemSize,
                                      fontWeight: FontWeight.w400,
                                      height: LoginStyle.pickerRow / LoginStyle.pickerItemSize,
                                      color: LoginStyle.pickerText,
                                      fontFamily: fontFamily,
                                      fontFamilyFallback: fontFallback,
                                      decoration: TextDecoration.none,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                          // 上下半透明白色遮罩和中間選中行的兩條細線（撐滿整個滾輪，否則遮罩寬度是 0）
                          const Positioned.fill(
                            child: IgnorePointer(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Expanded(
                                    child: DecoratedBox(
                                      decoration: BoxDecoration(
                                        gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [LoginStyle.pickerFadeTop, LoginStyle.pickerFadeMid]),
                                      ),
                                    ),
                                  ),
                                  DecoratedBox(
                                    decoration: BoxDecoration(
                                      border: Border.symmetric(horizontal: BorderSide(color: LoginStyle.pickerLine, width: .5)),
                                    ),
                                    child: SizedBox(height: LoginStyle.pickerRow, width: double.infinity),
                                  ),
                                  Expanded(
                                    child: DecoratedBox(
                                      decoration: BoxDecoration(
                                        gradient: LinearGradient(begin: Alignment.bottomCenter, end: Alignment.topCenter, colors: [LoginStyle.pickerFadeTop, LoginStyle.pickerFadeMid]),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
