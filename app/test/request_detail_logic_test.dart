// 辦理進度頁的計算（lib/pages/request_detail/request_detail_logic.dart）：一個情況一個測試。
// 期望值按 mobile/src/pages/request-detail/request-detail.vue 的原碼推算。
import 'package:dualplate/core/session.dart';
import 'package:dualplate/pages/request_detail/request_detail_logic.dart';
import 'package:flutter_test/flutter_test.dart';

void custody() => Session.debugSet(token: 't', user: {'id': 'u', 'serviceMode': '托管'}, mode: '托管');
void selfManaged() => Session.debugSet(token: 't', user: {'id': 'u', 'serviceMode': '自管'}, mode: '自管');

void main() {
  setUp(custody);

  group('進度步驟', () {
    test('四步次序照舊', () => expect(progressSteps, ['已提交', '收集資料', '辦理中', '完成']));
    test('已收到：第 1 步', () => expect(stepIndex({'status': '已收到'}), 0));
    test('需要你提供資料：第 2 步', () => expect(stepIndex({'status': '需要你提供資料'}), 1));
    test('辦理中：第 3 步', () => expect(stepIndex({'status': '辦理中'}), 2));
    test('已完成：第 4 步', () => expect(stepIndex({'status': '已完成'}), 3));
    test('已取消：停在第 1 步', () => expect(stepIndex({'status': '已取消'}), 0));
    test('沒有工單：第 1 步', () => expect(stepIndex(null), 0));
  });

  group('要客戶做的事', () {
    test('有 clientTodos：照用', () {
      expect(waitingOf({'clientTodos': [{'id': 1}], 'tasks': [{'status': '待客戶配合'}]}), [{'id': 1}]);
    });
    test('clientTodos 是空清單：照用空清單（不退回步驟）', () {
      expect(waitingOf({'clientTodos': [], 'tasks': [{'status': '待客戶配合'}]}), isEmpty);
    });
    test('沒有 clientTodos：用狀態「待客戶配合」的步驟', () {
      expect(waitingOf({'tasks': [{'id': 1, 'status': '待客戶配合'}, {'id': 2, 'status': '進行中'}]}), [{'id': 1, 'status': '待客戶配合'}]);
    });
  });

  group('自管用語', () {
    test('托管：原文', () => expect(adv('你的顧問會聯絡你', false), '你的顧問會聯絡你'));
    test('自管：「你的顧問」換成「我們」', () => expect(adv('你的顧問會聯絡你', true), '我們會聯絡你'));
    test('自管：單獨的「顧問」也換', () => expect(adv('顧問核對中', true), '我們核對中'));
  });

  group('下一步說明', () {
    test('已取消', () => expect(nextText({'status': '已取消'}, false), '這張工單已取消。如有疑問請聯絡你的顧問。'));
    test('已收到', () => expect(nextText({'status': '已收到'}, false), '顧問會盡快受理，並告訴你需要準備的資料。'));
    test('需要資料、有待辦', () => expect(nextText({'status': '需要你提供資料', 'clientTodos': [{}]}, false), '資料齊全後就會開始辦理。'));
    test('需要資料、沒有待辦', () => expect(nextText({'status': '需要你提供資料', 'clientTodos': []}, false), '顧問正在整理資料。'));
    test('辦理中', () => expect(nextText({'status': '辦理中'}, false), '正在辦理，有結果會通知你。'));
    test('已完成', () => expect(nextText({'status': '已完成'}, false), '已辦理完成。'));
    test('自管：已收到改說「我們」', () => expect(nextText({'status': '已收到'}, true), '我們會盡快受理，並告訴你需要準備的資料。'));
    test('自管：已取消改說「我們」', () => expect(nextText({'status': '已取消'}, true), '這張工單已取消。如有疑問請聯絡我們。'));
  });

  group('目前步驟', () {
    test('已取消：寫已取消', () => expect(nowStage({'status': '已取消', 'stage': '辦理中'}), '已取消'));
    test('沒有步驟（托管）：等待顧問受理', () => expect(nowStage({'status': '已收到'}), '等待顧問受理'));
    test('沒有步驟（自管）：等待我們受理', () {
      selfManaged();
      expect(nowStage({'status': '已收到'}), '等待我們受理');
    });
    test('「客戶」開頭的步驟改為「等你」', () => expect(nowStage({'stage': '客戶提供資料'}), '等你提供資料'));
  });

  group('待辦和上傳', () {
    test('待辦標題去掉開頭的「客戶」', () => expect(todoTitle('客戶提供身份證'), '提供身份證'));
    test('中間的「客戶」不去掉', () => expect(todoTitle('提供客戶身份證'), '提供客戶身份證'));
    test('沒有標題：空字串', () => expect(todoTitle(null), ''));
    test('辦理中可以上傳', () => expect(canUpload({'status': '辦理中'}), isTrue));
    test('已完成不可上傳', () => expect(canUpload({'status': '已完成'}), isFalse));
    test('已取消不可上傳', () => expect(canUpload({'status': '已取消'}), isFalse));
    test('工單未載入不可上傳', () => expect(canUpload(null), isFalse));
    test('按步驟篩選文件', () {
      expect(filesFor([{'taskId': 1, 'n': 'a'}, {'taskId': 2, 'n': 'b'}, {'n': 'c'}], 1), [{'taskId': 1, 'n': 'a'}]);
    });
    test('沒有步驟的文件：篩 null', () => expect(filesFor([{'taskId': 1}, {'n': 'c'}], null), [{'n': 'c'}]));
  });

  group('文件說明', () {
    final item = {'tasks': [{'id': 7, 'title': '提供身份證'}]};
    test('有對應步驟：步驟名加分隔點', () => expect(taskTitle(item, 7), '提供身份證 · '));
    test('沒有對應步驟：空字串', () => expect(taskTitle(item, 8), ''));
    test('大小：不足 1 KB 寫 1 KB', () => expect(sizeText(100), '1 KB'));
    test('大小：0 也寫 1 KB', () => expect(sizeText(null), '1 KB'));
    test('大小：KB 四捨五入', () => expect(sizeText(1536), '2 KB'));
    test('大小：1 MB 以上寫一位小數', () => expect(sizeText(1572864), '1.5 MB'));
    test('一行說明：步驟、日期、大小', () {
      expect(fileSub(item, {'taskId': 7, 'createdAt': '2026-11-20', 'size': 2048}), '提供身份證 · 2026-11-20 · 2 KB');
    });
    test('文件標記：PDF 與相片', () {
      expect(fileMark({'mime': 'application/pdf'}), 'PDF');
      expect(fileMark({'mime': 'image/jpeg'}), '相');
    });
  });

  group('資料來源', () {
    test('只列計劃選了的來源', () {
      final sources = [{'id': 'a'}, {'id': 'b'}, {'id': 'c'}];
      expect(selectedSources(sources, {'plan': {'sourceIds': ['c', 'a']}}), [{'id': 'a'}, {'id': 'c'}]);
    });
    test('沒有計劃：空清單', () => expect(selectedSources([{'id': 'a'}], {}), isEmpty));
  });

  group('頁首', () {
    test('有牌照：只寫路線', () => expect(headMeta({'route': '粵港', 'plateAsset': {'id': 1}}), '粵港'));
    test('沒有牌照、有車牌：路線加車牌', () => expect(headMeta({'route': '粵澳', 'vehicle': {'plate': 'MA1234'}}), '粵澳 · MA1234'));
    test('沒有牌照也沒有車牌：新申請', () => expect(headMeta({'route': '粵港'}), '粵港 · 新申請'));
  });

  group('上傳結果和取消', () {
    test('有成功有失敗', () => expect(uploadedTitle(2, 1), '已上傳 2 份，1 份未成功'));
    test('全部失敗', () => expect(uploadedTitle(0, 3), '上傳未成功'));
    test('取消原因第 1 至 3 項送 reason', () {
      expect(cancelBody(0), {'reason': '按錯了'});
      expect(cancelBody(2), {'reason': '已自己辦好'});
    });
    test('「不說明原因」不送 reason', () => expect(cancelBody(3), isEmpty));
  });

  group('文件狀態', () {
    test('托管：待確認寫顧問核對中', () => expect(attachmentText('待確認', false), '顧問核對中'));
    test('自管：待確認寫我們核對中', () => expect(attachmentText('待確認', true), '我們核對中'));
    test('需重交', () => expect(attachmentText('需重交', false), '需要重交'));
    test('不認得的狀態：空白', () => expect(attachmentText('怪狀態', true), ''));
  });
}
