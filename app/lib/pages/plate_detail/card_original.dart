// 看上傳的批文卡正本、車輛證件原件：對應 lib/api.js 的 viewCardOriginal、forgetCardOriginal、viewVehicleDocument。
// 現有 App 用 uni.downloadFile 帶登入 token 下載，再交給系統圖片檢視器（uni.previewImage）；
// 同一次使用中看過的正本不重新下載，上傳新卡後用 forgetCardOriginal 清掉。下載失敗不會轉登入頁（不經 api()）。
import 'dart:typed_data';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import '../../core/api.dart';
import '../../core/session.dart';
import '../../ui/image_preview.dart';
import '../../ui/loading.dart';
import '../../ui/toast.dart';

final _originals = <String, Future<Uint8List>>{};

void forgetCardOriginal(Object? plateId) => _originals.removeWhere((key, _) => key.startsWith('$plateId:'));

// 只給測試用
void debugForgetAllOriginals() => _originals.clear();

class _LoadError implements Exception {
  _LoadError(this.message);
  final String message;
  @override
  String toString() => message;
}

Future<Uint8List> downloadPrivate(String path) async {
  final token = getToken();
  final request = http.Request('GET', Uri.parse('$apiBase/api$path'))..headers['authorization'] = (token ?? '').isNotEmpty ? 'Bearer $token' : '';
  final http.Response r;
  try {
    r = await http.Response.fromStream(await Api.client.send(request).timeout(Api.timeout)).timeout(Api.timeout);
  } catch (_) {
    throw _LoadError('圖片載入失敗，請檢查網絡後再試');
  }
  if (r.statusCode != 200) throw _LoadError('圖片載入失敗');
  return r.bodyBytes;
}

Future<void> viewCardOriginal(BuildContext context, Object? plateId, List<String> sides, String current) async {
  showLoading(context, '正在載入');
  try {
    final images = await Future.wait(sides.map((side) {
      final key = '$plateId:$side';
      return _originals[key] ??= downloadPrivate('/plate-assets/${Uri.encodeComponent('$plateId')}/image/card-$side').catchError((Object e) {
        _originals.remove(key);
        throw e;
      });
    }), eagerError: true);
    hideLoading();
    if (!context.mounted) return;
    final i = sides.indexOf(current);
    await previewImages(context, images, current: i < 0 ? 0 : i);
  } catch (e) {
    hideLoading();
    if (context.mounted) showToast(context, e is _LoadError ? e.message : '圖片載入失敗');
  }
}

Future<void> viewVehicleDocument(BuildContext context, Object? vehicleId, Object? kind) async {
  showLoading(context, '正在載入');
  try {
    final image = await downloadPrivate('/vehicles/${Uri.encodeComponent('$vehicleId')}/documents/${Uri.encodeComponent('$kind')}/image');
    hideLoading();
    if (context.mounted) await previewImages(context, [image]);
  } catch (e) {
    hideLoading();
    if (context.mounted) showToast(context, e is _LoadError ? e.message : '圖片載入失敗');
  }
}
