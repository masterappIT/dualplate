// 註銷帳號頁的計算：照 mobile/src/pages/close-account/close-account.vue 的 submit()。
// 照現在的行為：即時刪除，不送 retain（「停用 30 天後刪除」計劃未批准）。

// POST /my/account/close 的內容：有選原因才送 reason；選「其他」而且有寫內容才送 reasonText（去掉前後空格）。密碼原文
Map<String, Object?> closeBody({required String password, required String reason, required String reasonText}) => {
      'password': password,
      if (reason.isNotEmpty) 'reason': reason,
      if (reason == '其他' && reasonText.trim().isNotEmpty) 'reasonText': reasonText.trim(),
    };

// 數量照模板 {{ }} 顯示：null 顯示空白
String countText(Object? counts, String key, String unit) {
  final v = counts is Map ? counts[key] : null;
  return '${v == null ? '' : v is double && v == v.truncateToDouble() ? v.toInt() : v} $unit';
}
