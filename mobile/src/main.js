import {
	createSSRApp
} from "vue";
import App from "./App.vue";
// #ifdef APP-PLUS
import { setupNavBar } from "./lib/nav-bar";
// #endif
// #ifdef H5
// 部署後，部署前打開的頁面去開未打開過的頁面時，舊版頁面檔已不存在：自動重新整理載入新版。
// 10 秒內只重新整理一次，避免網站真的出錯時不停刷新。
if (typeof window !== "undefined") {
	window.addEventListener("vite:preloadError", (event) => {
		let last = 0;
		try { last = Number(sessionStorage.getItem("reloadedForUpdate")) || 0; } catch {}
		if (Date.now() - last < 10000) return;
		event.preventDefault();
		try { sessionStorage.setItem("reloadedForUpdate", String(Date.now())); } catch {}
		window.location.reload();
	});
}
// #endif
export function createApp() {
	const app = createSSRApp(App);
	// #ifdef APP-PLUS
	// 安卓：底部導航列那一條跟頁面底色、彈窗遮罩（lib/nav-bar.js）；iOS 不經過
	if (typeof plus !== "undefined" && plus.os.name === "Android") setupNavBar(app);
	// #endif
	return {
		app,
	};
}
