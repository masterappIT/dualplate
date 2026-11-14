package com.masterappinc.dualplate;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import java.lang.ref.WeakReference;

/**
 * 安卓啟動只有一個靜態畫面：深綠底、正中白色 MasterApp 標誌（M 雲），一直顯示到登入頁或首頁出現。
 * 1. 不要 DCloud 安卓自己疊的啟動圖（drawable/splash）：它被拉伸到整個螢幕，之後又縮到導航列以上，標誌會變大再移位。
 *    DCloud 建立啟動圖前讀啟動 Intent 的 __splash_view__（預設 true），設成 false 就不建立。
 * 2. 在 DCloud 主畫面最上面加一層畫面，底圖與系統啟動畫面、視窗底同一張（drawable/launch_background），標誌同尺寸同位置；
 *    網頁載入期間的灰白不會露出。
 * 3. mobile/src/pages/launch/launch.vue 打開登入頁或首頁後呼叫 hide() 拿走；萬一沒有呼叫，FALLBACK_MS 後自動拿走。
 * 只是外觀處理，任何錯誤都不可令 App 閃退，出錯時保留 DCloud 預設。
 */
public class LaunchCover implements Application.ActivityLifecycleCallbacks {
    private static final String DCLOUD_ACTIVITY = "io.dcloud.PandoraEntryActivity";
    private static final String SPLASH_VIEW = "__splash_view__";
    private static final long FADE_MS = 180;
    private static final long FALLBACK_MS = 15000;

    private static WeakReference<View> coverRef = new WeakReference<>(null);

    private static boolean isDCloud(Activity a) {
        return DCLOUD_ACTIVITY.equals(a.getClass().getName());
    }

    private static void skipDCloudSplash(Activity a) {
        try {
            if (a.getIntent() != null) a.getIntent().putExtra(SPLASH_VIEW, false);
        } catch (RuntimeException ignored) {
            // 保留 DCloud 預設的啟動圖
        }
    }

    /** Android 10 起：在畫面的 onCreate 之前。每次 DCloud 主畫面建立都做（按返回鍵離開後再打開、更新後重開時，程序可能還在） */
    @Override
    public void onActivityPreCreated(Activity a, Bundle state) {
        if (isDCloud(a)) skipDCloudSplash(a);
    }

    /** Android 9 或以下沒有 onActivityPreCreated：DCloud 呼叫 super.onCreate() 時，仍在建立啟動圖之前 */
    @Override
    public void onActivityCreated(Activity a, Bundle state) {
        if (!isDCloud(a)) return;
        skipDCloudSplash(a);
        remove(false); // 上一次的畫面若還在（例如沒有呼叫 hide()），先拿走
        try {
            final ViewGroup decor = (ViewGroup) a.getWindow().getDecorView();
            final View cover = new View(a);
            cover.setBackgroundResource(R.drawable.launch_background);
            cover.setClickable(true); // 蓋着時不讓點擊穿到下面的網頁
            decor.addView(cover, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            coverRef = new WeakReference<>(cover);
            // DCloud 之後在最上層加的畫面（例如導航列後面那塊底）不可蓋過它
            decor.getViewTreeObserver().addOnGlobalLayoutListener(new android.view.ViewTreeObserver.OnGlobalLayoutListener() {
                @Override
                public void onGlobalLayout() {
                    View c = coverRef.get();
                    if (c != cover || c.getParent() != decor) {
                        decor.getViewTreeObserver().removeOnGlobalLayoutListener(this);
                        return;
                    }
                    if (decor.indexOfChild(c) != decor.getChildCount() - 1) c.bringToFront();
                }
            });
            decor.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (coverRef.get() == cover) remove(false); // 只拿走這一次加的，不碰之後重開時加的
                }
            }, FALLBACK_MS);
        } catch (RuntimeException e) {
            remove(false);
        }
    }

    /** launch.vue 打開登入頁或首頁後經 plus.android 呼叫 */
    public static void hide() {
        final View cover = coverRef.get();
        if (cover == null) return;
        cover.post(new Runnable() {
            @Override
            public void run() {
                remove(true);
            }
        });
    }

    /** 只在主執行緒呼叫 */
    private static void remove(boolean fade) {
        final View cover = coverRef.get();
        coverRef = new WeakReference<>(null);
        if (cover == null || !(cover.getParent() instanceof ViewGroup)) return;
        final ViewGroup parent = (ViewGroup) cover.getParent();
        try {
            if (!fade) {
                parent.removeView(cover);
                return;
            }
            cover.animate().alpha(0f).setDuration(FADE_MS).withEndAction(new Runnable() {
                @Override
                public void run() {
                    parent.removeView(cover);
                }
            }).start();
        } catch (RuntimeException e) {
            try { parent.removeView(cover); } catch (RuntimeException ignored) { /* 保留現狀 */ }
        }
    }

    @Override public void onActivityStarted(Activity a) {}
    @Override public void onActivityResumed(Activity a) {}
    @Override public void onActivityPaused(Activity a) {}
    @Override public void onActivityStopped(Activity a) {}
    @Override public void onActivitySaveInstanceState(Activity a, Bundle state) {}
    @Override public void onActivityDestroyed(Activity a) {}
}
