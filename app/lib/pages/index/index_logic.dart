// 首頁的計算：照抄 mobile/src/pages/index/index.vue 的 todoList、clientAction、actionNotices（一個情況一個測試，見 test/index_test.dart）。
import '../../core/js.dart';
import '../plate_detail/plate_detail_logic.dart' show J, at, listOf;

// 首頁資料的初始值（App 版載入頁先取好的資料見 core/launch.dart）
J emptyOverview() => {
      'unreadNotifications': 0,
      'advisor': null,
      'customerName': '',
      'counts': {'pending': 0, 'ok': 0, 'due': 0, 'overdue': 0},
      'plates': [],
      'deadlines': [],
      'todos': [],
      'activeRequests': [],
    };

// 通知只有兩類要客戶動手：文件需重交、自辦更新被顧問退回；辦理進度、到期、改回等只是告知，留在鈴鐺
const actionNotices = {'attachment', 'self_handled_returned'};

// 你自理（或要你過關）而快到期／已逾期的事項
bool clientAction(Object? item) => ['due', 'overdue'].contains(at(item, 'level')) && (at(item, 'handledBy') == 'you' || at(item, 'code') == 'crossing_90');

class TodoItem {
  const TodoItem({required this.key, required this.title, required this.subtitle, this.requestId, this.deadline, this.notice, this.urgent = false});
  final String key, title, subtitle;
  final Object? requestId;
  final Map? deadline, notice;
  final bool urgent;
}

String _s(Object? v) => v == null ? '' : jsString(v);

// 待辦只放要客戶動手的：要你提供的資料、你自理而快到期／已逾期的事項、要你處理的未讀通知
List<TodoItem> todoList(J data, List<dynamic> notices) => [
      for (final (i, t) in listOf(data['todos']).indexed)
        TodoItem(key: 't$i', title: _s(at(t, 'title')), subtitle: _s(at(t, 'subtitle')), requestId: at(t, 'requestId'), urgent: true),
      for (final d in listOf(data['deadlines']).where(clientAction))
        TodoItem(
          key: 'd${_s(at(d, 'code'))}${_s(at(d, 'ownerId'))}${truthy(at(d, 'period')) ? jsString(at(d, 'period')) : ''}',
          title: _s(at(d, 'name')),
          subtitle: [
            at(d, 'ownerLabel'),
            at(d, 'code') == 'crossing_90' ? '過關後按「今天已過關」' : truthy(at(d, 'markable')) ? '辦好後按「已辦好」' : '請你自行辦理',
          ].where(truthy).map(jsString).join(' · '),
          deadline: d as Map,
          urgent: at(d, 'level') == 'overdue',
        ),
      for (final n in notices.where((n) => !truthy(at(n, 'read')) && actionNotices.contains(at(n, 'kind'))))
        TodoItem(key: 'n${_s(at(n, 'id'))}', title: _s(at(n, 'title')), subtitle: _s(at(n, 'body')), notice: n as Map, urgent: true),
    ];

// 鈴鐺上的數字：超過 99 寫「99+」
String bellCount(Object? unread) => jsNumber(unread) > 99 ? '99+' : jsString(unread);

// Vue 的 {{ }}：null／undefined 顯示空白，其他照 String()
String shown(Object? v) => v == null ? '' : jsString(v);
