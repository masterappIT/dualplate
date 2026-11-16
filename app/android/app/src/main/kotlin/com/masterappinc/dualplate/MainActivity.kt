package com.masterappinc.dualplate

import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // 系統版本：申請讀相片權限時，Android 13 起用 READ_MEDIA_IMAGES，12 或以下用讀儲存空間（lib/business/pick_image.dart）
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "dualplate/system").setMethodCallHandler { call, result ->
            if (call.method == "sdkInt") result.success(Build.VERSION.SDK_INT) else result.notImplemented()
        }
    }
}
