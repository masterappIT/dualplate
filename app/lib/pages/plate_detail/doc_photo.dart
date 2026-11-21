// 選相片和壓縮：對應 mobile/src/lib/pick-image.js 的 pickImage（相機和相冊兩個來源）、lib/api.js 的 cardPhoto() 和 pickPhotos()。
// 用在牌照詳情的車輛證件（pickOne）、自行辦理更新的證明相片（addPhoto）、辦理進度的上傳文件（pickPhotos）。
//
// 現有 App（iOS）：uni.chooseImage 的 sourceType 有相機和相冊時，先彈 iOS 系統的動作表「拍攝／從相冊選擇／取消」（2026-11-21 截圖核實），
// 選了才打開系統相機或相冊；取消時頁面甚麼都不做。這裏用 CupertinoActionSheet 畫同一款系統動作表（計劃第二節：系統畫的部分照系統樣子）。
// 安卓的現有 App 是 plus.nativeUI.actionSheet（安卓原生樣子），階段 3e 在安卓模擬器統一核對。
// 相機、相冊權限和安卓用途說明經 business/pick_image.dart 的 pickPhoto（階段 2a）。
//
// cardPhoto（App 端）：uni.compressImage 把相片壓成 JPEG，長邊超過 2000 才縮到 2000，品質 80→60→40，到 800 KB 內為止；回傳 data URL。
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/cupertino.dart'
    show
        CupertinoActionSheet,
        CupertinoActionSheetAction,
        CupertinoColors,
        CupertinoTheme,
        CupertinoThemeData,
        showCupertinoModalPopup;
import 'package:flutter/foundation.dart' show compute;
import 'package:flutter/widgets.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

import '../../business/pick_image.dart';

const cardEdge = 2000, cardTarget = 800000;

class PhotoError implements Exception {
  PhotoError(this.message);
  final String message;
  @override
  String toString() => message;
}

// 壓好的相片：data 是上傳用的 data URL，bytes 是預覽用的 JPEG
typedef CardPhoto = ({String data, Uint8List bytes});

// data URL 的大約位元組數（api.js dataBytes）
int dataBytes(String dataUrl) =>
    ((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4).floor();

// 壓縮（純計算，在背景 isolate 跑）：長邊超過 2000 才縮，品質 80、60、40 逐級，到 800 KB 內為止（最後一級照用）
Uint8List compressCardPhoto(Uint8List source) {
  final decoded = img.decodeImage(source);
  if (decoded == null) throw PhotoError('這張照片無法讀取，請重新拍攝');
  var image = img.bakeOrientation(decoded);
  final longest = image.width > image.height ? image.width : image.height;
  if (longest > cardEdge) {
    image = image.width >= image.height
        ? img.copyResize(
            image,
            width: cardEdge,
            interpolation: img.Interpolation.average,
          )
        : img.copyResize(
            image,
            height: cardEdge,
            interpolation: img.Interpolation.average,
          );
  }
  Uint8List out = Uint8List(0);
  for (final quality in const [80, 60, 40]) {
    out = img.encodeJpg(image, quality: quality);
    if (dataBytes('data:image/jpeg;base64,${base64Encode(out)}') <= cardTarget) {
      break;
    }
  }
  return out;
}

Future<CardPhoto> cardPhoto(XFile file) async {
  final Uint8List source;
  try {
    source = await file.readAsBytes();
  } catch (_) {
    throw PhotoError('這張照片無法讀取，請重新拍攝');
  }
  final Uint8List bytes;
  try {
    bytes = await compute(compressCardPhoto, source);
  } on PhotoError {
    rethrow;
  } catch (_) {
    throw PhotoError('照片壓縮失敗，請重新拍攝');
  }
  return (data: 'data:image/jpeg;base64,${base64Encode(bytes)}', bytes: bytes);
}

// 系統動作表「拍攝／從相冊選擇／取消」；取消（包括點表外）回傳 null。測試可用 debugChooseSource 替換
Future<PhotoSource?> Function(BuildContext context)? debugChooseSource;

Future<PhotoSource?> chooseSource(BuildContext context) {
  if (debugChooseSource != null) return debugChooseSource!(context);
  return showCupertinoModalPopup<PhotoSource>(
    context: context,
    // 系統動作表的字是 iOS 系統藍（不跟 App 的 Material 主題色）
    builder: (context) => CupertinoTheme(
      data: const CupertinoThemeData(primaryColor: CupertinoColors.systemBlue),
      child: CupertinoActionSheet(
        actions: [
          CupertinoActionSheetAction(
            onPressed: () => Navigator.of(context).pop(PhotoSource.camera),
            child: const Text('拍攝'),
          ),
          CupertinoActionSheetAction(
            onPressed: () => Navigator.of(context).pop(PhotoSource.album),
            child: const Text('從相冊選擇'),
          ),
        ],
        cancelButton: CupertinoActionSheetAction(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取消'),
        ),
      ),
    ),
  );
}

// 選一張相片（相機或相冊，原圖）；取消回傳 null
Future<XFile?> pickOnePhoto(BuildContext context) async {
  final source = await chooseSource(context);
  if (source == null || !context.mounted) return null;
  return pickPhoto(context, source);
}

typedef DocPhotoPicker = Future<String?> Function(BuildContext context);

// 測試可用 debugPickDocPhoto 替換整個流程
DocPhotoPicker? debugPickDocPhoto;

// 車輛證件相片（牌照詳情 pickOne + cardPhoto）：回傳壓好的 data URL；取消回傳 null（頁面不提示）。
// 壓縮失敗拋出 PhotoError，頁面照 uploadDoc 的 catch 提示訊息。
Future<String?> pickDocPhoto(BuildContext context) async {
  if (debugPickDocPhoto != null) return debugPickDocPhoto!(context);
  final file = await pickOnePhoto(context);
  if (file == null) return null;
  return (await cardPhoto(file)).data;
}

// 上傳文件用的相片（api.js pickPhotos）：相機一張或相冊最多 6 張；回傳 [{ name, bytes, size }]，取消回傳空清單。
// 現有 App 的 sizeType 是 compressed（DCloud 自己壓縮）；這裏用 image_picker 的品質 80 近似，未和現有 App 逐張比較檔案大小。
typedef PickedFile = ({String name, Uint8List bytes, int size});

Future<List<PickedFile>> Function(BuildContext context)? debugPickPhotos;

Future<List<PickedFile>> pickPhotos(BuildContext context) async {
  if (debugPickPhotos != null) return debugPickPhotos!(context);
  final source = await chooseSource(context);
  if (source == null || !context.mounted) return const [];
  final List<XFile> files;
  if (source == PhotoSource.camera) {
    final one = await pickPhoto(context, source);
    files = one == null ? const [] : [one];
  } else {
    if (!await askPermission(context, source)) {
      if (context.mounted) notifyDenied(context, source);
      return const [];
    }
    try {
      files = await ImagePicker().pickMultiImage(
        limit: 6,
        imageQuality: 80,
        requestFullMetadata: false,
      );
    } catch (_) {
      throw PhotoError('未能選擇相片');
    }
  }
  final out = <PickedFile>[];
  for (final (i, f) in files.indexed) {
    final bytes = await f.readAsBytes();
    out.add((name: '相片${i + 1}.jpg', bytes: bytes, size: bytes.length));
  }
  return out;
}
