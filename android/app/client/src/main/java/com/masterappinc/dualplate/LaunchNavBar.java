package com.masterappinc.dualplate;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ArgbEvaluator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.Application;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowInsetsController;
import android.widget.RelativeLayout;

import java.lang.ref.WeakReference;

/**
 * 底部導航列那一條的顏色（iOS 沒有導航列；iPhone 的網頁延伸到螢幕最底，底部安全區就是頁面底色，彈窗遮罩也蓋到最底）。
 * DCloud 在 Android 15 起的全屏模式下，會在導航列後面墊一塊 #FCFCFC 的底，網頁不延伸到導航列（android:id/content 的外邊距由 DCloud 固定設成導航列高度，
 * 這裏不碰外邊距和排版，只改顏色）。
 * 1. 啟動期間把那塊底和導航列設成深綠，與啟動畫面連成一片（啟動畫面由 LaunchCover 蓋住整個螢幕）；
 *    mobile/src/pages/launch/launch.vue 打開登入頁或首頁時呼叫 restore()。頁面沒有呼叫 restore() 時自動還原（見 AFTER_PAGE_RESTORE_MS）。
 * 2. 之後由頁面（mobile/src/lib/nav-bar.js）用 paint()／fade() 指定顏色：有標籤列的頁面跟標籤列，其他頁面用頁面底色，彈窗打開時疊上遮罩顏色。
 * 3. DCloud 另墊新的底時又是 #FCFCFC：每次排版後檢查，發現就塗回頁面指定的顏色。
 */
public class LaunchNavBar implements Application.ActivityLifecycleCallbacks {
    private static final int JADE = 0xFF0B3B30;
    private static final int DCLOUD_DEFAULT = 0xFFFCFCFC;
    private static final int WHITE = 0xFFFFFFFF;
    /** 頁面底色（mobile/src/pages.json globalStyle.backgroundColor、manifest.json safearea.background），頁面還沒指定顏色時用 */
    private static final int PAPER = 0xFFF7F6F1;
    /** 彈窗開關時的變色時間，與 Wot Design Uni 選單和確認框遮罩的淡入淡出一致（wd-action-sheet 的 duration、wd-message-box 的 :duration 都是 200） */
    private static final long FADE_MS = 200;
    private static final String DCLOUD_ACTIVITY = "io.dcloud.PandoraEntryActivity";
    /** launch.vue 沒有呼叫 restore()（例如頁面取不到這個類別）時的保險：
     *  DCloud 換上網頁（launch.vue 出現）時會另墊一塊新的底，由那時起計 launch.vue 最短停留 2 秒加淡出 0.22 秒後還原；
     *  萬一一直沒換，第一次找到底後 8 秒還原 */
    private static final long AFTER_PAGE_RESTORE_MS = 2220;
    private static final long FALLBACK_RESTORE_MS = 8000;

    private static WeakReference<Activity> activity = new WeakReference<>(null);
    private static WeakReference<View> backing = new WeakReference<>(null);
    private static volatile boolean launching = true;
    /** 頁面最近指定的顏色（0＝還沒指定）；啟動期間指定的，restore() 時才塗上 */
    private static volatile int wanted = 0;
    // 以下只在主執行緒使用
    /** 目前塗上（或正在變過去）的顏色 */
    private static int painted = 0;
    private static ValueAnimator fading;
    private static boolean guarding;

    @Override
    public void onActivityCreated(final Activity a, Bundle state) {
        if (!DCLOUD_ACTIVITY.equals(a.getClass().getName())) return;
        // 每次 DCloud 主畫面建立都重新開始：按返回鍵離開後再打開、更新後重開時，程序可能還在，上次的狀態要清掉
        launching = true;
        wanted = 0;
        painted = 0;
        guarding = false;
        backing = new WeakReference<>(null);
        if (fading != null) {
            ValueAnimator old = fading;
            fading = null;
            old.cancel();
        }
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
                        View v = findBacking(decor, decor.getHeight(), 0);
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

    /** DCloud 墊在導航列後面的那塊底：沒有子項、貼着螢幕底部的 RelativeLayout，底色是白、#FCFCFC，或 also（不為 0 時，即我們塗上的顏色）。 */
    private static View findBacking(View v, int screenBottom, int also) {
        if (v instanceof RelativeLayout && ((ViewGroup) v).getChildCount() == 0 && v.getHeight() > 0) {
            int color = colorOf(v);
            if (color == DCLOUD_DEFAULT || color == WHITE || (also != 0 && color == also)) {
                int[] at = new int[2];
                v.getLocationOnScreen(at);
                if (at[1] + v.getHeight() >= screenBottom) return v;
            }
        }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) {
                View found = findBacking(g.getChildAt(i), screenBottom, also);
                if (found != null) return found;
            }
        }
        return null;
    }

    /** 目前那塊底；上次找到的已不在畫面上就重新找（Android 14 或以下沒有這塊底，回傳 null） */
    private static View currentBacking(View decor) {
        View v = backing.get();
        if (v != null && v.isAttachedToWindow() && v.getHeight() > 0) return v;
        v = findBacking(decor, decor.getHeight(), painted);
        if (v != null) backing = new WeakReference<>(v);
        return v;
    }

    private static int colorOf(View v) {
        Drawable d = v.getBackground();
        return d instanceof ColorDrawable ? ((ColorDrawable) d).getColor() : 0;
    }

    /** 淺色底配深色圖示 */
    private static boolean isLight(int color) {
        return Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114 >= 128000;
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

    /** 那塊底和導航列本身一起改。Android 8 以前導航列圖示只有白色，不改導航列本身，免得淺色底上看不到按鍵。 */
    private static void setColor(Window window, View v, int color) {
        if (v != null) v.setBackgroundColor(color);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) window.setNavigationBarColor(color);
    }

    /** launch.vue 打開登入頁或首頁時呼叫：換成頁面指定的顏色（還沒指定就用頁面底色）；標籤列已改過顏色的話不動。之後開始檢查 DCloud 有沒有改回。 */
    public static void restore() {
        launching = false;
        final Activity a = activity.get();
        if (a == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Window window = a.getWindow();
                    int target = wanted != 0 ? wanted : PAPER;
                    painted = target;
                    if (window.getNavigationBarColor() == JADE) {
                        window.setNavigationBarColor(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? target : DCLOUD_DEFAULT);
                    }
                    View v = backing.get();
                    if (v != null && colorOf(v) == JADE) v.setBackgroundColor(target);
                    lightIcons(window, isLight(target));
                    guard(window.getDecorView());
                } catch (RuntimeException ignored) {
                    // 保留現狀
                }
            }
        });
    }

    /** 頁面顯示時呼叫：立即換成 hex（#RRGGBB）。供 mobile/src/lib/nav-bar.js 經 plus.android 呼叫。 */
    public static void paint(String hex) {
        change(hex, 0);
    }

    /** 彈窗打開或關上時呼叫：用遮罩淡入淡出的時間變成 hex（#RRGGBB）。 */
    public static void fade(String hex) {
        change(hex, FADE_MS);
    }

    private static void change(String hex, final long ms) {
        final int color;
        try {
            color = Color.parseColor(hex) | 0xFF000000;
        } catch (RuntimeException e) {
            return;
        }
        wanted = color;
        final Activity a = activity.get();
        if (a == null || launching) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    apply(a.getWindow(), color, ms);
                } catch (RuntimeException ignored) {
                    // 保留現狀
                }
            }
        });
    }

    private static void apply(final Window window, final int target, long ms) {
        View decor = window.peekDecorView();
        if (decor == null) return;
        final View v = currentBacking(decor);
        if (fading != null) {
            ValueAnimator old = fading;
            fading = null;
            old.cancel();
        }
        int from = v != null ? colorOf(v) : window.getNavigationBarColor();
        painted = target;
        if (ms <= 0 || from == target || from == 0) {
            setColor(window, v, target);
            lightIcons(window, isLight(target));
            return;
        }
        final ValueAnimator anim = ValueAnimator.ofObject(new ArgbEvaluator(), from, target);
        anim.setDuration(ms);
        final boolean[] iconsSet = {false};
        anim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator animation) {
                setColor(window, v, (Integer) animation.getAnimatedValue());
                // 變到一半才換圖示顏色，前後都不會深底配深圖示或淺底配淺圖示太久
                if (!iconsSet[0] && animation.getAnimatedFraction() >= 0.5f) {
                    iconsSet[0] = true;
                    lightIcons(window, isLight(target));
                }
            }
        });
        anim.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                if (fading == anim) fading = null;
                if (!iconsSet[0]) lightIcons(window, isLight(target));
            }
        });
        fading = anim;
        anim.start();
    }

    /** DCloud 的 io.dcloud.p.e5.updateScreenInfo 在畫面高度變化時（例如彈出鍵盤）重新排那塊底，另墊新的底時是 #FCFCFC。
     *  每次排版後檢查，是 #FCFCFC 就塗回頁面指定的顏色。只改顏色，不改 android:id/content 的外邊距（DCloud 會不停改回，兩邊會互相改來改去）。 */
    private static void guard(final View decor) {
        if (guarding) return;
        guarding = true;
        final Runnable check = new Runnable() {
            @Override
            public void run() {
                try {
                    Activity a = activity.get();
                    if (a == null || painted == 0 || fading != null) return;
                    Window window = a.getWindow();
                    View v = currentBacking(decor);
                    if (v != null && colorOf(v) == DCLOUD_DEFAULT) v.setBackgroundColor(painted);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && window.getNavigationBarColor() == DCLOUD_DEFAULT) {
                        window.setNavigationBarColor(painted);
                    }
                } catch (RuntimeException ignored) {
                    // 保留現狀
                }
            }
        };
        decor.getViewTreeObserver().addOnGlobalLayoutListener(new ViewTreeObserver.OnGlobalLayoutListener() {
            @Override
            public void onGlobalLayout() {
                // DCloud 在同一次排版裏改，等它改完才檢查
                decor.removeCallbacks(check);
                decor.post(check);
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
