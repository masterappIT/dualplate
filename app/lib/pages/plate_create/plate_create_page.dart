// 新增牌照：一比一移植 mobile/src/pages/plate-create/plate-create.vue（App 端）。
// 一打開就顯示空白模擬批文卡，拍照辨識後即時填入（管理者 2026-10-18）；先開對準框，只取框內卡面辨識和保存。
// 自管客戶自己建檔（建立牌照）；托管客戶提交給顧問核對。
// 錄入到一半離開（返回箭頭、Android 返回鍵）：已拍相片或填過資料時先問是否放棄。
// 網址：/plate-create。計算在 plate_create_logic.dart。
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/approval_card.dart';
import '../../business/card_capture.dart';
import '../../business/card_log.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/dialogs.dart';
import '../../ui/keyboard_bar.dart';
import '../../ui/image_preview.dart';
import '../../ui/loading.dart';
import '../../ui/pickers.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/plate_detail_logic.dart' show at, fieldStatusFailed, fieldStatusText, listOf;
import '../plate_detail/plate_detail_widgets.dart';
import 'plate_create_logic.dart';

typedef CardCaptureFn = Future<String?> Function(BuildContext context, {required String side});

class PlateCreatePage extends StatefulWidget {
  const PlateCreatePage({super.key, this.query = const {}});
  final Map<String, String> query;

  // 拍卡：經階段 2 的共用接口；測試可替換
  static CardCaptureFn capture = openCardCapture;

  @override
  State<PlateCreatePage> createState() => PlateCreatePageState();
}

class PlateCreatePageState extends State<PlateCreatePage> {
  // 自管客戶自己建檔，不經顧問核對（打開時決定）
  final bool selfManaged = isSelfManaged();
  String route = '粵港', groupId = '';
  Map<String, Object?> draft = {}, fieldStatus = {};
  Map<String, String> images = {};
  Map<String, Uint8List> previews = {};
  bool busy = false, showFields = false, leaving = false;
  // 模擬批文卡顯示哪一面：拍哪一面就翻到哪一面，辨識結果填進去時看得到（管理者 2026-11-23：拍背面時畫面停在正面，
  // 背面辨識完不知道）；用戶自己點卡面或正面／背面鈕翻轉時跟着記下
  bool cardBack = false;
  Object? link = const {'groupId': null, 'groupName': '', 'companies': [], 'groups': []};
  final ctl = {for (final (key, _) in cardFields) key: TextEditingController()};
  Timer? linkTimer;
  String _linkKey = '';

  @override
  void initState() {
    super.initState();
    watchLink();
  }

  @override
  void dispose() {
    linkTimer?.cancel();
    for (final c in ctl.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
    watchLink();
  }

  void toast(String text) {
    hideLoading();
    if (mounted) showToast(context, text);
  }

  // watch([route, draft.company, draft.contractor], immediate)：停手 400 毫秒才找名下公司；出錯不提示
  void watchLink() {
    final key = '$route|${draft['company'] ?? ''}|${draft['contractor'] ?? ''}';
    if (key == _linkKey) return;
    _linkKey = key;
    linkTimer?.cancel();
    linkTimer = Timer(const Duration(milliseconds: 400), () async {
      try {
        final r = await api('/my/plate-companies?route=${Uri.encodeComponent(route)}&company=${Uri.encodeComponent(jsString(draft['company'] ?? ''))}&contractor=${Uri.encodeComponent(jsString(draft['contractor'] ?? ''))}');
        if (mounted) setState(() => link = r);
      } catch (_) {}
    });
  }

  void edit(String key, String value) => _set(() => draft = {...draft, key: value});

  bool get dirty => isDirty(images, draft);

  void onBack() {
    // onBackPress：先關本頁打開中的彈窗（closeTopLayer），彈窗區自己處理
    if (DialogArea.hasOpen(context)) return;
    // 等這一次返回的各個 PopEntry 都處理完才開確認框（否則彈窗區會把剛開、未畫好的確認框當作要關的彈窗）
    scheduleMicrotask(_askLeave);
  }

  Future<void> _askLeave() async {
    if (!mounted) return;
    final r = await ask(context, title: '放棄這次錄入？', msg: '已拍的相片和填寫的資料不會保存。', ok: '放棄', cancel: '繼續錄入');
    if (r == 'confirm' && mounted) {
      setState(() => leaving = true);
      Navigator.of(context).pop();
    }
  }

  // 先開對準框，只取框內卡面辨識和保存；伺服器找好卡邊後傳回卡面，建立牌照時存的就是這張
  Future<void> pickCard(String side) async {
    if (busy) return;
    final photo = await PlateCreatePage.capture(context, side: side);
    if (photo == null || !mounted) return;
    _set(() {
      busy = true;
      cardBack = side == 'back';
    });
    showLoading(context, side == 'back' ? '正在辨識背面…' : '正在辨識正面…');
    final clock = Stopwatch()..start();
    try {
      _set(() {
        images = {...images, side: photo};
        previews = {...previews, side: _bytes(photo)};
      });
      final recognized = await api('/card-recognize', 'POST', {'side': side, 'image': photo});
      cardLog('recognize create $side ${clock.elapsedMilliseconds}ms upload=${photo.length ~/ 1024}KB fields=${((at(recognized, 'fieldStatus') as Map?) ?? const {}).length}');
      final image = at(recognized, 'image');
      if (truthy(image)) {
        _set(() {
          images = {...images, side: jsString(image)};
          previews = {...previews, side: _bytes(jsString(image))};
        });
      }
      final next = mergeRecognized(draft, at(recognized, 'cardData'));
      for (final (key, _) in cardFields) {
        final v = next[key];
        if (v != draft[key]) ctl[key]!.text = v == null ? '' : jsString(v);
      }
      _set(() {
        draft = next;
        final status = at(recognized, 'fieldStatus');
        fieldStatus = {...fieldStatus, if (status is Map) ...status.map((k, v) => MapEntry('$k', v))};
      });
      toast(side == 'back' ? '已辨識背面，請核對資料' : '已辨識正面，請確認編號');
    } catch (e) {
      cardLog('recognize create $side failed ${clock.elapsedMilliseconds}ms $e');
      toast(e is ApiError && e.message.isNotEmpty ? e.message : '上傳失敗');
    } finally {
      _set(() => busy = false);
    }
  }

  Uint8List _bytes(String dataUrl) {
    try {
      return base64Decode(dataUrl.substring(dataUrl.indexOf(',') + 1));
    } catch (_) {
      return Uint8List(0);
    }
  }

  // 建檔時問一次新批文備案：只在這一期已逾期時問；說已辦好就記為已辦。牌照已建好，這一步出錯也照樣打開牌照頁
  Future<void> askFiling(Object? plateId) async {
    try {
      final item = overdueFiling(await api('/my/plates/$plateId'));
      if (item == null || !mounted) return;
      final pick = await choose(context, '這張批文卡的新批文備案已辦好了嗎？', [
        ChoiceItem('已辦好', selfManaged ? '這一期不再提醒' : '這一期不再提醒，顧問會再核對'),
        const ChoiceItem('未辦', '照常提醒，請盡快辦理'),
        const ChoiceItem('不清楚', '照常提醒'),
      ]);
      if (pick != 0) return;
      await api('/my/plates/$plateId/self-handled', 'POST', {'kind': 'filing_done', 'period': at(item, 'period'), 'confirmedAtCreation': true});
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    }
  }

  Future<void> create() async {
    if (busy) return;
    final problem = createProblem(draft, images);
    if (problem.isNotEmpty) return toast(problem);
    final user = getUser();
    if (!truthy(user?['customerId'])) {
      unawaited(context.push('/login'));
      return;
    }
    _set(() => busy = true);
    try {
      final cardNumber = jsString(draft['cardNumber']).trim();
      final plate = await api('/plate-assets', 'POST', {
        'customerId': user!['customerId'],
        'route': route,
        'cardData': {...draft, 'cardNumber': cardNumber},
        'cardImages': images,
        'groupId': groupId,
      });
      await askFiling(at(plate, 'id'));
      if (!mounted) return;
      setState(() => leaving = true);
      context.pushReplacement('/plate-detail?id=${Uri.encodeComponent(jsString(at(plate, 'id')))}');
    } catch (e) {
      toast(e is ApiError && e.message.isNotEmpty ? e.message : '建檔失敗');
    } finally {
      _set(() => busy = false);
    }
  }

  Future<void> viewPhotos(String side) async {
    final p = photoSides(previews, side);
    if (p.sides.isEmpty) return;
    await previewImages(context, [for (final s in p.sides) previews[s]!], current: p.current);
  }

  Future<void> pickGroup() async {
    final options = groupOptions(link);
    final i = await showSelectorPicker(context, options.map((o) => o.label).toList());
    if (i != null && i < options.length) _set(() => groupId = options[i].id);
  }

  @override
  Widget build(BuildContext context) {
    final hasPhoto = images['front'] != null || images['back'] != null;
    final blocks = <Blk>[
      Blk(Text(introText(selfManaged), style: ts(Fs.body, color: C.ink2, height: 1.6)), bottom: 16),
      Blk(Segmented<String>(options: const [('粵港', '粵港兩地牌'), ('粵澳', '粵澳兩地牌')], value: route, onChanged: (r) => _set(() => route = r)), bottom: 12),
      Blk(CardBox(margin: EdgeInsets.zero, child: Blocks(_previewBlocks(hasPhoto))), bottom: 12),
      if (hasPhoto || showFields) Blk(CardBox(margin: EdgeInsets.zero, child: Blocks(_fieldBlocks())), bottom: 12),
      Blk(DBtn(createText(busy, selfManaged), enabled: !busy, onTap: create), top: 4),
      Blk(GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => context.push('/requests?service=new_application'),
        child: Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Text('還沒有批文卡、要申請新牌？前往申請辦理 ›', textAlign: TextAlign.center, style: ts(Fs.body, weight: w700, color: C.jade))),
      )),
    ];
    return PopScope(
      canPop: leaving || !dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) onBack();
      },
      child: AppPage(
      title: '新增牌照',
      // iOS 鍵盤上方的「⌃ ⌄ 完成」列（現有 App 的 WKWebView 自帶），和牌照詳情頁同一做法
      child: KeyboardBarArea(
        child: Builder(builder: (context) {
          final inset = MediaQuery.viewInsetsOf(context).bottom;
          return Padding(padding: EdgeInsets.only(bottom: inset), child: PageBody(children: [Blocks(blocks)]));
        }),
      ),
    ),
    );
  }

  Blk _stepTitle(String text) => Blk(Text(text, style: ts(Fs.h, weight: w800, color: C.jadeDeep)), bottom: 4);

  Blk _more(String text, VoidCallback onTap) => Blk(GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Padding(padding: const EdgeInsets.only(top: 12), child: Text(text, style: ts(Fs.body, weight: w700, color: C.jade))),
      ));

  List<Blk> _previewBlocks(bool hasPhoto) => [
        _stepTitle('第一步：拍下批文卡'),
        Blk(const Subtle('正面和背面各一張，光線充足、四角入鏡，辨識最準。')),
        Blk(ApprovalCard(data: draft, back: cardBack, onFlip: (back) => cardBack = back), top: 12),
        Blk(
          Row(children: [
            Expanded(child: DBtn(images['front'] != null ? '✓ 已拍正面' : '拍正面', kind: BtnKind.small, enabled: !busy, onTap: () => pickCard('front'))),
            const SizedBox(width: 8),
            Expanded(child: DBtn(images['back'] != null ? '✓ 已拍背面' : '拍背面', kind: BtnKind.small, enabled: !busy, onTap: () => pickCard('back'))),
          ]),
          top: 12,
        ),
        if (busy)
          Blk(const Subtle('正在壓縮和辨識照片，請稍候…'), top: 8)
        else if (hasPhoto)
          _more('查看已拍的照片 ›', () => viewPhotos(images['front'] != null ? 'front' : 'back')),
        if (!hasPhoto && !showFields) _more('沒有照片？手動輸入 ›', () => _set(() => showFields = true)),
      ];

  Blk _label(String text, String key) => Blk(
        StatusLabel(text, status: fieldStatusText(fieldStatus[key]), failed: fieldStatusFailed(fieldStatus[key]), top: 0),
        top: 16,
      );

  List<Blk> _fieldBlocks() => [
        _stepTitle('第二步：確認辨識結果'),
        _label('批文卡編號（必填）', 'cardNumber'),
        Blk(Field(controller: ctl['cardNumber'], placeholder: '按批文卡正面「編號」填寫', onChanged: (v) => edit('cardNumber', v))),
        Blk(Subtle(fieldHint(selfManaged)), top: 8),
        Blk(Text('持牌公司', style: ts(Fs.body, weight: w700, color: C.ink2)), top: 16, bottom: 8),
        Blk(Text(holderText(link, groupId, selfManaged), style: ts(Fs.body, color: C.ink2, height: 1.6))),
        if (listOf(at(link, 'groups')).isNotEmpty) _more(groupLinkText(groupId), pickGroup),
        _more(showFields ? '收起全部欄位' : '查看或修改全部欄位 ›', () => _set(() => showFields = !showFields)),
        if (showFields)
          for (final (key, label) in cardFields.skip(1)) ...[
            _label(label, key),
            Blk(Field(controller: ctl[key], placeholder: '按批文卡填寫', onChanged: (v) => edit(key, v))),
          ],
      ];
}

