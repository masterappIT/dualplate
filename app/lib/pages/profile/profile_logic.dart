// 我的資料頁的計算：照 mobile/src/pages/profile/profile.vue。
import '../../core/js.dart';

const customerKeys = ['name', 'kind', 'phone'];

String _s(Object? v) => truthy(v) ? jsString(v) : '';

// 顯示名稱有改（去掉前後空格後不是空白，也和現在的不同）才可按「儲存」
bool nameChanged(String draft, Object? current) => draft.trim().isNotEmpty && draft.trim() != _s(current);

// 委託人資料：任何一欄（去掉前後空格）和現在不同
bool customerChanged(Map<String, String> draft, Map current) => customerKeys.any((k) => (draft[k] ?? '').trim() != _s(current[k]));

// 只送改了的欄位；送出的是輸入的原文（不去空格，照現有 App）
Map<String, String> customerChanges(Map<String, String> draft, Map current) => {
      for (final k in customerKeys)
        if ((draft[k] ?? '').trim() != _s(current[k])) k: draft[k] ?? '',
    };

// 改密碼前檢查：沒填目前密碼、新密碼少於 10 個字元、兩次不一樣
String passwordProblem(String current, String next, String again) => current.isEmpty
    ? '請輸入目前密碼'
    : next.length < 10
        ? '新密碼至少 10 個字元'
        : next != again
            ? '兩次輸入的新密碼不一樣'
            : '';

bool customerPendingIn(Object? pending) => pending is List && pending.any((item) => item is Map && item['entityType'] == 'customer');
