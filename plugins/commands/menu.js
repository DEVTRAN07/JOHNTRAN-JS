"use strict";

const botVersion = require("../../package.json").version;
const folders = require("../../core/runtime/folderMenu");

module.exports.config = {
  name: "menu",
  aliases: ["help"],
  version: "5.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Danh mục thư mục và toàn bộ lệnh bot",
  category: "Tiện ích",
  usage: "[tên thư mục]",
  cooldowns: 0,
  dependencies: {}
};

module.exports.run = async function ({ api, event, args = [] }) {
  const threadId = event.threadId;
  const type = event.type;
  const senderId = event?.data?.uidFrom;
  const prefix = global.config?.prefix || "/";
  const botName = global.config?.name_bot || "JOHNTRAN";
  const commands = global.client?.commands;

  if (!(commands instanceof Map)) {
    return api.sendMessage({ msg: "⚠️ Danh sách lệnh chưa sẵn sàng." }, threadId, type);
  }

  const requested = args.join(" ").trim();
  if (requested) {
    const folder = folders.resolveFolder(commands, senderId, requested);
    if (folder) {
      const items = folders.collectFolderCommands(commands, senderId, folder);
      return api.sendMessage({
        msg: folders.renderFolder(folder, items, prefix, botName, botVersion)
      }, threadId, type);
    }
    return api.sendMessage({
      msg: `❓ Không tìm thấy thư mục "${requested}". Gõ ${prefix}menu để xem danh mục.`
    }, threadId, type);
  }

  const list = folders.collectFolders(commands, senderId);
  return api.sendMessage({
    msg: folders.renderFolders(list, prefix, botName, botVersion)
  }, threadId, type);
};

module.exports._test = folders;
