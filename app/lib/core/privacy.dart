// 安卓第一次打開的條款同意框：對應 DCloud 的私隱同意框（android/ 的 AndroidManifest.xml DCLOUD_PRIVACY_PROMPT=template，
// 內容在 mobile/src/androidPrivacy.json；android/README.md「私隱同意框和權限」）。iOS 沒有這個框。
// 同意前不載入 App（不讀登入資料、不連網絡）；按「不同意」再問一次（second），再不同意就退出 App；返回鍵不起作用（backToExit:false）。
// 同意後記下 version，以後不再問；version 加 1 時要所有人重新同意。
// 文字照抄 androidPrivacy.json（test/privacy_test.dart 讀原檔逐字核對）。
import 'session.dart';

const privacyVersion = '1';
const _agreedKey = 'androidPrivacyAgreed';

// 一段文字；link 不是 null 時是連結（網站的服務條款、私隱聲明頁）
typedef PrivacySpan = ({String text, String? link});

class PrivacyPrompt {
  const PrivacyPrompt({required this.title, required this.message, required this.accept, required this.refuse});
  final String title, accept, refuse;
  // 每個元素是一行（<br/> 分行）
  final List<List<PrivacySpan>> message;
}

const _terms = 'https://dualplate.masterappinc.com/#/pages/terms/terms';
const _privacy = 'https://dualplate.masterappinc.com/#/pages/terms/terms?tab=privacy';

const privacyFirst = PrivacyPrompt(
  title: '服務條款及私隱聲明',
  message: [
    [
      (text: '歡迎使用跨境車牌管家。使用前請閱讀', link: null),
      (text: '《服務條款》', link: _terms),
      (text: '和', link: null),
      (text: '《私隱聲明》', link: _privacy),
      (text: '，了解我們收集甚麼資料、用途和你的權利。', link: null),
    ],
    [(text: '相機和相片只會在你選擇拍照或上傳相片時使用。', link: null)],
    [(text: '按「同意並繼續」，即表示你已閱讀並同意以上條款。', link: null)],
  ],
  accept: '同意並繼續',
  refuse: '不同意',
);

const privacySecond = PrivacyPrompt(
  title: '需要你的同意',
  message: [
    [
      (text: '不同意', link: null),
      (text: '《服務條款》', link: _terms),
      (text: '和', link: null),
      (text: '《私隱聲明》', link: _privacy),
      (text: '，就不能使用本 App。', link: null),
    ],
  ],
  accept: '同意並繼續',
  refuse: '退出 App',
);

// 還沒同意這一版就要問
bool privacyNeeded() => Session.readString(_agreedKey) != privacyVersion;

void privacyAgreed() => Session.writeString(_agreedKey, privacyVersion);

// 按鈕上的字：DCloud 的按鈕是安卓 Button，預設全部大寫（「退出 App」顯示成「退出 APP」，2026-11-22 在 Android 17 模擬器現有 App 截圖核實）
String buttonText(String text) => text.toUpperCase();
