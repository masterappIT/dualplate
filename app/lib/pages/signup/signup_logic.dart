// 申請使用頁的計算：照 mobile/src/pages/signup/signup.vue 的 submit()。
import '../login/login_page.dart' show AreaCode;

// 送出前的檢查，次序照現有 App；沒問題回傳空字串。phone 是輸入框的值（v-model.trim：已去掉前後空格）
String signupProblem({required AreaCode area, required String phone, required String name, required String password, required String again, required bool agree}) {
  final digits = phone.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) return '請填寫手機號碼';
  if (!area.accepts(digits)) return '${area.label.split(' ')[0]}手機號碼應為 ${area.hint.replaceFirst('手機號碼', '').trim()}';
  if (name.trim().isEmpty) return '請填寫稱呼';
  if (password.length < 10) return '密碼至少 10 個字元';
  if (password != again) return '兩次輸入的密碼不一樣';
  if (!agree) return '請先閱讀並同意服務條款及私隱聲明';
  return '';
}

// POST /public/signup 的內容：號碼只留數字、前面加區號；稱呼去掉前後空格；密碼原文
Map<String, Object?> signupBody({required AreaCode area, required String phone, required String name, required String password, required Object? termsVersion}) => {
      'phone': '${area.code}${phone.replaceAll(RegExp(r'\D'), '')}',
      'name': name.trim(),
      'password': password,
      'acceptTerms': true,
      'termsVersion': termsVersion,
    };

// 條款剛更新（409 且訊息有「條款已更新」）：取消勾選、重新載入條款
bool termsChanged(int? status, String message) => status == 409 && message.contains('條款已更新');
