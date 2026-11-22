// 階段 3e 收尾用的遙控巡覽（照 3d 的 pages_3d_tour_test.dart；接上修改公司資料表單，回應檔每次附上目前網址，方便核對從真正入口走到哪一頁）（不是測試）：在模擬器上打開 App，逐行讀指令檔照做，做完寫回應檔，外面的指令再截圖。
// 只連本機自己開的 API（--dart-define=API_BASE=http://localhost:…）；密碼只經 --dart-define 傳入：
//   cd app && flutter test integration_test/pages_3e_tour_test.dart -d <udid> \
//     --dart-define=API_BASE=http://localhost:4130 --dart-define=DP_PASS=… --dart-define=DP_DIR=/private/tmp/dp3/3e-ftour
// 指令檔 <DP_DIR>/cmd（每行一個；寫完改名為 cmd，免得讀到一半）：
//   login 電郵 ／ open /網址（重開 App 停在這頁）／ push /網址（在目前頁面上打開，和從入口進去一樣有返回箭頭）／ tapAt x y ／ tap 文字 ／ tapLast 文字 ／ tapHas 文字（包含） ／ tapKey key ／ logout（清登入狀態） ／ wait 毫秒 ／ see 文字（捲到畫面頂） ／
//   scroll 點數（向下捲，負數向上） ／ top（捲回頂） ／ type 第幾個輸入框 文字 ／ back ／ quit
// 做完寫 <DP_DIR>/done（MISSING 開頭的行是找不到的元素）。模擬器的 App 可以直接讀寫 Mac 的 /private/tmp。
import 'dart:io';

import 'package:dualplate/core/api.dart';
import 'package:dualplate/core/session.dart';
import 'package:dualplate/main.dart';
import 'package:dualplate/business/company_editor.dart';
import 'package:dualplate/pages/companies/companies_page.dart';
import 'package:dualplate/shell/nav_bar.dart';
import 'package:flutter/material.dart' show TextField;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';

const password = String.fromEnvironment('DP_PASS');
const dir = String.fromEnvironment(
  'DP_DIR',
  defaultValue: '/private/tmp/dp3/3e-ftour',
);
const localApi = String.fromEnvironment('API_BASE');

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('3e 遙控巡覽', timeout: const Timeout(Duration(hours: 6)), (
    tester,
  ) async {
    if (!localApi.startsWith('http://localhost')) {
      fail('只可連本機 API（--dart-define=API_BASE=http://localhost:…）');
    }
    Future<void> wait(int ms) => tester.pump(Duration(milliseconds: ms));
    // 和 main() 一樣接上修改公司資料表單
    CompaniesPage.editor = CompanyEditor.builder;
    final cmd = File('$dir/cmd'), done = File('$dir/done');
    Directory(dir).createSync(recursive: true);
    done.writeAsStringSync('ready\n');

    ScrollableState? scrollable() {
      final all = find
          .byType(Scrollable)
          .evaluate()
          .map((e) => (e as StatefulElement).state as ScrollableState)
          .where((s) => s.position.axis == Axis.vertical)
          .toList();
      return all.isEmpty ? null : all.last;
    }

    Future<bool> tap(Finder f, List<String> log) async {
      if (f.evaluate().isEmpty) {
        log.add('MISSING $f');
        return false;
      }
      final y = tester.getCenter(f).dy;
      if (y < 100 || y > 900) {
        await tester.ensureVisible(f);
        await wait(200);
      }
      await tester.tap(f, warnIfMissed: false);
      return true;
    }

    var n = 0;
    while (true) {
      if (!cmd.existsSync()) {
        await wait(100);
        continue;
      }
      final lines = cmd.readAsLinesSync();
      cmd.deleteSync();
      final log = <String>[];
      for (final line in lines) {
        final sp = line.indexOf(' ');
        final op = sp < 0 ? line : line.substring(0, sp),
            arg = sp < 0 ? '' : line.substring(sp + 1);
        // 一個指令出錯（例如找不到元素）只記下來，巡覽繼續
        try {
          switch (op) {
            case 'login':
              await Session.load();
              clearSession();
              await Session.flush();
              final r = await api('/login', 'POST', {
                'email': arg,
                'password': password,
              });
              saveSession(Map<String, dynamic>.from(r as Map));
              await Session.flush();
            case 'open':
              await tester.pumpWidget(
                DualplateApp(key: ValueKey('app${n++}'), initialLocation: arg),
              );
              await wait(300);
            case 'push':
              GoRouter.of(tester.element(find.byType(NavBar).last)).push(arg);
              await wait(600);
            case 'tapAt':
              final xy = arg.split(' ').map(double.parse).toList();
              await tester.tapAt(Offset(xy[0], xy[1]));
            case 'tap':
              await tap(find.text(arg).first, log);
            case 'tapLast':
              await tap(find.text(arg).last, log);
            case 'tapHas':
              await tap(find.textContaining(arg).first, log);
            case 'tapKey':
              await tap(find.byKey(ValueKey(arg)).first, log);
            case 'logout':
              await Session.load();
              clearSession();
              await Session.flush();
            case 'wait':
              await wait(int.parse(arg));
            case 'see':
              final f = find.textContaining(arg).first;
              if (f.evaluate().isEmpty) {
                log.add('MISSING $arg');
              } else {
                await Scrollable.ensureVisible(tester.element(f));
                await wait(300);
              }
            case 'scroll':
              final s = scrollable();
              if (s != null) {
                s.position.jumpTo(
                  (s.position.pixels + double.parse(arg)).clamp(
                    0,
                    s.position.maxScrollExtent,
                  ),
                );
              }
              await wait(300);
            case 'top':
              scrollable()?.position.jumpTo(0);
              await wait(300);
            case 'type':
              final sp2 = arg.indexOf(' ');
              final i = int.parse(arg.substring(0, sp2));
              await tester.enterText(
                find.byType(TextField).at(i),
                arg.substring(sp2 + 1),
              );
              await wait(200);
            case 'back':
              await tap(find.byKey(const ValueKey('nav-back')).last, log);
            case 'quit':
              done.writeAsStringSync('bye\n');
              return;
            default:
              log.add('UNKNOWN $op');
          }
        } catch (e) {
          log.add('ERROR $line: $e');
        }
      }
      await wait(150);
      done.writeAsStringSync(
        '${log.join('\n')}\nat ${AppNav.currentPath()}\nok ${DateTime.now().millisecondsSinceEpoch}\n',
      );
    }
  });
}
