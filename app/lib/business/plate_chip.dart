// 車牌徽章：縮小版仿真車牌，凡顯示車牌處都用它（docs/design-system.md 第二節）。照抄 mobile/src/components/PlateChip.vue。
import 'package:flutter/widgets.dart';
import '../ui/tokens.dart';
import 'css.dart';

enum PlateKind { mainland, hk, mo, unknown }

enum PlateChipSize { sm, md, lg }

class PlateChip extends StatelessWidget {
  const PlateChip({super.key, this.plate = '', this.region = '', this.size = PlateChipSize.md});
  final String plate;
  // '內地'、'香港'、'澳門'；空字串時按號碼自動判斷，其他值當判斷不了
  final String region;
  final PlateChipSize size;

  static String shownOf(String plate) => plate.trim().isEmpty ? '待補充' : plate.trim();

  // 內地（漢字開頭，如「粵Z」）黑底白字；澳門（M 開頭加數字分段，如「MM-12-34」）白底黑字；
  // 香港（1–8 個英文字母、數字或空格）黃底黑字；判斷不了用中性框。
  static PlateKind kindOf(String plate, [String region = '']) {
    if (region.isNotEmpty) return const {'內地': PlateKind.mainland, '香港': PlateKind.hk, '澳門': PlateKind.mo}[region] ?? PlateKind.unknown;
    // 第七節管理者決定（2026-11-22）：沒有號碼時用中性框，不再因「待補充」的「待」是漢字而當成內地牌
    if (plate.trim().isEmpty) return PlateKind.unknown;
    final text = shownOf(plate).toUpperCase();
    if (RegExp('^[一-龥]').hasMatch(text)) return PlateKind.mainland;
    if (RegExp(r'^M[A-Z]?[-\s]?\d{2}[-\s]?\d{2}$').hasMatch(text)) return PlateKind.mo;
    if (RegExp(r'^[A-Z0-9 ]{1,8}$').hasMatch(text)) return PlateKind.hk;
    return PlateKind.unknown;
  }

  static const _label = {PlateKind.mainland: '內地車牌', PlateKind.hk: '香港車牌', PlateKind.mo: '澳門車牌', PlateKind.unknown: '車牌'};

  @override
  Widget build(BuildContext context) {
    final shown = shownOf(plate), kind = kindOf(plate, region);
    // .md{font-size:14} .sm{12; padding:1px 6px} .lg{16; padding:4px 10px}；預設 padding:2px 8px
    final (fs, pad) = switch (size) {
      PlateChipSize.sm => (Fs.cap, const EdgeInsets.symmetric(horizontal: 6, vertical: 1)),
      PlateChipSize.md => (Fs.body, const EdgeInsets.symmetric(horizontal: 8, vertical: 2)),
      PlateChipSize.lg => (Fs.h, const EdgeInsets.symmetric(horizontal: 10, vertical: 4)),
    };
    // 底色、字色、inset 框線（由內到外）
    final (bg, fg, rings) = switch (kind) {
      PlateKind.mainland => (PlateC.chipMainland, PlateC.chipWhite, const [(1.0, PlateC.chipMainland), (2.0, PlateC.chipWhite)]),
      PlateKind.hk => (C.plateYellow, PlateC.chipInk, const [(1.0, PlateC.chipEdge)]),
      PlateKind.mo => (PlateC.chipWhite, PlateC.chipInk, const [(1.0, PlateC.chipInk)]),
      PlateKind.unknown => (C.mutedBg, C.ink3, const [(1.0, C.rule)]),
    };
    return Semantics(
      label: '${_label[kind]} $shown',
      excludeSemantics: true,
      child: CustomPaint(
        painter: CssBoxPainter(radius: 3, color: bg, shadows: [for (final (spread, color) in rings) CssShadow(0, 0, color, spread: spread, inset: true)]),
        child: Padding(
          padding: pad,
          // 文字 letter-spacing:.06em、line-height:1.4、等寬數字（.num）；未知時字重 700，其餘 800
          child: Text(shown,
              maxLines: 1,
              softWrap: false,
              textScaler: TextScaler.noScaling,
              style: ts(fs, weight: kind == PlateKind.unknown ? w700 : w800, color: fg, height: cssLineHeight(fs, 1.4), letterSpacing: fs * .06)
                  .copyWith(fontFamily: appSystemFont, fontFeatures: const [FontFeature.tabularFigures()])),
        ),
      ),
    );
  }
}
