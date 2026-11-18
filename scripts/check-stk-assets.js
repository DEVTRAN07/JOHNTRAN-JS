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

console.log("STK Discord remote asset check");
console.log("Nguồn raw GitHub: " + stk.RAW_BASE_URL);
console.log("Cache cục bộ: " + status.directory);
console.log("Menu đã cache: " + (status.menu.exists ? "YES" : "NO"));
console.log("Khung đã cache: " + status.available + "/" + status.total);
console.log("Khung chưa cache: " + status.missingCount);

if (!catalogValid) {
  console.error("FAIL: catalog STK phải có đủ 200 ID liên tục và tên file hợp lệ.");
  process.exitCode = 1;
} else {
  console.log("PASS: catalog hợp lệ; bot sẽ tải menu/khung theo nhu cầu từ raw GitHub.");
  console.log("Không cần chép 200 ảnh vào repository JOHNTRAN-JS.");
}
