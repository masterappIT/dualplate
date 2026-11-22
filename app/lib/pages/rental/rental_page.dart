// 出租：一比一移植 mobile/src/pages/rental/rental.vue（App 端）。
// 網址：/rental?id=<出租 id>。客戶自己新增的出租：現在要做的事、換車換司機進度、租約資料、出租協議（可修改；出租人手寫簽名後發給承租人）、
// 雙方簽名、紙本簽署本、各期租金、取消。每次顯示都重新載入（onShow），正在修改的協議不會被蓋掉。計算在 rental_logic.dart。
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import '../../core/external.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../business/signature_pad.dart';
import '../../business/uni_textarea.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/dialogs.dart';
import '../../ui/image_preview.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../login/contact_card.dart' show copyText, openLink;
import '../plate_detail/doc_photo.dart' show pickPhotos, PhotoError;
import '../plate_detail/plate_detail_widgets.dart' show Blk, Blocks, DBtn;
import 'rental_logic.dart';

// 私人圖片（簽名、簽署本）：照 api.js privateImage，帶登入 token 下載；回傳內容類型和內容
typedef PrivateFile = ({String mime, Uint8List bytes});

class _ImageError implements Exception {
  _ImageError(this.message);
  final String message;
  @override
  String toString() => message;
}

Future<PrivateFile> privateFile(String path) async {
  final token = getToken();
  final request = http.Request('GET', Uri.parse('$apiBase/api$path'))..headers['authorization'] = (token ?? '').isNotEmpty ? 'Bearer $token' : '';
  final http.Response r;
  try {
    r = await http.Response.fromStream(await Api.client.send(request).timeout(Api.timeout)).timeout(Api.timeout);
  } catch (_) {
    throw _ImageError('圖片載入失敗，請檢查網絡後再試');
  }
  if (r.statusCode != 200) throw _ImageError('圖片載入失敗');
  return (mime: r.headers['content-type'] ?? 'image/png', bytes: r.bodyBytes);
}


class RentalPage extends StatefulWidget {
  const RentalPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<RentalPage> createState() => RentalPageState();
}

class RentalPageState extends State<RentalPage> with PageShow {
  late final String rentalId = widget.query['id'] ?? '';
  Map? r;
  bool busy = false;
  Map? link;
  Map<String, Uint8List?> signImages = {'lessor': null, 'renter': null};
  final draft = TextEditingController();
  SignatureController pad = SignatureController();

  @override
  String get showPath => '/rental';

  @override
  void onShow() => unawaited(load());

  @override
  void dispose() {
    draft.dispose();
    pad.dispose();
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  void toast(String text) {
    if (mounted) showToast(context, text);
  }

  String err(Object e) => e is ApiError ? e.message : '$e';
  Map get agreement => agreementOf(r);
  String get body => truthy(agreement['body']) ? jsString(agreement['body']) : '';
  bool get signNeeded => needSign(r, draft.text);
  String _s(Object? v) => truthy(v) ? jsString(v) : '';

  Future<void> load() async {
    if (getUser() == null) {
      unawaited(context.push('/login'));
      return;
    }
    try {
      final fresh = await api('/my/rentals/$rentalId') as Map;
      final keepDraft = r != null && draft.text != body;
      _set(() => r = fresh);
      if (!keepDraft) draft.text = _s(agreementOf(fresh)['body']);
      _set(() {});
      loadSigns();
    } catch (e) {
      toast(err(e));
    }
  }

  // 這一版的雙方簽名相片
  void loadSigns() {
    for (final (key, _) in signParties) {
      _set(() => signImages[key] = null);
      if (truthy(agreement['${key}Signed'])) {
        privateFile('/my/rentals/$rentalId/signature-$key').then((f) => _set(() => signImages[key] = f.bytes)).catchError((Object _) {});
      }
    }
  }

  Future<void> save() async {
    _set(() => busy = true);
    try {
      final fresh = await api('/my/rentals/$rentalId/agreement', 'PUT', {'body': draft.text}) as Map;
      _set(() => r = fresh);
      draft.text = body;
      toast('已儲存');
    } catch (e) {
      toast(err(e));
    } finally {
      _set(() => busy = false);
    }
  }

  // 要簽名時連同簽名相片發出；不用簽名（協議沒改、這一版已簽）就直接重發連結
  Future<void> send() async {
    if (!signNeeded) return deliver(null);
    if (pad.isEmpty) return toast('請先在框內簽名');
    try {
      unawaited(deliver(await pad.toDataURL()));
    } catch (e) {
      toast(e is StateError ? e.message : '$e');
    }
  }

  Future<void> deliver(String? signature) async {
    _set(() => busy = true);
    try {
      if (draft.text != body) await api('/my/rentals/$rentalId/agreement', 'PUT', {'body': draft.text});
      final result = await api('/my/rentals/$rentalId/send', 'POST', signature != null ? {'signature': signature} : <String, Object>{}) as Map;
      _set(() {
        link = result['link'] is Map ? result['link'] as Map : null;
        r = result;
      });
      draft.text = body;
      loadSigns();
    } catch (e) {
      toast(err(e));
    } finally {
      _set(() => busy = false);
    }
  }

  Future<void> uploadSigned(String kind) async {
    try {
      final List<({String name, Uint8List bytes, int size})> files;
      if (kind == 'pdf') {
        // 現有 App 沒有 uni.chooseFile，提示 JavaScript 的錯誤原文；Flutter 版真的選 PDF（計劃第七節決定 2026-11-22）
        files = await pickPdfs();
      } else {
        files = await pickPhotos(context);
      }
      if (files.isEmpty) return;
      if (files[0].size > signedMaxBytes) return toast('檔案須小於 8 MB');
      _set(() => busy = true);
      final fresh = await api('/my/rentals/$rentalId/signed', 'POST', {'data': base64Encode(files[0].bytes)}) as Map;
      _set(() => r = fresh);
      toast('已上傳');
    } catch (e) {
      toast(e is PhotoError ? e.message : e is FileError ? e.message : err(e));
    } finally {
      _set(() => busy = false);
    }
  }

  Future<void> viewSigned() async {
    try {
      final f = await privateFile('/my/rentals/$rentalId/signed');
      if (!mounted) return;
      if (f.mime.startsWith('application/pdf')) {
        // 現有 App 只把整串 data URL 複製到剪貼簿；Flutter 版用手機自帶的檢視器打開（計劃第七節決定 2026-11-22）
        if (!await openPdf(f.bytes, name: '簽署本.pdf')) toast('未能打開 PDF');
      } else {
        await previewImages(context, [f.bytes]);
      }
    } catch (e) {
      toast(e is _ImageError ? e.message : '$e');
    }
  }

  Future<void> cancel() async {
    final ok = await ask(
      context,
      title: '取消這次出租？',
      msg: forMode('已發出的連結會作廢；已開的換車、換司機工單，顧問會聯絡你。', '已發出的連結會作廢；已開的換車、換司機工單，我們會聯絡你。'),
      ok: '取消出租',
      cancel: '不取消',
      danger: true,
    );
    if (ok != 'confirm') return;
    _set(() => busy = true);
    try {
      final fresh = await api('/my/rentals/$rentalId/cancel', 'POST', <String, Object>{}) as Map;
      _set(() {
        r = fresh;
        link = null;
      });
    } catch (e) {
      toast(err(e));
    } finally {
      _set(() => busy = false);
    }
  }

  // ── 小組件 ──
  Widget stepTitle(String text) => Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(text, style: ts(Fs.h, weight: w800, color: C.jadeDeep)));
  Widget lineTitle(String text) => Text(text, style: ts(Fs.h, weight: w700, height: 1.4));
  Widget lineSub(String text) => Text(text, style: ts(Fs.body, color: C.ink2, height: 1.5));
  Blk card(List<Widget> children, {bool warn = false}) =>
      Blk(CardBox(warn: warn, margin: EdgeInsets.zero, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children)), bottom: 12);
  // .actions：上距 12、兩個等寬小按鈕、間距 8
  Widget actions(List<Widget> buttons) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Row(children: [
          for (final (i, b) in buttons.indexed) ...[if (i > 0) const SizedBox(width: 8), Expanded(child: b)],
        ]),
      );
  // pill 單獨一行（inline-flex，靠左）
  Widget pillLine(String text, Tone tone, {double bottom = 0}) => Padding(padding: EdgeInsets.only(bottom: bottom), child: Align(alignment: Alignment.centerLeft, child: Pill(text, tone: tone)));

  Widget procedureRow(Map x, Map p, bool last) {
    Widget right;
    if (p['state'] == 'done') {
      right = const Pill('已辦妥');
    } else if (p['handler'] == 'us') {
      right = Pill(truthy(p['requestStatus']) ? jsString(p['requestStatus']) : '辦理中', tone: p['state'] == 'cancelled' ? Tone.gray : Tone.blue);
    } else {
      right = Btn('已辦好？更新', kind: BtnKind.small, onTap: () => context.push(reportDonePath(x, p)));
    }
    return Container(
      padding: EdgeInsets.only(top: 12, bottom: last ? 0 : 12),
      decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.rule))),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [lineTitle(jsString(p['name'])), lineSub(procedureSub(p))])),
        const SizedBox(width: 12),
        right,
      ]),
    );
  }

  Widget agreementCard(Map x) {
    final a = agreement;
    final canSend = truthy(x['canSend']);
    final showPad = canSend && signNeeded;
    final children = <Widget>[
      if (truthy(a['confirmed']))
        pillLine('${jsString(a['confirmedBy'])} 已於 ${when(a['confirmedAt'])} 確認', Tone.green, bottom: 8)
      else if (truthy(a['version']))
        pillLine('等承租人確認', Tone.amber, bottom: 8),
    ];
    if (x['handling'] != 'self') {
      children.add(lineSub('這次出租已交給我們代理，協議由${forMode('顧問', '我們')}處理。'));
    } else {
      children.add(Subtle('已按你填的資料寫好，可以按實際情況修改。${truthy(a['version']) ? '發出後再改，要重新發出，承租人要重新確認。' : ''}'));
      children.add(Padding(
        padding: const EdgeInsets.only(top: 12),
        child: UniTextArea(controller: draft, minHeight: RentalStyle.agreementMinHeight, lineHeight: 1.6, maxLength: 20000, enabled: canSend, onChanged: (_) => _set(() {})),
      ));
      // 手寫簽名（管理者 2026-10-18）：每一版協議出租人先簽，才發給承租人；沒有改動只是重發連結，不用再簽
      if (showPad) {
        children.add(Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(padding: const EdgeInsets.only(bottom: 8), child: Text('出租人簽名', style: ts(Fs.body, weight: w700, color: C.ink2))),
            Subtle('出租人：${jsString(x['lessor'])}。請用手指或滑鼠在框內簽名，簽好後按「發給承租人」。'),
            SignaturePad(controller: pad),
          ]),
        ));
      }
      if (canSend) {
        children.add(actions([
          DBtn('儲存修改', kind: BtnKind.small, enabled: !(busy || draft.text == body), onTap: save),
          DBtn(signNeeded ? '發給承租人' : '重新發送連結', kind: BtnKind.small, solid: true, enabled: !busy, onTap: send),
        ]));
      }
      final l = link;
      if (l != null) {
        final url = jsString(l['url']);
        children.add(Container(
          margin: const EdgeInsets.only(top: 16),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: C.paper, borderRadius: BorderRadius.circular(R.card)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            lineSub('連結只顯示這一次，請現在傳給承租人。承租人打開時要輸入電話最後 4 位。'),
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(url, style: numStyle(ts(Fs.meta)))),
            actions([
              DBtn('複製連結', kind: BtnKind.small, onTap: () => copyText(context, url, '連結已複製')),
              DBtn('用 WhatsApp 傳送', kind: BtnKind.small, onTap: () => openLink(context, whatsappLink(x, url))),
            ]),
          ]),
        ));
      }
    }
    // 簽名框收起後（發出了、或不用再簽），下次出現時是新的空白框（v-if 重建組件）
    if (!showPad && pad.strokes.isNotEmpty) pad = SignatureController();
    return CardBox(margin: EdgeInsets.zero, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children));
  }

  Widget signsCard(Map x) => CardBox(
        margin: EdgeInsets.zero,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          stepTitle('第 ${jsString(agreement['version'])} 版的簽名'),
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: LayoutBuilder(builder: (context, box) {
              // .signs：換行排列、間距 16；每個 .sign flex:1、最少 140
              final perRow = ((box.maxWidth + 16) / (140 + 16)).floor().clamp(1, 2);
              final w = (box.maxWidth - 16 * (perRow - 1)) / perRow;
              return Wrap(spacing: 16, runSpacing: 16, children: [
                for (final (key, label) in signParties)
                  SizedBox(
                    width: w,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Subtle(label),
                      Container(
                        margin: const EdgeInsets.symmetric(vertical: 4),
                        constraints: const BoxConstraints(maxWidth: RentalStyle.signMaxWidth),
                        height: signImages[key] == null ? RentalStyle.signBlankHeight : null,
                        alignment: Alignment.centerLeft,
                        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: C.ink3))),
                        child: signImages[key] == null ? null : Image.memory(signImages[key]!, width: double.infinity, fit: BoxFit.fitWidth),
                      ),
                      Subtle(signedLine(x, key)),
                    ]),
                  ),
              ]);
            }),
          ),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final x = r;
    final blocks = <Blk>[];
    if (x != null) {
      final renter = x['renter'] is Map ? x['renter'] as Map : const {};
      final next = nextStep(x, selfManaged: isSelfManaged());
      final procedures = proceduresOf(x);
      final invoices = (x['invoices'] is List ? x['invoices'] as List : const []).whereType<Map>().toList();
      final a = agreement;
      blocks.addAll([
        Blk(
          Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Padding(padding: const EdgeInsets.only(bottom: 4), child: Text(jsString(renter['name']), style: ts(Fs.title, weight: w800, height: 1.3, color: C.jadeDeep)))),
              const SizedBox(width: 12),
              Pill(jsString(x['statusWord']), tone: toneOf(rentalTone(x))),
            ]),
            Subtle('${jsString(x['plateLabel'])} · ${jsString(x['startsOn'])} 起${truthy(x['endsOn']) ? ' 至 ${jsString(x['endsOn'])}' : ''}'),
          ]),
          bottom: 16,
        ),
        // 下一步：只寫一件事
        card(warn: waitingOnYou(x), [
          Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('現在', style: ts(Fs.meta, weight: w700, color: C.ink3))),
          lineTitle(next.title),
          lineSub(next.sub),
        ]),
        if (procedures.isNotEmpty)
          card([
            stepTitle('換車、換司機'),
            for (final (i, p) in procedures.indexed) procedureRow(x, p, i == procedures.length - 1),
          ]),
        card([
          Kv([
            ('出租人', Text(jsString(x['lessor']))),
            ('承租人電話', Text(jsString(renter['phone']), style: numStyle(ts(Fs.body)))),
            ('使用車輛', Text(jsString(renter['vehiclePlate']))),
            ('司機', Text(jsString(renter['driver']))),
            ('租金', Text('${money(x['currency'], x['rentAmount'])} / ${cycleWord(x['cycle'])}，每期 ${jsString(x['dueDay'])} 日前', style: numStyle(ts(Fs.body)))),
            ('押金', Text(truthy(x['depositAmount']) ? money(x['currency'], x['depositAmount']) : '沒有', style: numStyle(ts(Fs.body)))),
            ('租金怎樣付', Text(x['collectionMode'] == '代收' ? '由我們代收' : '直接付給你')),
          ]),
        ]),
        Blk(SectionRow(title: '出租協議', trailing: truthy(a['version']) ? Subtle('已發出第 ${jsString(a['version'])} 版') : null), top: 28, bottom: 12),
        Blk(agreementCard(x), bottom: 12),
        if (truthy(a['version'])) Blk(signsCard(x), bottom: 12),
        card([
          stepTitle('另外簽了紙本？'),
          const Subtle('雙方已在網上簽名，不用紙本。另外簽了紙本的，可以拍照或上傳 PDF 保存。'),
          actions([
            DBtn(truthy(x['signed']) ? '重新拍照' : '拍照上傳', kind: BtnKind.small, enabled: !busy, onTap: () => uploadSigned('photo')),
            DBtn('上傳 PDF', kind: BtnKind.small, enabled: !busy, onTap: () => uploadSigned('pdf')),
          ]),
          if (truthy(x['signed'])) Padding(padding: const EdgeInsets.only(top: 12), child: Align(alignment: Alignment.centerLeft, child: LinkText('已上傳，查看 ›', onTap: viewSigned))),
        ]),
        if (invoices.isNotEmpty)
          card([
            stepTitle('各期租金'),
            for (final i in invoices)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Text(jsString(i['period']), style: numStyle(ts(Fs.body, color: C.ink2))),
                  const SizedBox(width: 12),
                  Pill(rentalFeeLabel(x, i), tone: toneOf(rentalFeeTone[i['status']] ?? '')),
                ]),
              ),
          ]),
        if (truthy(x['canCancel'])) Blk(Btn('取消這次出租', kind: BtnKind.line, expand: true, onTap: cancel), top: 8),
      ]);
    }
    return AppPage(
      title: '出租',
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(children: [Blocks(blocks)]));
        }),
      ),
    );
  }
}
