// 辦理進度：一比一移植 mobile/src/pages/request-detail/request-detail.vue（App 端）。
// 網址：/request-detail?id=<工單 id>。資料到之前整頁空白（v-if="item"）。onLoad 載入；onShow 已有資料時再載入（從子頁返回、App 回到前景）。
// 計算在 request_detail_logic.dart；選相片在 plate_detail/doc_photo.dart。
import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import '../../business/num_text.dart';
import '../../business/page_show.dart';
import '../../business/plate_chip.dart';
import '../../core/api.dart';
import '../../core/js.dart';
import '../../core/session.dart';
import '../../core/wording.dart';
import '../../shell/nav_bar.dart';
import '../../ui/base.dart';
import '../../ui/dialogs.dart';
import '../../ui/loading.dart';
import '../../ui/toast.dart';
import '../../ui/tokens.dart';
import '../plate_detail/doc_photo.dart';
import '../plate_detail/plate_detail_logic.dart' show at, listOf, str;
import '../plate_detail/plate_detail_widgets.dart';
import 'request_detail_logic.dart';

class RequestDetailPage extends StatefulWidget {
  const RequestDetailPage({super.key, this.query = const {}});
  final Map<String, String> query;
  @override
  State<RequestDetailPage> createState() => RequestDetailPageState();
}

class RequestDetailPageState extends State<RequestDetailPage> with PageShow {
  late final String requestId = widget.query['id'] ?? '';
  final bool selfManaged = isSelfManaged();
  Map<String, dynamic>? item;
  List<dynamic> sources = [], files = [];
  bool uploading = false, showDetail = false;
  bool _loadedOnce = false;

  @override
  String get showPath => '/request-detail';
  // onLoad 載入一次；之後的 onShow 已有資料才再載入
  @override
  void onShow() {
    if (!_loadedOnce || item != null) load();
    _loadedOnce = true;
  }

  void _set(VoidCallback fn) {
    if (mounted) setState(fn);
  }

  void toast(String text) {
    if (mounted) showToast(context, text);
  }

  String a(String text) => adv(text, selfManaged);

  Future<void> load() async {
    if (requestId.isEmpty) return;
    try {
      final r = await Future.wait([api('/requests/$requestId'), api('/catalog')], eagerError: true);
      _set(() {
        item = Map<String, dynamic>.from(r[0] as Map);
        sources = listOf(at(r[1], 'sources'));
      });
      unawaited(loadFiles());
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    }
  }

  Future<void> loadFiles() async {
    try {
      final list = listOf(await api('/my/requests/$requestId/attachments'));
      _set(() => files = list);
    } catch (_) {
      _set(() => files = []);
    }
  }

  // 子頁：返回時由 PageShow 重新載入（onShow，已有資料才載入）
  void go(String path) => context.push(path);

  void openSource(Object? url) {
    Clipboard.setData(ClipboardData(text: jsString(url))).then((_) => toast('官方連結已複製'));
  }

  // 拍照／相簿或 PDF；逐份上傳，任何一份失敗都告訴客戶是哪一份
  Future<void> chooseUpload(Object? taskId) async {
    final tapIndex = await choose(context, '上傳甚麼文件？', const ['拍照或選相片', '選擇 PDF 文件'], cancel: '返回');
    if (tapIndex < 0 || !mounted) return;
    List<PickedFile> picked;
    try {
      if (tapIndex != 0) throw PhotoError(pdfErrorText);
      picked = await pickPhotos(context);
    } catch (e) {
      return toast('$e');
    }
    if (picked.isEmpty || !mounted) return;
    _set(() => uploading = true);
    var ok = 0;
    final failed = <String>[];
    for (final (index, file) in picked.indexed) {
      if (mounted) showLoading(context, '上傳中 ${index + 1}/${picked.length}');
      try {
        if (file.size > maxUpload) throw PhotoError('${file.name} 超過 5 MB');
        await api('/my/requests/${Uri.encodeComponent(requestId)}/attachments', 'POST', {'fileName': file.name, 'data': base64Encode(file.bytes), 'taskId': taskId});
        ok++;
      } catch (e) {
        failed.add('${file.name}：${e is ApiError ? e.message : '$e'}');
      }
    }
    await hideLoading();
    _set(() => uploading = false);
    if (!mounted) return;
    if (failed.isNotEmpty) {
      unawaited(notice(context, title: uploadedTitle(ok, failed.length), msg: failed.join('\n')));
    } else {
      // uni.showToast icon:'success'：App 端同樣是原生等待框（圖示由 DCloud 畫），這裏只顯示文字（未和現有 App 對照）
      toast('已上傳 $ok 份');
    }
    unawaited(loadFiles());
  }

  // 原因選填：先選原因（可不說明），再確認；取消後我們不再跟進，之後需要可重新提交
  Future<void> cancelRequest() async {
    final pick = await choose(context, '為甚麼要取消？（選填）', cancelReasons, cancel: '返回');
    if (pick < 0 || !mounted) return;
    if (await ask(context, title: '取消這個委託？', msg: '取消後我們不會再跟進；之後如有需要，可以重新提交。', ok: '取消委託', cancel: '返回', danger: true) != 'confirm') return;
    try {
      await api('/my/requests/$requestId/cancel', 'POST', cancelBody(pick));
      await load();
      toast('委託已取消');
    } catch (e) {
      toast(e is ApiError ? e.message : '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final i = item;
    return AppPage(title: '辦理進度', child: i == null ? null : PageBody(children: [Blocks(_blocks(i))]));
  }

  List<Blk> _blocks(Map i) {
    final waiting = waitingOf(i);
    final upload = canUpload(i);
    final plateAsset = at(i, 'plateAsset');
    final activities = listOf(i['activities']);
    final tasks = listOf(i['tasks']);
    final picked = selectedSources(sources, i);
    return [
      Blk(Text(str(i['title']), style: ts(Fs.title, weight: w800, height: 1.3, color: C.jadeDeep)), bottom: 4),
      Blk(
        Row(children: [
          if (truthy(at(plateAsset, 'mainland_plate'))) ...[PlateChip(plate: str(at(plateAsset, 'mainland_plate')), region: '內地', size: PlateChipSize.sm), const SizedBox(width: 8)],
          // .head-meta .link{margin-left:auto}：連結靠右
          if (truthy(plateAsset)) ...[
            Expanded(child: Subtle(headMeta(i))),
            const SizedBox(width: 8),
            LinkText('查看牌照 ›', onTap: () => go(platePath(at(plateAsset, 'id')))),
          ] else
            Flexible(child: Subtle(headMeta(i))),
        ]),
        bottom: 16,
      ),
      Blk(_progressCard(i, waiting), bottom: 12),
      if (waiting.isNotEmpty) Blk(_waitingCard(waiting, upload), bottom: 12),
      if (files.isNotEmpty || upload)
        Blk(
          Row(children: [
            Expanded(
              child: Text.rich(TextSpan(text: '已交文件', children: [TextSpan(text: ' · ${files.length}', style: numStyle(ts(Fs.h, weight: w800, height: 1.4, color: C.jadeDeep)))]),
                  style: ts(Fs.h, weight: w800, height: 1.4, color: C.jadeDeep)),
            ),
            if (upload && waiting.isEmpty) ...[const SizedBox(width: 12), LinkText('上傳文件 ›', onTap: () => chooseUpload(null))],
          ]),
          top: 28,
          bottom: 12,
        ),
      if (files.isNotEmpty)
        Blk(_filesCard(i), bottom: 12)
      else if (upload)
        Blk(CardBox(margin: EdgeInsets.zero, padding: EdgeInsets.zero, child: Empty(a('還沒有上傳文件。顧問收妥後會在這裏標示「已收妥」。'))), bottom: 12),
      Blk(const SectionTitle('更新紀錄', bare: true), top: 28, bottom: 12),
      Blk(_activitiesCard(activities), bottom: 12),
      Blk(
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => _set(() => showDetail = !showDetail),
          child: Padding(padding: const EdgeInsets.only(top: 16), child: Text(showDetail ? '收起辦理步驟' : '查看辦理步驟 ›', style: ts(Fs.body, weight: w700, color: C.jade))),
        ),
      ),
      if (showDetail) ...[
        Blk(SectionRowNum(title: '辦理步驟', trailing: '${tasks.length} 步'), top: 28, bottom: 12),
        Blk(_tasksCard(tasks), bottom: 12),
        if (picked.isNotEmpty) ...[
          Blk(const SectionTitle('官方依據', bare: true), top: 28, bottom: 12),
          Blk(_sourcesCard(picked), bottom: 12),
        ],
      ],
      if (truthy(i['canCancel']))
        Blk(GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: cancelRequest,
          child: Padding(padding: const EdgeInsets.fromLTRB(0, 16, 0, 4), child: Text('取消這個委託 ›', textAlign: TextAlign.center, style: ts(Fs.body, weight: w700, color: C.ink2))),
        ))
      else if (truthy(i['cancelBlock']))
        Blk(Padding(padding: const EdgeInsets.fromLTRB(0, 16, 0, 4), child: Text(str(i['cancelBlock']), textAlign: TextAlign.center, style: ts(Fs.meta, color: C.ink2, height: 1.6)))),
    ];
  }

  Widget _progressCard(Map i, List<dynamic> waiting) {
    final step = stepIndex(i);
    return CardBox(
      margin: EdgeInsets.zero,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          for (final (n, s) in progressSteps.indexed)
            Expanded(
              child: Column(children: [
                Container(
                  width: 28,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: n < step ? C.jadeSoft : n == step ? C.jade : C.mutedBg),
                  child: Text(n < step ? '✓' : '${n + 1}', style: ts(Fs.meta, weight: w800, color: n == step ? C.card : n < step ? C.jade : C.ink3)),
                ),
                const SizedBox(height: 4),
                Text(s, style: ts(Fs.meta, weight: n == step ? w800 : FontWeight.w400, color: n <= step ? C.jade : C.ink3)),
              ]),
            ),
        ]),
        const TicketRule(),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Pill(str(i['status']), tone: toneOf(requestTone(i['status']))),
          const SizedBox(width: 12),
          Text('最近更新 ${friendlyDate(i['updated_at'])}', style: numStyle(ts(Fs.meta, color: C.ink2, height: 1.6))),
        ]),
        Padding(padding: const EdgeInsets.only(top: 12), child: Text(nowStage(i), style: ts(Fs.h, weight: w800, height: 1.4))),
        Padding(padding: const EdgeInsets.only(top: 4), child: Text(nextText(i, selfManaged), style: ts(Fs.body, color: C.ink2))),
      ]),
    );
  }

  Widget _waitingCard(List<dynamic> waiting, bool upload) => CardBox(
        margin: EdgeInsets.zero,
        warn: true,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('需要你提供', style: ts(Fs.h, weight: w800, color: C.due))),
          for (final t in waiting)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(child: Text(todoTitle(at(t, 'title')), style: ts(Fs.h, weight: w700, height: 1.4))),
                  if (upload) ...[const SizedBox(width: 12), DBtn('上傳', kind: BtnKind.small, solid: true, expand: false, enabled: !uploading, onTap: () => chooseUpload(at(t, 'id')))],
                ]),
                if (listOf(at(t, 'documents')).isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(spacing: 8, runSpacing: 8, children: [for (final d in listOf(at(t, 'documents'))) Pill(jsString(d), tone: Tone.amber)]),
                  ),
                if (filesFor(files, at(t, 'id')).isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text.rich(
                      TextSpan(text: '已交 ${filesFor(files, at(t, 'id')).length} 份', children: [
                        if (filesFor(files, at(t, 'id')).any((f) => at(f, 'status') == '需重交')) TextSpan(text: ' · 有文件需要重交', style: ts(Fs.meta, color: C.overdue)),
                      ]),
                      style: ts(Fs.meta, color: C.ink2),
                    ),
                  ),
              ]),
            ),
          Padding(padding: const EdgeInsets.only(top: 8), child: Subtle(a('可直接拍照或上傳 PDF；不方便的話，也可以交給你的顧問。'))),
        ]),
      );

  Widget _listCard(List<Widget> rows) => CardBox(margin: EdgeInsets.zero, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: rows));

  Widget _rule(bool last, Widget child, {EdgeInsets padding = const EdgeInsets.symmetric(vertical: 12)}) =>
      Container(padding: padding, decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: C.rule))), child: child);

  Widget _filesCard(Map i) => _listCard([
        for (final (n, f) in files.indexed)
          _rule(
            n == files.length - 1,
            Row(children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: fileMark(f) == 'PDF' ? C.overdueBg : C.jadeSoft, borderRadius: BorderRadius.circular(R.control)),
                child: Text(fileMark(f), style: ts(Fs.cap, weight: w800, color: fileMark(f) == 'PDF' ? C.overdue : C.jade)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(str(at(f, 'fileName')), maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis, style: ts(Fs.body, weight: w700)),
                  Padding(padding: const EdgeInsets.only(top: 2), child: Text(fileSub(i, f), style: ts(Fs.meta, color: C.ink2))),
                  if (at(f, 'status') == '需重交' && truthy(at(f, 'reviewNote')))
                    Padding(padding: const EdgeInsets.only(top: 4), child: Text(str(at(f, 'reviewNote')), style: ts(Fs.meta, weight: w700, color: C.overdue))),
                ]),
              ),
              const SizedBox(width: 12),
              Pill(attachmentText(at(f, 'status'), selfManaged), tone: toneOf(attachmentTone[at(f, 'status')])),
            ]),
          ),
      ]);

  Widget _activitiesCard(List<dynamic> activities) => _listCard([
        for (final (n, x) in activities.indexed)
          _rule(
            n == activities.length - 1,
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(width: 8, height: 8, margin: const EdgeInsets.only(top: 8), decoration: const BoxDecoration(color: C.jade, shape: BoxShape.circle)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(str(at(x, 'detail')), style: ts(Fs.body)),
                  Padding(padding: const EdgeInsets.only(top: 2), child: Text(friendlyDate(at(x, 'created_at')), style: numStyle(ts(Fs.meta, color: C.ink2)))),
                ]),
              ),
            ]),
          ),
        if (activities.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text('暫時沒有更新', style: ts(Fs.meta, color: C.ink2))),
      ]);

  Widget _tasksCard(List<dynamic> tasks) => _listCard([
        for (final (n, t) in tasks.indexed)
          _rule(
            n == tasks.length - 1,
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                width: 24,
                height: 24,
                alignment: Alignment.center,
                decoration: BoxDecoration(shape: BoxShape.circle, color: at(t, 'status') == '已完成' ? C.jade : C.jadeSoft),
                child: Text(at(t, 'status') == '已完成' ? '✓' : '${n + 1}', style: ts(Fs.cap, weight: w800, color: at(t, 'status') == '已完成' ? C.card : C.jade)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(todoTitle(at(t, 'title')), style: ts(Fs.body, weight: w700)),
                  Padding(padding: const EdgeInsets.only(top: 2), child: Text('${jsString(at(t, 'jurisdiction'))} · ${jsString(at(t, 'status'))}', style: ts(Fs.meta, color: C.ink2))),
                ]),
              ),
            ]),
          ),
      ]);

  Widget _sourcesCard(List<dynamic> list) => _listCard([
        for (final (n, s) in list.indexed)
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => openSource(at(s, 'url')),
            child: _rule(
              n == list.length - 1,
              Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(str(at(s, 'title')), style: ts(Fs.body, weight: w700)),
                    Padding(padding: const EdgeInsets.only(top: 2), child: Text('${jsString(at(s, 'agency'))} · 點擊複製官方連結', style: ts(Fs.meta, color: C.ink2))),
                  ]),
                ),
                const SizedBox(width: 12),
                const Chev(),
              ]),
            ),
          ),
      ]);
}

// .section-head：標題＋右邊 .subtle.num（例如「4 步」）；外距由 Blocks 處理
class SectionRowNum extends StatelessWidget {
  const SectionRowNum({super.key, required this.title, required this.trailing});
  final String title, trailing;
  @override
  Widget build(BuildContext context) => Row(children: [
        Expanded(child: SectionTitle(title, bare: true)),
        const SizedBox(width: 12),
        Text(trailing, style: numStyle(ts(Fs.meta, color: C.ink2, height: 1.6))),
      ]);
}
