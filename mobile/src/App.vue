<script>
export default { onLaunch() {} }
</script>
<style>
/* 車牌管家視覺識別「證件感」：見 docs/design-system.md 第二節。頁面只引用這裏的變量與類別。
   字號只用五級（px，不隨螢幕寬度縮放）：頁標題 22／區塊與列表標題 16／正文 14／輔助 13／標籤 12；統計數字 28。
   間距用 4 的倍數；手指點按的控件高度不小於 40px。 */
page{
  --jade:#0F5C4A;--jade-deep:#0B3B30;--jade-soft:#E3EFEA;--plate-yellow:#F2C230;
  --paper:#F7F6F1;--card:#FFFFFF;--ink:#14201B;--ink-2:#4E5D55;--ink-3:#85918A;--rule:#E2E1D8;
  --overdue:#C2362A;--overdue-bg:#FBE9E7;--due:#C47A00;--due-bg:#FDF1DC;--ok:#2E7D52;--ok-bg:#E5F2EA;--active:#2D63A6;--active-bg:#E6EEF8;--muted:#8A8F86;--muted-bg:#EEEEE9;
  --fs-title:22px;--fs-h:16px;--fs-body:14px;--fs-meta:13px;--fs-cap:12px;--fs-stat:28px;
  --r-control:4px;--r-card:8px;--r-panel:12px;
  --float:0 12px 32px rgba(11,59,48,.14);
  /* 深綠底上的狀態字色（首頁、帳單、月報封面） */
  --on-deep:#E3EFEA;--on-deep-2:rgba(227,239,234,.72);--on-deep-ok:#9FD8B5;--on-deep-due:#F2C230;--on-deep-overdue:#F4A39A;
  /* Wot Design Uni 主題：只用它的操作與組件行為，外觀換成本產品 */
  --wot-color-theme:#0F5C4A;--wot-color-success:#2E7D52;--wot-color-warning:#C47A00;--wot-color-danger:#C2362A;
  --wot-button-medium-radius:4px;--wot-button-large-radius:4px;--wot-button-small-radius:4px;
  /* 底部選單與確認框：紙色卡面、通行綠字、與「有變動？」等選單同一外觀 */
  --wot-action-sheet-bg:var(--card);--wot-action-sheet-radius:12px;--wot-action-sheet-color:var(--ink);--wot-action-sheet-fs:16px;--wot-action-sheet-weight:700;--wot-action-sheet-action-height:56px;
  --wot-action-sheet-subname-color:var(--ink-2);--wot-action-sheet-subname-fs:13px;--wot-action-sheet-title-fs:18px;--wot-action-sheet-title-height:56px;
  --wot-action-sheet-cancel-bg:var(--jade-soft);--wot-action-sheet-cancel-color:var(--jade);--wot-action-sheet-cancel-radius:4px;--wot-action-sheet-cancel-height:44px;--wot-action-sheet-active-color:var(--paper);
  --wot-message-box-bg:var(--card);--wot-message-box-radius:12px;--wot-message-box-title-color:var(--ink);--wot-message-box-title-fs:18px;--wot-message-box-content-color:var(--ink-2);--wot-message-box-content-fs:14px;
  background:var(--paper);color:var(--ink);font-size:var(--fs-body);line-height:1.5;
  font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Microsoft JhengHei','Noto Sans TC','PingFang SC',sans-serif
}
view,text,input,textarea,button{box-sizing:border-box}
button::after{border:0}
.page{min-height:100vh;padding:16px 16px calc(96px + env(safe-area-inset-bottom))}
.page-title{display:block;margin:0 0 4px;font-size:var(--fs-title);font-weight:800;line-height:1.3;color:var(--jade-deep)}
.subtle{display:block;color:var(--ink-2);font-size:var(--fs-meta);line-height:1.6}
.intro{display:block;color:var(--ink-2);font-size:var(--fs-body);line-height:1.6;margin-bottom:16px}
.num{font-variant-numeric:tabular-nums;letter-spacing:.04em}
.grow{flex:1;min-width:0}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:var(--r-card);padding:16px;margin-bottom:12px}
.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:28px 0 12px}
.section-title{display:block;font-size:var(--fs-h);font-weight:800;line-height:1.4;margin:28px 0 12px;color:var(--jade-deep)}
.section-head .section-title{margin:0}
.link{color:var(--jade);font-size:var(--fs-body);font-weight:700;white-space:nowrap}
/* 列表卡：標題 16、說明 14、補充 13 */
.list-card{background:var(--card);border:1px solid var(--rule);border-radius:var(--r-card);padding:16px;margin-bottom:12px}
.list-card:active{background:var(--jade-soft)}
.list-title{display:block;font-size:var(--fs-h);font-weight:700;line-height:1.4;color:var(--ink)}
.list-sub{display:block;margin-top:4px;color:var(--ink-2);font-size:var(--fs-body);line-height:1.5}
.list-note{display:block;margin-top:4px;font-size:var(--fs-meta);font-weight:700}
.chev{flex:none;color:var(--ink-3);font-size:var(--fs-h);line-height:1}
.note-red{color:var(--overdue)}.note-amber{color:var(--due)}.note-green{color:var(--ok)}.note-gray{color:var(--ink-3)}
.warn-card{border-color:#EBCF94;background:#FFFBF0}
/* 狀態標籤：只包住文字；五色＝逾期紅、快到期橙、正常綠、進行中藍、灰 */
.pill{display:inline-flex;align-items:center;flex:none;align-self:center;border-radius:99px;padding:2px 8px;font-size:var(--fs-cap);font-weight:700;line-height:18px;white-space:nowrap;background:var(--ok-bg);color:var(--ok)}
.pill.amber{background:var(--due-bg);color:var(--due)}.pill.gray{background:var(--muted-bg);color:var(--ink-2)}.pill.red{background:var(--overdue-bg);color:var(--overdue)}.pill.blue{background:var(--active-bg);color:var(--active)}
/* 客戶自理的事項：客戶自己辦，我們只提醒（灰色小標，不搶眼） */
.who{display:inline-flex;margin-top:4px;padding:0 6px;border-radius:var(--r-control);font-size:var(--fs-cap);font-weight:700;line-height:20px;background:var(--muted-bg);color:var(--ink-2)}
/* 篩選小籤：高 36 */
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 16px}
.chip{display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:99px;background:var(--muted-bg);color:var(--ink-2);font-size:var(--fs-body);font-weight:700}
.chip.active{background:var(--jade);color:#fff}
/* 分段切換（粵港／粵澳、卡片／列表）：全站同一款 */
.segmented{display:flex;gap:4px;padding:4px;border-radius:var(--r-card);background:var(--muted-bg)}
.segmented .seg{flex:1;display:flex;align-items:center;justify-content:center;height:36px;padding:0 12px;border-radius:var(--r-control);color:var(--ink-2);font-size:var(--fs-body);font-weight:700;white-space:nowrap}
.segmented .seg.on{background:var(--card);color:var(--jade);box-shadow:0 1px 2px rgba(11,59,48,.12)}
.segmented.inline{display:inline-flex}.segmented.inline .seg{flex:none}
/* 按鈕：主要 48、次要 44、行內小按鈕 40；每頁最多一個實心主要按鈕 */
.primary,.secondary,.btn-sm,.btn-line{display:flex;align-items:center;justify-content:center;margin:0;padding:0 16px;border:0;border-radius:var(--r-control);font-weight:700;white-space:nowrap}
.primary{width:100%;background:var(--jade);color:#fff;font-size:var(--fs-h);height:48px;line-height:48px}
.secondary{background:var(--jade-soft);color:var(--jade);font-size:var(--fs-h);height:44px;line-height:44px}
.btn-sm{background:var(--jade-soft);color:var(--jade);font-size:var(--fs-body);height:40px;line-height:40px}
.btn-sm.solid{background:var(--jade);color:#fff}
.primary.danger{background:var(--overdue)}
.btn-line{background:var(--card);color:var(--jade);border:1px solid var(--rule);font-size:var(--fs-body);height:44px;line-height:42px}
.primary[disabled],.secondary[disabled],.btn-sm[disabled],.btn-line[disabled]{opacity:.55}
.field-label{display:block;color:var(--ink-2);font-size:var(--fs-body);font-weight:700;margin:16px 0 8px}
/* 客戶自行修改的行內表單（牌照、司機、車輛、公司共用） */
.inline-editor{display:flow-root;margin:4px 0 12px;padding:0 12px 12px;border-radius:var(--r-card);background:var(--paper)}
.inline-editor .editor-actions{display:flex;gap:8px;margin-top:16px}.inline-editor .editor-actions .btn-sm{flex:1}
.inline-editor .picker{display:flex;align-items:center;justify-content:space-between}
.pending-tag{margin-top:4px}
/* 輸入框用 16px，避免手機點擊時自動放大 */
.field{width:100%;background:#fff;border:1px solid var(--rule);border-radius:var(--r-control);min-height:48px;padding:12px;font-size:var(--fs-h);color:var(--ink)}
.field:focus{border-color:var(--jade);box-shadow:0 0 0 3px rgba(242,194,48,.45)}
.empty{padding:24px 16px;text-align:center;color:var(--ink-3);font-size:var(--fs-body);line-height:1.6}
/* 標籤：值（窄螢幕也保留標籤） */
.kv{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:var(--fs-body);line-height:1.5}
.kv .k{color:var(--ink-3);white-space:nowrap}.kv .v{color:var(--ink);min-width:0;overflow-wrap:anywhere}
/* 深綠主卡（首頁、帳單、月報封面） */
.deep{background:var(--jade-deep);border-color:var(--jade-deep);color:var(--on-deep)}
.kicker{display:block;font-size:var(--fs-cap);font-weight:700;letter-spacing:2px;color:var(--plate-yellow)}
/* 防偽底紋：兩組錯位的同心細線形成證件扭索紋；只用在主卡、頁首與登入畫布 */
.guilloche{position:relative;overflow:hidden}
.guilloche::before{content:'';position:absolute;inset:-40%;pointer-events:none;opacity:.07;
  background:repeating-radial-gradient(circle at 30% 40%,currentColor 0 1px,transparent 1px 7px),repeating-radial-gradient(circle at 70% 60%,currentColor 0 1px,transparent 1px 7px)}
.guilloche>*{position:relative}
/* 票根分隔：兩側半圓缺口＋虛線 */
.ticket-rule{position:relative;height:1px;margin:16px -16px;border-top:1px dashed var(--rule)}
.ticket-rule::before,.ticket-rule::after{content:'';position:absolute;top:-8px;width:16px;height:16px;border-radius:50%;background:var(--paper);border:1px solid var(--rule)}
.ticket-rule::before{left:-9px}.ticket-rule::after{right:-9px}
.deep .ticket-rule{border-top-color:rgba(227,239,234,.25)}.deep .ticket-rule::before,.deep .ticket-rule::after{border-color:transparent}
.primary,.secondary,.btn-sm,.btn-line,.card,.field,.list-card,.chip{transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease}
.primary:active,.secondary:active,.btn-sm:active,.btn-line:active{opacity:.9;transform:scale(.985)}
@media screen and (min-width:780px){.page{max-width:640px;margin:0 auto;padding:32px 24px 120px}}
@media (prefers-reduced-motion:reduce){.primary,.secondary,.btn-sm,.btn-line,.card,.field,.list-card,.chip{transition:none}}
/* Wot 底部選單（lib/choice.js）：選項做成左對齊的卡片，說明放第二行，與線框圖一致 */
.choice-sheet.wd-action-sheet .wd-action-sheet__header{padding:0 48px 0 16px;text-align:left;font-weight:800;color:var(--ink)}
.choice-sheet.wd-action-sheet .wd-action-sheet__actions{padding:4px 16px 8px}
.choice-sheet.wd-action-sheet .wd-action-sheet__action{height:auto;min-height:48px;margin-bottom:8px;padding:12px 14px;line-height:1.4;text-align:left;white-space:normal;border:1px solid var(--rule);border-radius:var(--r-card)}
.choice-sheet.wd-action-sheet .wd-action-sheet__name{display:block;font-size:var(--fs-h);font-weight:700;color:var(--ink)}
.choice-sheet.wd-action-sheet .wd-action-sheet__subname{display:block;margin:4px 0 0;font-size:var(--fs-meta);font-weight:400;line-height:1.5;color:var(--ink-2)}
.choice-sheet.wd-action-sheet .wd-action-sheet__cancel{width:calc(100% - 32px);margin:0 16px 16px}
/* 桌面寬度時，選單和確認框跟頁面同寬（640px）置中，不鋪滿整個視窗 */
@media screen and (min-width:780px){.wd-popup.wd-action-sheet__popup{left:0;right:0;width:640px;margin:0 auto}}
</style>
