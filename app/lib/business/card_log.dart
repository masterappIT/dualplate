// 拍卡試用版的記錄（階段 5b）：只在打包時加 --dart-define=CARD_LOG=true 才寫，正式版不寫。
// 正式版打包的 print 不會傳到 Mac（2d 的教訓），所以寫到 App 自己的文件夾 card-log.txt，
// 測試後用 `xcrun devicectl device copy from` 取回。最後一次截出的卡面另存 card-<side>.jpg，方便和現有 App 比較。
import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';

const cardLogOn = bool.fromEnvironment('CARD_LOG');

/// 拍卡用的解像度（階段 5b 在真機比較後定案）：ultraHigh = 4K 3840×2160，veryHigh = 1080p。
/// 原本用 max，14 Pro Max 每張預覽畫面太大，找邊跟不上。
const cardPreset = String.fromEnvironment('CARD_PRESET', defaultValue: 'ultraHigh');

final _started = DateTime.now();
Future<IOSink?>? _sink;

Future<IOSink?> _open() async {
  try {
    final dir = await getApplicationDocumentsDirectory();
    final sink = File('${dir.path}/card-log.txt').openWrite(mode: FileMode.append);
    sink.writeln('---- ${DateTime.now().toIso8601String()} preset=$cardPreset');
    return sink;
  } catch (_) {
    return null;
  }
}

/// 寫一行記錄（前面是 App 打開後的毫秒數）；沒開記錄時不做事
void cardLog(String line) {
  if (!cardLogOn) return;
  final ms = DateTime.now().difference(_started).inMilliseconds;
  (_sink ??= _open()).then((s) => s?.writeln('$ms $line'));
}

/// 另存截出的卡面（data URL 的 JPEG）；沒開記錄時不做事
Future<void> cardLogImage(String side, String dataUrl) async {
  if (!cardLogOn) return;
  try {
    final comma = dataUrl.indexOf(',');
    final dir = await getApplicationDocumentsDirectory();
    await File('${dir.path}/card-$side.jpg').writeAsBytes(base64Decode(dataUrl.substring(comma + 1)));
  } catch (_) {}
}
