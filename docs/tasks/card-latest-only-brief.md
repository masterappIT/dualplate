# 任務：批文卡只保留最新版

先讀 `AGENTS.md`。這是管理者的新決定：批文卡的歷史版本浪費空間，**以後只保存最新一版**。

## 要做的事

1. **後端**（`api/src/server.js`）：
   - 上傳正面／背面、手動修改、新建檔時，不再寫入 `approval_card_versions` 和 `approval_card_version_images`
   - 移除 `GET /api/plate-assets/:id/card-versions/:versionId/image/:side` 路由；`plateDetail` 不再回傳 `cardVersions`
   - `db.js`：以 `schema_migrations` 一次性遷移，刪除兩個版本表的全部資料後 `DROP TABLE`，並移除啟動時「為舊卡補建版本」的程式碼；遷移後執行一次 `VACUUM` 釋放空間
   - 現有的 `approval_card_images`（目前正反面原件）、`card_data`、`card_status`、`card_updated_by`、`card_updated_at` 照舊保留
2. **管理端**（`admin/src/App.vue`）：移除「批文卡檔案／版本選擇」區塊、`selectedCardVersion`、`versionImages` 及相關 watch；原件核對改為只顯示目前的正反面原件
3. **客戶端**（`mobile/src/pages/plate-detail/plate-detail.vue`）：移除版本數量和版本選擇列（`cardVersionOptions`、`selectCardVersion`、`selectedCardVersion`、「正在查看舊版」提示），模擬卡固定顯示最新資料
   - 管理者特別指出：「最新版本 · 第 1 版」這個標籤、「批文卡檔案 · N 個版本」這行都**不要再顯示**，兩端都拿掉
4. **其他批文卡效果保持不變**：兩個 `ApprovalCard.vue` 不改；模擬卡外觀、正反翻轉、疊層、單獨預覽、上傳辨識、修改內容都照常
5. **測試**：
   - 上傳或修改批文卡後，資料庫沒有任何版本記錄；版本表在遷移後不存在
   - 遷移只執行一次；舊資料庫（含版本表與資料）啟動後資料被清除、表被刪除，目前卡面資料和原件不受影響
   - `cd api && npm test`、`cd admin && npm run build`、`cd mobile && npm run build:h5` 全部通過；`api/test/customer.test.js` 不得失敗增加
6. 按 `AGENTS.md` 在瀏覽器確認管理端和客戶端的兩地牌詳情頁；無法使用瀏覽器時如實寫明

## 限制

遵守 `AGENTS.md`。本任務允許修改 `mobile/src/pages/plate-detail/plate-detail.vue` 中與版本相關的部分，其他客戶端檔案不要動。
