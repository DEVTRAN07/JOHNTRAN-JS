"use strict";

const fs = require("fs");
const botVersion = require("../../package.json").version;
const folders = require("../../core/runtime/folderMenu");

module.exports.config = {
  name: "menu",
  aliases: [],
  version: "5.4.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Hiển thị danh mục chức năng dạng Card",
  category: "Tiện ích",
  usage: "",
  cooldowns: 0,
  dependencies: {}
};

module.exports.run = async function ({ api, event }) {
  const senderId = event?.data?.uidFrom;
  const commands = global.client?.commands;
  if (!(commands instanceof Map)) {
    return api.sendMessage({ msg: "📂 Danh mục đang được khởi tạo, vui lòng thử lại." }, event.threadId, event.type);
  }

  let imagePath;
  try {
    const list = folders.collectFolders(commands, senderId);
    const cards = list.map(folder => ({
      name: folder.name,
      usage: `${folder.count} lệnh · /${folder.slug}`,
      category: folder.description
    }));
    const { renderMenuGrid } = require("../../core/canvas/menu");
    imagePath = await renderMenuGrid({
      requesterName: String(event?.data?.dName || event?.data?.senderName || "Người dùng").slice(0, 32),
      requesterAvatarUrl: "",
      botVersion,
      prefix: global.config?.prefix || "/",
      page: 1,
      totalPages: 1,
      commands: cards,
      totalCommands: cards.reduce((sum, card) => sum + Number.parseInt(card.usage, 10) || sum, 0)
    });
    return await api.sendMessage({ msg: "Danh sách tính năng · Gõ /tên_danh_mục để xem chi tiết", attachments: [imagePath], ttlKind: "card" }, event.threadId, event.type);
  } catch (error) {
    console.error("[MENU_IMAGE]", error?.stack || error);
    return api.sendMessage({ msg: "⚠️ Không thể tạo menu dạng Card. Vui lòng thử lại." }, event.threadId, event.type);
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => { try { fs.rmSync(imagePath, { force: true }); } catch {} }, 60000);
      timer.unref?.();
    }
  }
};

module.exports._test = folders;
