"use strict";

const { downloadAllAssets } = require("./download-stk-assets");

downloadAllAssets().then(result => {
  if (result.missing > 0 || result.menuMissing) {
    console.warn("[stk-assets] Một số khung chưa tải được; bot vẫn khởi động và sẽ thử tải khung được yêu cầu.");
  }
}).catch(error => {
  // Asset prewarming is best-effort: a GitHub outage must not stop the Zalo bot.
  console.warn("[stk-assets] Không thể tải trước toàn bộ khung; bot vẫn tiếp tục:", error?.message || error);
});
