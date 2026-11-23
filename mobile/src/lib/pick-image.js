// 選相片（相機或相簿），參數和回呼與 uni.chooseImage 相同。
// 以前安卓 App 在這裏加上權限用途說明卡；App 改用 Flutter 後（docs/tasks/flutter-app-plan.md 階段 6），網頁版和小程序直接用 uni.chooseImage。
export function pickImage(options) {
  return uni.chooseImage(options)
}
