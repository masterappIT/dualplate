// 使用導覽：照抄 mobile/src/components/WelcomeGuide.vue（第一次登入的 3 步導覽，每部手機自動出現一次，可略過；「我的」頁可重看）。
// 現有 App 的導覽是頁面 WebView 裏的 position:fixed 遮罩，只蓋頁面內容（導航列以下、分頁列以上），沒有出入動畫。
// 用法：放在頁面內容的 Stack 裏（本組件自己是 Positioned.fill）。點遮罩空白處、按「略過」、Android 返回鍵都關閉。
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/session.dart';
import 'page_show.dart';
import '../ui/base.dart';
import '../ui/tokens.dart';

// 自管客戶（自己管理）看另一套導覽：沒有顧問、全部事項自己辦
const selfGuideSteps = [
  ('首頁一眼看清楚', '上方是你名下牌照的狀態：正常、快到期、已逾期。「待辦」列出快到期、要你辦的事，辦好按「已辦好」就會消失。'),
  ('拍卡建檔，自動提醒', '拍下批文卡就能建立牌照，到期日自動讀出；之後每項到期前都會提醒你。要看全部到期日，按「查看全部到期日」。'),
  ('牌照有變動，自己更新', '換車、續期、換司機等，在牌照頁按「有變動？」更新，資料即時生效。'),
];
const custodyGuideSteps = [
  ('首頁一眼看清楚', '上方是你名下牌照的狀態：正常、快到期、已逾期。「待辦」只列要你動手的事，做完自動消失；沒有就代表不用操心。'),
  ('我們負責的不用你管', '我們負責的事項會按時跟進，不會出現在待辦；要看全部到期日，按「查看全部到期日」。每個牌照有變動，在牌照頁按「有變動？」。'),
  ('要交文件，直接拍照', '顧問需要文件時會出現在待辦，按進去拍照或選 PDF 上傳。要聯絡顧問，在「我的」可以直接致電或複製微信號。'),
];

// 每部手機、每個帳戶記一次（uni.setStorageSync(`welcomeGuide:${id}`, Date.now())）
String welcomeGuideKey() => 'welcomeGuide:${getUser()?['id'] ?? 'anon'}';

// 遮罩 rgba(11,59,48,.55)
const guideMask = HomeStyle.guideMask;

class WelcomeGuide extends StatefulWidget {
  const WelcomeGuide({super.key, this.force = false, this.onClosed});
  final bool force;
  final VoidCallback? onClosed;
  @override
  State<WelcomeGuide> createState() => WelcomeGuideState();
}

class WelcomeGuideState extends State<WelcomeGuide> with BackClose {
  // 組件建立時決定（const steps = isSelfManaged() ? … : …）
  final steps = isSelfManaged() ? selfGuideSteps : custodyGuideSteps;
  bool open = false;
  int step = 0;

  @override
  void initState() {
    super.initState();
    if (widget.force) {
      open = true;
      return;
    }
    _autoOpen();
  }

  Future<void> _autoOpen() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final key = welcomeGuideKey();
      if (prefs.get(key) == null) {
        await prefs.setInt(key, DateTime.now().millisecondsSinceEpoch);
        if (mounted) setState(() => open = true);
      }
    } catch (_) {
      if (mounted) setState(() => open = false);
    }
  }

  @override
  bool get backOpen => open;
  // 安卓返回鍵等於「略過」
  @override
  void backClose() => close();

  void close() {
    setState(() {
      open = false;
      step = 0;
    });
    widget.onClosed?.call();
  }

  void next() {
    if (step < steps.length - 1) {
      setState(() => step++);
    } else {
      close();
    }
  }

  @override
  Widget build(BuildContext context) {
    syncBack();
    if (!open) return const SizedBox.shrink();
    final (title, body) = steps[step];
    final bottom = MediaQuery.paddingOf(context).bottom;
    return Positioned.fill(
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: close,
        child: Container(
          color: guideMask,
          padding: const EdgeInsets.all(16),
          alignment: Alignment.bottomCenter,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () {},
            child: Container(
              key: const ValueKey('welcome-guide'),
              constraints: const BoxConstraints(maxWidth: 640),
              width: double.infinity,
              padding: EdgeInsets.fromLTRB(16, 20, 16, 16 + bottom),
              decoration: BoxDecoration(color: C.card, borderRadius: BorderRadius.circular(R.panel), boxShadow: Shadows.float),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '第 ${step + 1} / ${steps.length} 步',
                    style: ts(Fs.cap, weight: w700, color: C.ink3),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    title,
                    style: ts(Fs.title, weight: w800, color: C.jadeDeep),
                  ),
                  const SizedBox(height: 8),
                  Text(body, style: ts(Fs.body, color: C.ink2, height: 1.7)),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      for (var i = 0; i < steps.length; i++) ...[
                        if (i > 0) const SizedBox(width: 4),
                        Container(
                          width: i == step ? 20 : 8,
                          height: 8,
                          decoration: BoxDecoration(color: i == step ? C.jade : C.rule, borderRadius: BorderRadius.circular(R.pill)),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 16),
                  // .secondary 高 44、.primary 高 48，按鈕各有固定高度，頂端對齊（照舊）
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Btn('略過', kind: BtnKind.secondary, expand: true, onTap: close),
                      ),
                      const SizedBox(width: 8),
                      Expanded(child: Btn(step < steps.length - 1 ? '下一步' : '開始使用', onTap: next)),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
