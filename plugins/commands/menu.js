"use strict";

const fs = require("fs");
const botVersion = require("../../package.json").version;
const folders = require("../../core/runtime/folderMenu");

module.exports.config = {
  name: "menu",
  aliases: ["help", "folder", "folders"],
  version: "5.2.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Danh mục thư mục và toàn bộ lệnh dạng thẻ ảnh",
  category: "Tiện ích",
  usage: "[tên thư mục|tổng]",
  cooldowns: 0,
  dependencies: {}
};

function requesterName(event) {
  return String(
    event?.data?.dName ||
    event?.data?.senderName ||
    event?.data?.name ||
    "Người dùng"
  ).slice(0, 32);
}

async function sendImageMenu(api, event, cards, totalCommands, pageTitle = "Danh sách tính năng") {
  const { threadId, type } = event;
  const { renderMenuGrid } = require("../../core/canvas/menu");
  const imagePath = await renderMenuGrid({
    requesterName: requesterName(event),
    requesterAvatarUrl: "",
    botVersion,
    prefix: global.config?.prefix || "/",
    page: 1,
    totalPages: 1,
    commands: cards,
    totalCommands
  });

  try {
    return await api.sendMessage({
      msg: pageTitle,
      attachments: [imagePath],
      ttlKind: "card"
    }, threadId, type);
  } finally {
    // Zalo SDK uploads the attachment during sendMessage; keep a short
    // grace period for asynchronous file reads, then remove the temp image.
    setTimeout(() => {
      try { fs.rmSync(imagePath, { force: true }); } catch { /* cleanup only */ }
    }, 60000).unref?.();
  }
}

module.exports.run = async function ({ api, event, args = [] }) {
  const senderId = event?.data?.uidFrom;
  const prefix = global.config?.prefix || "/";
  const commands = global.client?.commands;

  if (!(commands instanceof Map)) {
    return api.sendMessage({
      msg: "📂 Danh mục lệnh đang được khởi tạo, vui lòng thử lại sau."
    }, event.threadId, event.type);
  }

  const requested = args.join(" ").trim();
  const normalized = folders.normalizeFolder(requested);

  try {
    if (normalized && folders.ALL_FOLDER_KEYS.has(normalized)) {
      const groups = folders.collectAllCommands(commands, senderId);
      const cards = groups.flatMap(group => group.commands.map(command => ({
        name: command.name,
        usage: command.usage,
        category: group.name
      })));
      const total = cards.length;
      return sendImageMenu(api, event, cards, total, "Danh sách toàn bộ tính năng");
    }

    if (requested) {
      const folder = folders.resolveFolder(commands, senderId, requested);
      if (folder) {
        const items = folders.collectFolderCommands(commands, senderId, folder);
        const cards = items.map(command => ({
          name: command.name,
          usage: command.usage,
          category: folder.name
        }));
        return sendImageMenu(
          api,
          event,
          cards,
          items.length,
          `Chi tiết chức năng: ${folder.name} · ${folder.description}`
        );
      }

      return api.sendMessage({
        msg: `❓ Không tìm thấy thư mục "${requested}". Gõ ${prefix}menu để xem danh mục.`
      }, event.threadId, event.type);
    }

    const list = folders.collectFolders(commands, senderId);
    const total = list.reduce((sum, folder) => sum + folder.count, 0);
    const cards = list.map(folder => ({
      name: folder.name,
      usage: `${folder.count} lệnh · ${prefix}${folder.slug}`,
      category: folder.description
    }));
    return sendImageMenu(api, event, cards, total, "Danh sách tính năng");
  } catch (error) {
    console.error("[MENU_IMAGE]", error?.stack || error);
    return api.sendMessage({
      msg: "⚠️ Không thể tạo menu dạng ảnh. Vui lòng thử lại sau."
    }, event.threadId, event.type);
  }
};

module.exports._test = folders;
