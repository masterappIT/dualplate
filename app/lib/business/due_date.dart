// 到期徽章：左側狀態色條＋等寬日期＋「還有／逾期 N 天」（docs/design-system.md 第二節）；全站到期日都用它。
// 照抄 mobile/src/components/DueDate.vue。
import 'package:flutter/widgets.dart';
import '../ui/tokens.dart';
import 'css.dart';

class DueDate extends StatelessWidget {
  const DueDate({super.key, this.date = '', this.days, this.level = '', this.today});
  final String date; // YYYY-MM-DD；空字串顯示「待錄入」
  final int? days; // 伺服器算好的剩餘天數；沒有時按今天計
  final String level; // overdue、due、upcoming、ok、muted；空字串時按日期自動判斷
  final DateTime? today; // 只給測試用

  static bool validDate(String date) => RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date) && DateTime.tryParse('${date}T00:00:00') != null;

  // 第七節管理者決定（2026-11-22）：日期不是「年-月-日」又沒有伺服器天數時，當作還沒有填日期（原組件顯示綠色「還有 NaN 天」）
  static String shownDateOf(String date, int? days) => days == null && date.isNotEmpty && !validDate(date) ? '' : date;

  static int? daysLeftOf(String date, int? days, [DateTime? now]) {
    if (days != null) return days;
    if (!validDate(date)) return null;
    final t = now ?? DateTime.now();
    final d = DateTime.parse('${date}T00:00:00');
    return (d.difference(DateTime(t.year, t.month, t.day)).inMilliseconds / 86400000).round();
  }

  static String phraseOf(num? left) => left == null ? '' : left < 0 ? '逾期 ${-left} 天' : left == 0 ? '今天到期' : '還有 $left 天';

  static String toneOf(String date, num? left, String level) =>
      level.isNotEmpty ? level : date.isEmpty || left == null ? 'muted' : left < 0 ? 'overdue' : left <= 30 ? 'due' : 'ok';

  // .overdue .due .ok .upcoming .muted 的 color；其他值（例如 missing）沒有對應類別，沿用頁面字色
  static Color colorOf(String tone) => switch (tone) { 'overdue' => C.overdue, 'due' => C.due, 'ok' || 'upcoming' => C.ok, 'muted' => C.muted, _ => C.ink };

  @override
  Widget build(BuildContext context) {
    final date = shownDateOf(this.date, days);
    final left = daysLeftOf(date, days, today), tone = toneOf(date, left, level), color = colorOf(tone);
    TextStyle style(double size, Color c, {double? spacing}) =>
        ts(size, weight: w700, color: c, height: cssLineHeight(size, 1.4), letterSpacing: spacing).copyWith(fontFamily: appSystemFont, fontFeatures: const [FontFeature.tabularFigures()]);
    return Container(
      padding: const EdgeInsets.only(left: 10),
      decoration: BoxDecoration(border: Border(left: BorderSide(color: color, width: 3))),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        // .date.num：14、700、行高 1.4、字距 .04em；muted 時字色 ink-3
        Text(date.isEmpty ? '待錄入' : date, softWrap: false, textScaler: TextScaler.noScaling, style: style(Fs.body, tone == 'muted' ? C.ink3 : C.ink, spacing: Fs.body * .04)),
        if (date.isNotEmpty) ...[
          const SizedBox(height: 2),
          Text(phraseOf(left), softWrap: false, textScaler: TextScaler.noScaling, style: style(Fs.meta, color).copyWith(fontFeatures: const [])),
        ],
      ]),
    );
  }
}
