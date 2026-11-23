import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// 正式簽名金鑰：和現有 App 同一把（android/signing/，不入庫），網站 APK 每一版都要用它簽，用戶才能覆蓋更新。
// 檔案在 android/signing/release.properties；CI 可用同名環境變數代替。除錯版照舊用除錯金鑰（app/run.sh 會先移除簽名不同的 App）。
val releaseProps = Properties().apply {
    val file = rootProject.file("../../android/signing/release.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun secret(key: String): String = System.getenv(key) ?: releaseProps.getProperty(key, "")
val hasReleaseKey = secret("RELEASE_STORE_FILE").isNotEmpty()

android {
    namespace = "com.masterappinc.dualplate"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.masterappinc.dualplate"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (hasReleaseKey) {
                storeFile = rootProject.file("../../android/signing/${secret("RELEASE_STORE_FILE")}")
                storePassword = secret("RELEASE_STORE_PASSWORD")
                keyAlias = secret("RELEASE_KEY_ALIAS")
                keyPassword = secret("RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // 沒有正式金鑰（例如別的電腦）時退回除錯金鑰，只能自己試用，不能發佈：app/tool/build_apk.sh 會核對指紋
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
