"use strict";

const fs = require("fs");
const { ThreadType } = require("zalo-client");

module.exports.config = {
  name: "topchat",
  aliases: ["topmsg"],
  version: "1.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Bảng xếp hạng thành viên chat nhiều nhất hôm nay trong nhóm",
  category: "Tiện ích",
  usage: "topchat",
  cooldowns: 5,
  dependencies: { canvas: "" }
};

module.exports.run = async function ({ api, event, Threads, reply }) {
  if (event?.type !== ThreadType.Group) {
    return reply?.warn
      ? reply.warn("Lệnh /topchat chỉ dùng được trong nhóm.")
      : api.sendMessage({ msg: "Lệnh /topchat chỉ dùng được trong nhóm." }, event.threadId, event.type);
  }

  const record = await Threads.getData(String(event.threadId));
  const thread = record?.data || {};
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  const counts = thread.topchatDate === today && thread.topchatCounts
    ? thread.topchatCounts : {};
  const ranking = Object.entries(counts)
    .map(([uid, value]) => ({ uid, name: value?.name || "Thành viên", avatar: value?.avatar || "", count: Number(value?.count) || 0 }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "vi"))
    .slice(0, 10);

  if (!ranking.length) {
    const message = "📊 Hôm nay nhóm chưa có dữ liệu chat. Tin nhắn mới sẽ được tự động ghi nhận!";
    return reply?.info ? reply.info(message) : api.sendMessage({ msg: message }, event.threadId, event.type);
  }

  let imagePath;
  try {
    const { renderTopChat } = require("../../core/canvas/topchat");
    imagePath = await renderTopChat({
      title: "TOP CHAT HÔM NAY",
      subtitle: "VINH DANH TOP 3 HÔM QUA",
      ranking,
      totalMembers: ranking.length
    });
    return await api.sendMessage({ msg: "", attachments: [imagePath] }, event.threadId, event.type);
  } catch (error) {
    console.error("[TOPCHAT]", error?.stack || error);
    const lines = ranking.map((item, index) => `${index + 1}. ${item.name} — ${item.count} tin`);
    return api.sendMessage({ msg: `📊 TOP CHAT HÔM NAY\\n${lines.join("\\n")}` }, event.threadId, event.type);
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => { try { fs.rmSync(imagePath, { force: true }); } catch {} }, 60000);
      timer.unref?.();
    }
  }
};

module.exports._test = { };
