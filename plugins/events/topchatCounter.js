"use strict";

const { ThreadType } = require("zalo-client");

module.exports.config = {
  name: "topchatCounter",
  event_type: ["message"],
  version: "1.0.0",
  author: "JOHNTRAN",
  description: "Ghi nhận số tin nhắn theo ngày trong từng nhóm",
  category: "Thống kê",
  usage: "Tự động",
  cooldowns: 0
};

function getAvatar(data) {
  const value = data?.avatar || data?.avatarUrl || data?.profile?.avatar;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0]?.url || "";
  return value?.url || "";
}

module.exports.run = async function ({ event, Threads, isSelf }) {
  if (isSelf || event?.type !== ThreadType.Group) return;
  const data = event?.data || {};
  const uid = String(data.uidFrom || "");
  if (!uid) return;

  const content = typeof data.content === "string" ? data.content.trim() : "";
  if (!content || (global.config?.prefix && content.startsWith(global.config.prefix))) return;

  const threadId = String(event.threadId);
  const record = await Threads.getData(threadId);
  const thread = record?.data || {};
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });

  if (thread.topchatDate !== today) {
    thread.topchatDate = today;
    thread.topchatCounts = {};
  }

  const counts = thread.topchatCounts && typeof thread.topchatCounts === "object"
    ? thread.topchatCounts : {};
  const member = counts[uid] || { count: 0, name: "", avatar: "" };
  member.count = Math.max(0, Number(member.count) || 0) + 1;
  member.name = String(data.dName || data.senderName || member.name || "Thành viên").slice(0, 40);
  member.avatar = getAvatar(data) || member.avatar || "";
  counts[uid] = member;

  thread.topchatCounts = counts;
  await Threads.setData(threadId, thread);
};

module.exports._test = { getAvatar };
