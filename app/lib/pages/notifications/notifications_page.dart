// 通知：一比一移植 mobile/src/pages/notifications/notifications.vue（App 端）。
// 按日子分組（今天、昨天、其後按日期）；點一則標為已讀，有連結就打開；「全部已讀」。每次顯示（onShow）都重新載入。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/page_show.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf;
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, wrapBlk;

const noticeKindLabel = {
  'deadline': '到期提醒',
  'request': '辦理進度',
  'attachment': '文件核對',
  'change_accepted': '資料核對',
  'change_reverted': '資料核對',
  'self_handled_accepted': '自行辦理',
  'self_handled_returned': '自行辦理',
  'support_reply': '客服訊息',
  'scope_changed': '委託內容',
  'rental': '出租',
};

// 今天、昨天、其後寫日期（按現在減通知時間的整日數；new Date(value) 解析不了時 JS 得 NaN，寫原文前 10 個字）
String noticeDay(Object? value, [DateTime? now]) {
  final text = value == null ? 'null' : jsString(value);
  final date = DateTime.tryParse(text);
  if (date != null) {
    final days = ((now ?? DateTime.now()).millisecondsSinceEpoch - date.millisecondsSinceEpoch) / 86400000;
    if (days.floor() < 1) return '今天';
    if (days.floor() < 2) return '昨天';
  }
  return text.length > 10 ? text.substring(0, 10) : text;
}

// 按日子分組：相鄰同一天的放一組
List<({String label, List<dynamic> items})> noticeGroups(List<dynamic> items, [DateTime? now]) {
  final out = <({String label, List<dynamic> items})>[];
  for (final item in items) {
    final label = noticeDay(at(item, 'createdAt'), now);
    if (out.isNotEmpty && out.last.label == label) {
      out.last.items.add(item);
    } else {
      out.add((label: label, items: [item]));
    }
  }
  return out;
}

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<NotificationsPage> createState() => NotificationsPageState();
}

class NotificationsPageState extends State<NotificationsPage> with PageShow {
  List<dynamic> items = [];
  num unread = 0;
  bool loaded = false;

  @override
  String get showPath => '/notifications';

  @override
  void onShow() => unawaited(load());

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  Future<void> load() async {
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final result = await api('/my/notifications');
      _set(() {
        items = listOf(at(result, 'items')).toList();
        unread = at(result, 'unread') is num ? at(result, 'unread') as num : jsNumber(at(result, 'unread'));
      });
    } catch (e) {
      if (mounted) showToast(context, e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  void open(Map item) {
    if (!truthy(item['read'])) {
      _set(() {
        item['read'] = true;
        unread = unread - 1 < 0 ? 0 : unread - 1;
      });
      api('/my/notifications/read', 'POST', {'id': item['id']}).catchError((_) => null);
    }
    if (!truthy(item['link'])) return;
    openAppLink(context, jsString(item['link']));
  }

  Future<void> readAll() async {
    try {
      await api('/my/notifications/read', 'POST', {'all': true});
      _set(() {
        for (final item in items) {
          if (item is Map) item['read'] = true;
        }
        unread = 0;
      });
    } catch (e) {
      if (mounted) showToast(context, e is ApiError ? e.message : '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final groups = noticeGroups(items);
    return AppPage(
      title: '通知',
      child: PageBody(children: [
        Blocks([
          // .row.head：頂端對齊、下距 4
          Blk(
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Expanded(child: Subtle('到期提醒、辦理進度和文件核對結果都會在這裏。')),
              if (truthy(unread)) ...[const SizedBox(width: 12), LinkText('全部已讀', onTap: readAll)],
            ]),
            bottom: 4,
          ),
          for (final g in groups)
            ...wrapBlk([
              Blk(Text(g.label, style: ts(Fs.meta, weight: w700, color: C.ink3)), top: 16, bottom: 8),
              Blk(
                CardBox(
                  margin: EdgeInsets.zero,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    for (final (i, item) in g.items.indexed) _notice(item as Map, last: i == g.items.length - 1),
                  ]),
                ),
                bottom: 12,
              ),
            ]),
          if (loaded && items.isEmpty) Blk(const CardBox(margin: EdgeInsets.zero, padding: EdgeInsets.zero, child: Empty('暫時沒有通知')), bottom: 12),
        ]),
      ]),
    );
  }

  // .notice：圓點（未讀時牌照黃加淡黃光圈）＋標題、內容、類別；有連結時右邊 ›
  Widget _notice(Map item, {required bool last}) {
    final isUnread = !truthy(item['read']);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => open(item),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.rule))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 8,
            height: 8,
            margin: const EdgeInsets.only(top: 8),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isUnread ? C.plateYellow : null,
              boxShadow: isUnread ? const [BoxShadow(color: HomeStyle.unreadRing, spreadRadius: 2)] : null,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(item['title'] == null ? '' : jsString(item['title']), style: ts(Fs.h, weight: w700, height: 1.4, color: isUnread ? C.ink : C.ink2)),
              if (truthy(item['body'])) Padding(padding: const EdgeInsets.only(top: 2), child: Text(jsString(item['body']), style: ts(Fs.body, color: C.ink2))),
              Padding(padding: const EdgeInsets.only(top: 4), child: Text(noticeKindLabel[item['kind']] ?? '通知', style: ts(Fs.cap, weight: w700, color: C.ink3))),
            ]),
          ),
          if (truthy(item['link'])) ...[const SizedBox(width: 8), const Padding(padding: EdgeInsets.only(top: 4), child: Chev())],
        ]),
      ),
    );
  }
}
