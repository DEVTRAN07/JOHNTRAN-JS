"use strict";

const { ThreadType } = require("zalo-client");
const { vietnamDateKey, messageText, messageTimestamp, avatarUrl } = require("../../core/topchat/stats");

// Serialize writes per group so two messages arriving close together do not
// overwrite each other's counter update in the JSON/Supabase mirror.
const writeQueues = new Map();
const seenMessages = new Map();
const MAX_SEEN_PER_GROUP = 1500;

module.exports.config = {
  name: "topchatCounter",
  event_type: ["message"],
  version: "1.1.0",
  author: "JOHNTRAN",
  description: "Ghi nhận số tin nhắn theo ngày trong từng nhóm",
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

async function recordMessage({ event, Threads }) {
  const threadId = String(event.threadId);
  const data = event.data || {};
  const uid = String(data.uidFrom || data.senderId || "");
  if (!uid || uid === "0") return;

  const content = messageText(data.content);
  // A media/sticker message may not contain text. Count it if Zalo supplies
  // a message type or attachment metadata.
  const hasPayload = Boolean(content || data.msgType || data.propertyExt || data.attachment || data.attachments);
  if (!hasPayload) return;

  const record = await Threads.getData(threadId);
  const thread = record?.data || {};
  const prefix = String(thread.prefix || global.config?.prefix || "/");
  if (prefix && content.startsWith(prefix)) return;

  const today = vietnamDateKey();
  const timestamp = messageTimestamp(data.ts ?? data.timestamp);
  if (timestamp && vietnamDateKey(timestamp) !== today) return;
  if (thread.topchatDate !== today) {
    thread.topchatDate = today;
    thread.topchatCounts = {};
    thread.topchatSeenMessageIds = [];
  }

  const messageId = String(data.cliMsgId || data.msgId || "");
  const ids = Array.isArray(thread.topchatSeenMessageIds) ? thread.topchatSeenMessageIds : [];
  if (messageId && ids.includes(messageId)) return;

  const counts = thread.topchatCounts && typeof thread.topchatCounts === "object"
    ? thread.topchatCounts : {};
  const member = counts[uid] || { count: 0, name: "", avatar: "" };
  member.count = Math.max(0, Number(member.count) || 0) + 1;
  member.name = String(data.dName || data.senderName || data.name || member.name || "Thành viên").slice(0, 40);
  member.avatar = avatarUrl(data) || member.avatar || "";
  counts[uid] = member;

  thread.topchatCounts = counts;
  if (messageId) {
    ids.push(messageId);
    thread.topchatSeenMessageIds = ids.slice(-500);
  }
  await Threads.setData(threadId, thread);
}

module.exports.run = async function ({ event, Threads, isSelf }) {
  if (isSelf || event?.type !== ThreadType.Group || !event?.threadId) return;

  const threadId = String(event.threadId);
  if (!rememberMessage(threadId, event.data || {})) return;

  const previous = writeQueues.get(threadId) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => recordMessage({ event, Threads }));
  writeQueues.set(threadId, task);

  try {
    await task;
  } finally {
    if (writeQueues.get(threadId) === task) writeQueues.delete(threadId);
  }
};

module.exports._test = { rememberMessage, recordMessage, writeQueues, seenMessages };
