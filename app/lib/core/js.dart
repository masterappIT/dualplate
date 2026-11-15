// JavaScript 的真假和轉字串規則：照搬 api.js 時，伺服器傳來的值可能是 null、空字串、0、數字或其他類型，
// 判斷要和 JS 的 `||`、`!x`、`String(x)` 一樣，畫面才會一致。
bool truthy(Object? value) => switch (value) {
      null => false,
      bool b => b,
      num n => n != 0 && !n.isNaN,
      String s => s.isNotEmpty,
      _ => true,
    };

// String(x)：null → 'null'；整數值的小數（1.0）寫成 '1'；NaN、Infinity 照 JS 寫法
String jsString(Object? value) => switch (value) {
      null => 'null',
      double d when d.isNaN => 'NaN',
      double d when d.isInfinite => d > 0 ? 'Infinity' : '-Infinity',
      double d when d == d.truncateToDouble() && d.abs() < 1e21 => d.toInt().toString(),
      List l => l.map((e) => e == null ? '' : jsString(e)).join(','),
      Map _ => '[object Object]',
      _ => value.toString(),
    };

// Number(x)：null、空白 → 0；true/false → 1/0；不能轉的字串 → NaN
double jsNumber(Object? value) => switch (value) {
      null => 0,
      bool b => b ? 1 : 0,
      num n => n.toDouble(),
      String s when s.trim().isEmpty => 0,
      String s => double.tryParse(s.trim()) ?? double.nan,
      _ => double.nan,
    };
