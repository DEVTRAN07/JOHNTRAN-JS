"use strict";

const { ThreadType } = require("zalo-client");
const { vietnamDateKey, messageText, messageTimestamp, avatarUrl } = require("../../core/topchat/stats");

const writeQueues = new Map();
const seenMessages = new Map();
const pendingGroups = new Map();
const MAX_SEEN_PER_GROUP = 10000;
const MAX_STORED_IDS = 10000;
const DEFAULT_FLUSH_DELAY_MS = 750;
const FLUSH_DELAY_MS = Math.max(100, Math.min(10000,
  Number(process.env.JT_TOPCHAT_FLUSH_MS) || DEFAULT_FLUSH_DELAY_MS
));

module.exports.config = {
  name: "topchatCounter",
  event_type: ["message"],
  version: "1.3.0",
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
  if (!seen) { seen = new Set(); seenMessages.set(threadId, seen); }
  if (seen.has(messageId)) return false;
  seen.add(messageId);
  if (seen.size > MAX_SEEN_PER_GROUP) seen.delete(seen.values().next().value);
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

function resetDailyFields(thread, dateKey) {
  if (thread.topchatDate === dateKey) return;
  thread.topchatDate = dateKey;
  thread.topchatCounts = {};
  thread.topchatSeenMessageIds = [];
  thread.topchatHistoryDate = null;
  thread.topchatHistoryComplete = false;
  thread.topchatHistoryPages = 0;
  thread.topchatHistoryReason = "";
}

function makePending(dateKey) {
  return { dateKey, counts: new Map(), ids: [], idsSet: new Set(), total: 0, history: false, timer: null };
}

function scheduleFlush(threadId, Threads, pending) {
  if (pending.timer) return;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    void flushGroup(threadId, Threads).catch(error => {
      console.error("[topchat] batch flush failed:", error?.message || error);
    });
  }, FLUSH_DELAY_MS);
  pending.timer.unref?.();
}

async function flushGroupUnlocked(threadId, Threads) {
  const pending = pendingGroups.get(threadId);
  if (!pending) return 0;
  const record = Threads.getCachedData?.(threadId) || await Threads.getData(threadId);
  const thread = { ...(record?.data || {}) };
  resetDailyFields(thread, pending.dateKey);

  const counts = { ...(thread.topchatCounts || {}) };
  for (const [uid, delta] of pending.counts) {
    const previous = counts[uid] || { count: 0, name: "", avatar: "" };
    counts[uid] = {
      count: Math.max(0, Number(previous.count) || 0) + delta.count,
      name: delta.name || previous.name || "Thành viên",
      avatar: delta.avatar || previous.avatar || ""
    };
  }

  const storedIds = Array.isArray(thread.topchatSeenMessageIds) ? thread.topchatSeenMessageIds.map(String) : [];
  const storedSet = new Set(storedIds);
  const idsToAdd = pending.ids.filter(id => !storedSet.has(id));
  thread.topchatCounts = counts;
  thread.topchatSeenMessageIds = [...storedIds, ...idsToAdd].slice(-MAX_STORED_IDS);
  if (pending.history) {
    thread.topchatHistoryDate = pending.dateKey;
    thread.topchatHistoryComplete = false;
  }

  await Threads.setData(threadId, thread);
  if (pendingGroups.get(threadId) === pending) pendingGroups.delete(threadId);
  if (pending.timer) clearTimeout(pending.timer);
  return pending.total;
}

async function flushGroup(threadId, Threads) {
  if (!threadId || !Threads) return 0;
  return enqueueGroupWrite(String(threadId), () => flushGroupUnlocked(String(threadId), Threads));
}

async function flushAll(Threads) {
  const ids = [...pendingGroups.keys()];
  const results = await Promise.all(ids.map(id => flushGroup(id, Threads).catch(error => {
    console.error("[topchat] flush group failed:", id, error?.message || error);
    return 0;
  })));
  return results.reduce((sum, value) => sum + value, 0);
}

async function applyMessagesToGroup(threadId, messages, Threads, dateKey, source = "live") {
  if (!threadId || !Array.isArray(messages) || !messages.length || !Threads) return 0;
  return enqueueGroupWrite(threadId, async () => {
    const record = Threads.getCachedData?.(threadId) || await Threads.getData(threadId);
    const thread = record?.data || {};
    const prefix = String(thread.prefix || global.config?.prefix || "/");
    const storedIds = thread.topchatDate === dateKey && Array.isArray(thread.topchatSeenMessageIds)
      ? thread.topchatSeenMessageIds.map(String) : [];
    const storedSet = new Set(storedIds);

    let pending = pendingGroups.get(threadId);
    if (pending && pending.dateKey !== dateKey) {
      await flushGroupUnlocked(threadId, Threads);
      pending = null;
    }
    if (!pending) {
      pending = makePending(dateKey);
      pendingGroups.set(threadId, pending);
    }
    if (source === "history") pending.history = true;

    let added = 0;
    for (const message of messages) {
      if (!isCountableMessage(message, dateKey, prefix)) continue;
      const data = message.data || {};
      const uid = String(data.uidFrom || data.senderId || "");
      const messageId = String(data.cliMsgId || data.msgId || "");
      if (messageId && (storedSet.has(messageId) || pending.idsSet.has(messageId))) continue;
      if (messageId && !rememberMessage(threadId, data)) continue;

      const member = pending.counts.get(uid) || { count: 0, name: "", avatar: "" };
      member.count += 1;
      member.name = String(data.dName || data.senderName || data.name || member.name || "Thành viên").slice(0, 40);
      member.avatar = avatarUrl(data) || member.avatar || "";
      pending.counts.set(uid, member);
      pending.total += 1;
      added++;
      if (messageId) {
        pending.idsSet.add(messageId);
        pending.ids.push(messageId);
      }
    }
    if (added || source === "history") scheduleFlush(threadId, Threads, pending);
    return added;
  });
}

async function recordMessage({ event, Threads }) {
  const threadId = String(event?.threadId || "");
  if (!threadId || event?.type !== ThreadType.Group || event?.isSelf) return 0;
  return applyMessagesToGroup(threadId, [event], Threads, vietnamDateKey(), "live");
}

async function recordHistoryMessages(messages, Threads) {
  if (!Array.isArray(messages) || !Threads) return { groups: 0, messages: 0 };
  const today = vietnamDateKey();
  const grouped = new Map();
  for (const message of messages) {
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
      await flushGroupUnlocked(threadId, Threads);
      const record = Threads.getCachedData?.(threadId) || await Threads.getData(threadId);
      const thread = { ...(record?.data || {}) };
      resetDailyFields(thread, dateKey);
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
  await recordMessage({ event, Threads });
};
module.exports.recordHistoryMessages = recordHistoryMessages;
module.exports.markHistoryCoverage = markHistoryCoverage;
module.exports.flushGroup = flushGroup;
module.exports.flushAll = flushAll;
module.exports._test = {
  rememberMessage, recordMessage, recordHistoryMessages, markHistoryCoverage,
  applyMessagesToGroup, flushGroup, flushAll, enqueueGroupWrite, isCountableMessage,
  writeQueues, seenMessages, pendingGroups, MAX_STORED_IDS, FLUSH_DELAY_MS
};
