import 'package:dualplate/ui/choices.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/rendering.dart' show RenderDecoratedBox;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

// 和手機一樣寬（390）的測試畫面
Widget host(Widget child) => MediaQuery(
      data: const MediaQueryData(size: Size(390, 844)),
      child: Directionality(textDirection: TextDirection.ltr, child: Align(alignment: Alignment.topLeft, child: SizedBox(width: 358, child: child))),
    );

class RadioHost extends StatefulWidget {
  const RadioHost({super.key, this.initial = '香港', this.rowMargin = WotChoice.radioMargin, this.rowPadding = 0, this.onChanged, this.options = const [('香港', '香港公司'), ('澳門', '澳門公司'), ('內地', '內地公司')]});
  final String initial;
  final double rowMargin, rowPadding;
  final ValueChanged<String>? onChanged;
  final List<(String, String)> options;
  @override
  State<RadioHost> createState() => _RadioHostState();
}

class _RadioHostState extends State<RadioHost> {
  late String value = widget.initial;
  @override
  Widget build(BuildContext context) => WdRadioGroup<String>(
        value: value,
        options: widget.options,
        rowMargin: widget.rowMargin,
        rowPadding: widget.rowPadding,
        onChanged: (v) {
          widget.onChanged?.call(v);
          setState(() => value = v);
        },
      );
}

class CheckHost extends StatefulWidget {
  const CheckHost({super.key, this.label = '我已閱讀並同意', this.block = true, this.initial = false});
  final String label;
  final bool block, initial;
  @override
  State<CheckHost> createState() => _CheckHostState();
}

class _CheckHostState extends State<CheckHost> {
  late bool value = widget.initial;
  @override
  Widget build(BuildContext context) => WdCheckbox(label: widget.label, value: value, block: widget.block, onChanged: (v) => setState(() => value = v));
}

// 單選圓點：WdRadio 裏帶圓形外框的 Container
BoxDecoration dotOf(WidgetTester tester, String label) {
  final boxes = tester.widgetList<Container>(find.descendant(of: find.widgetWithText(WdRadio, label), matching: find.byType(Container)));
  return boxes.map((c) => c.decoration).whereType<BoxDecoration>().firstWhere((d) => d.border != null);
}

double whiteDotScale(WidgetTester tester, String label) => tester.widget<AnimatedScale>(find.descendant(of: find.widgetWithText(WdRadio, label), matching: find.byType(AnimatedScale))).scale;

// 勾選方框：AnimatedContainer 的底色、前景外框
AnimatedContainer boxOf(WidgetTester tester) => tester.widget<AnimatedContainer>(find.descendant(of: find.byType(WdCheckbox), matching: find.byType(AnimatedContainer)));

Color boxColorNow(WidgetTester tester) {
  final rendered = tester.renderObjectList<RenderDecoratedBox>(find.descendant(of: find.byType(WdCheckbox), matching: find.byType(DecoratedBox)));
  return rendered.map((r) => r.decoration).whereType<BoxDecoration>().firstWhere((d) => d.color != null).color!;
}

void main() {
  group('單選', () {
    testWidgets('點選項回傳該選項的值', (tester) async {
      String? got;
      await tester.pumpWidget(host(RadioHost(onChanged: (v) => got = v)));
      await tester.tap(find.text('澳門公司'));
      await tester.pump();
      expect(got, '澳門');
    });

    testWidgets('點文字和圓點之間的空白處也會選中（整行可點）', (tester) async {
      String? got;
      await tester.pumpWidget(host(RadioHost(onChanged: (v) => got = v)));
      final row = tester.getRect(find.widgetWithText(WdRadio, '內地公司'));
      await tester.tapAt(Offset(row.center.dx, row.center.dy));
      await tester.pump();
      expect(got, '內地');
    });

    testWidgets('選中的圓點是主題色實心，未選的是 2px 灰邊空心', (tester) async {
      await tester.pumpWidget(host(const RadioHost()));
      final on = dotOf(tester, '香港公司'), off = dotOf(tester, '澳門公司');
      expect(on.color, C.jade);
      expect((on.border! as Border).top.color, C.jade);
      expect(off.color, isNull);
      expect((off.border! as Border).top.color, WotChoice.border);
      expect((off.border! as Border).top.width, 2);
    });

    testWidgets('圓點 16px、在行的最右邊', (tester) async {
      await tester.pumpWidget(host(const RadioHost()));
      final row = tester.getRect(find.widgetWithText(WdRadio, '香港公司'));
      final dot = find.descendant(of: find.widgetWithText(WdRadio, '香港公司'), matching: find.byWidgetPredicate((w) => w is Container && w.decoration is BoxDecoration && (w.decoration! as BoxDecoration).border != null));
      final rect = tester.getRect(dot);
      expect(rect.size, const Size(16, 16));
      expect(rect.right, row.right);
    });

    testWidgets('中間白點選中時 200 毫秒內由 0 放大到 1', (tester) async {
      await tester.pumpWidget(host(const RadioHost()));
      expect(whiteDotScale(tester, '澳門公司'), 0);
      await tester.tap(find.text('澳門公司'));
      await tester.pump();
      expect(whiteDotScale(tester, '澳門公司'), 1);
      final scale = find.descendant(of: find.widgetWithText(WdRadio, '澳門公司'), matching: find.byType(ScaleTransition));
      await tester.pump(const Duration(milliseconds: 100));
      final mid = tester.widget<ScaleTransition>(scale).scale.value;
      expect(mid, greaterThan(0));
      expect(mid, lessThan(1));
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.widget<ScaleTransition>(scale).scale.value, 1);
    });

    testWidgets('預設每個選項上方 10px（第一個也有），行高 20', (tester) async {
      await tester.pumpWidget(host(const RadioHost()));
      final first = tester.getRect(find.widgetWithText(WdRadio, '香港公司'));
      final second = tester.getRect(find.widgetWithText(WdRadio, '澳門公司'));
      expect(first.top, 10);
      expect(first.height, 20);
      expect(second.top - first.bottom, 10);
    });

    testWidgets('頁面覆寫 padding 10、margin 0 時每行高 40、沒有間距', (tester) async {
      await tester.pumpWidget(host(const RadioHost(rowMargin: 0, rowPadding: 10)));
      final first = tester.getRect(find.widgetWithText(WdRadio, '香港公司'));
      final second = tester.getRect(find.widgetWithText(WdRadio, '澳門公司'));
      expect(first.top, 0);
      expect(first.height, 40);
      expect(second.top, first.bottom);
    });

    testWidgets('文字 14px、rgba(0,0,0,.85)、長文字換行後每行置中', (tester) async {
      await tester.pumpWidget(host(const RadioHost(options: [('a', '示範貿易有限公司示範貿易有限公司示範貿易有限公司（香港公司）')])));
      final text = tester.widget<Text>(find.textContaining('示範貿易'));
      expect(text.style!.fontSize, 14);
      expect(text.style!.color, WotChoice.label);
      expect(text.textAlign, TextAlign.center);
      expect(tester.getSize(find.textContaining('示範貿易')).height, 40);
    });

    testWidgets('沒有選中任何一項時全部是空心', (tester) async {
      await tester.pumpWidget(host(const RadioHost(initial: '')));
      for (final label in ['香港公司', '澳門公司', '內地公司']) {
        expect(dotOf(tester, label).color, isNull);
      }
    });
  });

  group('勾選', () {
    testWidgets('點文字切換為選中', (tester) async {
      await tester.pumpWidget(host(const CheckHost()));
      await tester.tap(find.text('我已閱讀並同意'));
      await tester.pumpAndSettle();
      expect(tester.widget<WdCheckbox>(find.byType(WdCheckbox)).value, isTrue);
    });

    testWidgets('再點一次取消選中', (tester) async {
      await tester.pumpWidget(host(const CheckHost(initial: true)));
      await tester.tap(find.text('我已閱讀並同意'));
      await tester.pumpAndSettle();
      expect(tester.widget<WdCheckbox>(find.byType(WdCheckbox)).value, isFalse);
    });

    testWidgets('未選時白底灰邊、沒有勾號；方框 16px、圓角 4', (tester) async {
      await tester.pumpWidget(host(const CheckHost()));
      final box = boxOf(tester);
      final fg = box.foregroundDecoration! as BoxDecoration;
      expect((box.decoration! as BoxDecoration).color, WotChoice.box);
      expect((fg.border! as Border).top.color, WotChoice.border);
      expect(fg.borderRadius, BorderRadius.circular(4));
      expect(tester.getSize(find.byType(AnimatedContainer)), const Size(16, 16));
      expect(tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity)).opacity, 0);
    });

    testWidgets('選中時邊框即時變主題色，底色 200 毫秒過渡到主題色，勾號淡入', (tester) async {
      await tester.pumpWidget(host(const CheckHost()));
      await tester.tap(find.byType(WdCheckbox));
      await tester.pump();
      expect(((boxOf(tester).foregroundDecoration! as BoxDecoration).border! as Border).top.color, C.jade);
      await tester.pump(const Duration(milliseconds: 100));
      final mid = boxColorNow(tester);
      expect(mid, isNot(WotChoice.box));
      expect(mid, isNot(C.jade));
      await tester.pump(const Duration(milliseconds: 100));
      expect(boxColorNow(tester), C.jade);
      expect(tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity)).opacity, 1);
    });

    testWidgets('文字在方框右邊 9px，行高 20', (tester) async {
      await tester.pumpWidget(host(const CheckHost()));
      final box = tester.getRect(find.byType(AnimatedContainer));
      final text = tester.getRect(find.text('我已閱讀並同意'));
      expect(text.left - box.right, 9);
      expect(text.height, 20);
      expect(box.center.dy, text.center.dy);
    });

    testWidgets('block 時整行可點（點行尾空白處也切換）', (tester) async {
      await tester.pumpWidget(host(const CheckHost()));
      await tester.tapAt(const Offset(350, 10));
      await tester.pumpAndSettle();
      expect(tester.widget<WdCheckbox>(find.byType(WdCheckbox)).value, isTrue);
    });

    testWidgets('block: false 時只佔自己的寬度', (tester) async {
      await tester.pumpWidget(host(const Row(children: [CheckHost(block: false)])));
      final width = tester.getSize(find.byType(WdCheckbox)).width;
      expect(width, 16 + 9 + tester.getSize(find.text('我已閱讀並同意')).width);
    });

    testWidgets('太長的文字只顯示一行並省略', (tester) async {
      await tester.pumpWidget(host(const CheckHost(label: '香港公司 · 示範貿易有限公司示範貿易有限公司示範貿易有限公司示範貿易有限公司')));
      final text = tester.widget<Text>(find.textContaining('示範貿易'));
      expect(text.maxLines, 1);
      expect(text.overflow, TextOverflow.ellipsis);
      expect(tester.getSize(find.textContaining('示範貿易')).height, 20);
      expect(tester.takeException(), isNull);
    });
  });
}
