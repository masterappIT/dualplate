<script>
export default { onLaunch() {} }
</script>
<style>
/* 車牌管家視覺識別「證件感」：見 docs/design-system.md 第二節。頁面只引用這裡的變量與類別。 */
page{
  --jade:#0F5C4A;--jade-deep:#0B3B30;--jade-soft:#E3EFEA;--plate-yellow:#F2C230;
  --paper:#F7F6F1;--card:#FFFFFF;--ink:#14201B;--ink-2:#4E5D55;--ink-3:#85918A;--rule:#E2E1D8;
  --overdue:#C2362A;--overdue-bg:#FBE9E7;--due:#C47A00;--due-bg:#FDF1DC;--ok:#2E7D52;--ok-bg:#E5F2EA;--active:#2D63A6;--active-bg:#E6EEF8;--muted:#8A8F86;--muted-bg:#EEEEE9;
  --r-control:8rpx;--r-card:16rpx;--r-panel:24rpx;
  --float:0 24rpx 64rpx rgba(11,59,48,.14);
  /* Wot Design Uni 主題：只用它的操作與組件行為，外觀換成本產品 */
  --wot-color-theme:#0F5C4A;--wot-color-success:#2E7D52;--wot-color-warning:#C47A00;--wot-color-danger:#C2362A;
  --wot-button-medium-radius:8rpx;--wot-button-large-radius:8rpx;--wot-button-small-radius:8rpx;
  background:var(--paper);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Microsoft JhengHei','Noto Sans TC','PingFang SC',sans-serif
}
view,text,input,textarea,button{box-sizing:border-box}
.page{min-height:100vh;padding:32rpx 30rpx calc(170rpx + env(safe-area-inset-bottom))}
.eyebrow{color:var(--jade);font-size:20rpx;font-weight:800;letter-spacing:2rpx}
.page-title{display:block;margin:12rpx 0 7rpx;font-size:44rpx;font-weight:800;line-height:1.25;letter-spacing:-.5rpx;color:var(--jade-deep)}
.subtle{color:var(--ink-2);font-size:24rpx;line-height:1.55}
.num{font-variant-numeric:tabular-nums;letter-spacing:.04em}
.card{background:var(--card);border:1rpx solid var(--rule);border-radius:var(--r-card);padding:27rpx;margin-bottom:18rpx}
.row{display:flex;align-items:center;justify-content:space-between;gap:16rpx}
.section-title{display:block;font-size:29rpx;font-weight:800;margin:34rpx 0 17rpx;color:var(--jade-deep)}
.pill{display:inline-flex;align-items:center;flex:none;border-radius:99rpx;padding:7rpx 15rpx;background:var(--ok-bg);color:var(--ok);font-size:20rpx;font-weight:750;white-space:nowrap}
.pill.amber{background:var(--due-bg);color:var(--due)}.pill.gray{background:var(--muted-bg);color:var(--ink-2)}.pill.red{background:var(--overdue-bg);color:var(--overdue)}.pill.blue{background:var(--active-bg);color:var(--active)}
.list-card{background:var(--card);border:1rpx solid var(--rule);border-radius:var(--r-card);padding:22rpx 24rpx;margin-bottom:14rpx}
.list-card:active{background:var(--jade-soft)}
.list-title{display:block;font-size:27rpx;font-weight:800;color:var(--ink)}
.list-sub{display:block;margin-top:5rpx;color:var(--ink-2);font-size:22rpx;line-height:1.5}
.list-note{display:block;margin-top:6rpx;font-size:22rpx;font-weight:700}
.note-red{color:var(--overdue)}.note-amber{color:var(--due)}.note-green{color:var(--ok)}.note-gray{color:var(--ink-3)}
.chips{display:flex;flex-wrap:wrap;gap:12rpx;margin:18rpx 0}
.chip{padding:9rpx 20rpx;border-radius:99rpx;background:var(--muted-bg);color:var(--ink-2);font-size:22rpx;font-weight:700}
.chip.active{background:var(--jade);color:#fff}
.section-head{display:flex;align-items:center;justify-content:space-between;margin:34rpx 0 15rpx}
.section-head .section-title{margin:0}
.link{color:var(--jade);font-size:23rpx;font-weight:750}
.warn-card{border-color:#EBCF94;background:#FFFBF0}
.primary{background:var(--jade);color:#fff;border:0;border-radius:var(--r-control);font-size:27rpx;font-weight:750;height:88rpx;line-height:88rpx}
.secondary{background:var(--jade-soft);color:var(--jade);border:0;border-radius:var(--r-control);font-size:26rpx;font-weight:750;height:82rpx;line-height:82rpx}
.field-label{display:block;color:var(--ink-2);font-size:23rpx;font-weight:750;margin:23rpx 0 10rpx}
.field{width:100%;background:#fff;border:1rpx solid var(--rule);border-radius:var(--r-control);min-height:84rpx;padding:20rpx 23rpx;font-size:27rpx;color:var(--ink)}
.field:focus{border-color:var(--jade);box-shadow:0 0 0 4rpx rgba(242,194,48,.45)}
.empty{padding:48rpx 23rpx;text-align:center;color:var(--ink-3);font-size:24rpx;line-height:1.6}
/* 客戶自理的事項：客戶自己要辦，用牌照黃小標提醒 */
.who{display:inline-block;margin-top:6rpx;padding:2rpx 12rpx;border-radius:6rpx;font-size:20rpx;font-weight:800}.who.you{background:#FFF4D0;color:#8A6A00;border:1rpx solid var(--plate-yellow)}
/* 防偽底紋：兩組錯位的同心細線形成證件扭索紋；只用在主卡、頁首與登入畫布 */
.guilloche{position:relative;overflow:hidden}
.guilloche::before{content:'';position:absolute;inset:-40%;pointer-events:none;opacity:.07;
  background:repeating-radial-gradient(circle at 30% 40%,currentColor 0 1rpx,transparent 1rpx 14rpx),repeating-radial-gradient(circle at 70% 60%,currentColor 0 1rpx,transparent 1rpx 14rpx)}
.guilloche>*{position:relative}
/* 票根分隔：兩側半圓缺口＋虛線 */
.ticket-rule{position:relative;height:2rpx;margin:24rpx -27rpx;border-top:2rpx dashed var(--rule)}
.ticket-rule::before,.ticket-rule::after{content:'';position:absolute;top:-15rpx;width:28rpx;height:28rpx;border-radius:50%;background:var(--paper);border:1rpx solid var(--rule)}
.ticket-rule::before{left:-15rpx}.ticket-rule::after{right:-15rpx}
.primary,.secondary,.card,.field,.list-card{transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease}
.primary:active,.secondary:active{opacity:.9;transform:scale(.985)}
@media screen and (min-width:780px){.page{max-width:640px;margin:0 auto;padding:44px 28px 180px}}
@media (prefers-reduced-motion:reduce){.primary,.secondary,.card,.field,.list-card{transition:none}}
</style>
