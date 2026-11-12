"use strict";

const fs = require("fs");
const botVersion = require("../../package.json").version;
const folders = require("../../core/runtime/folderMenu");
const { getRequesterProfile } = require("../../core/runtime/requesterProfile");

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
    const profile = await getRequesterProfile(api, event);
    const list = folders.collectFolders(commands, senderId);
    const menuDefinitions = [
      { name: "Game", slug: "game", category: "Giải trí & Game" },
      { name: "Tools", slug: "tools", category: "Công cụ hỗ trợ" },
      { name: "Music", slug: "music", category: "Nghe nhạc trực tuyến" },
      { name: "Anti", slug: "anti", category: "Bảo vệ nhóm" },
      { name: "Manager", slug: "manager", category: "Quản lý nhóm" },
      { name: "Admin", slug: "admin", category: "Quản trị hệ thống" },
      { name: "Mybot", slug: "mybot", category: "Quản lý bot" },
      { name: "Hidden", slug: "hidden", category: "Lệnh ẩn" },
      { name: "Khác", slug: "khac", category: "Thêm tính năng" }
    ];
    const cards = menuDefinitions.map(item => {
      const folder = folders.resolveFolder(commands, senderId, item.slug);
      return {
        name: item.name,
        usage: folder ? `${folder.count} lệnh · /${item.slug}` : `/${item.slug}`,
        category: item.category
      };
    });
    const totalVisibleCommands = list.reduce((sum, folder) => sum + folder.count, 0);
    const { renderMenuGrid } = require("../../core/canvas/menu");
    imagePath = await renderMenuGrid({
      requesterName: profile.requesterName,
      requesterAvatarUrl: profile.requesterAvatarUrl,
      botVersion,
      prefix: global.config?.prefix || "/",
      page: 1,
      totalPages: 1,
      commands: cards,
      totalCommands: totalVisibleCommands
    });
    const mentionName = profile.requesterName;
    const mentionUid = event?.data?.uidFrom;
    const caption = `@\u200b${mentionName}\n🤖 Chào bạn!\n👉 Hôm nay có gì hay không? Hãy chọn tính năng bạn muốn nhé! 📍`;
    const mentions = mentionUid ? [{ uid: String(mentionUid), pos: 0, len: mentionName.length + 1 }] : [];
    return await api.sendMessage({
      msg: caption,
      mentions,
      attachments: [imagePath],
      ttlKind: "card"
    }, event.threadId, event.type);
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
