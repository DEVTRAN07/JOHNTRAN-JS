"use strict";

const fs = require("fs");
const { ThreadType } = require("zalo-client");
const { vietnamDateKey, buildRanking } = require("../../core/topchat/stats");
const topchatCounter = require("../events/topchatCounter");
const { renderCanvas } = require("../../core/canvas/workerRender");

module.exports.config = {
  name: "topchat",
  aliases: ["topmsg"],
  version: "1.4.0",
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

function emptyRankingMessage(thread, today) {
  const historyComplete = thread?.topchatHistoryDate === today &&
    thread?.topchatHistoryComplete === true;
  if (historyComplete) {
    return "📊 Đã quét đủ lịch sử nhóm. Hôm nay chưa có tin nhắn phù hợp để xếp hạng.";
  }

  const reason = String(thread?.topchatHistoryReason || "");
  if (reason === "response-timeout" || reason === "request-error" ||
      reason === "empty-page" || reason === "missing-timestamps") {
    return "⚠️ Zalo chưa trả lịch sử nhóm qua WebSocket. Bot vẫn ghi nhận tin nhắn mới theo thời gian thực; hãy gửi thử tin nhắn trong nhóm rồi chạy lại /topchat.";
  }

  return "📥 Nhóm chưa có dữ liệu Topchat trong bộ đếm. Bot sẽ ghi nhận tin nhắn thành viên qua realtime và đồng bộ lịch sử qua WebSocket; hãy thử lại sau khi có tin nhắn mới.";
}

module.exports.run = async function ({ api, event, Threads, reply }) {
  if (event?.type !== ThreadType.Group) {
    return reply?.warn
      ? reply.warn("Lệnh /topchat chỉ dùng được trong nhóm.")
      : api.sendMessage({ msg: "Lệnh /topchat chỉ dùng được trong nhóm." }, event.threadId, event.type);
  }

  const threadId = String(event.threadId);
  await topchatCounter.flushGroup(threadId, Threads);
  const record = Threads.getCachedData?.(threadId) || await Threads.getData(threadId);
  const thread = record?.data || {};
  const { today, counts } = readDailyCounts(thread);
  const ranking = buildRanking(counts, 10);
  const totalMessages = Object.values(counts).reduce(
    (total, member) => total + Math.max(0, Number(member?.count) || 0), 0
  );

  if (!ranking.length) {
    const message = emptyRankingMessage(thread, today);
    return reply?.info
      ? reply.info(message)
      : api.sendMessage({ msg: message }, event.threadId, event.type);
  }

  const historyComplete = thread.topchatHistoryDate === today &&
    thread.topchatHistoryComplete === true;
  const historyLabel = historyComplete
    ? "ĐÃ QUÉT LỊCH SỬ TỪ 00:00"
    : thread.topchatHistoryDate === today && thread.topchatHistoryReason
      ? "LỊCH SỬ CHƯA ĐẦY ĐỦ"
      : "ĐANG ĐỒNG BỘ LỊCH SỬ";

  let imagePath;
  try {
    imagePath = await renderCanvas("topchat", {
      title: "TOP CHAT HÔM NAY",
      subtitle: `${historyLabel} · ${today} · ${totalMessages} TIN NHẮN`,
      ranking,
      totalMembers: ranking.length
    }, { timeout: 30000, poolSize: 2 });
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

module.exports._test = { readDailyCounts, emptyRankingMessage };
