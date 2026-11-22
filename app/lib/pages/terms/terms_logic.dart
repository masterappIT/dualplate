// 服務條款頁的計算：照 mobile/src/pages/terms/terms.vue。
import '../../core/js.dart';

// 登入後的 /my/terms：已發佈才顯示，並記下是自己的（mine）；未發佈當作沒有
Map? myTermsDoc(Object? mine) => mine is Map && truthy(mine['published']) ? {...mine, 'mine': true} : null;

// 要同意：登入後讀到的條款、而且未同意最新版本
bool termsNeedAccept(Map? doc) => doc != null && truthy(doc['mine']) && !truthy(doc['accepted']);

// 強制同意（管理者設定）：同意前不能使用其他功能
bool termsForced(Map? doc) => doc?['mode'] == 'force';

// 頂部提示：強制時固定一句；否則看以前有沒有同意過
(String, String) termsBanner(Map doc) {
  if (termsForced(doc)) return ('請先閱讀並同意', '服務條款及私隱聲明已更新，同意後才可繼續使用。');
  return truthy(doc['everAccepted']) ? ('服務條款已更新', '請閱讀並同意最新版本。') : ('請先閱讀服務條款', '開始使用前，請閱讀並同意以下條款及私隱聲明。');
}
