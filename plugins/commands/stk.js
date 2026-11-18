"use strict";

const { enqueue } = require("../../core/jobQueue");
const { parseQuote } = require("../../core/mediaReply");
const stickerService = require("../../core/stickerService");
const stickerDecorations = require("../../core/stickerDecorations");

const PREFIX = () => global.config?.prefix || "/";
const PAGE_SIZE = 15;

module.exports.config = {
  name: "stk",
  aliases: [],
  version: "1.2.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Tạo sticker ảnh/GIF/video bằng Discord avatar decorations",
  category: "Tiện ích",
  usage: "stk [list [trang]|find <tên>|random|<decoration-id>] (reply media) | stk <link> <decoration-id>",
  cooldowns: 5,
  preferCommandOnBare: true,
  dependencies: {}
};

function parseArguments(args) {
  const tokens = Array.isArray(args) ? args.map(value => String(value).trim()).filter(Boolean) : [];
  const lowered = tokens.map(value => value.toLowerCase());
  if (lowered.some(value => ["help", "--help", "-h"].includes(value))) {
    return { help: true, url: null, decorationId: null };
  }
  if (["list", "decorations", "ds"].includes(lowered[0])) {
    const pageToken = tokens[1] && /^\d+$/.test(tokens[1]) ? Number(tokens[1]) : 1;
    return { list: true, page: Math.max(1, Math.min(1000, pageToken)), url: null, decorationId: null };
  }
  if (["find", "search", "tim"].includes(lowered[0])) {
    return { find: tokens.slice(1).join(" ").trim(), url: null, decorationId: null };
  }

  let url = null;
  let randomDecoration = false;
  const idTokens = [];
  for (const token of tokens) {
    const normalizedUrl = stickerService.normalizeSourceUrl(token);
    if (normalizedUrl) {
      if (!url) url = normalizedUrl;
      continue;
    }
    if (["random", "rand", "ngẫu-nhiên", "ngau-nhien"].includes(token.toLowerCase())) {
      randomDecoration = true;
      continue;
    }
    idTokens.push(token);
  }

  const decorationId = idTokens.join(" ").trim() || null;
  return { help: false, list: false, find: null, url, randomDecoration, decorationId };
}

function formatDecorationList(result, page, prefix = PREFIX(), heading = "KHO DISCORD DECORATIONS") {
  const rows = (result.items || []).map((item, index) =>
    String(result.offset + index + 1).padStart(3, " ") + ". " +
    item.name + " [" + item.collection + "]" +
    (item.animated ? " · ANIMATED" : "") +
    "\n    ID: " + item.id
  );
  return [
    "╭━━━〔 " + heading + " 〕━━━╮",
    "Tổng: " + result.total + " mẫu · Trang " + page,
    "├────────────────────────",
    ...(rows.length ? rows : ["Không tìm thấy mẫu phù hợp."]),
    "├────────────────────────",
    "• Trang tiếp: " + prefix + "stk list " + (page + 1),
    "• Tìm tên: " + prefix + "stk find <từ khóa>",
    "• Reply media rồi dùng: " + prefix + "stk <ID>",
    "• Chọn ngẫu nhiên: reply media rồi gõ " + prefix + "stk random",
    "• Nguồn: uhidontkno/DiscordAvatarDecorations",
    "╰────────────────────────"
  ].join("\n");
}

function guide(prefix = PREFIX()) {
  return [
    "CÁCH DÙNG /STK",
    "• Reply đúng tin ảnh/GIF/video rồi gõ " + prefix + "stk random",
    "• Xem kho decoration: " + prefix + "stk list [trang]",
    "• Tìm decoration: " + prefix + "stk find <tên>",
    "• Áp dụng mẫu: reply media rồi gõ " + prefix + "stk <ID>",
    "• Dùng link media: " + prefix + "stk <link media> <ID>",
    "",
    "Lệnh STK hiện chỉ sử dụng Discord avatar decorations trong kho; 5 khung tự thiết kế cũ đã được gỡ."
  ].join("\n");
}

async function safeSend(api, message, event) {
  try {
    return await api.sendMessage(
      { msg: message, recallAfterMs: 60000 },
      event.threadId,
      event.type
    );
  } catch (error) {
    console.error("[stk] Không gửi được trạng thái:", error?.message || error);
    return null;
  }
}

async function resolveDecoration(options) {
  if (options.randomDecoration) return stickerDecorations.getRandomDecoration();
  if (!options.decorationId) return null;
  const exact = await stickerDecorations.getDecoration(options.decorationId);
  if (exact) return exact;
  const matches = await stickerDecorations.getDecorations({
    query: options.decorationId,
    limit: 20
  });
  return matches.total === 1 ? matches.items[0] : null;
}

module.exports.run = async function ({ api, event, args }) {
  const options = parseArguments(args);
  if (options.help) return safeSend(api, guide(), event);
  if (options.list) {
    try {
      const result = await stickerDecorations.getDecorations({
        limit: PAGE_SIZE,
        offset: (options.page - 1) * PAGE_SIZE
      });
      return safeSend(api, formatDecorationList(result, options.page), event);
    } catch (error) {
      return safeSend(api, "❌ Không đọc được catalog decoration đã đóng gói: " + String(error?.message || error).slice(0, 220), event);
    }
  }
  if (options.find !== undefined && options.find !== null) {
    if (!options.find) return safeSend(api, "Nhập từ khóa. Ví dụ: " + PREFIX() + "stk find anime", event);
    try {
      const result = await stickerDecorations.getDecorations({ query: options.find, limit: PAGE_SIZE });
      return safeSend(api, formatDecorationList(result, 1, PREFIX(), "KẾT QUẢ TÌM KIẾM"), event);
    } catch (error) {
      return safeSend(api, "❌ Không tìm được decoration: " + String(error?.message || error).slice(0, 220), event);
    }
  }

  if (!options.randomDecoration && options.decorationId && /^\d+$/.test(options.decorationId)) {
    return safeSend(api, "❌ 5 khung số cũ đã được gỡ. Hãy dùng /stk list để chọn ID decoration mới.", event);
  }

  const quotedMedia = parseQuote(event);
  const url = options.url || stickerService.pickMediaUrl(quotedMedia);
  if (!url) return safeSend(api, guide(), event);

  let decoration;
  try {
    decoration = await resolveDecoration(options);
    if (!decoration) {
      return safeSend(api, "❌ Không tìm thấy decoration. Dùng /stk list hoặc /stk find <tên> để lấy ID chính xác.", event);
    }
  } catch (error) {
    return safeSend(api, "❌ Không đọc được catalog decoration: " + String(error?.message || error).slice(0, 220), event);
  }

  await safeSend(api, "⏳ Đang tạo sticker với decoration " + decoration.name + "...", event);
  try {
    await enqueue("sticker", () => stickerService.processSticker({
      api,
      event,
      url,
      decorationId: decoration.id
    }), {
      key: String(event.threadId) + ":" + url + ":" + decoration.id,
      label: "STK Discord · " + decoration.name,
      retries: 1,
      retryDelayMs: 500,
      retryOn: error => /worker|temporarily|timeout|ECONNRESET|ETIMEDOUT/i.test(String(error?.message || error))
    });
  } catch (error) {
    console.error("[stk] Tạo sticker thất bại:", error?.stack || error);
    const message = /privacy|không nằm trong danh sách cho phép/i.test(String(error?.message || error))
      ? "❌ Host của link media chưa được cho phép trong privacy.allowed_hosts. Hãy dùng CDN Zalo hoặc link từ host đã bật."
      : "❌ Không tạo được sticker: " + String(error?.userMessage || error?.message || "lỗi không xác định").slice(0, 260);
    return safeSend(api, message, event);
  }
};

module.exports._test = {
  parseArguments,
  formatDecorationList,
  guide,
  resolveDecoration,
  PAGE_SIZE
};
