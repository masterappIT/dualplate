// 登入頁和「忘記密碼？」卡用到的 svg 圖示：M 雲標誌、WhatsApp、微信。
// 不加 svg 套件：把 mobile/src/static/ 同名檔案的 path 照抄在下面（test/login_test.dart 會讀原檔核對，一字不差），用 Canvas 畫。
// 階段 3 有更多圖示時，再決定搬到 lib/ui/ 共用。
import 'dart:math' as math;
import 'package:flutter/widgets.dart';

class SvgIcon {
  const SvgIcon._(this.width, this.height, this.paths);
  final double width, height; // viewBox 的寬高（左上角都是 0 0）
  final List<(String, Color)> paths;
}

// <image mode="aspectFit">：保持比例放進框內置中；預設 scaleToFill 拉伸填滿
class SvgImage extends StatelessWidget {
  const SvgImage(this.icon, {super.key, required this.width, required this.height, this.fit = BoxFit.fill});
  final SvgIcon icon;
  final double width, height;
  final BoxFit fit;
  @override
  Widget build(BuildContext context) => SizedBox(width: width, height: height, child: CustomPaint(painter: _SvgPainter(icon, fit)));
}

class _SvgPainter extends CustomPainter {
  _SvgPainter(this.icon, this.fit);
  final SvgIcon icon;
  final BoxFit fit;
  static final _cache = <String, Path>{};
  @override
  void paint(Canvas canvas, Size size) {
    var sx = size.width / icon.width, sy = size.height / icon.height;
    if (fit == BoxFit.contain) sx = sy = math.min(sx, sy);
    canvas
      ..save()
      ..translate((size.width - icon.width * sx) / 2, (size.height - icon.height * sy) / 2)
      ..scale(sx, sy);
    for (final (d, color) in icon.paths) {
      canvas.drawPath(_cache.putIfAbsent(d, () => parseSvgPath(d)), Paint()..color = color..isAntiAlias = true);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_SvgPainter old) => old.icon != icon || old.fit != fit;
}

// SVG path 的 d 屬性：支援 M L H V C S Q T A Z（大小寫），弧線的旗標可以不加空格（例如「a9.87 9.87 0 01-5.031-1.378」）
Path parseSvgPath(String d) {
  final path = Path();
  var i = 0;
  void skip() {
    while (i < d.length && (d[i] == ' ' || d[i] == ',' || d[i] == '\n' || d[i] == '\t' || d[i] == '\r')) {
      i++;
    }
  }

  bool atNumber() {
    skip();
    return i < d.length && RegExp(r'[-+.\d]').hasMatch(d[i]);
  }

  double number() {
    skip();
    final m = RegExp(r'[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?').matchAsPrefix(d, i)!;
    i = m.end;
    return double.parse(m[0]!);
  }

  bool flag() {
    skip();
    return d[i++] == '1';
  }

  var x = 0.0, y = 0.0, sx = 0.0, sy = 0.0; // 目前位置、子路徑起點
  double? cx, cy, qx, qy; // 上一段曲線的控制點（S、T 用）
  var cmd = '';
  while (true) {
    skip();
    if (i >= d.length) break;
    if (RegExp(r'[A-Za-z]').hasMatch(d[i])) cmd = d[i++];
    final rel = cmd == cmd.toLowerCase();
    final ox = rel ? x : 0.0, oy = rel ? y : 0.0;
    switch (cmd.toUpperCase()) {
      case 'M':
        x = ox + number();
        y = oy + number();
        path.moveTo(x, y);
        sx = x;
        sy = y;
        cx = qx = null;
        cmd = rel ? 'l' : 'L'; // 後面再接的座標當作直線
      case 'L':
        x = ox + number();
        y = oy + number();
        path.lineTo(x, y);
        cx = qx = null;
      case 'H':
        x = ox + number();
        path.lineTo(x, y);
        cx = qx = null;
      case 'V':
        y = oy + number();
        path.lineTo(x, y);
        cx = qx = null;
      case 'C':
        final x1 = ox + number(), y1 = oy + number(), x2 = ox + number(), y2 = oy + number();
        x = ox + number();
        y = oy + number();
        path.cubicTo(x1, y1, x2, y2, x, y);
        cx = x2;
        cy = y2;
        qx = null;
      case 'S':
        final x1 = cx == null ? x : 2 * x - cx, y1 = cy == null ? y : 2 * y - cy;
        final x2 = ox + number(), y2 = oy + number();
        x = ox + number();
        y = oy + number();
        path.cubicTo(x1, y1, x2, y2, x, y);
        cx = x2;
        cy = y2;
        qx = null;
      case 'Q':
        final x1 = ox + number(), y1 = oy + number();
        x = ox + number();
        y = oy + number();
        path.quadraticBezierTo(x1, y1, x, y);
        qx = x1;
        qy = y1;
        cx = null;
      case 'T':
        final x1 = qx == null ? x : 2 * x - qx, y1 = qy == null ? y : 2 * y - qy;
        x = ox + number();
        y = oy + number();
        path.quadraticBezierTo(x1, y1, x, y);
        qx = x1;
        qy = y1;
        cx = null;
      case 'A':
        final rx = number(), ry = number(), rotation = number(), large = flag(), sweep = flag();
        x = ox + number();
        y = oy + number();
        path.arcToPoint(Offset(x, y), radius: Radius.elliptical(rx, ry), rotation: rotation, largeArc: large, clockwise: sweep);
        cx = qx = null;
      case 'Z':
        path.close();
        x = sx;
        y = sy;
        cx = qx = null;
        if (!atNumber()) continue;
      default:
        throw FormatException('不支援的 path 指令 $cmd', d, i);
    }
  }
  return path;
}

// mobile/src/static/masterapp-mark.svg
const brandMark = SvgIcon._(50, 38, [
    (r'M33.9404 28.3711V29.5554L34.919 30.1218L35.949 29.5554V28.3711L34.919 27.8047L33.9404 28.3711Z', Color(0xFFFFFFFF)),
    (r'M30.1289 0C23.6396 0 17.9743 3.24391 14.5237 8.13551C6.43779 8.34147 0 14.9323 0 23.0678C0 31.3062 6.6953 38 14.9357 38C15.0387 38 15.1417 38 15.2447 38H29.9743C30.0258 38 30.0774 38 30.1289 38C30.1804 38 30.2319 38 30.2834 38H30.4379C40.7898 37.8455 49.1332 29.4011 49.1332 19C49.1332 8.49595 40.6353 0 30.1289 0ZM13.0816 27.8049L8.9614 26.5176L17.2533 12.3577L21.3735 13.645L13.0816 27.8049ZM16.2232 26.5176L24.5151 12.3577L28.6353 13.645L20.3434 27.8049L16.2232 26.5176ZM37.6482 30.5339L34.9186 32.0786L32.1889 30.5339V27.393L33.7855 26.4661V17.0949L27.5537 27.8049L23.4336 26.5176L31.7254 12.3577L35.8456 13.645H36.1031V26.5176L37.6997 27.4444V30.5339H37.6482Z', Color(0xFFFFFFFF)),
]);

// mobile/src/static/whatsapp.svg
const whatsappIcon = SvgIcon._(24, 24, [
    (r'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z', Color(0xFF25D366)),
]);

// mobile/src/static/wechat.svg
const wechatIcon = SvgIcon._(24, 24, [
    (r'M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z', Color(0xFF07C160)),
]);
