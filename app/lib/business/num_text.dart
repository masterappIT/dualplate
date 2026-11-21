// .num：等寬數字、字距 .04em（App.vue）。各頁的數字、日期、號碼用它
import 'package:flutter/widgets.dart';

TextStyle numStyle(TextStyle s) => s.copyWith(fontFeatures: const [FontFeature.tabularFigures()], letterSpacing: (s.fontSize ?? 14) * .04);
