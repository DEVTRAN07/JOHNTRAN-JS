"use strict";

const threadRecall = require("../../core/threadRecall");

module.exports.config = {
  name: "ttl",
  aliases: ["autodelete", "tuxoa"],
  version: "1.1.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Cấu hình tự thu hồi tin nhắn do bot gửi.",
  category: "Quản trị",
  usage: "ttl [30s|5m|1h|off|default]",
  cooldowns: 3,
  dependencies: {}
};

function parse(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (["off", "tat", "tắt", "0"].includes(value)) return { mode: "off" };
  if (["default", "macdinh", "mặc định"].includes(value)) return { mode: "default" };
  const match = value.match(/^(\d+)(s|sec|secs|giay|giây|m|min|mins|phut|phút|h|hr|hrs|gio|giờ|d|day|days|ngay|ngày)$/);
  if (!match) return { error: "Cú pháp: /ttl 30s, /ttl 5m, /ttl 1h, /ttl off hoặc /ttl default." };
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = /^(s|sec|secs|giay|giây)$/.test(unit) ? 1000
    : /^(m|min|mins|phut|phút)$/.test(unit) ? 60000
    : /^(h|hr|hrs|gio|giờ)$/.test(unit) ? 3600000 : 86400000;
  const ms = amount * multiplier;
  if (!Number.isSafeInteger(ms) || ms < 5000 || ms > 30 * 86400000) {
    return { error: "Thời gian tự thu hồi tin nhắn bot phải từ 5 giây đến 30 ngày." };
  }
  return { mode: "local", ms, label: value };
}

async function send(api, event, msg) { return api.sendMessage({ msg, recallAfterMs: 0 }, event.threadId, event.type); }

module.exports.run = async function ({ args = [], event, api }) {
  if (!event?.threadId) return;
  if (!args[0]) {
    const local = threadRecall.get(event.threadId);
    const status = local > 0 ? "sau " + (local / 1000) + " giây" : "đang tắt";
    return send(api, event, "⏱️ TỰ THU HỒI TIN NHẮN BOT\nTrạng thái: " + status +
      "\n\n/ttl 30s — thu hồi tin bot sau 30 giây\n/ttl 5m — sau 5 phút\n/ttl 1h — sau 1 giờ\n/ttl off — tắt tự thu hồi\n/ttl default — trở về mặc định 60 giây\n\nTin nhắn thành viên không bị xóa.");
  }

  const parsed = parse(args[0]);
  if (parsed.error) return send(api, event, "❌ " + parsed.error);
  if (parsed.mode === "off") {
    threadRecall.set(event.threadId, 0);
    return send(api, event, "✅ Đã tắt tự thu hồi tin nhắn bot trong cuộc trò chuyện này. Tin nhắn thành viên không bị ảnh hưởng.");
  }
  if (parsed.mode === "default") {
    threadRecall.set(event.threadId, null);
    return send(api, event, "✅ Đã đặt tự thu hồi tin nhắn bot về mặc định 60 giây.");
  }
  threadRecall.set(event.threadId, parsed.ms);
  return send(api, event, "✅ Đã đặt tự thu hồi tin nhắn bot sau " + parsed.label +
    " trong cuộc trò chuyện này. Chỉ tin nhắn do bot gửi mới bị thu hồi.");
};

module.exports._test = { parse };
