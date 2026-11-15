// 連伺服器（lib/core/api.dart）：對應 api.js 的 api、publicApi、checkTerms；伺服器用 http 的 MockClient 代替，不連正式網站。
import 'dart:async';
import 'dart:convert';
import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

late List<http.Request> sent;
late List<String> pushed, relaunched;
String here = '/index';

void serve(FutureOr<http.Response> Function(http.Request r) handler) {
  Api.client = MockClient((r) async {
    sent.add(r);
    return handler(r);
  });
}

http.Response json(Object? body, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

Future<Object?> caught(Future<Object?> f) async {
  try {
    return await f;
  } catch (e) {
    return e;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
    await Session.load();
    sent = [];
    pushed = [];
    relaunched = [];
    here = '/index';
    AppNav.currentPath = () => here;
    AppNav.push = (p) { pushed.add(p); here = p; };
    AppNav.reLaunch = (p) { relaunched.add(p); here = p; };
    Api.timeout = const Duration(seconds: 60);
    debugResetApi();
    Session.debugSet(token: 'tok', user: {'id': 'u1'});
  });

  group('api 成功', () {
    test('回傳解析後的 JSON', () async {
      serve((_) => json({'ok': 1}));
      expect(await api('/my/overview'), {'ok': 1});
    });

    test('網址是 /api 加路徑', () async {
      serve((_) => json({}));
      await api('/my/overview');
      expect(sent.single.url.toString(), '$apiBase/api/my/overview');
    });

    test('有 token 時送 Bearer', () async {
      serve((_) => json({}));
      await api('/x');
      expect(sent.single.headers['authorization'], 'Bearer tok');
    });

    test('沒有 token 時 authorization 是空字串', () async {
      Session.debugSet();
      serve((_) => json({}));
      await api('/x');
      expect(sent.single.headers['authorization'], '');
    });

    test('送 content-type JSON', () async {
      serve((_) => json({}));
      await api('/x');
      expect(sent.single.headers['content-type'], startsWith('application/json'));
    });

    test('POST 送 JSON 內容', () async {
      serve((_) => json({}));
      await api('/login', 'POST', {'login': '+85212345678', 'password': 'p'});
      expect([sent.single.method, jsonDecode(sent.single.body)], ['POST', {'login': '+85212345678', 'password': 'p'}]);
    });

    test('GET 的 data 變成網址參數', () async {
      serve((_) => json({}));
      await api('/my/items', 'GET', {'q': 'A B', 'n': 2});
      expect(sent.single.url.query, 'q=A+B&n=2');
    });

    test('回覆不是 JSON：回傳原文', () async {
      serve((_) => http.Response('純文字', 200, headers: {'content-type': 'text/plain; charset=utf-8'}));
      expect(await api('/x'), '純文字');
    });

    test('201 也算成功', () async {
      serve((_) => json({'id': 1}, 201));
      expect(await api('/x', 'POST', {}), {'id': 1});
    });
  });

  group('api 失敗', () {
    test('用伺服器的 error 作訊息', () async {
      serve((_) => json({'error': '密碼不正確'}, 400));
      final e = await caught(api('/login', 'POST', {})) as ApiError;
      expect([e.message, e.status], ['密碼不正確', 400]);
    });

    test('沒有 error 時寫「操作失敗」', () async {
      serve((_) => json({}, 500));
      expect((await caught(api('/x')) as ApiError).message, '操作失敗');
    });

    test('error 是空字串時寫「操作失敗」', () async {
      serve((_) => json({'error': ''}, 400));
      expect((await caught(api('/x')) as ApiError).message, '操作失敗');
    });

    test('回覆不是 JSON 時寫「操作失敗」', () async {
      serve((_) => http.Response('Bad Gateway', 502));
      expect((await caught(api('/x')) as ApiError).message, '操作失敗');
    });

    test('帶回 data 和 code（登入頁用來判斷申請狀態）', () async {
      serve((_) => json({'error': '申請審批中', 'code': 'SIGNUP_PENDING'}, 403));
      final e = await caught(api('/login', 'POST', {})) as ApiError;
      expect([e.code, (e.data as Map)['error']], ['SIGNUP_PENDING', '申請審批中']);
    });

    test('連不上伺服器', () async {
      Api.client = MockClient((_) => throw http.ClientException('no network'));
      expect((await caught(api('/x')) as ApiError).message, '連不上伺服器，請檢查網絡後再試');
    });

    test('逾時當作連不上', () async {
      Api.timeout = const Duration(milliseconds: 10);
      serve((_) => Future.delayed(const Duration(milliseconds: 200), () => json({})));
      expect((await caught(api('/x')) as ApiError).message, '連不上伺服器，請檢查網絡後再試');
    });
  });

  group('401', () {
    test('清登入狀態並打開登入頁', () async {
      serve((_) => json({'error': '請重新登入'}, 401));
      final e = await caught(api('/my/overview')) as ApiError;
      expect([e.message, getToken(), getUser(), pushed], ['請重新登入', null, null, ['/login']]);
    });

    test('登入接口的 401 不清狀態、不跳轉', () async {
      serve((_) => json({'error': '帳號或密碼不正確'}, 401));
      await caught(api('/login', 'POST', {}));
      expect([getToken(), pushed], ['tok', <String>[]]);
    });

    test('微信接口的 401 不清狀態、不跳轉', () async {
      serve((_) => json({}, 401));
      await caught(api('/wechat/login', 'POST', {}));
      expect([getToken(), pushed], ['tok', <String>[]]);
    });

    test('同時幾個請求 401 只打開一次登入頁', () async {
      serve((_) => json({}, 401));
      await Future.wait([caught(api('/my/overview')), caught(api('/my/notifications'))]);
      expect(pushed, ['/login']);
    });

    test('已在登入頁時不再打開', () async {
      here = '/login';
      serve((_) => json({}, 401));
      await caught(api('/my/overview'));
      expect(pushed, isEmpty);
    });
  });

  group('403 TERMS_REQUIRED', () {
    test('轉到條款頁（不能返回）', () async {
      serve((_) => json({'error': '請先同意條款', 'code': 'TERMS_REQUIRED'}, 403));
      final e = await caught(api('/my/overview')) as ApiError;
      expect([e.message, relaunched], ['請先同意條款', ['/terms']]);
    });

    test('1.5 秒內只轉一次', () async {
      serve((_) => json({'code': 'TERMS_REQUIRED'}, 403));
      await caught(api('/a'));
      here = '/index';
      await caught(api('/b'));
      expect(relaunched, ['/terms']);
    });

    test('已在條款頁不再轉', () async {
      here = '/terms';
      serve((_) => json({'code': 'TERMS_REQUIRED'}, 403));
      await caught(api('/a'));
      expect(relaunched, isEmpty);
    });

    test('其他 403 不轉', () async {
      serve((_) => json({'code': 'FORBIDDEN'}, 403));
      await caught(api('/a'));
      expect(relaunched, isEmpty);
    });
  });

  group('publicApi', () {
    test('回傳內容', () async {
      serve((_) => json({'whatsapp': '+85366714829'}));
      expect(await publicApi('/public/contact'), {'whatsapp': '+85366714829'});
    });

    test('不送 authorization', () async {
      serve((_) => json({}));
      await publicApi('/public/contact');
      expect(sent.single.headers.containsKey('authorization'), false);
    });

    test('失敗時寫「載入失敗」', () async {
      serve((_) => json({}, 500));
      final e = await caught(publicApi('/public/contact')) as ApiError;
      expect([e.message, e.status], ['載入失敗', 500]);
    });

    test('失敗時用伺服器的 error', () async {
      serve((_) => json({'error': '找不到'}, 404));
      expect((await caught(publicApi('/public/x')) as ApiError).message, '找不到');
    });

    test('401 不清登入狀態', () async {
      serve((_) => json({}, 401));
      await caught(publicApi('/public/x'));
      expect([getToken(), pushed], ['tok', <String>[]]);
    });

    test('連不上伺服器', () async {
      Api.client = MockClient((_) => throw http.ClientException('no network'));
      expect((await caught(publicApi('/public/contact')) as ApiError).message, '連不上伺服器，請檢查網絡後再試');
    });
  });

  group('checkTerms', () {
    final asked = <String>[];
    TermsAsk answer(String reply) => ({required title, required msg, required ok, required cancel}) async {
          asked.add('$title|$msg|$ok|$cancel');
          return reply;
        };
    setUp(asked.clear);

    test('未登入不檢查', () async {
      Session.debugSet();
      serve((_) => json({}));
      expect([await checkTerms(answer('confirm')), sent.length], [null, 0]);
    });

    test('未發布條款：不提示', () async {
      serve((_) => json({'published': false}));
      expect([await checkTerms(answer('confirm')), asked], [null, <String>[]]);
    });

    test('已同意：不提示', () async {
      serve((_) => json({'published': true, 'accepted': true}));
      expect([await checkTerms(answer('confirm')), asked], [null, <String>[]]);
    });

    test('強制同意：直接轉條款頁', () async {
      serve((_) => json({'published': true, 'accepted': false, 'mode': 'force'}));
      expect([await checkTerms(answer('confirm')), relaunched, asked], ['opened', ['/terms'], <String>[]]);
    });

    test('從未同意：提示「請先閱讀服務條款」', () async {
      serve((_) => json({'published': true, 'accepted': false}));
      await checkTerms(answer('cancel'));
      expect(asked, ['請先閱讀服務條款|開始使用前，請查看並同意服務條款及私隱聲明。|查看|稍後']);
    });

    test('同意過舊版：提示「服務條款已更新」', () async {
      serve((_) => json({'published': true, 'accepted': false, 'everAccepted': true}));
      await checkTerms(answer('cancel'));
      expect(asked, ['服務條款已更新|請查看並同意最新的服務條款及私隱聲明。|查看|稍後']);
    });

    test('按「查看」：打開條款頁（可以返回）', () async {
      serve((_) => json({'published': true, 'accepted': false}));
      expect([await checkTerms(answer('confirm')), pushed], ['opened', ['/terms']]);
    });

    test('按「稍後」：不打開', () async {
      serve((_) => json({'published': true, 'accepted': false}));
      expect([await checkTerms(answer('cancel')), pushed], [null, <String>[]]);
    });

    test('沒有確認框：不打開', () async {
      serve((_) => json({'published': true, 'accepted': false}));
      expect([await checkTerms(null), pushed], [null, <String>[]]);
    });

    test('同時呼叫只檢查一次', () async {
      serve((_) => json({'published': true, 'accepted': true}));
      await Future.wait([checkTerms(null), checkTerms(null)]);
      expect(sent.length, 1);
    });

    test('每次打開 App 只檢查一次', () async {
      serve((_) => json({'published': true, 'accepted': false}));
      await checkTerms(answer('cancel'));
      await checkTerms(answer('cancel'));
      expect([sent.length, asked.length], [1, 1]);
    });

    test('檢查失敗：回傳 null，下次再試', () async {
      serve((_) => json({}, 500));
      expect(await checkTerms(null), isNull);
      await checkTerms(null);
      expect(sent.length, 2);
    });

    test('換帳戶登入後重新檢查', () async {
      serve((_) => json({'published': true, 'accepted': true}));
      await checkTerms(null);
      saveSession({'token': 't2', 'user': {'id': 'u2'}});
      await checkTerms(null);
      expect(sent.length, 2);
    });
  });
}
