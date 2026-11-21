// 出租（mobile/src/pages/rental/rental.vue）：階段 3c 一比一移植，現在是佔位頁（負責人 3-0 放）。
// 路由已在 shell/router.dart 接好：網址 /rental，查詢參數原樣放在 query（例如 ?id=…）。3c 只替換本檔，不改路由。
import 'package:flutter/widgets.dart';
import '../../shell/nav_bar.dart';

class RentalPage extends StatelessWidget {
  const RentalPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  Widget build(BuildContext context) => const AppPage(title: '出租');
}
