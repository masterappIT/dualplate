<script>
export default { onLaunch() {} }
</script>
<style>
page{background:#f5f7f5;color:#20372f;font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','PingFang SC','Microsoft JhengHei',sans-serif}
view,text,input,textarea,button{box-sizing:border-box}
.page{min-height:100vh;padding:32rpx 30rpx calc(170rpx + env(safe-area-inset-bottom))}
.eyebrow{color:#388368;font-size:20rpx;font-weight:800;letter-spacing:1.8rpx}
.page-title{display:block;margin:12rpx 0 7rpx;font-size:46rpx;font-weight:800;line-height:1.25;letter-spacing:-1rpx}
.subtle{color:#71857a;font-size:24rpx;line-height:1.55}
.card{background:#fff;border:1rpx solid #e5ece6;border-radius:24rpx;padding:27rpx;margin-bottom:18rpx;box-shadow:0 6rpx 20rpx rgba(28,64,43,.035)}
.row{display:flex;align-items:center;justify-content:space-between;gap:16rpx}
.section-title{display:block;font-size:29rpx;font-weight:800;margin:34rpx 0 17rpx}
.pill{display:inline-flex;align-items:center;flex:none;border-radius:99rpx;padding:7rpx 15rpx;background:#e8f4eb;color:#217257;font-size:20rpx;font-weight:750;white-space:nowrap}
.pill.amber{background:#fff1db;color:#9e6414}.pill.gray{background:#edf1ed;color:#65796c}
.primary{background:#176f59;color:#fff;border:0;border-radius:16rpx;font-size:27rpx;font-weight:750;height:88rpx;line-height:88rpx;box-shadow:0 7rpx 18rpx rgba(26,107,75,.15)}
.secondary{background:#e8f2eb;color:#176f59;border:0;border-radius:16rpx;font-size:26rpx;font-weight:750;height:82rpx;line-height:82rpx}
.field-label{display:block;color:#496657;font-size:23rpx;font-weight:750;margin:23rpx 0 10rpx}
.field{width:100%;background:#f9fbf9;border:1rpx solid #dfe8e0;border-radius:14rpx;min-height:84rpx;padding:20rpx 23rpx;font-size:27rpx;color:#20372f}
.field:focus{border-color:#288369;box-shadow:0 0 0 4rpx rgba(40,131,105,.12)}
.empty{padding:48rpx 23rpx;text-align:center;color:#71857a;font-size:24rpx;line-height:1.6}
.primary,.secondary,.card,.field{transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease}
.primary:active,.secondary:active{opacity:.88;transform:scale(.99)}
@media screen and (min-width:780px){.page{max-width:640px;margin:0 auto;padding:44px 28px 180px}.card{box-shadow:0 8px 26px rgba(16,68,57,.055)}}
@media (prefers-reduced-motion:reduce){.primary,.secondary,.card,.field{transition:none}}
</style>
