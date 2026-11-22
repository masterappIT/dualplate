// iOS 啟動動畫的數值（lib/shell/launch_view.dart LaunchMotion）：逐項對照 mobile/src/pages/launch/launch.vue 的 @keyframes。
import 'package:dualplate/shell/launch_view.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('雙牌合位（yellow-move 1s）', () {
    test('開始時兩牌合着', () => expect(LaunchMotion.yellow(0), Offset.zero));
    test('12% 前不動', () => expect(LaunchMotion.yellow(120), Offset.zero));
    test('44% 分得最開：translate(64px,-48px)', () => expect(LaunchMotion.yellow(440), const Offset(64, -48)));
    test('彈回時越過原位（cubic-bezier(.34,1.56,.64,1)）', () {
      final overshoot = List.generate(56, (i) => LaunchMotion.yellow(440 + i * 10.0).dx).any((x) => x < 0);
      expect(overshoot, isTrue);
    });
    test('1 秒時合上', () => expect(LaunchMotion.yellow(1000), Offset.zero));
    test('之後一直合着', () => expect(LaunchMotion.yellow(5000), Offset.zero));
  });

  group('合上輕壓（settle .26s，.84s 開始）', () {
    test('開始前 1', () => expect(LaunchMotion.settle(840), 1));
    test('40% 時 .975', () => expect(LaunchMotion.settle(840 + 260 * .4), closeTo(.975, 1e-9)));
    test('結束 1', () => expect(LaunchMotion.settle(1100), 1));
  });

  group('螺絲一閃（glint .36s，.88s 開始）', () {
    test('開始前 1', () => expect(LaunchMotion.glint(880), 1));
    test('35% 時最亮 1.9', () => expect(LaunchMotion.glint(880 + 360 * .35), closeTo(1.9, 1e-9)));
    test('結束 1', () => expect(LaunchMotion.glint(1240), 1));
  });

  group('反光（sweep 1.6s，1.1s 開始，循環）', () {
    test('開始前看不見', () => expect(LaunchMotion.sweep(1000).opacity, 0));
    test('開始時在左邊、看得見', () {
      final s = LaunchMotion.sweep(1100);
      expect(s.x, 0);
      expect(s.opacity, 1);
    });
    test('44% 掃到 1500px', () => expect(LaunchMotion.sweep(1100 + 1600 * .44).x, closeTo(1500, 1e-6)));
    test('45% 後看不見', () => expect(LaunchMotion.sweep(1100 + 1600 * .6).opacity, 0));
    test('下一輪重新開始', () => expect(LaunchMotion.sweep(1100 + 1600).opacity, 1));
  });

  group('時長', () {
    test('至少停留 2 秒', () => expect(LaunchMotion.minShow, 2000));
    test('離開淡出 0.22 秒', () => expect(LaunchMotion.fade, 220));
  });
}
