"use strict";

const { ThreadType } = require("zalo-client");
const stats = require("../../core/stats");
const { extractMentions } = require("../../core/mentions");

module.exports.config = {
  name: "id",
  aliases: ["uid"],
  version: "2.1.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Lấy userId của người dùng, hoặc ID của nhóm chat.",
  category: "Tiện ích",
  usage: "id | id [số điện thoại] | id box | id @user",
  cooldowns: 2,
  dependencies: {}
};

function mentionRows(event) {
  const mentions = Array.isArray(event?.mentions) && event.mentions.length
    ? event.mentions
    : extractMentions(event?.data);
  return (mentions || []).map((mention) => {
    const uid = String(mention.uid || mention.userId || "");
    const name = mention.displayName || mention.name || mention.dName || "";
    return uid ? `👤 ${name ? name + " — " : ""}${uid}` : null;
  }).filter(Boolean);
}

module.exports.run = async ({ args = [], event, api, reply }) => {
  const { threadId, type, data = {} } = event;

  if (args[0]?.toLowerCase() === "box") {
    if (type !== ThreadType.Group) {
      return reply.error("Lệnh này chỉ sử dụng trong nhóm.");
    }

    const cached = stats.getCachedGroupInfo(threadId);
    const group = cached?.gridInfoMap?.[String(threadId)];
    if (!group) {
      void stats.warmGroupInfo(api, threadId).catch(() => {});
    }

    return reply.text([
      "🆔 THÔNG TIN NHÓM",
      `Tên: ${group?.name || "Nhóm hiện tại"}`,
      `ID nhóm: ${threadId}`
    ].join("\n"));
  }

  const names = mentionRows(event);
  if (names.length) {
    return reply.text(["🆔 DANH SÁCH ID", ...names].join("\n"));
  }

  if (args.length === 0) {
    const senderId = String(data.uidFrom || "");
    const name = String(data.dName || data.senderName || "Người dùng");
    return reply.text([
      "🆔 THÔNG TIN TÀI KHOẢN",
      `Tên: ${name}`,
      `ID: ${senderId || "Không xác định"}`
    ].join("\n"));
  }

  const phoneNumber = args[0];
  try {
    const userInfo = await api.findUser(phoneNumber);
    if (!userInfo?.uid) {
      return reply.error(`Không tìm thấy người dùng với số điện thoại "${phoneNumber}".`);
    }

    const targetId = String(userInfo.uid);
    await reply.success(`Đã tìm thấy người dùng\nSĐT: ${phoneNumber}\nID: ${targetId}`);
    return api.sendCard({ userId: targetId, phoneNumber }, threadId, type);
  } catch (error) {
    console.error(`Lỗi khi tìm SĐT ${phoneNumber}:`, error);
    return reply.error("Có lỗi xảy ra khi tìm kiếm số điện thoại.");
  }
};

module.exports._test = { mentionRows };
