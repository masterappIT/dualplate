// 你的顧問：照抄 mobile/src/components/AdvisorCard.vue（一鍵致電或複製微信號）。
// 顧問沒有名字、電話、微信時：placeholder 為 true 顯示「顧問資料整理中」，否則不顯示。
// 外距（.advisor margin-top 12、.card margin-bottom 12）由所在頁面按外距合併處理，這裏只畫卡本身。
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import '../core/js.dart';
import '../pages/login/contact_card.dart' show copyText;
import '../ui/base.dart';
import '../ui/tokens.dart';

// api.js 的 callAdvisor：去掉空格和短橫後撥號（uni.makePhoneCall）。
// App 端由原生打開撥號（iOS 系統會先問「撥打…？」）；原生通道 dualplate/system 的 dial（AppDelegate.swift、MainActivity.kt）
const _system = MethodChannel('dualplate/system');
Future<void> callAdvisor(Object? phone) async {
  if (!truthy(phone)) return;
  try {
    await _system.invokeMethod('dial', jsString(phone).replaceAll(RegExp(r'[\s-]'), ''));
  } catch (_) {}
}

class AdvisorCard extends StatelessWidget {
  const AdvisorCard({super.key, this.advisor, this.placeholder = false});
  final Map? advisor;
  final bool placeholder;

  static bool hasAdvisor(Map? a) => a != null && (truthy(a['name']) || truthy(a['phone']) || truthy(a['wechat']));
  // 有沒有東西要畫（沒有時頁面不加這一塊）
  static bool shows(Map? advisor, bool placeholder) => hasAdvisor(advisor) || placeholder;

  @override
  Widget build(BuildContext context) {
    final a = advisor;
    // .caption：12、700、ink-3；.meta：14、ink-2、行高 1.5
    final caption = Text('你的顧問', style: ts(Fs.cap, weight: w700, color: C.ink3));
    TextStyle meta({bool num = false}) {
      final s = ts(Fs.body, color: C.ink2);
      return num ? s.copyWith(fontFeatures: const [FontFeature.tabularFigures()], letterSpacing: Fs.body * .04) : s;
    }

    if (!hasAdvisor(a)) {
      if (!placeholder) return const SizedBox.shrink();
      return CardBox(
        margin: EdgeInsets.zero,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          caption,
          Text('顧問資料整理中，稍後會在這裏顯示聯絡方式。', style: meta()),
        ]),
      );
    }
    final name = truthy(a!['name']) ? jsString(a['name']) : '';
    final badge = (name.isNotEmpty ? name : '顧').substring(0, 1);
    final phone = a['phone'], wechat = a['wechat'];
    // .actions：間距 8、上距 16；按鈕 .btn-sm 平分寬度。沒有電話和微信時是空的一行，仍留上距 16（照舊）
    final actions = <Widget>[
      if (truthy(phone)) Expanded(child: Btn('致電', kind: BtnKind.small, expand: true, onTap: () => callAdvisor(phone))),
      if (truthy(wechat)) Expanded(child: Btn('複製微信號', kind: BtnKind.small, expand: true, onTap: () => copyText(context, wechat, '微信號已複製'))),
    ];
    return CardBox(
      margin: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          // .badge：44 圓、深綠底、2px 牌照黃框；字 16、800、白
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: C.jadeDeep, shape: BoxShape.circle, border: Border.all(color: C.plateYellow, width: 2)),
            alignment: Alignment.center,
            child: Text(badge, style: ts(Fs.h, weight: w800, color: HomeStyle.white)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              caption,
              Text(name.isNotEmpty ? name : '顧問', style: ts(Fs.h, weight: w800, height: 1.4)),
              if (truthy(phone)) Text(jsString(phone), style: meta(num: true)),
              if (truthy(wechat)) Text('微信 ${jsString(wechat)}', style: meta()),
            ]),
          ),
        ]),
        const SizedBox(height: 16),
        Row(children: [
          for (final (i, b) in actions.indexed) ...[if (i > 0) const SizedBox(width: 8), b],
        ]),
      ]),
    );
  }
}
