"use strict";

const menuPalette = require("../../core/canvas/menuPalette");

module.exports.config = {
  name: "theme",
  aliases: ["menutheme", "doimau"],
  version: "1.0.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Đổi màu menu và toàn bộ thư mục",
  category: "Hệ thống",
  usage: "theme [preset|#RRGGBB|reset]",
  cooldowns: 2,
  dependencies: {}
};

module.exports.run = async function ({ api, event, args = [] }) {
  const threadId = event?.threadId;
  const type = event?.type;
  const input = Array.isArray(args) ? String(args[0] || "").trim() : "";

  if (!input || ["help", "list", "show"].includes(input.toLowerCase())) {
    const current = menuPalette.getThemeInfo();
    const presets = menuPalette.getPresetList()
      .map(item => "• " + item.name + " — " + item.label + " (" + item.accent + ")");
    const message = [
      "🎨 THEME MENU · JOHNTRAN",
      "Đang dùng: " + current.label + " · " + current.accent,
      "",
      "Preset có sẵn:",
      ...presets,
      "",
      "Đổi theme: /theme ocean",
      "Màu tuỳ chỉnh: /theme #RRGGBB",
      "Khôi phục mặc định: /theme reset",
      "Chỉ quản trị viên bot được đổi theme."
    ].join("\n");
    return api.sendMessage({ msg: message }, threadId, type);
  }

  try {
    const selected = menuPalette.setTheme(input);
    const message = [
      "✅ ĐÃ ĐỔI THEME THÀNH CÔNG",
      "Giao diện: " + selected.label,
      "Màu nhấn: " + selected.accent,
      "Màu mới đã áp dụng đồng nhất cho /menu và tất cả thư mục.",
      "Dữ liệu theme được lưu lại sau khi bot khởi động lại."
    ].join("\n");
    return api.sendMessage({ msg: message }, threadId, type);
  } catch (error) {
    return api.sendMessage({
      msg: "❌ " + error.message + "\nDùng /theme để xem danh sách màu hợp lệ."
    }, threadId, type);
  }
};
