"use strict";

const { enqueue } = require("../../core/jobQueue");
const { parseQuote } = require("../../core/mediaReply");
const stickerFrames = require("../../core/stickerFrames");
const stickerService = require("../../core/stickerService");

const PREFIX = () => global.config?.prefix || "/";
const DEFAULT_FRAME_ID = 1;

module.exports.config = {
  name: "stk",
  aliases: [],
  version: "1.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Tạo sticker ảnh/GIF/video với khung Discord trong suốt",
  category: "Tiện ích",
  usage: "stk [1-5|random|khung] (reply media) | stk <link> [1-5]",
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
  if (tokens.length === 1 && ["khung", "frames", "list"].includes(lowered[0])) {
    return { list: true, frameId: DEFAULT_FRAME_ID, url: null };
  }

  let url = null;
  let frameId = DEFAULT_FRAME_ID;
  let invalidFrame = null;
  let random = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    const normalizedUrl = stickerService.normalizeSourceUrl(token);
    if (normalizedUrl) {
      if (!url) url = normalizedUrl;
      continue;
    }

    if (["random", "rand", "ngẫu-nhiên", "ngau-nhien"].includes(lower)) {
      random = true;
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
    }
  }

  if (random) {
    const options = stickerFrames.frameList();
    frameId = options[Math.floor(Math.random() * options.length)].id;
  }
  return { help: false, list: false, url, frameId, invalidFrame };
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
    "• Chọn ngẫu nhiên: " + prefix + "stk random",
    "• Dùng link: " + prefix + "stk <link media> 3",
    "╰────────────────────────"
  ].join("\n");
}

function guide(prefix = PREFIX()) {
  return [
    "CÁCH DÙNG /STK",
    "• Reply đúng tin ảnh/GIF/video rồi gõ " + prefix + "stk",
    "• Chọn khung Discord: " + prefix + "stk 1 đến " + prefix + "stk 5",
    "• Xem toàn bộ khung: " + prefix + "stk khung",
    "• Chọn ngẫu nhiên: " + prefix + "stk random",
    "• Hoặc dùng link: " + prefix + "stk <link media> [1-5]",
    "",
    "Mặc định dùng Discord Classic. Vùng giữa khung trong suốt để giữ nguyên ảnh."
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

module.exports.run = async function ({ api, event, args }) {
  const options = parseArguments(args);
  if (options.help) return safeSend(api, guide(), event);
  if (options.list) return safeSend(api, formatFrameList(), event);
  if (options.invalidFrame) {
    return safeSend(api, "❌ Khung không hợp lệ. Chọn từ 1 đến " + stickerFrames.frameList().length + " hoặc dùng /stk khung.", event);
  }

  const quotedMedia = parseQuote(event);
  const url = options.url || stickerService.pickMediaUrl(quotedMedia);
  if (!url) return safeSend(api, guide(), event);

  const frame = stickerFrames.getFrame(options.frameId);
  if (!frame) return safeSend(api, formatFrameList(), event);

  await safeSend(api, "⏳ Đang tạo sticker với khung " + frame.name + "...", event);
  try {
    await enqueue("sticker", () => stickerService.processSticker({
      api,
      event,
      url,
      frameId: frame.id
    }), {
      key: String(event.threadId) + ":" + url + ":" + frame.id,
      label: "STK Discord · " + frame.name,
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
  guide,
  DEFAULT_FRAME_ID
};
