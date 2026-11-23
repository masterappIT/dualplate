import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // 顧問卡「致電」（lib/business/advisor_card.dart callAdvisor）：照 uni.makePhoneCall 打開 tel:，iOS 會先問「撥打…？」
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "DualplateSystem") {
      FlutterMethodChannel(name: "dualplate/system", binaryMessenger: registrar.messenger()).setMethodCallHandler { call, result in
        if call.method == "dial", let number = call.arguments as? String, let url = URL(string: "tel:\(number)") {
          UIApplication.shared.open(url)
          result(nil)
        } else if call.method == "versionName" {
          // 線上客服帶入的「來自」（lib/business/support.dart）：iPhone App 1.1.0
          result(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
        } else {
          result(FlutterMethodNotImplemented)
        }
      }
    }
  }
}
