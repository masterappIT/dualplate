// <picker>（mode selector、date）：現有 App 在 App 端打開 uni-app 自帶的選擇頁（mobile/dist/build/app/__uniapppicker.js），
// 外觀和登入頁的區號選擇器（pages/login/area_picker.dart）相同：全螢幕透明頁，黑色遮罩淡入、白色面板由下滑上（200ms），
// 頂部「取消」「完成」，下面一欄或三欄滾輪（每行 34、字 16）。
// - selector：回傳選中的序號；按「取消」、點遮罩、返回鍵回傳 null。<picker> 沒有 :value 時打開在第 0 項（和現有 App 一樣）。
// - date：三欄「2026年」「11月」「16日」；年份範圍是今年前後 61 年（start／end 更早或更遲時放寬）；
//   日欄固定 31 項，選了該月沒有的日子時自動退回該月最後一天；超出 start／end 時退回邊界（__uniapppicker 的 valueArray watch）。
//   value 不是「年-月-日」時打開在今天。按「完成」回傳「YYYY-MM-DD」。
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'tokens.dart';

Future<int?> showSelectorPicker(BuildContext context, List<String> labels, {int index = 0}) async {
  if (labels.isEmpty) labels = const [' '];
  final r = await _open(context, PickerSpec(columns: [labels], values: [index.clamp(0, labels.length - 1)]));
  return r?.first;
}

Future<String?> showDatePicker(BuildContext context, {String? value, String? start, String? end, DateTime? now}) async {
  final today = now ?? DateTime.now();
  final range = dateYears(today.year, start, end);
  final years = [for (var y = range.$1; y <= range.$2; y++) '$y'];
  final months = [for (var m = 1; m <= 12; m++) _two(m)];
  final days = [for (var d = 1; d <= 31; d++) _two(d)];
  final cols = [years, months, days];
  final todayText = '${today.year}-${_two(today.month)}-${_two(today.day)}';
  List<int> parse(String? text, String fallback) {
    final parts = (text ?? '').split('-');
    final idx = [for (var i = 0; i < 3; i++) i < parts.length ? cols[i].indexOf(parts[i]) : -1];
    return idx.contains(-1) ? (fallback.isEmpty ? [0, 0, 0] : parse(fallback, '')) : idx;
  }

  final startArr = parse(start, '${today.year - 61}-01-01');
  final endArr = parse(end, '${today.year + 61}-12-31');
  final r = await _open(
    context,
    PickerSpec(
      columns: cols,
      values: parse(value, todayText),
      labels: (col, text) => text + const ['年', '月', '日'][col],
      clamp: (v) => clampDate(v, years, startArr, endArr),
    ),
  );
  return r == null ? null : [for (var i = 0; i < 3; i++) cols[i][r[i]]].join('-');
}

String _two(int n) => n < 10 ? '0$n' : '$n';

// 年份範圍：F()——今年前後 61 年；start 更早時由 start 起。end 照原碼讀 e.start（原有寫法），所以 end 不會放寬
(int, int) dateYears(int year, String? start, String? end) {
  var a = year - 61, b = year + 61;
  final s = int.tryParse((start ?? '').split('-').first);
  if (s != null && s < a) a = s;
  final e = int.tryParse((start ?? '').split('-').first);
  if (end != null && e != null && e > b) b = e;
  return (a, b);
}

// 選了該月沒有的日子退回月尾；早於 start、遲於 end 時退回邊界
List<int> clampDate(List<int> v, List<String> years, List<int> start, List<int> end) {
  final out = [...v];
  final y = int.parse(years[out[0]]), m = out[1] + 1;
  final last = DateTime(y, m + 1, 0).day;
  if (out[2] + 1 > last) out[2] = last - 1;
  int key(List<int> a) => a[0] * 31 * 12 + a[1] * 31 + a[2];
  if (key(out) < key(start)) return [...start];
  if (key(out) > key(end)) return [...end];
  return out;
}

// 選擇器的內容：每欄的選項、打開時選中的序號、顯示用的文字（日期加「年月日」）、停下時的修正
class PickerSpec {
  PickerSpec({required this.columns, required this.values, this.labels, this.clamp});
  final List<List<String>> columns;
  final List<int> values;
  final String Function(int col, String text)? labels;
  final List<int> Function(List<int>)? clamp;
}

Future<List<int>?> _open(BuildContext context, PickerSpec spec) => Navigator.of(context, rootNavigator: true).push<List<int>>(
      PageRouteBuilder<List<int>>(
        opaque: false,
        barrierDismissible: false,
        barrierColor: const Color(0x00000000),
        transitionDuration: LoginStyle.pickerDuration,
        reverseTransitionDuration: LoginStyle.pickerDuration,
        pageBuilder: (context, animation, _) => UniPicker(animation: animation, spec: spec),
      ),
    );

class UniPicker extends StatefulWidget {
  const UniPicker({super.key, required this.animation, required this.spec});
  final Animation<double> animation;
  final PickerSpec spec;
  @override
  State<UniPicker> createState() => _UniPickerState();
}

class _UniPickerState extends State<UniPicker> {
  late final List<FixedExtentScrollController> wheels = [for (final v in widget.spec.values) FixedExtentScrollController(initialItem: v)];
  bool closing = false;

  @override
  void dispose() {
    for (final w in wheels) {
      w.dispose();
    }
    super.dispose();
  }

  List<int> get current => [for (var i = 0; i < wheels.length; i++) wheels[i].hasClients ? wheels[i].selectedItem.clamp(0, widget.spec.columns[i].length - 1) : widget.spec.values[i]];

  void close([List<int>? value]) {
    if (closing) return;
    closing = true;
    Navigator.of(context).pop(value);
  }

  // 滾輪停下時按日期規則修正（退回月尾或邊界）
  void settle() {
    final clamp = widget.spec.clamp;
    if (clamp == null) return;
    final now = current, fixed = clamp(now);
    for (var i = 0; i < wheels.length; i++) {
      if (fixed[i] != now[i] && wheels[i].hasClients) wheels[i].animateToItem(fixed[i], duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    }
  }

  @override
  Widget build(BuildContext context) {
    final safe = MediaQuery.paddingOf(context);
    final zh = PlatformDispatcher.instance.locale.languageCode == 'zh';
    final android = defaultTargetPlatform == TargetPlatform.android;
    final action = TextStyle(
      fontWeight: FontWeight.w400,
      fontSize: LoginStyle.pickerActionSize,
      height: LoginStyle.pickerHeader / LoginStyle.pickerActionSize,
      fontFamily: fontFamily,
      fontFamilyFallback: fontFallback,
      decoration: TextDecoration.none,
    );
    const item = TextStyle(
      fontSize: LoginStyle.pickerItemSize,
      fontWeight: FontWeight.w400,
      height: LoginStyle.pickerRow / LoginStyle.pickerItemSize,
      color: LoginStyle.pickerText,
      fontFamily: fontFamily,
      fontFamilyFallback: fontFallback,
      decoration: TextDecoration.none,
    );
    final spec = widget.spec;
    return AnimatedBuilder(
      animation: widget.animation,
      builder: (context, _) {
        final t = widget.animation.value, slide = (283 + safe.bottom) * (1 - t);
        return Stack(children: [
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
            bottom: -slide,
            height: LoginStyle.pickerHeight + safe.bottom,
            child: Container(
              color: LoginStyle.pickerBg,
              padding: EdgeInsets.only(bottom: safe.bottom),
              child: Column(children: [
                Container(
                  height: LoginStyle.pickerHeader,
                  decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: LoginStyle.pickerLine, width: .5))),
                  child: Row(children: [
                    GestureDetector(
                      key: const ValueKey('picker-cancel'),
                      behavior: HitTestBehavior.opaque,
                      onTap: close,
                      child: Padding(padding: EdgeInsets.only(left: 14 + safe.left, right: 14), child: Text(zh ? '取消' : 'Cancel', style: action.copyWith(color: LoginStyle.pickerCancel))),
                    ),
                    const Spacer(),
                    GestureDetector(
                      key: const ValueKey('picker-done'),
                      behavior: HitTestBehavior.opaque,
                      onTap: () => close(spec.clamp == null ? current : spec.clamp!(current)),
                      child: Padding(padding: EdgeInsets.only(left: 14, right: 14 + safe.right), child: Text(zh ? '完成' : 'Done', style: action.copyWith(color: LoginStyle.pickerConfirm))),
                    ),
                  ]),
                ),
                SizedBox(
                  height: LoginStyle.pickerBody,
                  child: Padding(
                    padding: EdgeInsets.only(left: safe.left),
                    child: Stack(children: [
                      Row(children: [
                        for (var c = 0; c < spec.columns.length; c++)
                          Expanded(
                            child: NotificationListener<ScrollEndNotification>(
                              onNotification: (_) {
                                settle();
                                return false;
                              },
                              child: ListWheelScrollView(
                                key: ValueKey('picker-col-$c'),
                                controller: wheels[c],
                                itemExtent: LoginStyle.pickerRow,
                                diameterRatio: 1000,
                                physics: const FixedExtentScrollPhysics(),
                                children: [
                                  for (final label in spec.columns[c]) Center(child: Text(spec.labels == null ? label : spec.labels!(c, label), style: item)),
                                ],
                              ),
                            ),
                          ),
                      ]),
                      const Positioned.fill(
                        child: IgnorePointer(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                            Expanded(child: DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [LoginStyle.pickerFadeTop, LoginStyle.pickerFadeMid])))),
                            DecoratedBox(
                              decoration: BoxDecoration(border: Border.symmetric(horizontal: BorderSide(color: LoginStyle.pickerLine, width: .5))),
                              child: SizedBox(height: LoginStyle.pickerRow, width: double.infinity),
                            ),
                            Expanded(child: DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.bottomCenter, end: Alignment.topCenter, colors: [LoginStyle.pickerFadeTop, LoginStyle.pickerFadeMid])))),
                          ]),
                        ),
                      ),
                    ]),
                  ),
                ),
              ]),
            ),
          ),
        ]);
      },
    );
  }
}
