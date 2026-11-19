"use strict";

const { vietnamDateKey, isTimestampInVietnamDate, isGroupMessage, messageText, messageTimestamp, avatarUrl } = require("../../core/topchat/stats");

const writeQueues = new Map();
const seenMessages = new Map();
const pendingGroups = new Map();
const runtimeDiagnostics = new Map();
const MAX_RUNTIME_DIAGNOSTIC_GROUPS = 1000;
const MAX_SEEN_PER_GROUP = 10000;
const MAX_SEEN_GROUPS = 1000;
const MAX_STORED_IDS = 10000;
// Keep live ranking updates batched. /topchat explicitly flushes before reading,
// so a longer debounce lowers per-group Supabase writes without stale command output.
const DEFAULT_FLUSH_DELAY_MS = 2500;
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

function createRuntimeDiagnosticSnapshot(date = vietnamDateKey()) {
  return {
    date,
    events: 0,
    groups: 0,
    private: 0,
    unknown: 0,
    self: 0,
    other: 0,
    received: 0,
    counted: 0,
    rejected: 0,
    duplicates: 0,
    lastType: "missing",
    lastMessageType: "",
    lastSeenAt: 0
  };
}

function getOrCreateRuntimeDiagnostics(threadId) {
  const key = String(threadId || "");
  if (!key) return null;
  const today = vietnamDateKey();
  let value = runtimeDiagnostics.get(key);
  if (!value || value.date !== today) value = createRuntimeDiagnosticSnapshot(today);
  // Refresh LRU order and keep diagnostics memory bounded.
  runtimeDiagnostics.delete(key);
  runtimeDiagnostics.set(key, value);
  while (runtimeDiagnostics.size > MAX_RUNTIME_DIAGNOSTIC_GROUPS) {
    runtimeDiagnostics.delete(runtimeDiagnostics.keys().next().value);
  }
  return value;
}

function observeIncomingEvent(event) {
  const threadId = String(event?.threadId || event?.data?.idTo || "");
  if (!threadId) return null;

  const value = getOrCreateRuntimeDiagnostics(threadId);
  value.events++;
  if (isGroupMessage(event)) value.groups++;
  else if (event?.type === 0 || event?.type === "0" ||
      (typeof event?.type === "string" && event.type.toLowerCase() === "user")) value.private++;
  else value.unknown++;

  if (event?.isSelf) value.self++;
  else value.other++;
  value.lastType = String(event?.type ?? "missing").slice(0, 20);
  value.lastMessageType = String(event?.data?.msgType || "").slice(0, 40);
  value.lastSeenAt = Date.now();
  return { ...value };
}

function getRuntimeDiagnostics(threadId) {
  const value = runtimeDiagnostics.get(String(threadId || ""));
  if (!value || value.date !== vietnamDateKey()) {
    return createRuntimeDiagnosticSnapshot();
  }
  return { ...value };
}

function getStats() {
  const now = Date.now();
  let pendingMessages = 0;
  let oldestPendingMs = 0;
  for (const pending of pendingGroups.values()) {
    pendingMessages += Math.max(0, Number(pending.total) || 0);
    const createdAt = Number(pending.createdAt) || now;
    oldestPendingMs = Math.max(oldestPendingMs, now - createdAt);
  }
  return {
    flushDelayMs: FLUSH_DELAY_MS,
    activeWriteQueues: writeQueues.size,
    pendingGroups: pendingGroups.size,
    pendingMessages,
    seenGroups: seenMessages.size,
    diagnosticGroups: runtimeDiagnostics.size,
    oldestPendingMs
  };
}

function rememberMessage(threadId, data) {
  const messageId = String(data?.cliMsgId || data?.msgId || "");
  if (!messageId) return true;
  let seen = seenMessages.get(threadId);
  if (seen) {
    // LRU refresh: active groups retain their dedupe window.
    seenMessages.delete(threadId);
    seenMessages.set(threadId, seen);
  } else {
    // Bound memory when the bot serves many transient groups over time.
    while (seenMessages.size >= MAX_SEEN_GROUPS) {
      seenMessages.delete(seenMessages.keys().next().value);
    }
    seen = new Set();
    seenMessages.set(threadId, seen);
  }
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

function isCountableMessage(message, dateKey, prefix, receivedAt = 0) {
  // Zalo SDK replaces uidFrom='0' with the authenticated account UID and keeps isSelf=true.
  // Count that account like any other member; only reject unresolved placeholder IDs.
  if (!message || !isGroupMessage(message)) return false;
  const data = message.data || {};
  const uid = String(data.uidFrom || data.senderId || "");
  if (!uid || uid === "0") return false;
  // A live WebSocket frame is known to have arrived now even when its payload
  // omits ts. Historical messages never use this receive-time fallback.
  const timestamp = messageTimestamp(data.ts ?? data.timestamp) || receivedAt;
  if (!timestamp || !isTimestampInVietnamDate(timestamp, dateKey)) return false;
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
  thread.topchatHistoryVersion = 0;
  thread.topchatDiagnostics = { date: dateKey, received: 0, counted: 0, rejected: 0, duplicates: 0, lastSeenAt: 0 };
}

function makePending(dateKey, storedIds = []) {
  // The persisted dedupe window is large (up to 10k IDs). Build this Set once
  // when a batch starts, not again for every incoming group message.
  const storedIdsSet = new Set(Array.isArray(storedIds) ? storedIds.map(String) : []);
  return {
    dateKey, counts: new Map(), ids: [], idsSet: new Set(), storedIdsSet,
    total: 0, history: false, createdAt: Date.now(), timer: null
  };
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
  const realtimeDiagnostics = runtimeDiagnostics.get(threadId);
  if (realtimeDiagnostics?.date === pending.dateKey && realtimeDiagnostics.received > 0) {
    // Persist the latest diagnostics alongside a real ranking/history batch,
    // not through a separate DB write for every filtered command.
    thread.topchatDiagnostics = {
      date: pending.dateKey,
      received: realtimeDiagnostics.received,
      counted: realtimeDiagnostics.counted,
      rejected: realtimeDiagnostics.rejected,
      duplicates: realtimeDiagnostics.duplicates,
      lastSeenAt: realtimeDiagnostics.lastSeenAt || Date.now()
    };
  }
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
  const key = String(threadId);
  try {
    return await enqueueGroupWrite(key, () => flushGroupUnlocked(key, Threads));
  } catch (error) {
    // Keep the batch in memory and retry on the next debounce window if the
    // storage backend is temporarily unavailable.
    const pending = pendingGroups.get(key);
    if (pending) scheduleFlush(key, Threads, pending);
    throw error;
  }
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

    let pending = pendingGroups.get(threadId);
    if (pending && pending.dateKey !== dateKey) {
      await flushGroupUnlocked(threadId, Threads);
      pending = null;
    }

    // History imports are already batched by caller and must preserve coverage
    // state even when a group's custom prefix filters some entries.
    if (source === "history" && !pending) {
      const storedIds = thread.topchatDate === dateKey && Array.isArray(thread.topchatSeenMessageIds)
        ? thread.topchatSeenMessageIds : [];
      pending = makePending(dateKey, storedIds);
      pendingGroups.set(threadId, pending);
    }
    if (source === "history") pending.history = true;

    let added = 0;
    const receivedAt = source === "live" ? Date.now() : 0;
    const realtimeDiagnostics = source === "live"
      ? getOrCreateRuntimeDiagnostics(threadId)
      : null;

    for (const message of messages) {
      if (realtimeDiagnostics) {
        realtimeDiagnostics.received++;
        realtimeDiagnostics.lastSeenAt = Date.now();
      }

      if (!isCountableMessage(message, dateKey, prefix, receivedAt)) {
        if (realtimeDiagnostics) realtimeDiagnostics.rejected++;
        continue;
      }

      // Do not build a Set from up to 10,000 persisted message IDs for a
      // command/media event that will never enter the ranking. Create the
      // batch only after the message passes the inexpensive eligibility test.
      if (!pending) {
        const storedIds = thread.topchatDate === dateKey && Array.isArray(thread.topchatSeenMessageIds)
          ? thread.topchatSeenMessageIds : [];
        pending = makePending(dateKey, storedIds);
        pendingGroups.set(threadId, pending);
      }

      const data = message.data || {};
      const uid = String(data.uidFrom || data.senderId || "");
      const messageId = String(data.cliMsgId || data.msgId || "");
      if (messageId && (pending.storedIdsSet.has(messageId) || pending.idsSet.has(messageId))) {
        if (realtimeDiagnostics) realtimeDiagnostics.duplicates++;
        continue;
      }
      if (messageId && !rememberMessage(threadId, data)) {
        if (realtimeDiagnostics) realtimeDiagnostics.duplicates++;
        continue;
      }

      const member = pending.counts.get(uid) || { count: 0, name: "", avatar: "" };
      member.count += 1;
      if (realtimeDiagnostics) realtimeDiagnostics.counted++;
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

    if (added || source === "history") {
      scheduleFlush(threadId, Threads, pending);
    } else if (pending && pending.total === 0 && !pending.history && !pending.timer) {
      // Filtered/duplicate-only live traffic is diagnostics-only; keep it in
      // the bounded runtime map, not as a dangling pending DB batch.
      if (pendingGroups.get(threadId) === pending) pendingGroups.delete(threadId);
    }
    return added;
  });
}

async function recordMessage({ event, Threads }) {
  const threadId = String(event?.threadId || event?.data?.idTo || "");
  if (!threadId || !isGroupMessage(event)) return 0;
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
      try {
        await flushGroupUnlocked(threadId, Threads);
      } catch (error) {
        const pending = pendingGroups.get(threadId);
        if (pending) scheduleFlush(threadId, Threads, pending);
        throw error;
      }
      const record = Threads.getCachedData?.(threadId) || await Threads.getData(threadId);
      const thread = { ...(record?.data || {}) };
      resetDailyFields(thread, dateKey);
      thread.topchatHistoryDate = dateKey;
      thread.topchatHistoryComplete = Boolean(complete);
      thread.topchatHistoryVersion = 2;
      thread.topchatHistoryPages = Math.max(0, Number(pageCount) || 0);
      thread.topchatHistoryReason = String(reason || "").slice(0, 40);
      await Threads.setData(threadId, thread);
    });
  }
  return uniqueIds.length;
}

module.exports.run = async function ({ event, Threads }) {
  if (!isGroupMessage(event) || !(event?.threadId || event?.data?.idTo)) return;
  // Self messages are passed through for diagnostics; isCountableMessage still
  // excludes them from the member ranking while persisting the rejection count.
  await recordMessage({ event, Threads });
};
module.exports.observeIncomingEvent = observeIncomingEvent;
module.exports.getRuntimeDiagnostics = getRuntimeDiagnostics;
module.exports.getStats = getStats;
module.exports.recordHistoryMessages = recordHistoryMessages;
module.exports.markHistoryCoverage = markHistoryCoverage;
module.exports.flushGroup = flushGroup;
module.exports.flushAll = flushAll;
module.exports._test = {
  rememberMessage, recordMessage, recordHistoryMessages, markHistoryCoverage, isGroupMessage,
  applyMessagesToGroup, flushGroup, flushAll, enqueueGroupWrite, isCountableMessage,
  writeQueues, seenMessages, pendingGroups, runtimeDiagnostics,
  observeIncomingEvent, getRuntimeDiagnostics, getStats, MAX_STORED_IDS, MAX_SEEN_GROUPS, FLUSH_DELAY_MS
};
