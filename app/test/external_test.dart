// 打開外部連結、選 PDF（lib/core/external.dart）：計劃第七節管理者決定（2026-11-22）。一個情況一個測試。
import 'dart:typed_data';
import 'package:dualplate/core/external.dart';
import 'package:flutter_test/flutter_test.dart';

PdfFile pdf(String name) => (name: name, bytes: Uint8List.fromList([1]), size: 1);

void main() {
  tearDown(() {
    debugLaunchUrl = null;
    debugPickPdfs = null;
  });

  group('打開外部連結', () {
    test('沒有網址開頭：不打開', () async {
      debugLaunchUrl = (_) async => fail('不應打開');
      expect(await launchExternal('wa.me/123'), false);
    });
    test('空白：不打開', () async {
      debugLaunchUrl = (_) async => fail('不應打開');
      expect(await launchExternal(''), false);
    });
    test('https：交給手機打開', () async {
      Uri? got;
      debugLaunchUrl = (uri) async {
        got = uri;
        return true;
      };
      expect([await launchExternal('https://wa.me/85366714829'), '$got'], [true, 'https://wa.me/85366714829']);
    });
    test('手機打不開：回傳 false', () async {
      debugLaunchUrl = (_) async => false;
      expect(await launchExternal('https://wa.me/1'), false);
    });
  });

  group('選 PDF', () {
    test('最多 3 份（和現有 App 的 count:3 一樣）', () async {
      debugPickPdfs = () async => [pdf('1.pdf'), pdf('2.pdf'), pdf('3.pdf'), pdf('4.pdf')];
      expect((await pickPdfs()).map((f) => f.name), ['1.pdf', '2.pdf', '3.pdf']);
    });
    test('取消：空清單', () async {
      debugPickPdfs = () async => [];
      expect(await pickPdfs(), isEmpty);
    });
  });
}
