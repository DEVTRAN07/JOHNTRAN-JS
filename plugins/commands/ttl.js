"use strict";

const ThreadType = require("zalo-client").ThreadType;
const threadRecall = require("../../core/threadRecall");
const DAY_MS = 86400000;
const MAX_DAYS = 30;

module.exports.config = {
  name: "ttl",
  aliases: ["autodelete", "tuxoa"],
  version: "1.1.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Cấu hình tự thu hồi tin nhắn bot hoặc tự xóa nguyên bản Zalo.",
  category: "Quản trị",
  usage: "ttl [30s|1d-30d|off]",
  cooldowns: 3,
  dependencies: {}
};

function parse(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (["off", "tat", "tắt", "0"].includes(value)) return { mode: "off" };
  const seconds = value.match(/^(\d+)(?:s|sec|secs|giay|giây)$/);
  if (seconds) {
    const n = Number(seconds[1]);
    if (n < 5 || n > 86400) return { error: "Thời gian thu hồi bot phải từ 5 giây đến 24 giờ." };
    return { mode: "local", ms: n * 1000, label: n + " giây" };
  }
  const days = value.match(/^(\d{1,2})(?:d|day|days|ngay|ngày)?$/);
  if (days) {
    const n = Number(days[1]);
    if (n < 1 || n > MAX_DAYS) return { error: "Tự xóa Zalo hỗ trợ lựa chọn từ 1 đến 30 ngày." };
    return { mode: "native", ms: n * DAY_MS, days: n };
  }
  return { error: "Cú pháp: /ttl 30s (tin bot), /ttl 5d (toàn cuộc trò chuyện), /ttl off." };
}

function list(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.convers)) return response.convers;
  if (Array.isArray(response?.data?.convers)) return response.data.convers;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}
function find(response, id, group) {
  return list(response).find(x => String(x?.destId ?? x?.threadId ?? x?.id ?? "") === String(id) &&
    (x?.isGroup === undefined || Boolean(Number(x.isGroup)) === group)) || null;
}
async function send(api, event, msg) { return api.sendMessage({ msg, recallAfterMs: 0 }, event.threadId, event.type); }

module.exports.run = async function ({ args = [], event, api }) {
  if (!event?.threadId) return;
  const group = event.type === ThreadType.Group || String(event.type).toLowerCase() === "group";
  if (!args[0]) {
    const local = threadRecall.get(event.threadId);
    let native = "không xác định";
    try {
      const current = find(await api.getAutoDeleteChat(), event.threadId, group);
      native = Number(current?.ttl) > 0 ? (Number(current.ttl) / DAY_MS) + " ngày" : "tắt";
    } catch {}
    return send(api, event, "⏱️ CẤU HÌNH TỰ XÓA\nTin nhắn bot: " + (local / 1000) + " giây\nTự xóa Zalo toàn chat: " + native +
      "\n\n/ttl 30s — thu hồi tin nhắn bot sau 30 giây\n/ttl 5d — tự xóa nguyên bản Zalo\n/ttl off — đưa thu hồi bot về mặc định");
  }

  const parsed = parse(args[0]);
  if (parsed.error) return send(api, event, "❌ " + parsed.error);
  if (parsed.mode === "local") {
    threadRecall.set(event.threadId, parsed.ms);
    return send(api, event, "✅ Đã đặt tự thu hồi tin nhắn bot sau " + parsed.label +
      " trong cuộc trò chuyện này. Tin nhắn thành viên không bị ảnh hưởng.");
  }
  if (parsed.mode === "off") {
    threadRecall.set(event.threadId, threadRecall.DEFAULT_MS);
    return send(api, event, "✅ Đã đưa thời gian thu hồi tin nhắn bot về mặc định 60 giây. Cài đặt tự xóa nguyên bản Zalo không thay đổi.");
  }

  if (typeof api?.updateAutoDeleteChat !== "function" || typeof api?.getAutoDeleteChat !== "function") {
    return send(api, event, "❌ API tự xóa nguyên bản Zalo không khả dụng.");
  }
  try {
    await api.updateAutoDeleteChat(parsed.ms, event.threadId, group ? ThreadType.Group : ThreadType.User);
    const current = find(await api.getAutoDeleteChat(), event.threadId, group);
    if (!current || Number(current.ttl) !== parsed.ms) {
      return send(api, event, "⚠️ Zalo chưa xác nhận đã áp dụng mốc " + parsed.days + " ngày.");
    }
    return send(api, event, "✅ Đã xác minh Zalo tự xóa sau " + parsed.days + " ngày cho toàn bộ cuộc trò chuyện.");
  } catch (error) {
    return send(api, event, "❌ Zalo từ chối thiết lập tự xóa: " + (error?.message || error));
  }
};

module.exports._test = { parse, find, list, DAY_MS };
