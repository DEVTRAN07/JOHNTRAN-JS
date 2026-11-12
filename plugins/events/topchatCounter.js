"use strict";

const { ThreadType } = require("zalo-client");
const {
  vietnamDateKey,
  messageText,
  messageTimestamp,
  avatarUrl
} = require("../../core/topchat/stats");

// Live messages and WebSocket backfill share the same per-group queue so they
// cannot overwrite each other's daily counter updates.
const writeQueues = new Map();
const seenMessages = new Map();
const MAX_SEEN_PER_GROUP = 10000;
const MAX_STORED_IDS = 10000;

module.exports.config = {
  name: "topchatCounter",
  event_type: ["message"],
  version: "1.2.0",
  author: "JOHNTRAN",
  description: "Thống kê tổng số tin nhắn mỗi thành viên gửi trong ngày",
  category: "Thống kê",
  usage: "Tự động",
  cooldowns: 0
};

function rememberMessage(threadId, data) {
  const messageId = String(data?.cliMsgId || data?.msgId || "");
  if (!messageId) return true;

  let seen = seenMessages.get(threadId);
  if (!seen) {
    seen = new Set();
    seenMessages.set(threadId, seen);
  }
  if (seen.has(messageId)) return false;
  seen.add(messageId);
  if (seen.size > MAX_SEEN_PER_GROUP) {
    seen.delete(seen.values().next().value);
  }
  return true;
}

function enqueueGroupWrite(threadId, operation) {
  const previous = writeQueues.get(threadId) || Promise.resolve();
  const task = previous.catch(() => {}).then(operation);
  writeQueues.set(threadId, task);
  return task.finally(() => {
    if (writeQueues.get(threadId) === task) writeQueues.delete(threadId);
  });
}

function isCountableMessage(message, dateKey, prefix) {
  if (!message || message.isSelf || message.type !== ThreadType.Group) return false;
  const data = message.data || {};
  const uid = String(data.uidFrom || data.senderId || "");
  if (!uid || uid === "0") return false;

  const timestamp = messageTimestamp(data.ts ?? data.timestamp);
  if (!timestamp || vietnamDateKey(timestamp) !== dateKey) return false;

  const content = messageText(data.content);
  if (prefix && content.startsWith(prefix)) return false;
  return Boolean(content || data.msgType || data.propertyExt || data.attachment || data.attachments);
}

async function applyMessagesToGroup(threadId, messages, Threads, dateKey, source = "live") {
  if (!threadId || !Array.isArray(messages) || !messages.length) return 0;

  return enqueueGroupWrite(threadId, async () => {
    const record = await Threads.getData(threadId);
    const thread = record?.data || {};
    const prefix = String(thread.prefix || global.config?.prefix || "/");

    if (thread.topchatDate !== dateKey) {
      thread.topchatDate = dateKey;
      thread.topchatCounts = {};
      thread.topchatSeenMessageIds = [];
      thread.topchatHistoryDate = null;
      thread.topchatHistoryComplete = false;
    }
    if (source === "history") {
      thread.topchatHistoryDate = dateKey;
      thread.topchatHistoryComplete = false;
    }

    const counts = thread.topchatCounts && typeof thread.topchatCounts === "object"
      ? thread.topchatCounts : {};
    const storedIds = Array.isArray(thread.topchatSeenMessageIds)
      ? thread.topchatSeenMessageIds.map(String) : [];
    const storedSet = new Set(storedIds);
    const newIds = [];
    let added = 0;

    for (const message of messages) {
      if (!isCountableMessage(message, dateKey, prefix)) continue;
      const data = message.data || {};
      const uid = String(data.uidFrom || data.senderId || "");
      const messageId = String(data.cliMsgId || data.msgId || "");

      // Persistent IDs prevent overlapping realtime + old_messages events from
      // counting the same Zalo message twice, including after a bot restart.
      if (messageId && storedSet.has(messageId)) continue;

      const member = counts[uid] || { count: 0, name: "", avatar: "" };
      member.count = Math.max(0, Number(member.count) || 0) + 1;
      member.name = String(data.dName || data.senderName || data.name || member.name || "Thành viên").slice(0, 40);
      member.avatar = avatarUrl(data) || member.avatar || "";
      counts[uid] = member;
      added++;

      if (messageId) {
        storedSet.add(messageId);
        newIds.push(messageId);
        rememberMessage(threadId, data);
      }
    }

    if (!added && source !== "history") return 0;

    thread.topchatCounts = counts;
    // Keep a wider daily dedupe window so history backfill can overlap with
    // realtime traffic without inflating the leaderboard.
    thread.topchatSeenMessageIds = [...storedIds, ...newIds].slice(-MAX_STORED_IDS);
    await Threads.setData(threadId, thread);
    return added;
  });
}

async function recordMessage({ event, Threads }) {
  const threadId = String(event.threadId || "");
  if (!threadId || event?.type !== ThreadType.Group || event?.isSelf) return 0;
  return applyMessagesToGroup(threadId, [event], Threads, vietnamDateKey());
}

async function recordHistoryMessages(messages, Threads) {
  if (!Array.isArray(messages) || !Threads) return { groups: 0, messages: 0 };

  const today = vietnamDateKey();
  const grouped = new Map();
  for (const message of messages) {
    // Resolve the actual prefix after loading that group's thread record;
    // don't accidentally classify another group's custom prefix as a command.
    if (!isCountableMessage(message, today, "")) continue;
    const threadId = String(message.threadId || message.data?.idTo || "");
    if (!threadId) continue;
    if (!grouped.has(threadId)) grouped.set(threadId, []);
    grouped.get(threadId).push(message);
  }

  let added = 0;
  for (const [threadId, groupMessages] of grouped) {
    added += await applyMessagesToGroup(threadId, groupMessages, Threads, today, "history");
  }
  return { groups: grouped.size, messages: added };
}

async function markHistoryCoverage(threadIds, Threads, dateKey, complete, pageCount, reason = "") {
  const uniqueIds = [...new Set((threadIds || []).map(String).filter(Boolean))];
  for (const threadId of uniqueIds) {
    await enqueueGroupWrite(threadId, async () => {
      const record = await Threads.getData(threadId);
      const thread = record?.data || {};
      if (thread.topchatDate !== dateKey) {
        thread.topchatDate = dateKey;
        thread.topchatCounts = {};
        thread.topchatSeenMessageIds = [];
      }
      thread.topchatHistoryDate = dateKey;
      thread.topchatHistoryComplete = Boolean(complete);
      thread.topchatHistoryPages = Math.max(0, Number(pageCount) || 0);
      thread.topchatHistoryReason = String(reason || "").slice(0, 40);
      await Threads.setData(threadId, thread);
    });
  }
  return uniqueIds.length;
}

module.exports.run = async function ({ event, Threads, isSelf }) {
  if (isSelf || event?.isSelf || event?.type !== ThreadType.Group || !event?.threadId) return;
  const threadId = String(event.threadId);
  if (!rememberMessage(threadId, event.data || {})) return;
  await recordMessage({ event, Threads });
};

module.exports.recordHistoryMessages = recordHistoryMessages;
module.exports.markHistoryCoverage = markHistoryCoverage;

module.exports._test = {
  rememberMessage,
  recordMessage,
  recordHistoryMessages,
  markHistoryCoverage,
  applyMessagesToGroup,
  enqueueGroupWrite,
  isCountableMessage,
  writeQueues,
  seenMessages,
  MAX_STORED_IDS
};
