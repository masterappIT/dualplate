// 返回鍵先關彈窗（mobile/src/lib/back-close.js）的登記：彈窗區（dialogs.dart DialogArea）和頁面浮層（page_show.dart BackClose）
// 在所在頁面的路由上各有一個「可以返回」開關。分頁和第一頁按返回鍵時（shell/back_quit.dart）用它分辨：
// 有彈窗或浮層開着 → 這一下是關彈窗（back-close.js 的 onBackPress 回傳 true），不算「再按一次退出」。
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

abstract final class BackGate {
  static final Map<ModalRoute<dynamic>, Set<ValueListenable<bool>>> _gates = {};

  static void add(ModalRoute<dynamic> route, ValueListenable<bool> canPop) => (_gates[route] ??= {}).add(canPop);

  static void remove(ModalRoute<dynamic> route, ValueListenable<bool> canPop) {
    final set = _gates[route];
    if (set == null) return;
    set.remove(canPop);
    if (set.isEmpty) _gates.remove(route);
  }

  // 這一頁有沒有開着的彈窗或浮層
  static bool blocked(ModalRoute<dynamic> route) => _gates[route]?.any((gate) => !gate.value) ?? false;
}
