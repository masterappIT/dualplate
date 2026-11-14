package com.masterappinc.dualplate;

import android.app.Activity;
import android.app.Application;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.RelativeLayout;

import java.lang.ref.WeakReference;

/**
 * 啟動期間把底部導航列的底色設成深綠，與啟動畫面、mobile/src/pages/launch/launch.vue 連成一片（iOS 沒有導航列）。
 * DCloud 在 Android 15 起的全屏模式下，會在導航列後面墊一塊 #FCFCFC 的底，網頁不延伸到導航列；
 * 這裏先把那塊底改成深綠，launch.vue 離開時呼叫 restore() 還原。有底部標籤列的頁面，DCloud 會再改成標籤列的顏色。
 * launch.vue 用 insetDp() 取得導航列高度，把雙牌放回整個螢幕的正中。
 * 頁面沒有呼叫 restore() 時自動還原（見 AFTER_PAGE_RESTORE_MS），不讓深綠留在登入頁底部。
 */
public class LaunchNavBar implements Application.ActivityLifecycleCallbacks {
    private static final int JADE = 0xFF0B3B30;
    private static final int DCLOUD_DEFAULT = 0xFFFCFCFC;
    private static final int WHITE = 0xFFFFFFFF;
    private static final String DCLOUD_ACTIVITY = "io.dcloud.PandoraEntryActivity";
    /** launch.vue 沒有呼叫 restore()（例如頁面取不到這個類別）時的保險：
     *  DCloud 換上網頁（launch.vue 出現）時會另墊一塊新的底，由那時起計 launch.vue 最短停留 2 秒加淡出 0.22 秒後還原；
     *  萬一一直沒換，第一次找到底後 8 秒還原 */
    private static final long AFTER_PAGE_RESTORE_MS = 2220;
    private static final long FALLBACK_RESTORE_MS = 8000;

    private static WeakReference<Activity> activity = new WeakReference<>(null);
    private static WeakReference<View> backing = new WeakReference<>(null);
    private static volatile boolean launching = true;

    @Override
    public void onActivityCreated(final Activity a, Bundle state) {
        if (!launching || !DCLOUD_ACTIVITY.equals(a.getClass().getName())) return;
        activity = new WeakReference<>(a);
        // 這裏只是外觀處理，任何錯誤都不可令 App 閃退
        try {
            final Window window = a.getWindow();
            window.setNavigationBarColor(JADE);
            final View decor = window.getDecorView();
            decor.getViewTreeObserver().addOnGlobalLayoutListener(new ViewTreeObserver.OnGlobalLayoutListener() {
                private boolean iconsSet, fallbackSet, pageSet;

                @Override
                public void onGlobalLayout() {
                    try {
                        if (!launching) {
                            decor.getViewTreeObserver().removeOnGlobalLayoutListener(this);
                            return;
                        }
                        if (!iconsSet) {
                            lightIcons(window, false);
                            iconsSet = true;
                        }
                        // DCloud 換到網頁時會另墊一塊新的底，所以啟動期間每次排版都檢查
                        View v = findBacking(decor, decor.getHeight());
                        if (v == null) return;
                        View previous = backing.get();
                        backing = new WeakReference<>(v);
                        v.setBackgroundColor(JADE);
                        if (!fallbackSet) {
                            fallbackSet = true;
                            restoreLater(decor, FALLBACK_RESTORE_MS);
                        } else if (!pageSet && previous != null && previous != v) {
                            pageSet = true;
                            restoreLater(decor, AFTER_PAGE_RESTORE_MS);
                        }
                    } catch (RuntimeException e) {
                        decor.getViewTreeObserver().removeOnGlobalLayoutListener(this);
                    }
                }
            });
        } catch (RuntimeException ignored) {
            // 保留 DCloud 預設外觀
        }
    }

    private static void restoreLater(View decor, long delay) {
        decor.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (launching) restore();
            }
        }, delay);
    }

    /** DCloud 墊在導航列後面的那塊底：沒有子項、貼着螢幕底部、底色白或 #FCFCFC 的 RelativeLayout。 */
    private static View findBacking(View v, int screenBottom) {
        if (v instanceof RelativeLayout && ((ViewGroup) v).getChildCount() == 0 && v.getHeight() > 0
                && (colorOf(v) == DCLOUD_DEFAULT || colorOf(v) == WHITE)) {
            int[] at = new int[2];
            v.getLocationOnScreen(at);
            if (at[1] + v.getHeight() >= screenBottom) return v;
        }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) {
                View found = findBacking(g.getChildAt(i), screenBottom);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static int colorOf(View v) {
        Drawable d = v.getBackground();
        return d instanceof ColorDrawable ? ((ColorDrawable) d).getColor() : 0;
    }

    private static void lightIcons(Window window, boolean light) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = window.getInsetsController();
            if (c != null) {
                int flag = WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(light ? flag : 0, flag);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            View decor = window.getDecorView();
            int flags = decor.getSystemUiVisibility();
            flags = light ? flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(flags);
        }
    }

    /** 底部導航列高度（dp），沒有導航列或取不到時為 0。供 launch.vue 經 plus.android 呼叫。 */
    public static float insetDp() {
        Activity a = activity.get();
        if (a == null) return 0;
        View decor = a.getWindow().peekDecorView();
        if (decor == null) return 0;
        WindowInsets insets = decor.getRootWindowInsets();
        if (insets == null) return 0;
        int px;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            px = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
        } else {
            px = insets.getSystemWindowInsetBottom();
        }
        return px / a.getResources().getDisplayMetrics().density;
    }

    /** launch.vue 離開時呼叫：還原 DCloud 預設的近白色；標籤列已改過顏色的話不動。 */
    public static void restore() {
        launching = false;
        final Activity a = activity.get();
        if (a == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Window window = a.getWindow();
                    if (window.getNavigationBarColor() == JADE) window.setNavigationBarColor(DCLOUD_DEFAULT);
                    View v = backing.get();
                    if (v != null && colorOf(v) == JADE) v.setBackgroundColor(DCLOUD_DEFAULT);
                    lightIcons(window, true);
                } catch (RuntimeException ignored) {
                    // 保留現狀
                }
            }
        });
    }

    @Override public void onActivityStarted(Activity a) {}
    @Override public void onActivityResumed(Activity a) {}
    @Override public void onActivityPaused(Activity a) {}
    @Override public void onActivityStopped(Activity a) {}
    @Override public void onActivitySaveInstanceState(Activity a, Bundle state) {}
    @Override public void onActivityDestroyed(Activity a) {}
}
