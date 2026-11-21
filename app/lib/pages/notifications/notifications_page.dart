// 通知（mobile/src/pages/notifications/notifications.vue）：階段 3a 一比一移植，現在是佔位頁（負責人 3-0 放）。
// 路由已在 shell/router.dart 接好：網址 /notifications，查詢參數原樣放在 query（例如 ?id=…）。3a 只替換本檔，不改路由。
import 'package:flutter/widgets.dart';
import '../../shell/nav_bar.dart';

class NotificationsPage extends StatelessWidget {
  const NotificationsPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  Widget build(BuildContext context) => const AppPage(title: '通知');
}
