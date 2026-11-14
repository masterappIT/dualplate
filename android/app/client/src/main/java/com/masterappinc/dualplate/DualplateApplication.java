package com.masterappinc.dualplate;

import io.dcloud.application.DCloudApplication;

/** 在 DCloud 的 Application 上掛啟動期間的導航列處理（LaunchNavBar）和啟動畫面（LaunchCover），其餘照 DCloud 預設。 */
public class DualplateApplication extends DCloudApplication {
    @Override
    public void onCreate() {
        super.onCreate();
        registerActivityLifecycleCallbacks(new LaunchNavBar());
        registerActivityLifecycleCallbacks(new LaunchCover());
    }
}
