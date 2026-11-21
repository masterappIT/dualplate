// <picker>：
// - mode selector：現有 App 在 App 端打開 uni-app 自帶的選擇頁（mobile/dist/build/app/__uniapppicker.js），
//   外觀和登入頁的區號選擇器（pages/login/area_picker.dart）相同：全螢幕透明頁，黑色遮罩淡入、白色面板由下滑上（200ms），
//   頂部「取消」「完成」，下面一欄滾輪（每行 34、字 16）。回傳選中的序號；按「取消」、點遮罩、返回鍵回傳 null。
//   <picker> 沒有 :value 時打開在第 0 項（和現有 App 一樣）。
// - mode date：現有 App 在 iOS 打開系統原生日期滾輪（UIDatePicker，3a 修正時對照截圖），這裏用 Flutter 自帶的 CupertinoPicker 排三欄：
//   頂條只有右邊「完成」，點遮罩、返回鍵關閉（回傳 null）；三欄「2026 年」「12月」「16日」（月日不補零），立體滾輪，選中行灰色圓角底條。
//   不直接用 CupertinoDatePicker：它的月份欄靠右、香港中文月份寫「十二月」，和原生不同（原生年份靠右、月日靠左）；
//   放大、壓縮、立體偏移、月日循環、不存在的日子變灰並彈回，照 CupertinoDatePicker 的做法。
//   數值見 tokens.dart 的 DatePickerStyle。年份範圍沿用今年前後 61 年（start 更早時放寬，dateYears）；
//   start／end 是可選的最早、最遲日期，滾到範圍外會彈回（和 UIDatePicker 的 minimumDate／maximumDate 一樣）。
//   value 不是「年-月-日」時打開在今天；打開的日期超出範圍時先退回邊界。按「完成」回傳「YYYY-MM-DD」。
import 'dart:ui' show ImageFilter;
import 'package:flutter/cupertino.dart' show CupertinoPicker;
import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart' show SchedulerBinding;
import 'package:flutter/widgets.dart';
import 'tokens.dart';

Future<int?> showSelectorPicker(BuildContext context, List<String> labels, {int index = 0}) async {
  if (labels.isEmpty) labels = const [' '];
  final r = await _open(context, PickerSpec(columns: [labels], values: [index.clamp(0, labels.length - 1)]));
  return r?.first;
}

Future<String?> showDatePicker(BuildContext context, {String? value, String? start, String? end, DateTime? now}) {
  final today = now ?? DateTime.now();
  final range = dateYears(today.year, start, end);
  final first = parseDay(start), last = parseDay(end);
  final minYear = first != null && first.year < range.$1 ? first.year : range.$1;
  final maxYear = last != null && last.year > range.$2 ? last.year : range.$2;
  var initial = parseDay(value) ?? DateTime(today.year, today.month, today.day);
  final lo = first ?? DateTime(minYear), hi = last ?? DateTime(maxYear, 12, 31);
  if (initial.isBefore(lo)) initial = lo;
  if (initial.isAfter(hi)) initial = hi;
  return Navigator.of(context, rootNavigator: true).push<String>(
    PageRouteBuilder<String>(
      opaque: false,
      barrierDismissible: false,
      barrierColor: const Color(0x00000000),
      transitionDuration: DatePickerStyle.duration,
      reverseTransitionDuration: DatePickerStyle.duration,
      pageBuilder: (context, animation, _) => NativeDatePicker(animation: animation, initial: initial, minimum: first, maximum: last, minimumYear: minYear, maximumYear: maxYear),
    ),
  );
}

// 「YYYY-MM-DD」轉成日期；格式不對時 null。日子大過該月日數時退回月尾（和原來三欄滾輪的修正一樣，例如 2026-02-30 → 2026-02-28）
DateTime? parseDay(String? text) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(text ?? '');
  if (m == null) return null;
  final y = int.parse(m[1]!), mo = int.parse(m[2]!), d = int.parse(m[3]!);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  final lastDay = DateTime(y, mo + 1, 0).day;
  return DateTime(y, mo, d > lastDay ? lastDay : d);
}

String dayText(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${_two(d.month)}-${_two(d.day)}';

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

// iOS 原生樣式的日期滾輪（showDatePicker 打開）
class NativeDatePicker extends StatefulWidget {
  const NativeDatePicker({super.key, required this.animation, required this.initial, this.minimum, this.maximum, required this.minimumYear, required this.maximumYear});
  final Animation<double> animation;
  final DateTime initial;
  final DateTime? minimum, maximum;
  final int minimumYear, maximumYear;
  @override
  State<NativeDatePicker> createState() => _NativeDatePickerState();
}

class _NativeDatePickerState extends State<NativeDatePicker> {
  late int year = widget.initial.year, month = widget.initial.month, day = widget.initial.day;
  late final years = FixedExtentScrollController(initialItem: year - widget.minimumYear);
  late final months = FixedExtentScrollController(initialItem: month - 1);
  late final days = FixedExtentScrollController(initialItem: day - 1);
  int scrolling = 0;
  bool closing = false;

  @override
  void dispose() {
    years.dispose();
    months.dispose();
    days.dispose();
    super.dispose();
  }

  int get _lastDay => DateTime(year, month + 1, 0).day;

  // 目前停着的日期：不存在的日子退回月尾，超出範圍退回邊界（按「完成」時用）
  DateTime get current {
    var d = DateTime(year, month, day > _lastDay ? _lastDay : day);
    if (widget.minimum != null && d.isBefore(widget.minimum!)) d = widget.minimum!;
    if (widget.maximum != null && d.isAfter(widget.maximum!)) d = widget.maximum!;
    return d;
  }

  void close([String? value]) {
    if (closing) return;
    closing = true;
    Navigator.of(context).pop(value);
  }

  // 全部欄都停下後：更新變灰的項目；停在不存在的日子或範圍外時彈回（CupertinoDatePicker 的 _pickerDidStopScrolling）
  void _stopped() {
    setState(() {});
    if (scrolling > 0) return;
    final target = current;
    if (target.year == year && target.month == month && target.day == day) return;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      void go(FixedExtentScrollController c, int item) {
        if (c.hasClients && c.selectedItem != item) c.animateToItem(item, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }

      if (target.year != year) go(years, target.year - widget.minimumYear);
      if (target.month != month) go(months, _loopItem(months, target.month - 1, 12));
      if (target.day != day) go(days, _loopItem(days, target.day - 1, 31));
    });
  }

  // 循環的欄：轉到離目前最近的同一項
  int _loopItem(FixedExtentScrollController c, int index, int count) {
    final now = c.selectedItem;
    final base = now - now % count;
    final options = [base - count + index, base + index, base + count + index];
    options.sort((a, b) => (a - now).abs().compareTo((b - now).abs()));
    return options.first;
  }

  bool _validDay(int d) {
    if (d > _lastDay) return false;
    final date = DateTime(year, month, d);
    if (widget.minimum != null && date.isBefore(widget.minimum!)) return false;
    if (widget.maximum != null && date.isAfter(widget.maximum!)) return false;
    return true;
  }

  bool _validMonth(int m) {
    final first = DateTime(year, m), last = DateTime(year, m + 1, 0);
    if (widget.minimum != null && last.isBefore(widget.minimum!)) return false;
    if (widget.maximum != null && first.isAfter(widget.maximum!)) return false;
    return true;
  }

  bool _validYear(int y) => (widget.minimum == null || y >= widget.minimum!.year) && (widget.maximum == null || y <= widget.maximum!.year);

  TextStyle _style(bool valid) => TextStyle(
    inherit: false,
    fontSize: DatePickerStyle.fontSize,
    fontWeight: FontWeight.w400,
    color: valid ? DatePickerStyle.text : DatePickerStyle.invalid,
    fontFamily: DatePickerStyle.font,
    fontFamilyFallback: fontFallback,
    decoration: TextDecoration.none,
  );

  // 一欄：寬 width，文字靠右（年）或靠左（月、日）；offAxis 是立體偏移（照 CupertinoDatePicker：左欄 -0.3、中 0、右 0.3）
  Widget _column({
    required Key key,
    required FixedExtentScrollController controller,
    required double offAxis,
    required bool looping,
    required int count,
    required Widget Function(int index) item,
    required void Function(int index) onChanged,
  }) => NotificationListener<ScrollNotification>(
    onNotification: (n) {
      if (n is ScrollStartNotification) scrolling++;
      if (n is ScrollEndNotification) {
        scrolling = scrolling > 0 ? scrolling - 1 : 0;
        _stopped();
      }
      return false;
    },
    child: CupertinoPicker(
      key: key,
      scrollController: controller,
      itemExtent: DatePickerStyle.itemExtent,
      magnification: DatePickerStyle.magnification,
      useMagnifier: true,
      squeeze: DatePickerStyle.squeeze,
      offAxisFraction: offAxis,
      looping: looping,
      backgroundColor: const Color(0x00000000),
      selectionOverlay: null,
      onSelectedItemChanged: (i) => onChanged(i % count),
      children: [
          for (var i = 0; i < count; i++) Padding(padding: const EdgeInsets.symmetric(horizontal: DatePickerStyle.columnPad), child: item(i)),
        ],
    ),
  );

  // 「12月」「16日」
  Widget _label(int n, String unit, bool valid) => Text('$n$unit', style: _style(valid));

  // 「2026 年」：數字和「年」之間比月、日多一點空隙（原生截圖量得）。用最後一個數字的字距做，文字仍是「2026年」
  Widget _yearLabel(int y) {
    final text = '$y';
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(text: text.substring(0, text.length - 1)),
          TextSpan(text: text.substring(text.length - 1), style: const TextStyle(letterSpacing: DatePickerStyle.yearGap)),
          const TextSpan(text: '年'),
        ],
      ),
      style: _style(_validYear(y)),
    );
  }

  Widget _wheel() => LayoutBuilder(
    builder: (context, box) {
      final cx = box.maxWidth / 2;
      // 每欄左右各多留 columnPad（中線不變），文字內縮同樣距離（見 _column）：選中行放大時以欄中線為準，貼邊的字會被欄邊裁掉
      Widget at(double left, double width, Widget child) =>
          Positioned(left: cx + left - DatePickerStyle.columnPad, width: width + 2 * DatePickerStyle.columnPad, top: 0, bottom: 0, child: child);
      return Stack(
        children: [
          at(
            DatePickerStyle.yearLeft,
            DatePickerStyle.yearWidth,
            _column(
              key: const ValueKey('picker-year'),
              controller: years,
              offAxis: -0.3,
              looping: false,
              count: widget.maximumYear - widget.minimumYear + 1,
              item: (i) => Align(alignment: Alignment.centerRight, child: _yearLabel(widget.minimumYear + i)),
              onChanged: (i) => year = widget.minimumYear + i,
            ),
          ),
          at(
            DatePickerStyle.monthLeft,
            DatePickerStyle.monthWidth,
            _column(
              key: const ValueKey('picker-month'),
              controller: months,
              offAxis: 0,
              looping: true,
              count: 12,
              item: (i) => Align(
                alignment: Alignment.centerLeft,
                child: _label(i + 1, '月', _validMonth(i + 1)),
              ),
              onChanged: (i) => month = i + 1,
            ),
          ),
          at(
            DatePickerStyle.dayLeft,
            DatePickerStyle.dayWidth,
            _column(
              key: const ValueKey('picker-day'),
              controller: days,
              offAxis: 0.3,
              looping: true,
              count: 31,
              item: (i) => Align(
                alignment: Alignment.centerLeft,
                child: _label(i + 1, '日', _validDay(i + 1)),
              ),
              onChanged: (i) => day = i + 1,
            ),
          ),
        ],
      );
    },
  );

  @override
  Widget build(BuildContext context) {
    final safe = MediaQuery.paddingOf(context);
    const panel = DatePickerStyle.toolbarHeight + DatePickerStyle.wheelHeight;
    final zh = PlatformDispatcher.instance.locale.languageCode == 'zh';
    return AnimatedBuilder(
      animation: widget.animation,
      builder: (context, child) {
        final t = Curves.easeOut.transform(widget.animation.value);
        return Stack(
          children: [
            Positioned.fill(
              child: GestureDetector(
                key: const ValueKey('picker-mask'),
                onTap: close,
                child: ColoredBox(color: Color.lerp(const Color(0x00000000), DatePickerStyle.mask, t)!),
              ),
            ),
            Positioned(left: 0, right: 0, bottom: -panel * (1 - t), height: panel, child: child!),
          ],
        );
      },
      // 頂條是模糊的系統材質；滾輪部分不模糊，下面的頁面隱約透出（照截圖）
      child: Column(
        children: [
          ClipRect(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: DatePickerStyle.blur, sigmaY: DatePickerStyle.blur),
              child: Container(
                height: DatePickerStyle.toolbarHeight,
                color: DatePickerStyle.toolbarBg,
                alignment: Alignment.centerRight,
                child: GestureDetector(
                  key: const ValueKey('picker-done'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () => close(dayText(current)),
                  child: Container(
                    height: DatePickerStyle.toolbarHeight,
                    padding: EdgeInsets.only(left: DatePickerStyle.doneRight, right: DatePickerStyle.doneRight + safe.right),
                    child: Text(
                      zh ? '完成' : 'Done',
                      // 一般粗細（不跟外面的預設字型）；行高等於頂條高，文字置中
                      style: const TextStyle(
                        inherit: false,
                        height: DatePickerStyle.toolbarHeight / DatePickerStyle.doneSize,
                        leadingDistribution: TextLeadingDistribution.even,
                        fontWeight: FontWeight.w400,
                        fontSize: DatePickerStyle.doneSize,
                        color: DatePickerStyle.done,
                        fontFamily: fontFamily,
                        fontFamilyFallback: fontFallback,
                        decoration: TextDecoration.none,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          Container(
            height: DatePickerStyle.wheelHeight,
            color: DatePickerStyle.wheelBg,
            padding: EdgeInsets.only(left: safe.left, right: safe.right),
            child: Stack(
              children: [
                Center(
                  child: Container(
                    key: const ValueKey('picker-selection'),
                    height: DatePickerStyle.selectionHeight,
                    margin: const EdgeInsets.symmetric(horizontal: DatePickerStyle.selectionMargin),
                    decoration: BoxDecoration(color: DatePickerStyle.selection, borderRadius: BorderRadius.circular(DatePickerStyle.selectionRadius)),
                  ),
                ),
                _wheel(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
