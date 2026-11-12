"use strict";

const fs = require("fs");
const { ThreadType } = require("zalo-client");
const {
  vietnamDateKey,
  aggregateMessages,
  buildRanking
} = require("../../core/topchat/stats");

const HISTORY_LIMIT = 200;
const HISTORY_CACHE_TTL_MS = 30000;
const HISTORY_RESPONSE_BUDGET_MS = 650;
const historyCache = new Map();
const historyFlights = new Map();

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

async function readHistoryMessages(api, threadId) {
  if (typeof api?.getGroupChatHistory !== "function") {
    throw new Error("Zalo API không hỗ trợ getGroupChatHistory");
  }
  const response = await api.getGroupChatHistory(String(threadId), HISTORY_LIMIT);
  return Array.isArray(response?.groupMsgs)
    ? response.groupMsgs
    : Array.isArray(response?.data?.groupMsgs)
      ? response.data.groupMsgs
      : [];
}

function countHistoryMessages(messages, dateKey, prefix, seenIds) {
  return aggregateMessages(messages, dateKey, prefix, "", seenIds);
}

async function readHistoryCounts(api, threadId, dateKey, prefix, seenIds) {
  const messages = await readHistoryMessages(api, threadId);
  return countHistoryMessages(messages, dateKey, prefix, seenIds);
}

function getCachedHistoryCounts(api, threadId, dateKey, prefix, seenIds) {
  const key = `${threadId}:${dateKey}:${prefix}`;
  const cached = historyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve({
      counts: countHistoryMessages(cached.messages, dateKey, prefix, seenIds),
      source: "cache"
    });
  }
  if (historyFlights.has(key)) return historyFlights.get(key);

  const task = readHistoryMessages(api, threadId)
    .then((messages) => {
      historyCache.set(key, { messages, expiresAt: Date.now() + HISTORY_CACHE_TTL_MS });
      return {
        counts: countHistoryMessages(messages, dateKey, prefix, seenIds),
        source: "live"
      };
    })
    .finally(() => {
      if (historyFlights.get(key) === task) historyFlights.delete(key);
    });
  historyFlights.set(key, task);
  return task;
}

async function readHistoryWithinBudget(api, threadId, dateKey, prefix, seenIds, budgetMs = HISTORY_RESPONSE_BUDGET_MS) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(null), Math.max(0, budgetMs));
  });
  try {
    return await Promise.race([
      getCachedHistoryCounts(api, threadId, dateKey, prefix, seenIds),
      timeout
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const today = vietnamDateKey();
  const prefix = String(thread.prefix || global.config?.prefix || "/");
  const hasRealtimeCounts = thread.topchatDate === today && thread.topchatCounts &&
    typeof thread.topchatCounts === "object";
  const counts = hasRealtimeCounts ? { ...thread.topchatCounts } : {};

  let historyRead = false;
  let historyPending = false;
  let historyError = null;
  const seenIds = thread.topchatDate === today ? thread.topchatSeenMessageIds || [] : [];
  const historyKey = `${threadId}:${today}:${prefix}`;
  const cachedHistory = historyCache.get(historyKey);

  if (cachedHistory && cachedHistory.expiresAt > Date.now()) {
    mergeCounts(counts, countHistoryMessages(cachedHistory.messages, today, prefix, seenIds));
    historyRead = true;
  } else if (Object.keys(counts).length > 0) {
    // A live ranking is ready. Refresh historical messages in the background
    // so this command can return the realtime result without waiting for Zalo.
    historyPending = true;
    void getCachedHistoryCounts(api, threadId, today, prefix, seenIds).catch((error) => {
      console.warn("[TOPCHAT] Không đọc được lịch sử nhóm:", error?.message || error);
    });
  } else {
    // Cold start: no local counts exist yet, so wait briefly for a history seed.
    try {
      const historyResult = await readHistoryWithinBudget(
        api,
        threadId,
        today,
        prefix,
        seenIds
      );
      if (historyResult) {
        mergeCounts(counts, historyResult.counts);
        historyRead = true;
      } else {
        historyPending = true;
      }
    } catch (error) {
      historyError = error;
      console.warn("[TOPCHAT] Không đọc được lịch sử nhóm:", error?.message || error);
    }
  }

  const ranking = buildRanking(counts, 10);
  if (!ranking.length) {
    const message = historyPending
      ? "⏳ Đang nạp lịch sử chat của nhóm. Hãy dùng /topchat lại sau ít giây."
      : historyError
        ? "⚠️ Không lấy được lịch sử nhóm. Hãy kiểm tra kết nối Zalo rồi thử lại."
        : historyRead
          ? "📊 Hôm nay nhóm chưa có tin nhắn để xếp hạng. Bot sẽ tiếp tục ghi nhận tin nhắn mới."
          : "⚠️ Chưa có dữ liệu realtime để xếp hạng. Hãy nhắn tin trong nhóm rồi thử lại.";
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
    const suffix = historyError
      ? "\n⚠️ Lịch sử Zalo tạm thời không khả dụng; số liệu lấy từ realtime."
      : historyPending
        ? "\nℹ️ Đang cập nhật thêm lịch sử nhóm; bảng hiện tại lấy từ số liệu realtime."
        : "";
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

module.exports._test = {
  mergeCounts,
  readHistoryCounts,
  getCachedHistoryCounts,
  readHistoryWithinBudget,
  historyCache,
  historyFlights,
  HISTORY_LIMIT,
  HISTORY_CACHE_TTL_MS,
  HISTORY_RESPONSE_BUDGET_MS
};
