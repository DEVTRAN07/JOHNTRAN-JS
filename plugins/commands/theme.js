"use strict";

const fs = require("fs");
const menuPalette = require("../../core/canvas/menuPalette");
const { renderCanvas } = require("../../core/canvas/workerRender");

module.exports.config = {
  name: "theme",
  aliases: ["menutheme", "doimau"],
  version: "2.0.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Chỉnh màu /menu và các thẻ thư mục",
  category: "Hệ thống",
  usage: "theme [preset|#RRGGBB|reset]",
  cooldowns: 2,
  dependencies: { canvas: "" }
};

function buildText(current, presets) {
  return [
    "🎨 THEME MENU · JOHNTRAN",
    "Đang dùng: " + current.label + " · " + current.accent,
    "",
    "Preset có sẵn:",
    ...presets.map(item => "• " + item.name + " — " + item.label + " (" + item.accent + ")"),
    "",
    "Đổi theme: /theme ocean",
    "Màu tuỳ chỉnh: /theme #RRGGBB",
    "Khôi phục mặc định: /theme reset",
    "Chỉ quản trị viên bot được đổi theme."
  ].join("\n");
}

function cleanupLater(filePath) {
  if (!filePath) return;
  const timer = setTimeout(() => { try { fs.rmSync(filePath, { force: true }); } catch {} }, 60000);
  timer.unref?.();
}

async function sendThemeCard(api, event) {
  const current = menuPalette.getThemeInfo();
  const presets = menuPalette.getPresetList();
  const fallback = buildText(current, presets);
  let imagePath;
  try {
    imagePath = await renderCanvas("theme", { current, presets }, { timeout: 30000, poolSize: 2 });
    return await api.sendMessage({ msg: "", attachments: [imagePath], ttlKind: "card" }, event.threadId, event.type);
  } catch (error) {
    console.error("[THEME_CANVAS]", error?.stack || error);
    return api.sendMessage({ msg: fallback }, event.threadId, event.type);
  } finally { cleanupLater(imagePath); }
}

module.exports.run = async function ({ api, event, args = [] }) {
  const threadId = event?.threadId;
  const type = event?.type;
  const input = Array.isArray(args) ? String(args[0] || "").trim() : "";

  if (!input || ["help", "list", "show"].includes(input.toLowerCase())) {
    return sendThemeCard(api, event);
  }

  try {
    const selected = menuPalette.setTheme(input);
    const message = [
      "✅ ĐÃ ĐỔI THEME THÀNH CÔNG",
      "Giao diện: " + selected.label,
      "Màu nhấn: " + selected.accent,
      "Màu mới chỉ áp dụng cho /menu và các thẻ thư mục.",
      "Các Canvas khác giữ giao diện mặc định, không dùng ảnh nền theme.",
      "Dữ liệu theme được lưu lại sau khi bot khởi động lại."
    ].join("\n");
    return api.sendMessage({ msg: message }, threadId, type);
  } catch (error) {
    return api.sendMessage({ msg: "❌ " + error.message + "\nDùng /theme để xem danh sách màu hợp lệ." }, threadId, type);
  }
};

module.exports._test = { buildText };
