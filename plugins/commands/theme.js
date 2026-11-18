"use strict";

const fs = require("fs");
const themeBackgrounds = require("../../core/canvas/themeBackgrounds");
const { renderCanvas } = require("../../core/canvas/workerRender");

module.exports.config = {
  name: "theme",
  aliases: ["menutheme", "doimau", "wallpaper"],
  version: "3.0.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Chọn ảnh nền Aurora cho toàn bộ Canvas của bot",
  category: "Hệ thống",
  usage: "theme [1|2|3|random|next|reset]",
  cooldowns: 2,
  dependencies: { canvas: "" }
};

function buildText(current, backgrounds) {
  return [
    "🖼️ JOHNTRAN · PHOTO THEME LIBRARY",
    "Nền hiện tại: " + (current.name || "Aurora random"),
    "",
    ...backgrounds.map(item =>
      (item.id === current.selected ? "✓ " : "  ") +
      item.id + ". " + item.name + " — /theme " + item.id
    ),
    "",
    "/theme random — chọn ngẫu nhiên mỗi ảnh",
    "/theme next — chuyển sang ảnh kế tiếp",
    "/theme reset — trở về chế độ ngẫu nhiên",
    "",
    "Ảnh nền nằm ở thư mục theme/. Các lớp kính/Aurora phía trên dùng độ trong suốt để giữ ảnh rõ mà chữ vẫn dễ đọc."
  ].join("\n");
}

function cleanupLater(filePath) {
  if (!filePath) return;
  const timer = setTimeout(() => {
    try { fs.rmSync(filePath, { force: true }); } catch {}
  }, 60000);
  timer.unref?.();
}

async function sendThemeCard(api, event, notice = "") {
  const current = themeBackgrounds.getCurrent();
  const backgrounds = themeBackgrounds.getBackgrounds();
  const fallback = [notice, buildText(current, backgrounds)].filter(Boolean).join("\n\n");
  let imagePath;
  try {
    imagePath = await renderCanvas("theme", { current, backgrounds }, {
      timeout: 45000,
      poolSize: 2
    });
    return await api.sendMessage({
      msg: notice,
      attachments: [imagePath],
      ttlKind: "card"
    }, event.threadId, event.type);
  } catch (error) {
    console.error("[THEME_GALLERY]", error?.stack || error);
    return api.sendMessage({ msg: fallback }, event.threadId, event.type);
  } finally {
    cleanupLater(imagePath);
  }
}

module.exports.run = async function ({ api, event, args = [] }) {
  const input = Array.isArray(args) ? String(args[0] || "").trim() : "";
  if (!input || ["help", "list", "show", "gallery"].includes(input.toLowerCase())) {
    return sendThemeCard(api, event);
  }

  try {
    const selected = themeBackgrounds.setSelection(input);
    const notice = selected.random
      ? "✅ Đã bật chế độ nền ảnh ngẫu nhiên cho tất cả Canvas."
      : "✅ Đã chọn " + selected.name + " làm nền chung cho tất cả Canvas.";
    return sendThemeCard(api, event, notice);
  } catch (error) {
    return api.sendMessage({
      msg: "❌ " + error.message + "\nDùng /theme để xem thư viện ảnh nền."
    }, event.threadId, event.type);
  }
};

module.exports._test = { buildText, cleanupLater };
