"use strict";

const TIME_ZONE = "Asia/Ho_Chi_Minh";

function vietnamDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function isGroupMessage(message) {
  const type = message?.type ?? message?.threadType ?? message?.thread_type;
  return type === 1 || type === "1" ||
    (typeof type === "string" && type.trim().toLowerCase() === "group");
}

function messageData(message) {
  return message?.data && typeof message.data === "object" ? message.data : (message || {});
}

function messageText(content) {
  if (typeof content === "string") return content.trim();
  if (!content || typeof content !== "object") return "";
  for (const key of ["title", "text", "caption", "description", "content", "msg"]) {
    const value = content[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function messageTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" || (typeof value === "string" && /^\d{9,16}$/.test(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function avatarUrl(data) {
  const value = data?.avatar || data?.avatarUrl || data?.profile?.avatar;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0]?.url || "";
  return value?.url || "";
}

function isCommand(data, prefix = "/") {
  const text = messageText(data?.content);
  return Boolean(prefix && text.startsWith(prefix));
}

function aggregateMessages(messages, dateKey, prefix = "/", selfUid = "", excludeIds = []) {
  const counts = {};
  const excluded = excludeIds instanceof Set ? excludeIds : new Set(Array.isArray(excludeIds) ? excludeIds.map(String) : []);
  for (const message of Array.isArray(messages) ? messages : []) {
    const data = messageData(message);
    const messageId = String(data.cliMsgId || data.msgId || "");
    if (messageId && excluded.has(messageId)) continue;
    const uid = String(data.uidFrom || data.senderId || data.uid || "");
    if (!uid || uid === "0" || message?.isSelf === true || (selfUid && uid === String(selfUid))) continue;

    const timestamp = messageTimestamp(data.ts ?? data.timestamp ?? message?.timestamp);
    if (!timestamp || vietnamDateKey(timestamp) !== dateKey) continue;
    if (isCommand(data, prefix)) continue;

    // Text, media, sticker and other message types all count as one message.
    const text = messageText(data.content);
    const hasPayload = Boolean(text || data.msgType || data.propertyExt || data.attachments || data.attachment);
    if (!hasPayload) continue;

    const current = counts[uid] || { count: 0, name: "Thành viên", avatar: "" };
    current.count += 1;
    current.name = String(data.dName || data.senderName || data.name || current.name).slice(0, 40);
    current.avatar = avatarUrl(data) || current.avatar;
    counts[uid] = current;
  }
  return counts;
}

function buildRanking(counts, limit = 10) {
  return Object.entries(counts && typeof counts === "object" ? counts : {})
    .map(([uid, value]) => ({
      uid,
      name: String(value?.name || "Thành viên"),
      avatar: String(value?.avatar || ""),
      count: Math.max(0, Number(value?.count) || 0)
    }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "vi"))
    .slice(0, limit);
}

module.exports = {
  vietnamDateKey,
  isGroupMessage,
  messageData,
  messageText,
  messageTimestamp,
  avatarUrl,
  isCommand,
  aggregateMessages,
  buildRanking
};
