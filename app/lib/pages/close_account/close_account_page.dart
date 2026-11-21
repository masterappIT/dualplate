// 註銷帳號（mobile/src/pages/close-account/close-account.vue）：階段 3d 一比一移植，現在是佔位頁（負責人 3-0 放）。
// 路由已在 shell/router.dart 接好：網址 /close-account，查詢參數原樣放在 query（例如 ?id=…）。3d 只替換本檔，不改路由。
import 'package:flutter/widgets.dart';
import '../../shell/nav_bar.dart';

class CloseAccountPage extends StatelessWidget {
  const CloseAccountPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  Widget build(BuildContext context) => const AppPage(title: '註銷帳號');
}
