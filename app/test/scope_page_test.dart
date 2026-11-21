// 委託內容頁：從 /scope?id=… 返回 /scope 時重新載入（靠 PageShow 連查詢參數比較，頁面不再自己載入）。
import 'dart:convert';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

int scopeLoads = 0;
List<Object> youItems = [];

Map<String, Object> scope() => {
      'sections': [
        {
          'title': '牌照',
          'owners': [
            {'id': 'p1', 'type': 'plate', 'label': '粵ZA100港', 'us': [1, 2], 'you': youItems},
          ],
        },
      ],
    };

Future<http.Response> handle(http.Request r) async {
  final body = switch (r.url.path) {
    '/api/my/scope' => (() {
        scopeLoads++;
        return scope();
      })(),
    '/api/my/overview' => {'advisor': null},
    _ => <String, Object>{},
  };
  return http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json; charset=utf-8'});
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    scopeLoads = 0;
    youItems = [];
    Api.client = MockClient(handle);
    debugResetApi();
  });

  testWidgets('從 /scope?id=… 返回 /scope：重新載入，畫面跟着變', (tester) async {
    tester.view.physicalSize = const Size(1320, 2868);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({'flutter.welcomeGuide:u1': 1});
    await Session.load();
    Session.debugSet(token: 't', user: {'id': 'u1', 'name': '李先生', 'serviceMode': '托管'}, mode: '托管');
    await tester.pumpWidget(const DualplateApp(initialLocation: '/scope'));
    await settle(tester);
    expect(scopeLoads, 1);
    expect(find.text('我們負責 2 項'), findsWidgets);

    // 點牌照，推入 /scope?id=p1
    await tester.tap(find.text('粵ZA100港').first);
    await settle(tester);
    expect(scopeLoads, 2);

    // 在子頁期間資料改了：多了一項自行辦理
    youItems = [3];
    GoRouter.of(tester.element(find.text('粵ZA100港').last)).pop();
    await settle(tester);
    expect(scopeLoads, 3);
    expect(find.text('我們負責 2 項 · 你自行辦理 1 項'), findsWidgets);
  });
}
