"use strict";

const { enqueue } = require("../../core/jobQueue");
const { parseQuote } = require("../../core/mediaReply");
const stickerFrames = require("../../core/stickerFrames");
const stickerService = require("../../core/stickerService");
const stickerDecorations = require("../../core/stickerDecorations");

const PREFIX = () => global.config?.prefix || "/";
const DEFAULT_FRAME_ID = 1;
const PAGE_SIZE = 15;

module.exports.config = {
  name: "stk",
  aliases: [],
  version: "1.1.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Tạo sticker ảnh/GIF/video với khung Discord và kho avatar decorations",
  category: "Tiện ích",
  usage: "stk [1-5|random|list|find <tên>|<decoration-id>] (reply media) | stk <link> [1-5]",
  cooldowns: 5,
  preferCommandOnBare: true,
  dependencies: {}
};

function parseArguments(args) {
  const tokens = Array.isArray(args) ? args.map(value => String(value).trim()).filter(Boolean) : [];
  const lowered = tokens.map(value => value.toLowerCase());
  if (lowered.some(value => ["help", "--help", "-h"].includes(value))) {
    return { help: true, frameId: DEFAULT_FRAME_ID, url: null };
  }

  if (["khung", "frames"].includes(lowered[0])) {
    return { listFrames: true, frameId: DEFAULT_FRAME_ID, url: null };
  }
  if (["list", "decorations", "ds"].includes(lowered[0])) {
    const pageToken = tokens[1] && /^\d+$/.test(tokens[1]) ? Number(tokens[1]) : 1;
    return { list: true, page: Math.max(1, Math.min(1000, pageToken)), frameId: DEFAULT_FRAME_ID, url: null };
  }
  if (["find", "search", "tim"].includes(lowered[0])) {
    return { find: tokens.slice(1).join(" ").trim(), frameId: DEFAULT_FRAME_ID, url: null };
  }

  let url = null;
  let frameId = DEFAULT_FRAME_ID;
  let invalidFrame = null;
  let randomDecoration = false;
  const otherTokens = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    const normalizedUrl = stickerService.normalizeSourceUrl(token);
    if (normalizedUrl) {
      if (!url) url = normalizedUrl;
      continue;
    }

    if (["random", "rand", "ngẫu-nhiên", "ngau-nhien"].includes(lower)) {
      randomDecoration = true;
      continue;
    }
    if (["frame", "frames", "khung", "-f", "--frame"].includes(lower)) {
      const next = tokens[index + 1];
      if (next && /^\d+$/.test(next)) {
        const value = Number(next);
        if (stickerFrames.normalizeFrameId(value) === null) invalidFrame = next;
        else frameId = value;
        index += 1;
      }
      continue;
    }
    if (/^\d+$/.test(token)) {
      const value = Number(token);
      if (stickerFrames.normalizeFrameId(value) === null) invalidFrame = token;
      else frameId = value;
      continue;
    }
    otherTokens.push(token);
  }

  if (randomDecoration) return { randomDecoration: true, url, frameId, invalidFrame };
  const decorationId = otherTokens.join(" ").trim();
  return { help: false, listFrames: false, list: false, find: null, url, frameId, invalidFrame, decorationId: decorationId || null };
}

function formatFrameList(prefix = PREFIX()) {
  const rows = stickerFrames.frameList().map(item =>
    "  " + item.id + ". " + item.name + "  [" + item.tag + "]"
  );
  return [
    "╭━━━〔 KHUNG DISCORD CHO STK 〕━━━╮",
    ...rows,
    "├────────────────────────",
    "• Reply ảnh/GIF/video rồi gõ " + prefix + "stk 1",
    "• Chọn khung khác: " + prefix + "stk 2 ... " + prefix + "stk 5",
    "• Kho decorations: " + prefix + "stk list",
    "• Tìm mẫu: " + prefix + "stk find <tên>",
    "• Chọn ngẫu nhiên: " + prefix + "stk random",
    "╰────────────────────────"
  ].join("\n");
}

function formatDecorationList(result, page, prefix = PREFIX(), heading = "KHO DISCORD DECORATIONS") {
  const rows = (result.items || []).map((item, index) =>
    String(result.offset + index + 1).padStart(3, " ") + ". " +
    item.name + " [" + item.collection + "]" +
    (item.animated ? " · GIF" : "") +
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
    "• Nguồn: uhidontkno/DiscordAvatarDecorations",
    "╰────────────────────────"
  ].join("\n");
}

function guide(prefix = PREFIX()) {
  return [
    "CÁCH DÙNG /STK",
    "• Reply đúng tin ảnh/GIF/video rồi gõ " + prefix + "stk",
    "• Khung Discord tự thiết kế: " + prefix + "stk 1 đến " + prefix + "stk 5",
    "• Xem khung tự thiết kế: " + prefix + "stk khung",
    "• Xem kho decoration: " + prefix + "stk list [trang]",
    "• Tìm decoration: " + prefix + "stk find <tên>",
    "• Chọn decoration: " + prefix + "stk <ID> (khi reply media)",
    "• Chọn ngẫu nhiên: " + prefix + "stk random",
    "• Dùng link media: " + prefix + "stk <link media> [1-5]",
    "",
    "Mặc định dùng Discord Classic. Kho decoration được cache để chọn mẫu nhanh."
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
  if (options.randomDecoration) {
    const catalog = await stickerDecorations.getDecorations({ limit: stickerDecorations.MAX_LIMIT || 100 });
    if (!catalog.items.length) return null;
    return catalog.items[Math.floor(Math.random() * catalog.items.length)];
  }
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
      return safeSend(api, "❌ Không tải được kho decoration Discord: " + String(error?.message || error).slice(0, 220), event);
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
  if (options.listFrames) return safeSend(api, formatFrameList(), event);
  if (options.invalidFrame) {
    return safeSend(api, "❌ Khung tự thiết kế chỉ có số từ 1 đến " + stickerFrames.frameList().length + ". Dùng /stk list để xem kho Discord.", event);
  }

  let decoration = null;
  if (options.randomDecoration || options.decorationId) {
    try {
      decoration = await resolveDecoration(options);
      if (!decoration) {
        return safeSend(api, "❌ Không tìm thấy decoration. Dùng /stk list hoặc /stk find <tên> để xem ID chính xác.", event);
      }
    } catch (error) {
      return safeSend(api, "❌ Kho decoration đang lỗi: " + String(error?.message || error).slice(0, 220), event);
    }
  }

  const quotedMedia = parseQuote(event);
  const url = options.url || stickerService.pickMediaUrl(quotedMedia);
  if (!url) return safeSend(api, guide(), event);

  const frame = decoration ? null : stickerFrames.getFrame(options.frameId);
  if (!decoration && !frame) return safeSend(api, formatFrameList(), event);

  const label = decoration ? decoration.name : frame.name;
  await safeSend(api, "⏳ Đang tạo sticker với " + label + "...", event);
  try {
    await enqueue("sticker", () => stickerService.processSticker({
      api,
      event,
      url,
      frameId: frame?.id || DEFAULT_FRAME_ID,
      decorationId: decoration?.id || null
    }), {
      key: String(event.threadId) + ":" + url + ":" + (decoration?.id || frame.id),
      label: "STK Discord · " + label,
      retries: 1,
      retryDelayMs: 500,
      retryOn: error => /worker|temporarily|timeout|ECONNRESET|ETIMEDOUT/i.test(String(error?.message || error))
    });
  } catch (error) {
    console.error("[stk] Tạo sticker thất bại:", error?.stack || error);
    const message = /privacy|không nằm trong danh sách cho phép/i.test(String(error?.message || error))
      ? "❌ Host của link chưa được cho phép trong privacy.allowed_hosts. Hãy dùng CDN Zalo hoặc link từ host đã bật."
      : "❌ Không tạo được sticker: " + String(error?.userMessage || error?.message || "lỗi không xác định").slice(0, 260);
    return safeSend(api, message, event);
  }
};

module.exports._test = {
  parseArguments,
  formatFrameList,
  formatDecorationList,
  guide,
  resolveDecoration,
  DEFAULT_FRAME_ID,
  PAGE_SIZE
};
