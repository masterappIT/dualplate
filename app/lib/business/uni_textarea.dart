// <textarea class="field …">：外觀同輸入框（白底、細線、圓角 4、內距 12、字 16），聚焦時綠框加牌照黃光暈。
// 用在聯絡我們（固定高 96、行高 1.5、最多 1000 字）和出租協議（auto-height、最少高 240、行高 1.6、最多 20000 字、可停用）。
// uni-app 的 textarea 有 maxlength 時超出的字打不進去（不提示）；停用時文字照常顯示、不能編輯。
import 'package:flutter/material.dart' show Material, MaterialType, TextField, InputDecoration, InputBorder;
import 'package:flutter/services.dart' show LengthLimitingTextInputFormatter;
import 'package:flutter/widgets.dart';
import '../ui/tokens.dart';

class UniTextArea extends StatefulWidget {
  const UniTextArea({super.key, required this.controller, this.placeholder = '', this.onChanged, this.height, this.minHeight = 0, this.lineHeight = 1.5, this.maxLength, this.enabled = true});
  final TextEditingController controller;
  final String placeholder;
  final ValueChanged<String>? onChanged;
  // height：固定高（含框線）；沒有時按內容自動長高（auto-height），最少 minHeight
  final double? height;
  final double minHeight, lineHeight;
  final int? maxLength;
  final bool enabled;
  @override
  State<UniTextArea> createState() => _UniTextAreaState();
}

class _UniTextAreaState extends State<UniTextArea> {
  final focus = FocusNode();

  @override
  void initState() {
    super.initState();
    focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final on = focus.hasFocus;
    final fixed = widget.height != null;
    return AnimatedContainer(
      duration: Motion.fast,
      curve: Motion.ease,
      height: widget.height,
      constraints: BoxConstraints(minHeight: widget.minHeight),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: C.card,
        border: Border.all(color: on ? C.jade : C.rule),
        borderRadius: BorderRadius.circular(R.control),
        boxShadow: on ? const [BoxShadow(color: Color(0x73F2C230), spreadRadius: 3)] : null,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: TextField(
          controller: widget.controller,
          focusNode: focus,
          enabled: widget.enabled,
          maxLines: null,
          expands: fixed,
          onChanged: widget.onChanged,
          inputFormatters: widget.maxLength == null ? null : [LengthLimitingTextInputFormatter(widget.maxLength)],
          cursorColor: C.jade,
          textAlignVertical: TextAlignVertical.top,
          style: ts(Fs.h, height: widget.lineHeight),
          decoration: InputDecoration(isCollapsed: true, border: InputBorder.none, hintText: widget.placeholder, hintStyle: ts(Fs.h, color: const Color(0xFF808080), height: widget.lineHeight)),
        ),
      ),
    );
  }
}
