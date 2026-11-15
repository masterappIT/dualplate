// 鍵盤上方的「⌃ ⌄ 完成」列（lib/ui/keyboard_bar.dart）：一個情況一個測試。
import 'package:dualplate/ui/keyboard_bar.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/material.dart' show DefaultMaterialLocalizations, Material, MaterialType, TextField;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

// 三個輸入框：上、左下、右下（畫面順序：上 → 左下 → 右下）
Widget page({TargetPlatform platform = TargetPlatform.iOS, double keyboard = 300, List<FocusNode>? nodes, ValueChanged<double>? seen}) {
  final n = nodes ?? [FocusNode(), FocusNode(), FocusNode()];
  return MediaQuery(
    data: MediaQueryData(
      size: const Size(440, 956),
      viewInsets: EdgeInsets.only(bottom: keyboard),
    ),
    child: Localizations(
      locale: const Locale('en'),
      delegates: const [DefaultMaterialLocalizations.delegate, DefaultWidgetsLocalizations.delegate],
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Overlay(
          initialEntries: [
            OverlayEntry(
              builder: (_) => KeyboardBarArea(
                platform: platform,
                child: Builder(
                  builder: (context) {
                    seen?.call(MediaQuery.viewInsetsOf(context).bottom);
                    return Material(
                      type: MaterialType.transparency,
                      child: Column(
                        children: [
                          SizedBox(
                            width: 400,
                            child: TextField(key: const ValueKey('a'), focusNode: n[0]),
                          ),
                          Row(
                            children: [
                              SizedBox(
                                width: 200,
                                child: TextField(key: const ValueKey('c'), focusNode: n[2]),
                              ),
                              SizedBox(
                                width: 200,
                                child: TextField(key: const ValueKey('b'), focusNode: n[1]),
                              ),
                            ],
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

Future<List<FocusNode>> open(WidgetTester tester, {TargetPlatform platform = TargetPlatform.iOS, double keyboard = 300, int focus = 0, ValueChanged<double>? seen}) async {
  final nodes = [FocusNode(), FocusNode(), FocusNode()];
  addTearDown(() {
    for (final n in nodes) {
      n.dispose();
    }
  });
  await tester.pumpWidget(page(platform: platform, keyboard: keyboard, nodes: nodes, seen: seen));
  nodes[focus].requestFocus();
  await tester.pump();
  await tester.pump(); // 聚焦改變在 microtask 才通知，列在下一幀出現
  return nodes;
}

void main() {
  testWidgets('iOS 有鍵盤和聚焦時顯示', (tester) async {
    await open(tester);
    expect(find.byType(KeyboardBar), findsOneWidget);
  });

  testWidgets('接硬件鍵盤（沒有軟鍵盤）時貼在畫面底部', (tester) async {
    tester.view.physicalSize = const Size(1320, 2868);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await open(tester, keyboard: 0);
    expect(tester.getRect(find.byType(KeyboardBar)).bottom, 956);
  });

  testWidgets('沒有聚焦時不顯示', (tester) async {
    await tester.pumpWidget(page());
    await tester.pump();
    expect(find.byType(KeyboardBar), findsNothing);
  });

  testWidgets('安卓不顯示', (tester) async {
    await open(tester, platform: TargetPlatform.android);
    expect(find.byType(KeyboardBar), findsNothing);
  });

  testWidgets('有軟鍵盤時貼在鍵盤頂上、高 44', (tester) async {
    tester.view.physicalSize = const Size(1320, 2868);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await open(tester);
    final r = tester.getRect(find.byType(KeyboardBar));
    expect([r.bottom, r.height], [956 - 300, KeyboardBarStyle.height]);
  });

  testWidgets('頁面看到的鍵盤高度加上列高', (tester) async {
    double? inset;
    await open(tester, seen: (v) => inset = v);
    expect(inset, 300 + KeyboardBarStyle.height);
  });

  testWidgets('安卓頁面看到的鍵盤高度不變', (tester) async {
    double? inset;
    await open(tester, platform: TargetPlatform.android, seen: (v) => inset = v);
    expect(inset, 300);
  });

  testWidgets('第一個輸入框：⌃ 不能按、⌄ 可以', (tester) async {
    await open(tester);
    final bar = tester.widget<KeyboardBar>(find.byType(KeyboardBar));
    expect([bar.canUp, bar.canDown], [false, true]);
  });

  testWidgets('最後一個輸入框：⌄ 不能按', (tester) async {
    await open(tester, focus: 1);
    final bar = tester.widget<KeyboardBar>(find.byType(KeyboardBar));
    expect([bar.canUp, bar.canDown], [true, false]);
  });

  testWidgets('⌄ 按畫面位置跳到左下的輸入框', (tester) async {
    final nodes = await open(tester);
    await tester.tap(find.byKey(const ValueKey('keyboard-down')));
    await tester.pump();
    await tester.pump();
    expect(nodes[2].hasFocus, true);
  });

  testWidgets('再按 ⌄ 跳到右下', (tester) async {
    final nodes = await open(tester, focus: 2);
    await tester.tap(find.byKey(const ValueKey('keyboard-down')));
    await tester.pump();
    await tester.pump();
    expect(nodes[1].hasFocus, true);
  });

  testWidgets('⌃ 跳回上一個', (tester) async {
    final nodes = await open(tester, focus: 2);
    await tester.tap(find.byKey(const ValueKey('keyboard-up')));
    await tester.pump();
    await tester.pump();
    expect(nodes[0].hasFocus, true);
  });

  testWidgets('第一個輸入框按 ⌃ 不變', (tester) async {
    final nodes = await open(tester);
    await tester.tap(find.byKey(const ValueKey('keyboard-up')));
    await tester.pump();
    await tester.pump();
    expect(nodes[0].hasFocus, true);
  });

  testWidgets('「完成」收起鍵盤（失去聚焦）', (tester) async {
    final nodes = await open(tester);
    await tester.tap(find.byKey(const ValueKey('keyboard-done')));
    await tester.pump();
    await tester.pump();
    expect([nodes.any((n) => n.hasFocus), find.byType(KeyboardBar).evaluate().length], [false, 0]);
  });
}

