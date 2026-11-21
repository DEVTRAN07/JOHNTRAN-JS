"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const downloader = path.join(__dirname, "download-stk-assets.js");

try {
  const child = spawn(process.execPath, [downloader], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env
  });
  child.once("error", error => {
    console.warn("[stk-assets] Không khởi chạy được tiến trình tải nền:", error?.message || error);
  });
  child.unref();
} catch (error) {
  // Asset prewarming is best-effort and must never delay or block bot startup.
  console.warn("[stk-assets] Bỏ qua tải trước tài nguyên:", error?.message || error);
}
