// 車輛證件的相片（行駛證、香港車輛牌照、澳門登記文件、保險單）：對應 plate-detail.vue 的 pickOne() 和 lib/api.js 的 cardPhoto()。
// 現有 App：pickImage({ count:1, sizeType:['compressed'], sourceType:['camera','album'] }) 先彈系統選單「拍攝／從相冊選擇／取消」，
// 再把相片壓成 JPEG（長邊最多 2000、品質 80→60→40，到 800 KB 內為止），回傳 data URL。
//
// 選相片和相機權限屬 2a（lib/business/pick_image.dart，2026-11-16 仍在 2a 分支未合併）。2c 不改 pubspec、不另加套件，
// 這裏先放佔位：回傳 null，頁面當作取消（和 pickOne 取消時一樣，不提示）。2a 合併後把本函數改為呼叫 pick_image.dart。
// 測試可用 debugPickDocPhoto 替換。
import 'package:flutter/widgets.dart';

typedef DocPhotoPicker = Future<String?> Function(BuildContext context);

DocPhotoPicker? debugPickDocPhoto;

Future<String?> pickDocPhoto(BuildContext context) async {
  if (debugPickDocPhoto != null) return debugPickDocPhoto!(context);
  return null;
}
