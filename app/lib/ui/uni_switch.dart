// <switch>：App 端是網頁組件 uni-switch（@dcloudio/uni-components/style/switch.css），不是系統開關。
// 52×32、灰框灰底；:before 是 50×30 的白底（選中時縮到 0），:after 是 30×30 的白圓鈕加陰影（選中時右移 20）；
// 底色、框色 .1s 轉色，白底和圓鈕 .3s 移動；不可按時 opacity .7；右邊有 5px 外距。
// 點一下先在組件內切換（switchChecked），再回報新值；外面傳入的 checked 改變時才跟着改——
// 所以伺服器失敗、頁面資料沒變時，開關停在用戶點過的位置（和現有 App 一樣）。
import 'package:flutter/widgets.dart';
import 'tokens.dart';

class UniSwitch extends StatefulWidget {
  const UniSwitch({super.key, required this.checked, this.color = C.jade, this.disabled = false, this.onChanged});
  final bool checked, disabled;
  final Color color;
  final ValueChanged<bool>? onChanged;
  @override
  State<UniSwitch> createState() => _UniSwitchState();
}

class _UniSwitchState extends State<UniSwitch> {
  late bool checked = widget.checked;

  @override
  void didUpdateWidget(UniSwitch old) {
    super.didUpdateWidget(old);
    if (old.checked != widget.checked) checked = widget.checked;
  }

  @override
  Widget build(BuildContext context) {
    final disabled = widget.disabled, color = widget.color;
    final fill = checked ? color : UniSwitchStyle.off;
    final box = Opacity(
      opacity: disabled ? UniSwitchStyle.disabledOpacity : 1,
      child: AnimatedContainer(
        duration: UniSwitchStyle.colorDuration,
        width: UniSwitchStyle.width,
        height: UniSwitchStyle.height,
        decoration: BoxDecoration(color: fill, border: Border.all(color: fill), borderRadius: BorderRadius.circular(UniSwitchStyle.height / 2)),
        child: Stack(clipBehavior: Clip.none, children: [
          // :before（top:0;left:0，在 1px 框線之內）
          Positioned(
            left: 0,
            top: 0,
            child: AnimatedScale(
              scale: checked ? 0 : 1,
              duration: UniSwitchStyle.moveDuration,
              curve: Motion.ease,
              child: Container(
                width: UniSwitchStyle.width - 2,
                height: UniSwitchStyle.height - 2,
                decoration: BoxDecoration(color: UniSwitchStyle.inner, borderRadius: BorderRadius.circular((UniSwitchStyle.height - 2) / 2)),
              ),
            ),
          ),
          AnimatedPositioned(
            left: checked ? UniSwitchStyle.travel : 0,
            top: 0,
            duration: UniSwitchStyle.moveDuration,
            curve: Motion.ease,
            child: Container(
              width: UniSwitchStyle.height - 2,
              height: UniSwitchStyle.height - 2,
              decoration: BoxDecoration(color: UniSwitchStyle.knob, shape: BoxShape.circle, boxShadow: UniSwitchStyle.knobShadow),
            ),
          ),
        ]),
      ),
    );
    return Semantics(
      toggled: checked,
      enabled: !disabled,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: disabled
            ? null
            : () {
                setState(() => checked = !checked);
                widget.onChanged?.call(checked);
              },
        child: Padding(padding: const EdgeInsets.only(right: UniSwitchStyle.marginRight), child: box),
      ),
    );
  }
}
