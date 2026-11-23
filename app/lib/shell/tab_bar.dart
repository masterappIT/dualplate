// 底部四個分頁：對應 pages.json tabBar（白底、字 #85918A、選中 #0F5C4A、圖示 static/*-normal.png、*-selected.png）。
// 高 50（加底部安全區）、圖示 24、字 10px；圖示和文字的位置按現有 App 截圖量度，數值見 tokens.dart Shell。
// 切換分頁沒有動畫、各分頁保留原來的狀態（和 uni-app switchTab 一樣）；分頁列沒有按下效果。
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../business/support_unread.dart';
import '../ui/tokens.dart';

class TabItem {
  const TabItem(this.text, this.icon);
  final String text, icon;
  String get normal => 'assets/tabbar/$icon-normal.png';
  String get selected => 'assets/tabbar/$icon-selected.png';
}

const tabItems = [TabItem('首頁', 'home'), TabItem('牌照', 'vehicle'), TabItem('公司', 'company'), TabItem('我的', 'me')];

class BottomTabs extends StatelessWidget {
  const BottomTabs({super.key, required this.index, required this.onTap, this.badges = const {}});
  final int index;
  final ValueChanged<int> onTap;
  // 分頁紅點上的字（uni.setTabBarBadge）：分頁位置 → 字；「我的」分頁用來顯示線上客服的未讀數
  final Map<int, String> badges;

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.paddingOf(context).bottom;
    final hairline = 1 / MediaQuery.devicePixelRatioOf(context);
    return Container(
      key: const ValueKey('tab-bar'),
      color: C.tabBg,
      padding: EdgeInsets.only(bottom: bottom),
      child: SizedBox(
        height: Shell.tabHeight,
        child: Stack(children: [
          Row(children: [
            for (var i = 0; i < tabItems.length; i++)
              Expanded(
                child: GestureDetector(
                  key: ValueKey('tab-$i'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () => onTap(i),
                  child: Column(children: [
                    const SizedBox(height: Shell.tabIconTop),
                    Stack(clipBehavior: Clip.none, children: [
                      Image.asset(i == index ? tabItems[i].selected : tabItems[i].normal,
                          width: Shell.tabIcon, height: Shell.tabIcon, filterQuality: FilterQuality.medium, gaplessPlayback: true),
                      if (badges[i] != null) Positioned(top: 2, right: 0, child: FractionalTranslation(translation: const Offset(.4, 0), child: TabBadge(badges[i]!))),
                    ]),
                    const SizedBox(height: Shell.tabSpacing),
                    Text(tabItems[i].text, maxLines: 1, style: ts(Shell.tabFontSize, color: i == index ? C.tabSelected : C.tabText, height: 1.4)),
                  ]),
                ),
              ),
          ]),
          // borderStyle white：頂邊一條 rgba(255,255,255,.4) 細線（白底上看不見，照設定保留）
          Positioned(left: 0, right: 0, top: 0, height: hairline, child: const ColoredBox(color: Shell.tabBorder)),
        ]),
      ),
    );
  }
}

// 有底部分頁的外殼：上面是目前分頁（各自有導航列），下面是分頁列
class TabsShell extends StatefulWidget {
  const TabsShell(this.shell, {super.key});
  final StatefulNavigationShell shell;
  @override
  State<TabsShell> createState() => _TabsShellState();
}

class _TabsShellState extends State<TabsShell> {
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // 先載入八個圖示，第一次切換時不會閃一下
    for (final item in tabItems) {
      precacheImage(AssetImage(item.normal), context);
      precacheImage(AssetImage(item.selected), context);
    }
  }

  @override
  Widget build(BuildContext context) => ColoredBox(
        color: C.paper,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Expanded(child: MediaQuery.removePadding(context: context, removeBottom: true, child: widget.shell)),
          // 「我的」分頁：客服回覆了有紅點（business/support_unread.dart）
          ValueListenableBuilder<int>(
            valueListenable: SupportUnread.count,
            builder: (context, unread, _) => BottomTabs(
              index: widget.shell.currentIndex,
              onTap: (i) => widget.shell.goBranch(i),
              badges: {if (unread > 0) tabItems.length - 1: badgeText(unread)},
            ),
          ),
        ]),
      );
}

// 分頁紅點：照 uni-app H5 的分頁紅點（tabBar.css .uni-tabbar__reddot.uni-tabbar__badge）：貼在圖示右上（上 2、右邊對齊後再往右移自身寬度的 40%），
// 高 16、最少寬 16、左右內距 2、圓角 16、紅底白字 12 號、置中不換行
class TabBadge extends StatelessWidget {
  const TabBadge(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        key: const ValueKey('tab-badge'),
        constraints: const BoxConstraints(minWidth: 16),
        height: 16,
        padding: const EdgeInsets.symmetric(horizontal: 2),
        decoration: BoxDecoration(color: C.tabBadge, borderRadius: BorderRadius.circular(16)),
        child: Center(widthFactor: 1, child: Text(text, softWrap: false, style: ts(12, color: C.card, height: 16 / 12))),
      );
}
