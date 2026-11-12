"use strict";

const fs = require("fs");
const { ThreadType } = require("zalo-client");
const {
  vietnamDateKey,
  aggregateMessages,
  buildRanking
} = require("../../core/topchat/stats");

const HISTORY_LIMIT = 200;

module.exports.config = {
  name: "topchat",
  aliases: ["topmsg"],
  version: "1.1.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Bảng xếp hạng thành viên chat nhiều nhất hôm nay trong nhóm",
  category: "Tiện ích",
  usage: "topchat",
  cooldowns: 5,
  dependencies: { canvas: "" }
};

function mergeCounts(target, addition) {
  for (const [uid, item] of Object.entries(addition || {})) {
    const current = target[uid] || { count: 0, name: item.name || "Thành viên", avatar: item.avatar || "" };
    current.count = (Number(current.count) || 0) + (Number(item.count) || 0);
    current.name = item.name || current.name;
    current.avatar = item.avatar || current.avatar;
    target[uid] = current;
  }
  return target;
}

async function readHistoryCounts(api, threadId, dateKey, prefix, seenIds) {
  if (typeof api?.getGroupChatHistory !== "function") {
    throw new Error("Zalo API không hỗ trợ getGroupChatHistory");
  }
  const response = await api.getGroupChatHistory(String(threadId), HISTORY_LIMIT);
  const messages = Array.isArray(response?.groupMsgs)
    ? response.groupMsgs
    : Array.isArray(response?.data?.groupMsgs)
      ? response.data.groupMsgs
      : [];
  return aggregateMessages(messages, dateKey, prefix, "", seenIds);
}

module.exports.run = async function ({ api, event, Threads, reply }) {
  if (event?.type !== ThreadType.Group) {
    return reply?.warn
      ? reply.warn("Lệnh /topchat chỉ dùng được trong nhóm.")
      : api.sendMessage({ msg: "Lệnh /topchat chỉ dùng được trong nhóm." }, event.threadId, event.type);
  }

  const threadId = String(event.threadId);
  const record = await Threads.getData(threadId);
  const thread = record?.data || {};
  const today = vietnamDateKey();
  const prefix = String(thread.prefix || global.config?.prefix || "/");
  const counts = thread.topchatDate === today && thread.topchatCounts
    ? { ...thread.topchatCounts }
    : {};

  let historyRead = false;
  let historyError = null;
  try {
    const historyCounts = await readHistoryCounts(
      api,
      threadId,
      today,
      prefix,
      thread.topchatDate === today ? thread.topchatSeenMessageIds || [] : []
    );
    mergeCounts(counts, historyCounts);
    historyRead = true;
  } catch (error) {
    historyError = error;
    console.warn("[TOPCHAT] Không đọc được lịch sử nhóm:", error?.message || error);
  }

  const ranking = buildRanking(counts, 10);
  if (!ranking.length) {
    const message = historyRead
      ? "📊 Hôm nay nhóm chưa có tin nhắn để xếp hạng. Bot sẽ tiếp tục ghi nhận tin nhắn mới."
      : "⚠️ Chưa đọc được lịch sử nhóm và chưa có dữ liệu realtime. Hãy kiểm tra kết nối Zalo rồi thử lại.";
    return reply?.info
      ? reply.info(message)
      : api.sendMessage({ msg: message }, event.threadId, event.type);
  }

  let imagePath;
  try {
    const { renderTopChat } = require("../../core/canvas/topchat");
    imagePath = await renderTopChat({
      title: "TOP CHAT HÔM NAY",
      subtitle: historyRead ? "LỊCH SỬ ZALO + THỐNG KÊ REALTIME" : "THỐNG KÊ REALTIME",
      ranking,
      totalMembers: ranking.length
    });
    return await api.sendMessage({ msg: "", attachments: [imagePath] }, event.threadId, event.type);
  } catch (error) {
    console.error("[TOPCHAT]", error?.stack || error);
    const lines = ranking.map((item, index) => `${index + 1}. ${item.name} — ${item.count} tin`);
    const suffix = historyError ? "\n⚠️ Lịch sử Zalo tạm thời không khả dụng; số liệu lấy từ realtime." : "";
    return api.sendMessage({
      msg: `📊 TOP CHAT HÔM NAY\n${lines.join("\n")}${suffix}`
    }, event.threadId, event.type);
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => { try { fs.rmSync(imagePath, { force: true }); } catch {} }, 60000);
      timer.unref?.();
    }
  }
};

module.exports._test = { mergeCounts, readHistoryCounts, HISTORY_LIMIT };
