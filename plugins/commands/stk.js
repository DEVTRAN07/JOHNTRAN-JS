"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { enqueue } = require("../../core/jobQueue");
const { parseQuote } = require("../../core/mediaReply");
const { getUserAvatar, getRequesterProfile } = require("../../core/runtime/requesterProfile");
const stkDiscord = require("../../core/stkDiscordService");

const PREFIX = () => global.config?.prefix || "/";
const MENU_IMAGE = path.join(stkDiscord.DECOR_DIR, "menu.jpg");

module.exports.config = {
  name: "stk",
  aliases: [],
  version: "2.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Ghép 200 khung Discord vào ảnh, sticker, GIF hoặc video",
  category: "Tiện ích",
  usage: "stk dis [1-200] (reply ảnh/sticker/GIF/video)",
  cooldowns: 3,
  preferCommandOnBare: true,
  dependencies: {}
};

function parseArguments(args) {
  const tokens = Array.isArray(args)
    ? args.map(value => String(value ?? "").trim()).filter(Boolean)
    : [];
  if (!tokens.length || tokens[0].toLowerCase() !== "dis") {
    return { help: true, menu: false, decorationId: null, error: null };
  }

  const candidate = tokens[1];
  if (!candidate || ["menu", "help", "list"].includes(candidate.toLowerCase())) {
    return { help: false, menu: true, decorationId: null, error: null };
  }

  if (!/^\d{1,3}$/.test(candidate)) {
    return {
      help: false,
      menu: false,
      decorationId: null,
      error: "Số thứ tự khung không hợp lệ. Vui lòng chọn từ 1 đến 200."
    };
  }

  const decorationId = Number(candidate);
  if (decorationId < 1 || decorationId > 200) {
    return {
      help: false,
      menu: false,
      decorationId,
      error: "Khung #" + decorationId + " không tồn tại. Vui lòng chọn từ 1 đến 200."
    };
  }

  return { help: false, menu: false, decorationId, error: null };
}

function getAuthorId(event) {
  return String(
    event?.data?.uidFrom || event?.data?.uid || event?.uidFrom ||
    event?.senderID || event?.senderId || ""
  );
}

function getQuotedOwnerId(event) {
  const quote = event?.data?.quote || event?.data?.dQuote || event?.quote;
  return String(quote?.ownerId || quote?.uidFrom || quote?.uid || getAuthorId(event));
}

function getQuotedMediaUrl(event) {
  const media = parseQuote(event);
  if (!media) return null;
  return [
    media.webpUrl,
    media.video,
    media.image,
    media.file
  ].find(value => typeof value === "string" && /^https?:\/\//i.test(value)) || null;
}

function getMention(profile, uid) {
  if (!uid) return [];
  const name = String(profile?.requesterName || "Bạn").trim() || "Bạn";
  return [{ uid: String(uid), pos: 0, len: name.startsWith("@") ? name.length : name.length + 1 }];
}

async function safeSend(api, event, msg, mentions = []) {
  try {
    return await api.sendMessage(
      { msg, ...(mentions.length ? { mentions } : {}), ttl: 60000 },
      event.threadId,
      event.type
    );
  } catch (error) {
    console.error("[stk] Không gửi được tin nhắn:", error?.message || error);
    return null;
  }
}

async function safeReaction(api, event, icon) {
  const data = event?.data || {};
  const msgId = data.msgId || data.messageId || event?.msgId;
  const cliMsgId = data.cliMsgId || data.clientMsgId || event?.cliMsgId;
  if (!msgId || !cliMsgId || typeof api?.addReaction !== "function") return;
  try {
    await api.addReaction(
      { rType: 0, source: 6, icon },
      {
        data: { msgId: String(msgId), cliMsgId: String(cliMsgId) },
        threadId: String(event.threadId),
        type: event.type
      }
    );
  } catch {
    // Reaction is only a progress indicator; it must not cancel sticker work.
  }
}

function helpText(prefix = PREFIX()) {
  return [
    "✨ DISCORD AVATAR DECORATION — 200 KHUNG ✨",
    "",
    "1. Reply vào ảnh, sticker, GIF hoặc video.",
    "2. Gõ: " + prefix + "stk dis <1-200>",
    "",
    "Xem menu: " + prefix + "stk dis",
    "Ví dụ: " + prefix + "stk dis 12",
    "",
    "Không reply media? Bot sẽ thử dùng avatar Zalo của người gửi lệnh."
  ].join("\n");
}

async function sendMenu(api, event) {
  const uid = getAuthorId(event);
  const profile = await getRequesterProfile(api, event, { skipAvatarWarm: true });
  const name = String(profile?.requesterName || "Bạn");
  const tag = "@" + name;
  const mentions = uid ? [{ uid, pos: 0, len: tag.length }] : [];

  if (fs.existsSync(MENU_IMAGE)) {
    try {
      return await api.sendMessage(
        {
          msg: "✨ AVATAR DECORATION — DISCORD (200 KHUNG) ✨",
          mentions,
          attachments: [MENU_IMAGE],
          ttlKind: "media"
        },
        event.threadId,
        event.type
      );
    } catch (error) {
      console.error("[stk] Không gửi được menu.jpg:", error?.message || error);
    }
  }

  return safeSend(api, event, helpText(), mentions);
}

function isNotFoundError(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  return status === 404 || /\b404\b|not found|hết hạn lưu trữ/i.test(
    String(error?.message || error || "")
  );
}

async function resolveMediaSource(api, event, quotedUrl) {
  if (quotedUrl) {
    return { url: quotedUrl, usingAvatar: false, targetUid: getQuotedOwnerId(event) };
  }

  const targetUid = getQuotedOwnerId(event);
  const avatarUrl = await getUserAvatar(api, targetUid, {
    waitMs: 900,
    fetchTimeoutMs: 1600,
    skipAvatarWarm: true
  });
  if (avatarUrl) return { url: avatarUrl, usingAvatar: true, targetUid };

  throw new Error(
    "Không tìm thấy ảnh/sticker trong tin nhắn được reply và cũng không lấy được avatar Zalo. " +
    "Hãy reply một ảnh hoặc gửi ảnh mới rồi reply lại."
  );
}

async function processWithAvatarFallback(api, event, media) {
  try {
    return await stkDiscord.processDiscordSticker({
      api,
      event,
      mediaUrl: media.url,
      decorationId: media.decorationId
    });
  } catch (error) {
    if (media.usingAvatar || !isNotFoundError(error)) throw error;

    const avatarUrl = await getUserAvatar(api, media.targetUid, {
      waitMs: 900,
      fetchTimeoutMs: 1600,
      skipAvatarWarm: true
    });
    if (!avatarUrl) {
      throw new Error(
        "Ảnh/sticker đã hết hạn trên máy chủ Zalo (404) và không lấy được avatar thay thế. " +
        "Vui lòng gửi lại ảnh mới rồi reply lại."
      );
    }

    return stkDiscord.processDiscordSticker({
      api,
      event,
      mediaUrl: avatarUrl,
      decorationId: media.decorationId
    });
  }
}

module.exports.run = async function ({ api, event, args }) {
  const options = parseArguments(args);

  if (options.help) return safeSend(api, event, helpText());
  if (options.menu) return sendMenu(api, event);
  if (options.error) return safeSend(api, event, "⚠️ " + options.error + "\nGõ " + PREFIX() + "stk dis để xem menu.");

  const decoration = stkDiscord.getDecoration(options.decorationId);
  if (!decoration) {
    return safeSend(api, event, "❌ Không tìm thấy khung #" + options.decorationId + ".");
  }

  // Fail early when the selected local asset is missing; do not queue work
  // that cannot succeed and do not leave an ⏳ reaction behind.
  try {
    stkDiscord.findDecorationFile(options.decorationId);
  } catch (error) {
    return safeSend(
      api,
      event,
      "❌ " + String(error?.message || error) +
      "\nĐặt file khung vào: data/discord_decor/" +
      "\nTên file chuẩn: " + decoration.file
    );
  }

  const quotedUrl = getQuotedMediaUrl(event);
  const targetUid = getQuotedOwnerId(event);
  let media;
  try {
    media = await resolveMediaSource(api, event, quotedUrl);
  } catch (error) {
    return safeSend(api, event, "⚠️ " + String(error?.message || error));
  }
  media.decorationId = options.decorationId;

  const profile = await getRequesterProfile(api, event, { skipAvatarWarm: true });
  const uid = getAuthorId(event);
  const tag = "@" + String(profile?.requesterName || "Bạn");
  const mentions = uid ? [{ uid, pos: 0, len: tag.length }] : [];

  await safeReaction(api, event, "⏳");
  await safeSend(
    api,
    event,
    "⏳ Đang tạo sticker Discord [" + decoration.name + " - " + decoration.vi + "]...",
    mentions
  );

  const jobKey = [
    String(event.threadId),
    String(event?.data?.msgId || event?.data?.cliMsgId || Date.now()),
    String(options.decorationId)
  ].join(":");

  try {
    await enqueue("sticker", () => processWithAvatarFallback(api, event, media), {
      key: jobKey,
      label: "STK Discord · #" + options.decorationId,
      retries: 0
    });

    const success = [
      tag,
      "SUCCESS",
      "Đã thêm khung Discord [" + decoration.name + " - " + decoration.vi + "]"
    ].join("\n");
    await safeSend(api, event, success, mentions);
    await safeReaction(api, event, "✅");
    return true;
  } catch (error) {
    console.error("[stk] Tạo sticker thất bại:", error?.stack || error);
    await safeSend(
      api,
      event,
      "❌ Đã xảy ra lỗi khi tạo sticker khung Discord:\n" +
      String(error?.userMessage || error?.message || error).slice(0, 350),
      mentions
    );
    return false;
  }
};

module.exports._test = {
  parseArguments,
  getAuthorId,
  getQuotedOwnerId,
  getQuotedMediaUrl,
  helpText,
  isNotFoundError
};
