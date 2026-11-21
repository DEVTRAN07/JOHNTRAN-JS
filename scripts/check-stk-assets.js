#!/usr/bin/env node
"use strict";

const stk = require("../core/stkDiscordService");

const status = stk.getAssetStatus();
const catalogValid = Boolean(stk.catalog &&
  stk.catalog.total === 200 &&
  Array.isArray(stk.catalog.items) &&
  stk.catalog.items.length === 200 &&
  stk.catalog.items.every((item, index) =>
    item.id === index + 1 &&
    typeof item.file === "string" &&
    item.file.endsWith(".png")
  ));

console.log("STK Discord local asset check");
console.log("Nguồn ghim: " + stk.RAW_BASE_URL);
console.log("Thư mục src: " + status.directory);
console.log("Menu local: " + (status.menu.exists ? "YES" : "NO"));
console.log("Khung local: " + status.available + "/" + status.total);
console.log("Khung còn thiếu: " + status.missingCount);

if (!catalogValid) {
  console.error("FAIL: catalog STK phải có đủ 200 ID liên tục và tên file hợp lệ.");
  process.exitCode = 1;
} else if (status.available !== 200 || !status.menu.exists) {
  console.error("FAIL: thiếu tài nguyên local. Chạy: npm run assets:stk");
  process.exitCode = 1;
} else {
  console.log("PASS: đủ 200 khung và menu đã có trong src/assets/stk.");
}
