"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { getAssetStatus } = require("../core/stkDiscordService");

const status = getAssetStatus();
if (status.available === status.total && status.menu.exists) {
  console.info("[stk-assets] Đã có đủ " + status.total +
    " khung và menu local; bỏ qua tải mạng.");
  process.exit(0);
}

console.info("[stk-assets] Đang chuẩn bị " + status.missingCount +
  " khung còn thiếu trước khi bot nhận lệnh STK.");
const downloader = path.join(__dirname, "download-stk-assets.js");
const result = spawnSync(process.execPath, [downloader], {
  cwd: path.resolve(__dirname, ".."),
  stdio: "inherit",
  windowsHide: true,
  env: process.env
});

if (result.error) {
  console.error("[stk-assets] Không chạy được downloader:", result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error("[stk-assets] Tài nguyên chưa tải đủ; kiểm tra kết quả ở trên.");
  process.exit(Number.isInteger(result.status) ? result.status : 1);
}
