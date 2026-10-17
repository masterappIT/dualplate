import {
	createSSRApp
} from "vue";
import App from "./App.vue";
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
	return {
		app,
	};
}
