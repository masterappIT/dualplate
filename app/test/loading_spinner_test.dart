// 載入框轉圈（ui/loading.dart）：位置固定、最深的一條每格順時針前進一條。
// 階段 5b：原本位置和深淺一起轉，每格圖案相同，真機上轉圈不動。
import 'package:dualplate/ui/loading.dart';
import 'package:flutter_test/flutter_test.dart';

List<double> frame(int step) => [for (var i = 0; i < 12; i++) spinnerAlpha(i, step)];

void main() {
  test('相鄰兩格畫出來的深淺不同（轉圈看得出在動）', () {
    for (var step = 0; step < 12; step++) {
      expect(frame(step), isNot(equals(frame(step + 1))), reason: 'step $step');
    }
  });

  test('每格最深的一條是第 step 條', () {
    for (var step = 0; step < 12; step++) {
      expect(spinnerAlpha(step, step), 1.0);
    }
  });

  test('最深的一條後面（逆時針）一條次深，前面（順時針）一條最淡', () {
    expect(spinnerAlpha(4, 5), closeTo(11 / 12, 1e-9));
    expect(spinnerAlpha(6, 5), .25);
  });

  test('十二格轉完一圈回到原樣', () {
    expect(frame(12), equals(frame(0)));
  });

  test('第 i 條的位置不隨格數改變，第 0 條在 12 點鐘', () {
    expect(spinnerAngle(0), closeTo(-1.5707963, 1e-6));
    expect(spinnerAngle(3), closeTo(0, 1e-9));
  });
}
