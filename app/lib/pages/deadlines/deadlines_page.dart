// 到期提醒：一比一移植 mobile/src/pages/deadlines/deadlines.vue（App 端）。
// 未來半年要辦的事；按「全部／牌照／車輛／公司」篩選。自管客戶可「委託我們辦」。每次顯示（onShow）都重新載入。
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/due_date.dart';
import '../../business/page_show.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf;
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DetailListCard;

const deadlineFilters = [('', '全部'), ('plate', '牌照'), ('vehicle', '車輛'), ('company', '公司')];

List<dynamic> visibleDeadlines(List<dynamic> items, String filter) => items.where((item) => filter.isEmpty || at(item, 'ownerType') == filter).toList();

// 第二行：所屬（公司名、車牌等）· 補充說明
String deadlineSubline(Object? item) => '${at(item, 'ownerLabel') == null ? '' : jsString(at(item, 'ownerLabel'))}${truthy(at(item, 'detail')) ? ' · ${detailText(at(item, 'detail'))}' : ''}';

class DeadlinesPage extends StatefulWidget {
  const DeadlinesPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<DeadlinesPage> createState() => DeadlinesPageState();
}

class DeadlinesPageState extends State<DeadlinesPage> with PageShow {
  // 頁面建立時決定（const selfManaged = isSelfManaged()）
  final bool selfManaged = isSelfManaged();
  List<dynamic> items = [];
  String filter = '';
  bool loaded = false;

  @override
  String get showPath => '/deadlines';

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
      final overview = await api('/my/overview');
      _set(() => items = listOf(at(overview, 'deadlines')));
    } catch (e) {
      if (mounted) showToast(context, e is ApiError ? e.message : '$e');
    } finally {
      _set(() => loaded = true);
    }
  }

  void open(Object? item) {
    if (at(item, 'ownerType') == 'company') {
      context.go('/companies');
    } else if (truthy(at(item, 'plateId'))) {
      context.push(platePath(at(item, 'plateId')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = visibleDeadlines(items, filter);
    return AppPage(
      title: '到期提醒',
      child: PageBody(children: [
        Blocks([
          Blk(
            Text(selfManaged ? '未來半年要辦的事，都由你自己辦；想交給我們，按「委託我們辦」。' : '未來半年要辦的事。標了「自行辦理」的由你自己辦，其他由我們在到期前安排。', style: ts(Fs.body, color: C.ink2, height: 1.6)),
            bottom: 16,
          ),
          Blk(Wrap(spacing: 8, runSpacing: 8, children: [for (final (id, name) in deadlineFilters) Chip(name, active: filter == id, onTap: () => _set(() => filter = id))]), top: 12, bottom: 16),
          for (final item in visible) Blk(_row(item as Map), bottom: 12),
          if (loaded && visible.isEmpty) Blk(const CardBox(margin: EdgeInsets.zero, padding: EdgeInsets.zero, child: Empty('沒有需要留意的到期項目')), bottom: 12),
        ]),
      ]),
    );
  }

  Widget _row(Map item) => DetailListCard(
        onTap: () => open(item),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              ListTitle(item['name'] == null ? '' : jsString(item['name'])),
              if (showSelfTag(item)) const Who(selfHandled),
              ListSub(deadlineSubline(item)),
              if (canEntrust(item))
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    widthFactor: 1,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => context.push(entrustPath(item)),
                      child: Text('委託我們辦 ›', style: ts(Fs.body, weight: w700, color: C.jade)),
                    ),
                  ),
                ),
            ]),
          ),
          const SizedBox(width: 12),
          DueDate(date: item['dueOn'] is String ? item['dueOn'] as String : '', days: item['daysLeft'] is num ? (item['daysLeft'] as num).toInt() : null, level: item['level'] is String ? item['level'] as String : ''),
        ]),
      );
}
