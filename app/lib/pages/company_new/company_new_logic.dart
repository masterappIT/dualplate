// 新增公司頁的計算：照 mobile/src/pages/company-new/company-new.vue。
import '../../core/js.dart';

typedef PlateChoice = ({String id, String route, String label});

// /my/overview 的牌照 → 選項：內地牌 · 香港／澳門牌；都沒有時「批文卡 <編號>」
List<PlateChoice> plateChoices(Object? overview) {
  final plates = overview is Map && overview['plates'] is List ? overview['plates'] as List : const [];
  return [
    for (final p in plates.whereType<Map>())
      (
        id: jsString(p['id']),
        route: jsString(p['route']),
        label: (() {
          final text = [p['mainlandPlate'], p['localPlate']].where(truthy).map(jsString).join(' · ');
          return text.isNotEmpty ? text : '批文卡 ${p.containsKey('cardNumber') ? jsString(p['cardNumber']) : 'undefined'}';
        })(),
      ),
  ];
}

// 香港公司只可做粵港牌照的持牌公司、澳門公司只可做粵澳的；內地公司（內承單位）兩種都可以
List<PlateChoice> choicesFor(String jurisdiction, List<PlateChoice> plates) =>
    plates.where((p) => jurisdiction == '內地' || (p.route == '粵澳' ? '澳門' : '香港') == jurisdiction).toList();

// 換了註冊地後，選了的牌照不在新的選項裏：改回「不屬於任何牌照」
String keepPlate(String plateId, List<PlateChoice> choices) => plateId.isNotEmpty && !choices.any((p) => p.id == plateId) ? '' : plateId;

Map<String, Object> companyNewBody(String jurisdiction, String name, String plateId) => {
      'jurisdiction': jurisdiction,
      'name': name.trim(),
      if (plateId.isNotEmpty) 'plateId': plateId,
    };

String companyNamePlaceholder(String jurisdiction) => jurisdiction == '內地' ? '按營業執照填寫，用簡體字' : '按商業登記證填寫';
