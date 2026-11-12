"use strict";

const { ThreadType } = require("zalo-client");

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 30;

module.exports.config = {
  name: "ttl",
  aliases: ["autodelete", "tuxoa"],
  version: "1.0.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Thiết lập thời gian tự xóa nguyên bản của Zalo cho cuộc trò chuyện hiện tại.",
  category: "Quản trị",
  usage: "ttl [1d-30d|off]",
  cooldowns: 3,
  dependencies: {}
};

function parseTTL(input) {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "off" || value === "tat" || value === "tắt" || value === "0") {
    return { ok: true, ttl: 0, days: 0 };
  }

  const match = value.match(/^(\d{1,2})(?:d|day|days|ngay|ngày)?$/i);
  if (!match) {
    return { ok: false, error: "Thời gian không hợp lệ. Hãy nhập số ngày, ví dụ 3d hoặc 14d." };
  }

  const days = Number(match[1]);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return { ok: false, error: "Zalo chỉ cho phép chọn từ 1 đến 30 ngày." };
  }

  return { ok: true, ttl: days * DAY_MS, days };
}

function getConversationList(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.convers)) return response.convers;
  if (Array.isArray(response?.data?.convers)) return response.data.convers;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function findConversation(response, threadId, isGroup) {
  const id = String(threadId ?? "");
  return getConversationList(response).find(item =>
    String(item?.destId ?? item?.threadId ?? item?.id ?? "") === id &&
    (item?.isGroup === undefined || Boolean(Number(item.isGroup)) === isGroup)
  ) || null;
}

function getThreadKind(type) {
  if (type === ThreadType.Group || String(type).toLowerCase() === "group") {
    return { type: ThreadType.Group, isGroup: true };
  }
  return { type: ThreadType.User, isGroup: false };
}

async function send(api, event, msg) {
  return api.sendMessage({ msg }, event.threadId, event.type);
}

module.exports.run = async function ({ args = [], event, api }) {
  if (!event?.threadId || !api?.getAutoDeleteChat || !api?.updateAutoDeleteChat) {
    return send(api, event, "❌ Không thể truy cập API tự xóa của Zalo.");
  }

  const thread = getThreadKind(event.type);
  const input = args[0];

  if (input === undefined) {
    try {
      const current = findConversation(await api.getAutoDeleteChat(), event.threadId, thread.isGroup);
      const ttl = Number(current?.ttl ?? 0);
      const days = ttl > 0 ? ttl / DAY_MS : 0;
      const status = ttl > 0
        ? (Number.isInteger(days) ? days + " ngày" : Math.round(ttl / 3600000) + " giờ")
        : "Đang tắt";
      return send(api, event, "⏱️ TỰ XÓA TIN NHẮN\n━━━━━━━━━━━━━━━━\nTrạng thái: " + status +
        "\nPhạm vi: cuộc trò chuyện hiện tại\n\nDùng /ttl 5d để đặt 5 ngày hoặc /ttl off để tắt.");
    } catch (error) {
      return send(api, event, "❌ Không đọc được trạng thái tự xóa: " + (error?.message || "Lỗi API"));
    }
  }

  const parsed = parseTTL(input);
  if (!parsed.ok) {
    return send(api, event, "❌ " + parsed.error + "\nVí dụ: /ttl 2d, /ttl 7d, /ttl 30d, /ttl off");
  }

  try {
    const updateResult = await api.updateAutoDeleteChat(parsed.ttl, event.threadId, thread.type);
    // A successful HTTP/API response is not enough: read the conversation setting back.
    const after = await api.getAutoDeleteChat();
    const current = findConversation(after, event.threadId, thread.isGroup);
    const actualTTL = Number(current?.ttl ?? 0);

    if (!current || actualTTL !== parsed.ttl) {
      const apiMessage = typeof updateResult === "string" ? updateResult : "";
      return send(api, event,
        "⚠️ Zalo đã nhận yêu cầu nhưng chưa xác minh được thời gian tự xóa đã áp dụng." +
        (apiMessage ? "\nPhản hồi API: " + apiMessage.slice(0, 180) : "") +
        "\nBot không báo thành công khi trạng thái đọc lại không khớp.");
    }

    const label = parsed.days === 0 ? "đã tắt" : "đã đặt " + parsed.days + " ngày";
    return send(api, event,
      "✅ Đã xác minh Zalo " + label + " tự xóa cho cuộc trò chuyện này." +
      "\nĐây là cài đặt cấp cuộc trò chuyện, ảnh hưởng tin nhắn của các thành viên.");
  } catch (error) {
    return send(api, event,
      "❌ Không thể cập nhật tự xóa trên Zalo: " + (error?.message || "Lỗi API") +
      "\nCó thể máy chủ không chấp nhận mốc thời gian này.");
  }
};

module.exports._test = { parseTTL, findConversation, getConversationList, DAY_MS };
