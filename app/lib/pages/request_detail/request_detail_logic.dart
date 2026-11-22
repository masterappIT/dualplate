// 辦理進度頁的計算：逐條照搬 mobile/src/pages/request-detail/request-detail.vue 的 computed 和小函數。
import '../../core/js.dart';
import '../../core/wording.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf;

// 客戶看到的四步進度
const progressSteps = ['已提交', '收集資料', '辦理中', '完成'];

// 伺服器已把內部狀態換成客戶看得懂的文字：已收到／需要你提供資料／辦理中／已完成／已取消
int stepIndex(Object? item) {
  final status = at(item, 'status');
  return status == '已完成' ? 3 : status == '辦理中' ? 2 : status == '需要你提供資料' ? 1 : 0;
}

// 要客戶做的事：伺服器有 clientTodos 就用（空清單也照用），否則用狀態「待客戶配合」的步驟
List<dynamic> waitingOf(Object? item) {
  final todos = at(item, 'clientTodos');
  if (todos != null) return listOf(todos);
  return listOf(at(item, 'tasks')).where((t) => at(t, 'status') == '待客戶配合').toList();
}

// 自管客戶沒有顧問：用語改為「我們」
String adv(String text, bool selfManaged) => selfManaged ? text.replaceAll('你的顧問', '我們').replaceAll('顧問', '我們') : text;

String nextText(Object? item, bool selfManaged) {
  final step = stepIndex(item);
  final text = at(item, 'status') == '已取消'
      ? '這張工單已取消。如有疑問請聯絡你的顧問。'
      : step == 0
          ? '顧問會盡快受理，並告訴你需要準備的資料。'
          : step == 1
              ? (waitingOf(item).isNotEmpty ? '資料齊全後就會開始辦理。' : '顧問正在整理資料。')
              : step == 2
                  ? '正在辦理，有結果會通知你。'
                  : '已辦理完成。';
  return adv(text, selfManaged);
}

String nowStage(Object? item) => at(item, 'status') == '已取消' ? '已取消' : clientStage(at(item, 'stage'));

// 待辦標題去掉「客戶」二字，直接對客戶說要提供甚麼
String todoTitle(Object? title) => (truthy(title) ? jsString(title) : '').replaceFirst(RegExp(r'^客戶'), '');

bool canUpload(Object? item) => item != null && !['已完成', '已取消'].contains(at(item, 'status'));

List<dynamic> filesFor(List<dynamic> files, Object? taskId) => files.where((f) => at(f, 'taskId') == taskId).toList();

String taskTitle(Object? item, Object? taskId) {
  final task = listOf(at(item, 'tasks')).cast<Object?>().firstWhere((t) => at(t, 'id') == taskId, orElse: () => null);
  return task != null ? '${jsString(at(task, 'title'))} · ' : '';
}

String sizeText(Object? size) {
  final n = jsNumber(size);
  if (n >= 1048576) return '${(n / 1048576).toStringAsFixed(1)} MB';
  final kb = (n / 1024).round();
  return '${kb < 1 ? 1 : kb} KB';
}

List<dynamic> selectedSources(List<dynamic> sources, Object? item) {
  final ids = listOf(at(at(item, 'plan'), 'sourceIds'));
  return sources.where((s) => ids.contains(at(s, 'id'))).toList();
}

// 頁首：路線，沒有牌照時加「 · 車牌／新申請」
String headMeta(Object? item) {
  final plateAsset = at(item, 'plateAsset');
  if (truthy(plateAsset)) return jsString(at(item, 'route'));
  final plate = at(at(item, 'vehicle'), 'plate');
  return '${jsString(at(item, 'route'))} · ${truthy(plate) ? jsString(plate) : '新申請'}';
}

// 逐份上傳的結果（chooseUpload）：全部成功是提示，有失敗是提示框
String uploadedTitle(int ok, int failed) => ok > 0 ? '已上傳 $ok 份，$failed 份未成功' : '上傳未成功';

// 取消原因（選填）；第 4 項「不說明原因」不送 reason
const cancelReasons = ['按錯了', '改變主意', '已自己辦好', '不說明原因'];
Map<String, dynamic> cancelBody(int pick) => pick < 3 ? {'reason': cancelReasons[pick]} : {};

String fileMark(Object? f) => at(f, 'mime') == 'application/pdf' ? 'PDF' : '相';

String fileSub(Object? item, Object? f) => '${taskTitle(item, at(f, 'taskId'))}${friendlyDate(at(f, 'createdAt'))} · ${sizeText(at(f, 'size'))}';

// 不認得的狀態：現有 App 顯示空白（托管）；自管時 adv(undefined) 會出錯，這裏同樣顯示空白
String attachmentText(Object? status, bool selfManaged) => adv(attachmentLabel[status] ?? '', selfManaged);
