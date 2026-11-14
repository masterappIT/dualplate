import 'package:dualplate/main.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('組件樣板頁可以打開', (tester) async {
    await tester.pumpWidget(const DualplateApp());
    expect(find.text('組件樣板'), findsOneWidget);
  });

  testWidgets('確認框按取消回傳 cancel', (tester) async {
    await tester.pumpWidget(const DualplateApp());
    await tester.scrollUntilVisible(find.text('確認框'), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('確認框'));
    await tester.pumpAndSettle();
    expect(find.text('刪除這張牌照？'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(find.text('結果：cancel'), findsOneWidget);
  });

  testWidgets('底部選單按取消回傳 -1', (tester) async {
    await tester.pumpWidget(const DualplateApp());
    await tester.scrollUntilVisible(find.text('底部選單'), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('底部選單'));
    await tester.pumpAndSettle();
    expect(find.text('有變動？'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(find.text('結果：選了 -1'), findsOneWidget);
  });
}
