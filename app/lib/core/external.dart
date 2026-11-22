// 和手機其他 App 打交道：打開外部連結（WhatsApp、微信客服）、選 PDF、用手機自帶的檢視器打開 PDF。
// 計劃第七節管理者決定（2026-11-22）：現有 App 這三樣都做不到（只複製連結、提示 JavaScript 錯誤原文、複製整串 data URL），Flutter 版做成真的可用。
// 測試時用 debug… 代替，不叫原生套件。
import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:url_launcher/url_launcher.dart';

typedef PdfFile = ({String name, Uint8List bytes, int size});

class FileError implements Exception {
  FileError(this.message);
  final String message;
  @override
  String toString() => message;
}

Future<bool> Function(Uri uri)? debugLaunchUrl;
Future<List<PdfFile>> Function()? debugPickPdfs;
Future<bool> Function(Uint8List bytes, String name)? debugOpenPdf;

// 用手機的瀏覽器或對應 App 打開（wa.me 連結會轉到 WhatsApp）；打不開回傳 false，由頁面改為複製連結
Future<bool> launchExternal(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasScheme) return false;
  if (debugLaunchUrl != null) return debugLaunchUrl!(uri);
  try {
    return await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}

// 選 PDF（api.js pickPdf：最多 3 份；沒有名字時叫「文件.pdf」；取消回傳空清單；出錯是「未能選擇文件」）
Future<List<PdfFile>> pickPdfs({int count = 3}) async {
  if (debugPickPdfs != null) return (await debugPickPdfs!()).take(count).toList();
  try {
    final files = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: const ['pdf']);
    final out = <PdfFile>[];
    for (final f in files.take(count)) {
      final bytes = await f.readAsBytes();
      out.add((name: f.name.isEmpty ? '文件.pdf' : f.name, bytes: bytes, size: bytes.length));
    }
    return out;
  } catch (_) {
    throw FileError('未能選擇文件');
  }
}

// 把 PDF 存到暫存資料夾，再用手機自帶的檢視器打開（iOS 是預覽，Android 由用戶選 App）；打不開回傳 false
Future<bool> openPdf(Uint8List bytes, {String name = '文件.pdf'}) async {
  if (debugOpenPdf != null) return debugOpenPdf!(bytes, name);
  try {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/$name');
    await file.writeAsBytes(bytes, flush: true);
    final r = await OpenFilex.open(file.path, type: 'application/pdf', uti: 'com.adobe.pdf');
    return r.type == ResultType.done;
  } catch (_) {
    return false;
  }
}
