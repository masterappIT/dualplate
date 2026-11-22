// 登入頁（lib/pages/login/）和啟動頁：一個情況一個測試。伺服器用 MockClient 代替，不連正式網站。
// 口岸畫布一直在動，不能用 pumpAndSettle，一律 pump 固定時間。
import 'dart:convert';
import 'dart:io';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/external.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/pages/login/contact_card.dart';
import 'package:dualplate/pages/login/login_page.dart';
import 'package:dualplate/pages/login/ports_canvas.dart';
import 'package:dualplate/pages/login/svg_icon.dart';
import 'package:dualplate/shell/tab_bar.dart';
import 'package:dualplate/ui/tokens.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

const whatsapp = {'whatsapp': '+85366714829', 'whatsappLink': 'https://wa.me/85366714829', 'wechatId': '', 'wechatQr': '', 'wecomLink': ''};
const noChannel = {'whatsapp': '', 'whatsappLink': '', 'wechatId': '', 'wechatQr': '', 'wecomLink': ''};
const customer = {'token': 'new-token', 'user': {'id': 'u1', 'role': 'customer', 'serviceMode': '托管'}};

late List<http.Request> sent;

http.Response reply(Object body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

// login：/login 的回覆；contact：/public/contact 的回覆；delay：/login 要等多久
void serve({Object? login, int loginStatus = 200, Map contact = whatsapp, Duration delay = Duration.zero, bool offline = false}) {
  Api.client = MockClient((r) async {
    sent.add(r);
    if (r.url.path == '/api/public/contact') return reply(contact);
    if (r.url.path == '/api/login') {
      if (offline) throw http.ClientException('offline');
      await Future<void>.delayed(delay);
      return reply(login ?? customer, loginStatus);
    }
    return reply({'error': '請重新登入'}, 401);
  });
}

Future<void> openLogin(WidgetTester tester, {Map<String, Object> prefs = const {}}) async {
  tester.view.physicalSize = const Size(1320, 2868); // iPhone 16／17 Pro Max：440×956
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues(Map.of(prefs));
  await Session.load();
  // 3a：首頁換成真頁面後會讀 API（這裏的假伺服器一律回 401，會再打開登入頁）；登入後到首頁的流程照外殼測試用 demoTabs
  await tester.pumpWidget(const DualplateApp(initialLocation: '/login', demoTabs: true));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

Finder inputOf(String key) => find.descendant(of: find.byKey(ValueKey(key)), matching: find.byType(EditableText));

Future<void> type(WidgetTester tester, String key, String text) async {
  await tester.enterText(inputOf(key), text);
  await tester.pump();
}

Future<void> tapLogin(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const ValueKey('login-button')));
  await tester.tap(find.byKey(const ValueKey('login-button')));
  await tester.pump();
}

Color borderOf(WidgetTester tester, String key) {
  final box = tester.widget<AnimatedContainer>(find.descendant(of: find.byKey(ValueKey(key)), matching: find.byType(AnimatedContainer)).first);
  return ((box.decoration as BoxDecoration).border as Border).top.color;
}

String svgPaths(String file) => RegExp(r'<path d="([^"]+)"').allMatches(File('../mobile/src/static/$file').readAsStringSync()).map((m) => m[1]).join('\n');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
    sent = [];
    debugResetApi();
    serve();
  });

  group('svg 圖示和原檔一樣', () {
    test('M 雲標誌', () => expect(brandMark.paths.map((p) => p.$1).join('\n'), svgPaths('masterapp-mark.svg')));
    test('WhatsApp', () => expect(whatsappIcon.paths.map((p) => p.$1).join('\n'), svgPaths('whatsapp.svg')));
    test('微信', () => expect(wechatIcon.paths.map((p) => p.$1).join('\n'), svgPaths('wechat.svg')));
    test('M 雲標誌畫在 50×38 之內', () {
      final b = parseSvgPath(brandMark.paths[1].$1).getBounds();
      expect([b.left, b.top, b.right.roundToDouble(), b.bottom], [0, 0, 49, 38]);
    });
    test('WhatsApp 的弧線旗標沒有空格也讀得到', () {
      final b = parseSvgPath(whatsappIcon.paths[0].$1).getBounds();
      expect([b.left.round(), b.top.round(), b.right.round(), b.bottom.round()], [0, 0, 24, 24]);
    });
    test('不支援的指令會報錯', () => expect(() => parseSvgPath('M0 0 X1 1'), throwsFormatException));
  });

  group('送出前的檢查', () {
    String? check({bool phoneMode = true, int area = 0, String phone = '', String email = '', String password = ''}) =>
        checkLogin(phoneMode: phoneMode, area: areaCodes[area], phone: phone, email: email, password: password);
    test('手機：都沒填', () => expect(check(), '請填寫手機號碼和密碼'));
    test('手機：沒填密碼', () => expect(check(phone: '12345678'), '請填寫手機號碼和密碼'));
    test('手機：沒填號碼', () => expect(check(password: 'p'), '請填寫手機號碼和密碼'));
    test('手機：號碼沒有數字當作沒填', () => expect(check(phone: '--', password: 'p'), '請填寫手機號碼和密碼'));
    test('電郵：都沒填', () => expect(check(phoneMode: false), '請填寫電郵和密碼'));
    test('電郵：沒填密碼', () => expect(check(phoneMode: false, email: 'a@b.c'), '請填寫電郵和密碼'));
    test('香港 3 位', () => expect(check(phone: '123', password: 'p'), '香港手機號碼應為 8 位'));
    test('澳門 9 位', () => expect(check(area: 1, phone: '123456789', password: 'p'), '澳門手機號碼應為 8 位'));
    test('內地不是 1 字頭', () => expect(check(area: 2, phone: '23812345678', password: 'p'), '內地手機號碼應為 11 位'));
    test('內地 10 位', () => expect(check(area: 2, phone: '1381234567', password: 'p'), '內地手機號碼應為 11 位'));
    test('香港 8 位通過', () => expect(check(phone: '12345678', password: 'p'), isNull));
    test('號碼中間有空格和短橫也通過', () => expect(check(phone: '1234 56-78', password: 'p'), isNull));
    test('內地 11 位通過', () => expect(check(area: 2, phone: '13812345678', password: 'p'), isNull));
    test('電郵不檢查格式', () => expect(check(phoneMode: false, email: 'abc', password: 'p'), isNull));
  });

  group('區號', () {
    test('沒記下：香港', () => expect(areaIndexOf(null), 0));
    test('記下澳門', () => expect(areaIndexOf('+853'), 1));
    test('記下內地', () => expect(areaIndexOf('+86'), 2));
    test('不認識的區號：香港', () => expect(areaIndexOf('+1'), 0));
    test('三個選項的文字', () => expect([for (final a in areaCodes) '${a.label}|${a.hint}|${a.digits}'], ['香港 +852|8 位手機號碼|8', '澳門 +853|8 位手機號碼|8', '內地 +86|11 位手機號碼|11']));
  });

  group('搖動', () {
    test('開始和結束在原位', () => expect([shakeOffset(0), shakeOffset(1)], [0, 0]));
    test('20% 在 -7', () => expect(shakeOffset(.2), closeTo(-7, 1e-9)));
    test('40% 在 6', () => expect(shakeOffset(.4), closeTo(6, 1e-9)));
    test('60% 在 -4', () => expect(shakeOffset(.6), closeTo(-4, 1e-9)));
    test('80% 在 2', () => expect(shakeOffset(.8), closeTo(2, 1e-9)));
    test('每段用 ease 曲線（10% 不是一半）', () => expect(shakeOffset(.1), closeTo(-7 * Motion.ease.transform(.5), 1e-9)));
  });

  group('口岸畫布', () {
    test('可用範圍：車牌下 40、登入卡上 22', () {
      final m = PortsModel(440, 527, top: 295, bottom: 479);
      expect([m.bandTop, m.bandBottom], [335, 457]);
    });
    test('量不到時按手機版預留', () {
      final m = PortsModel(440, 527);
      expect([m.bandTop.toStringAsFixed(2), m.bandBottom], [(527 * .44 + 40).toStringAsFixed(2), 527 - 48 - 22]);
    });
    test('範圍太窄時至少留 80', () {
      final m = PortsModel(440, 527, top: 440, bottom: 479);
      expect(m.bandBottom - m.bandTop, 80);
    });
    test('脈衝不會走到節點光暈上', () {
      final m = PortsModel(440, 527, top: 295, bottom: 479);
      for (var i = 0; i < 2000; i++) {
        m.step();
        final pos = m.positions();
        for (final (j, p) in m.pulsePositions(pos).indexed) {
          final link = links[pulseLinks[j]];
          expect(((p - pos[link.$1]).distance >= pulseGap - .5) && ((p - pos[link.$2]).distance >= pulseGap - .5), isTrue);
        }
      }
    });
    test('擴散 40 幀內完成', () {
      final m = PortsModel(440, 527)..step();
      m.burst();
      for (var i = 0; i < 39; i++) {
        m.step();
      }
      final before = m.burstProgress();
      m.step();
      expect([before! < 1, m.burstProgress()], [true, null]);
    });
    test('減少動態效果：節點不動', () {
      final m = PortsModel(440, 527, reduced: true)..step();
      final a = m.positions();
      for (var i = 0; i < 50; i++) {
        m.step();
      }
      expect(m.positions(), a);
    });
  });

  group('聯絡方式說明', () {
    test('只有 WhatsApp，有標題', () => expect(contactIntro(whatsapp, title: '忘記密碼？'), '可以用 WhatsApp 找我們。'));
    test('只有 WhatsApp，沒標題寫「也」', () => expect(contactIntro(whatsapp), '也可以用 WhatsApp 找我們。'));
    test('只有微信號', () => expect(contactIntro({'wechatId': 'abc'}, title: 'x'), '可以用微信找我們。'));
    test('WhatsApp 和微信', () => expect(contactIntro({'whatsappLink': 'l', 'wecomLink': 'w'}, title: 'x'), '可以用 WhatsApp、微信找我們。'));
    test('app 內訊息，有 WhatsApp', () => expect(contactIntro(whatsapp, messages: true), '有問題可以在 app 內發訊息，或用 WhatsApp 找我們。'));
    test('app 內訊息，沒有渠道', () => expect(contactIntro(noChannel, messages: true), '有問題可以在 app 內發訊息給我們。'));
    test('沒有渠道不顯示卡', () => expect(hasChannel(noChannel), false));
    test('只有二維碼也顯示', () => expect(hasChannel({'wechatQr': 'data:x'}), true));
  });

  group('啟動頁', () {
    test('未登入：登入頁', () {
      Session.debugSet();
      expect(startLocation(), '/login');
    });
    test('已登入：首頁分頁', () {
      Session.debugSet(token: 't', user: {'id': 'u1'});
      expect(startLocation(), '/index');
    });
    test('只有 token：登入頁', () {
      Session.debugSet(token: 't');
      expect(startLocation(), '/login');
    });
  });

  group('登入頁畫面', () {
    testWidgets('空白狀態的文字逐字照舊', (tester) async {
      await openLogin(tester);
      for (final t in ['車牌管家', '兩地牌、公司與到期事項', '一處管好。', '登入客戶帳戶', '查看你的牌照、公司和辦理進度', '電郵', '香港 +852', '密碼', '登入', '沒有帳戶？申請使用', '托管客戶的帳戶由顧問開通。忘記密碼請聯絡我們。', '服務條款', '·', '私隱聲明']) {
        expect(find.text(t), findsWidgets, reason: t);
      }
      expect(find.text('手機號碼'), findsNWidgets(2)); // 分段和欄位標題
      expect([find.text('8 位手機號碼'), find.text('輸入密碼')].map((f) => f.evaluate().length), [1, 1]);
    });

    testWidgets('「忘記密碼？」卡列出 WhatsApp', (tester) async {
      await openLogin(tester);
      expect([find.text('忘記密碼？'), find.text('可以用 WhatsApp 找我們。'), find.text('WhatsApp +853 6671 4829')].map((f) => f.evaluate().length), [1, 1, 1]);
    });

    testWidgets('沒有設定聯絡渠道時不顯示「忘記密碼？」卡', (tester) async {
      serve(contact: noChannel);
      await openLogin(tester);
      expect(find.text('忘記密碼？'), findsNothing);
    });

    testWidgets('聯絡方式取不到時不顯示、不提示', (tester) async {
      Api.client = MockClient((r) async => throw http.ClientException('offline'));
      await openLogin(tester);
      expect([find.text('忘記密碼？').evaluate().length, find.text('連不上伺服器，請檢查網絡後再試').evaluate().length], [0, 0]);
    });

    // 計劃第七節管理者決定（2026-11-22）：按 WhatsApp 直接打開；打不開才複製連結
    testWidgets('按 WhatsApp 直接打開連結，不複製', (tester) async {
      final opened = <Uri>[];
      debugLaunchUrl = (uri) async {
        opened.add(uri);
        return true;
      };
      addTearDown(() => debugLaunchUrl = null);
      await openLogin(tester);
      await tester.ensureVisible(find.text('WhatsApp +853 6671 4829'));
      await tester.tap(find.text('WhatsApp +853 6671 4829'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect([opened.map((u) => '$u').toList(), find.text('連結已複製，請在瀏覽器打開').evaluate().length], [['https://wa.me/85366714829'], 0]);
    });

    testWidgets('打不開 WhatsApp 時複製連結並提示', (tester) async {
      debugLaunchUrl = (_) async => false;
      addTearDown(() => debugLaunchUrl = null);
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') copied = (call.arguments as Map)['text'] as String;
        return null;
      });
      await openLogin(tester);
      await tester.ensureVisible(find.text('WhatsApp +853 6671 4829'));
      await tester.tap(find.text('WhatsApp +853 6671 4829'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect([copied, find.text('連結已複製，請在瀏覽器打開').evaluate().length], ['https://wa.me/85366714829', 1]);
      await tester.pump(const Duration(seconds: 2));
    });

    testWidgets('記下的區號：澳門', (tester) async {
      await openLogin(tester, prefs: {'loginArea': '+853'});
      expect(find.text('澳門 +853'), findsOneWidget);
    });

    testWidgets('切到電郵', (tester) async {
      await openLogin(tester);
      await tester.tap(find.text('電郵').first);
      await tester.pump();
      expect([find.text('name@example.com').evaluate().length, find.text('香港 +852').evaluate().length], [1, 0]);
    });

    testWidgets('香港號碼最多 8 位', (tester) async {
      await openLogin(tester);
      await type(tester, 'login-phone', '123456789012');
      expect(tester.widget<EditableText>(inputOf('login-phone')).controller.text, '12345678');
    });

    testWidgets('往下滑時狀態列蓋深綠', (tester) async {
      await openLogin(tester);
      ColoredBox? cover() => tester.widgetList<ColoredBox>(find.byType(ColoredBox)).where((b) => b.color == C.jadeDeep).length > 1 ? tester.widgetList<ColoredBox>(find.byType(ColoredBox)).last : null;
      final before = cover();
      await tester.drag(find.byType(SingleChildScrollView), const Offset(0, -200));
      await tester.pump();
      expect([before, cover()?.color], [null, C.jadeDeep]);
    });
  });

  group('區號選擇器', () {
    testWidgets('選內地後改提示，並記下區號', (tester) async {
      await openLogin(tester);
      await tester.tap(find.byKey(const ValueKey('login-area')));
      await tester.pump();
      await tester.pump(LoginStyle.pickerDuration);
      expect([find.text('內地 +86').evaluate().length, find.text('完成').evaluate().length + find.text('Done').evaluate().length], [1, 1]);
      await tester.drag(find.text('內地 +86'), const Offset(0, -80));
      await tester.pump(const Duration(seconds: 1));
      await tester.tap(find.byKey(const ValueKey('picker-done')));
      await tester.pump();
      await tester.pump(LoginStyle.pickerDuration);
      await tester.pump(const Duration(milliseconds: 1));
      await Session.flush();
      expect([find.text('內地 +86').evaluate().length, find.text('11 位手機號碼').evaluate().length, Session.loginArea], [1, 1, '+86']);
    });

    testWidgets('選項是一般字重（不繼承除錯用的粗體）', (tester) async {
      await openLogin(tester);
      await tester.tap(find.byKey(const ValueKey('login-area')));
      await tester.pump();
      await tester.pump(LoginStyle.pickerDuration);
      final style = tester.widget<Text>(find.text('內地 +86')).style!;
      expect(style.fontWeight, FontWeight.w400);
    });

    testWidgets('上下遮罩撐滿滾輪寬度', (tester) async {
      await openLogin(tester);
      await tester.tap(find.byKey(const ValueKey('login-area')));
      await tester.pump();
      await tester.pump(LoginStyle.pickerDuration);
      final masks = find.byWidgetPredicate((w) => w is DecoratedBox && (w.decoration as BoxDecoration?)?.gradient != null);
      expect(masks.evaluate().map((e) => tester.getSize(find.byWidget(e.widget)).width), [440.0, 440.0]);
    });

    testWidgets('取消不改', (tester) async {
      await openLogin(tester);
      await tester.tap(find.byKey(const ValueKey('login-area')));
      await tester.pump();
      await tester.pump(LoginStyle.pickerDuration);
      await tester.tap(find.byKey(const ValueKey('picker-cancel')));
      await tester.pump();
      await tester.pump(LoginStyle.pickerDuration);
      await tester.pump(const Duration(milliseconds: 1));
      expect([find.text('香港 +852').evaluate().length, find.text('內地 +86').evaluate().length, Session.loginArea], [1, 0, null]);
    });

    testWidgets('點遮罩關閉', (tester) async {
      await openLogin(tester);
      await tester.tap(find.byKey(const ValueKey('login-area')));
      await tester.pump();
      await tester.pump(LoginStyle.pickerDuration);
      await tester.tapAt(const Offset(220, 100));
      await tester.pump();
      await tester.pump(LoginStyle.pickerDuration);
      await tester.pump(const Duration(milliseconds: 1));
      expect(find.byKey(const ValueKey('picker-done')), findsNothing);
    });
  });

  group('送出', () {
    testWidgets('都沒填：提示並標紅，不送出', (tester) async {
      await openLogin(tester);
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 20));
      expect([find.text('請填寫手機號碼和密碼').evaluate().length, borderOf(tester, 'login-phone'), borderOf(tester, 'login-password'), sent.where((r) => r.url.path == '/api/login').length], [1, C.overdue, C.overdue, 0]);
      await tester.pump(LoginStyle.shake);
    });

    testWidgets('號碼不夠位：提示，不送出', (tester) async {
      await openLogin(tester);
      await type(tester, 'login-phone', '123');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      expect([find.text('香港手機號碼應為 8 位').evaluate().length, borderOf(tester, 'login-phone'), sent.where((r) => r.url.path == '/api/login').length], [1, C.rule, 0]);
      await tester.pump(LoginStyle.shake);
    });

    testWidgets('錯誤時登入卡搖動', (tester) async {
      await openLogin(tester);
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 10));
      await tester.pump(const Duration(milliseconds: 76)); // 約 20%
      final dx = tester.widget<Transform>(find.ancestor(of: find.byKey(const ValueKey('login-sheet')), matching: find.byType(Transform)).first).transform.getTranslation().x;
      expect(dx, lessThan(-5));
      await tester.pump(LoginStyle.shake);
    });

    testWidgets('送出中顯示「登入中」，不能再按', (tester) async {
      serve(delay: const Duration(seconds: 1));
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('登入中'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('login-button')));
      await tester.pump(const Duration(seconds: 1));
      expect(sent.where((r) => r.url.path == '/api/login').length, 1);
      await tester.pump(const Duration(seconds: 1));
    });

    // 計劃第七節管理者決定（2026-11-22）：8 位上限只算數字
    testWidgets('號碼中的空格、短橫不算在 8 位之內', (tester) async {
      await openLogin(tester);
      await type(tester, 'login-phone', ' 1234 5678 ');
      expect(tester.widget<EditableText>(inputOf('login-phone')).controller.text, ' 1234 5678 ');
    });

    testWidgets('有空格時超過 8 個數字，剪到第 8 個數字', (tester) async {
      await openLogin(tester);
      await type(tester, 'login-phone', '1234 56789');
      expect(tester.widget<EditableText>(inputOf('login-phone')).controller.text, '1234 5678');
    });

    testWidgets('內地號碼上限 11 個數字', (tester) async {
      await openLogin(tester, prefs: {'loginArea': '+86'});
      await type(tester, 'login-phone', '138 1234 567890');
      expect(tester.widget<EditableText>(inputOf('login-phone')).controller.text, '138 1234 5678');
    });

    testWidgets('登入中在密碼欄按「完成」不會再送一次', (tester) async {
      serve(delay: const Duration(seconds: 1));
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 100));
      await tester.showKeyboard(inputOf('login-password'));
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump(const Duration(seconds: 1));
      expect(sent.where((r) => r.url.path == '/api/login').length, 1);
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('伺服器沒有回傳 user：顯示「找不到這個帳號」，不顯示程式錯誤', (tester) async {
      serve(login: {'token': 't'});
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 100));
      expect([find.text(loginNoUser).evaluate().length, find.textContaining('undefined').evaluate().length], [1, 0]);
      await tester.pump(LoginStyle.shake);
    });

    testWidgets('電郵欄不自動大寫、用電郵鍵盤', (tester) async {
      await openLogin(tester);
      await tester.tap(find.text('電郵').first);
      await tester.pump();
      final f = tester.widget<EditableText>(inputOf('login-email'));
      expect([f.textCapitalization, f.keyboardType, f.autocorrect], [TextCapitalization.none, TextInputType.emailAddress, false]);
    });

    testWidgets('手機登入送「區號＋號碼」，密碼不去空白', (tester) async {
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678 ');
      await type(tester, 'login-password', ' pw ');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 50));
      expect(jsonDecode(sent.lastWhere((r) => r.url.path == '/api/login').body), {'login': '+85212345678', 'password': ' pw '});
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('電郵登入送去掉空白的電郵', (tester) async {
      await openLogin(tester);
      await tester.tap(find.text('電郵').first);
      await tester.pump();
      await type(tester, 'login-email', ' a@b.com ');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 50));
      expect(jsonDecode(sent.lastWhere((r) => r.url.path == '/api/login').body), {'login': 'a@b.com', 'password': 'pw'});
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('密碼欄按鍵盤「完成」也會登入', (tester) async {
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tester.showKeyboard(inputOf('login-password'));
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump(const Duration(milliseconds: 50));
      expect(sent.where((r) => r.url.path == '/api/login').length, 1);
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('成功：存登入狀態、蓋「已登入」印章，700ms 後到首頁分頁', (tester) async {
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 50));
      expect([getToken(), find.text('已登入').evaluate().length, find.byType(TabsShell).evaluate().length], ['new-token', 1, 0]);
      await tester.pump(const Duration(milliseconds: 660));
      await tester.pump(const Duration(milliseconds: 50));
      expect([find.byType(TabsShell).evaluate().length, find.byType(LoginPage).evaluate().length], [1, 0]);
    });

    testWidgets('不是客戶帳號：提示用管理端，不存登入狀態', (tester) async {
      serve(login: {'token': 'x', 'user': {'id': 'a', 'role': 'admin'}});
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 50));
      expect([find.text('此帳號請使用管理端登入').evaluate().length, getToken()], [1, null]);
      await tester.pump(LoginStyle.shake);
    });

    testWidgets('伺服器的錯誤照顯示', (tester) async {
      serve(login: {'error': '手機號碼或密碼不正確'}, loginStatus: 401);
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 50));
      expect([find.text('手機號碼或密碼不正確').evaluate().length, find.text('登入').evaluate().length], [1, 1]);
      await tester.pump(LoginStyle.shake);
    });

    testWidgets('連不上伺服器', (tester) async {
      serve(offline: true);
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.text('連不上伺服器，請檢查網絡後再試'), findsOneWidget);
      await tester.pump(LoginStyle.shake);
    });

    testWidgets('申請審批中：顯示狀態和聯絡方式，下面的「忘記密碼？」卡收起', (tester) async {
      serve(login: {'error': '你的申請正在審批中', 'code': 'SIGNUP_PENDING'}, loginStatus: 403);
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 50));
      expect([find.text('你的申請正在審批中'), find.text('我們會先聯絡你核實手機號碼。'), find.text('其他聯絡方式'), find.text('也可以用 WhatsApp 找我們。'), find.text('忘記密碼？')].map((f) => f.evaluate().length), [1, 1, 1, 1, 0]);
    });

    testWidgets('申請未獲批准：沒有「核實手機號碼」一句', (tester) async {
      serve(login: {'error': '你的申請未獲批准', 'code': 'SIGNUP_REJECTED'}, loginStatus: 403);
      await openLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 50));
      expect([find.text('你的申請未獲批准'), find.text('我們會先聯絡你核實手機號碼。')].map((f) => f.evaluate().length), [1, 0]);
    });

    testWidgets('再按登入時先清掉上次的錯誤', (tester) async {
      await openLogin(tester);
      await tapLogin(tester);
      await type(tester, 'login-phone', '12345678');
      await type(tester, 'login-password', 'pw');
      await tapLogin(tester);
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.text('請填寫手機號碼和密碼'), findsNothing);
      await tester.pump(const Duration(seconds: 1));
    });
  });

  group('連結', () {
    testWidgets('服務條款', (tester) async {
      await openLogin(tester);
      await tester.ensureVisible(find.text('服務條款'));
      await tester.tap(find.text('服務條款'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('服務條款及私隱聲明'), findsOneWidget);
    });

    testWidgets('申請使用', (tester) async {
      await openLogin(tester);
      await tester.ensureVisible(find.text('沒有帳戶？申請使用'));
      await tester.tap(find.text('沒有帳戶？申請使用'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('申請使用'), findsOneWidget);
    });
  });

  testWidgets('登入失效（401）：清登入狀態並打開登入頁', (tester) async {
    tester.view.physicalSize = const Size(1320, 2868);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    Session.debugSet(token: 'old', user: {'id': 'u1'});
    await tester.pumpWidget(const DualplateApp(initialLocation: '/index', demoTabs: true));
    await tester.pump();
    try {
      await api('/my/overview');
    } catch (_) {}
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect([getToken(), find.byType(LoginPage).evaluate().length], [null, 1]);
  });

  testWidgets('從首頁打開的登入頁，登入後回到首頁分頁', (tester) async {
    tester.view.physicalSize = const Size(1320, 2868);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    Session.debugSet(token: 'old', user: {'id': 'u1'});
    await tester.pumpWidget(const DualplateApp(initialLocation: '/index', demoTabs: true));
    await tester.pump();
    AppNav.push('/login');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await type(tester, 'login-phone', '12345678');
    await type(tester, 'login-password', 'pw');
    await tapLogin(tester);
    await tester.pump(const Duration(milliseconds: 800));
    await tester.pump(const Duration(milliseconds: 400));
    expect([find.byType(LoginPage).evaluate().length, find.byType(TabsShell).evaluate().length], [0, 1]);
  });
}
