"use strict";

const fs = require("fs");
const { ThreadType } = require("zalo-client");
const { vietnamDateKey, buildRanking } = require("../../core/topchat/stats");

module.exports.config = {
  name: "topchat",
  aliases: ["topmsg"],
  version: "1.2.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Tìm thành viên gửi nhiều tin nhắn nhất trong ngày của nhóm",
  category: "Tiện ích",
  usage: "topchat",
  cooldowns: 5,
  dependencies: { canvas: "" }
};

function readDailyCounts(thread) {
  const today = vietnamDateKey();
  if (thread?.topchatDate !== today) return { today, counts: {} };
  const counts = thread.topchatCounts && typeof thread.topchatCounts === "object"
    ? thread.topchatCounts : {};
  return { today, counts };
}

module.exports.run = async function ({ api, event, Threads, reply }) {
  if (event?.type !== ThreadType.Group) {
    return reply?.warn
      ? reply.warn("Lệnh /topchat chỉ dùng được trong nhóm.")
      : api.sendMessage({ msg: "Lệnh /topchat chỉ dùng được trong nhóm." }, event.threadId, event.type);
  }

  const threadId = String(event.threadId);
  const record = Threads.getCachedData?.(threadId) || await Threads.getData(threadId);
  const thread = record?.data || {};
  const { today, counts } = readDailyCounts(thread);
  const ranking = buildRanking(counts, 10);
  const totalMessages = Object.values(counts).reduce(
    (total, member) => total + Math.max(0, Number(member?.count) || 0), 0
  );

  if (!ranking.length) {
    return reply?.info
      ? reply.info(
          "📊 Hôm nay nhóm chưa có dữ liệu để xếp hạng. Bot sẽ ghi nhận tin nhắn trong ngày và bổ sung lịch sử nhóm được Zalo gửi qua WebSocket."
        )
      : api.sendMessage({
          msg: "📊 Hôm nay nhóm chưa có dữ liệu để xếp hạng. Bot sẽ ghi nhận tin nhắn trong ngày và bổ sung lịch sử nhóm được Zalo gửi qua WebSocket."
        }, event.threadId, event.type);
  }

  let imagePath;
  try {
    const { renderTopChat } = require("../../core/canvas/topchat");
    imagePath = await renderTopChat({
      title: "TOP CHAT HÔM NAY",
      subtitle: `THỐNG KÊ CẢ NGÀY · ${today} · ${totalMessages} TIN NHẮN`,
      ranking,
      totalMembers: ranking.length
    });
    return await api.sendMessage({ msg: "", attachments: [imagePath] }, event.threadId, event.type);
  } catch (error) {
    console.error("[TOPCHAT]", error?.stack || error);
    const lines = ranking.map((item, index) => `${index + 1}. ${item.name} — ${item.count} tin`);
    return api.sendMessage({
      msg: `📊 TOP CHAT HÔM NAY · ${today}\nTổng ${totalMessages} tin nhắn\n${lines.join("\n")}`
    }, event.threadId, event.type);
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => { try { fs.rmSync(imagePath, { force: true }); } catch {} }, 60000);
      timer.unref?.();
    }
  }
};

module.exports._test = { readDailyCounts };
