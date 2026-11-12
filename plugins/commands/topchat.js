"use strict";

const fs = require("fs");
const { ThreadType } = require("zalo-client");
const { vietnamDateKey, buildRanking } = require("../../core/topchat/stats");
const topchatCounter = require("../events/topchatCounter");
const { renderCanvas } = require("../../core/canvas/workerRender");

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

const GROUP_HISTORY_FALLBACK_COOLDOWN_MS = 15000;
const groupHistoryFallbackAt = new Map();

async function backfillCurrentGroupHistory(api, threadId, Threads) {
  const key = String(threadId || "");
  if (!key || typeof api?.getGroupChatHistory !== "function") {
    return { available: false, reason: "group-history-api-unavailable", received: 0, added: 0 };
  }

  const now = Date.now();
  const lastAttempt = groupHistoryFallbackAt.get(key) || 0;
  if (now - lastAttempt < GROUP_HISTORY_FALLBACK_COOLDOWN_MS) {
    return { available: true, skipped: true, reason: "cooldown", received: 0, added: 0 };
  }
  groupHistoryFallbackAt.set(key, now);

  const response = await api.getGroupChatHistory(key, 50);
  const messages = Array.isArray(response?.groupMsgs)
    ? response.groupMsgs
    : Array.isArray(response?.data?.groupMsgs)
      ? response.data.groupMsgs
      : [];
  const imported = await topchatCounter.recordHistoryMessages(messages, Threads);

  // This endpoint returns only the latest page, not a guaranteed full-day
  // archive. Mark it as partial so the bot never claims complete coverage.
  await topchatCounter.markHistoryCoverage(
    [key], Threads, vietnamDateKey(), false, 0, "group-api-fallback"
  );
  await topchatCounter.flushGroup(key, Threads);

  return {
    available: true,
    received: messages.length,
    added: Number(imported?.messages) || 0,
    reason: messages.length ? "latest-page-imported" : "empty-group-history"
  };
}

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
  await topchatCounter.flushGroup(threadId, Threads);
  const record = Threads.getCachedData?.(threadId) || await Threads.getData(threadId);
  const thread = record?.data || {};
  const { today, counts } = readDailyCounts(thread);
  const ranking = buildRanking(counts, 10);
  const totalMessages = Object.values(counts).reduce(
    (total, member) => total + Math.max(0, Number(member?.count) || 0), 0
  );

  if (!ranking.length) {
    const invalidCoverageReasons = new Set([
      "empty-page", "missing-timestamps", "response-timeout",
      "request-error", "connection-closed", "page-limit", "missing-cursor"
    ]);
    const historyComplete = thread.topchatHistoryDate === today &&
      thread.topchatHistoryComplete === true &&
      !invalidCoverageReasons.has(String(thread.topchatHistoryReason || ""));
    let message;
    if (historyFallback?.error) {
      message = "⚠️ Không đọc được lịch sử nhóm từ Zalo: " +
        String(historyFallback.error).slice(0, 180) +
        "\\nBot vẫn tiếp tục ghi nhận tin nhắn mới qua realtime.";
    } else if (historyFallback?.available && !historyFallback.skipped && historyFallback.received === 0) {
      message = "⚠️ Zalo không trả tin nhắn từ API lịch sử nhóm. Bot đang chờ dữ liệu realtime; hãy nhắn thử một tin trong nhóm rồi chạy lại /topchat.";
    } else if (historyComplete) {
      message = "📊 Đã quét đủ lịch sử nhưng hôm nay chưa có tin nhắn phù hợp để xếp hạng.";
    } else {
      message = "📥 Chưa đủ dữ liệu xếp hạng. Bot đang ghi nhận realtime và thử đồng bộ lịch sử nhóm; hãy thử lại sau khi có thêm tin nhắn.";
    }
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

module.exports._test = { readDailyCounts, backfillCurrentGroupHistory, groupHistoryFallbackAt, GROUP_HISTORY_FALLBACK_COOLDOWN_MS };
