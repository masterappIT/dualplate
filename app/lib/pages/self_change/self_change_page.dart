// 自行辦理更新（mobile/src/pages/self-change/self-change.vue）：階段 3b 一比一移植，現在是佔位頁（負責人 3-0 放）。
// 路由已在 shell/router.dart 接好：網址 /self-change，查詢參數原樣放在 query（例如 ?id=…）。3b 只替換本檔，不改路由。
import 'package:flutter/widgets.dart';
import '../../shell/nav_bar.dart';

class SelfChangePage extends StatelessWidget {
  const SelfChangePage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  Widget build(BuildContext context) => const AppPage(title: '自行辦理更新');
}
