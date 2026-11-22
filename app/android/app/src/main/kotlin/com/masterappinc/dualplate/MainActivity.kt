package com.masterappinc.dualplate

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.widget.Toast
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "dualplate/system").setMethodCallHandler { call, result ->
            when (call.method) {
                // 系統版本：申請讀相片權限時，Android 13 起用 READ_MEDIA_IMAGES，12 或以下用讀儲存空間（lib/business/pick_image.dart）
                "sdkInt" -> result.success(Build.VERSION.SDK_INT)
                // 顧問卡「致電」（lib/business/advisor_card.dart）：打開撥號畫面，號碼已填好
                "dial" -> {
                    startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + (call.arguments as? String ?: ""))))
                    result.success(null)
                }
                // 分頁按返回鍵「再按一次退出應用」（lib/shell/back_quit.dart）：系統提示，同 plus.nativeUI.toast
                "toast" -> {
                    Toast.makeText(this, call.arguments as? String ?: "", Toast.LENGTH_SHORT).show()
                    result.success(null)
                }
                // 2 秒內再按返回鍵：關掉畫面（plus.runtime.quit），程序可能留着
                "quit" -> {
                    result.success(null)
                    finish()
                }
                // 條款同意框按「退出 App」：連程序一起結束（現有 App 按下後程序也不在了）
                "exitApp" -> {
                    result.success(null)
                    finishAffinity()
                    Process.killProcess(Process.myPid())
                }
                // 條款同意框裏的連結：交給系統瀏覽器
                "openUrl" -> {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(call.arguments as? String ?: "")))
                    } catch (e: RuntimeException) {
                        // 沒有瀏覽器：不做甚麼
                    }
                    result.success(null)
                }
                // App 內更新（lib/business/app_update.dart，照 mobile/src/lib/app-update.js）
                "versionCode" -> result.success(installedVersion())
                "downloadDir" -> {
                    val dir = File(filesDir, "_downloads")
                    dir.mkdirs()
                    result.success(dir.absolutePath)
                }
                "apkInfo" -> result.success(apkInfo(call.arguments as? String ?: ""))
                "installApk" -> result.success(install(call.arguments as? String ?: ""))
                else -> result.notImplemented()
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun versionOf(info: android.content.pm.PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    // 已安裝 APK 的 versionCode（pubspec.yaml version 的 + 後面）
    private fun installedVersion(): Long = try {
        versionOf(packageManager.getPackageInfo(packageName, 0))
    } catch (e: PackageManager.NameNotFoundException) {
        0
    }

    // 下載到的 APK 的包名和 versionCode，以及本 App 的包名；讀不到回傳 null
    private fun apkInfo(path: String): Map<String, Any?>? = try {
        val info = packageManager.getPackageArchiveInfo(path, 0)
        if (info == null) null else mapOf("name" to info.packageName, "code" to versionOf(info), "own" to packageName)
    } catch (e: RuntimeException) {
        null
    }

    // 交給系統安裝（同 DCloud 的 plus.runtime.install：FileProvider + ACTION_VIEW）；
    // 第一次系統安裝畫面會先要求允許本 App「安裝未知應用」，允許後自動回到安裝畫面
    private fun install(path: String): Boolean = try {
        val uri = FileProvider.getUriForFile(this, "$packageName.update", File(path))
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        true
    } catch (e: RuntimeException) {
        false
    }
}
