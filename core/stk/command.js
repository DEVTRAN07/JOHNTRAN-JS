"use strict";

const { randomUUID } = require("node:crypto");
const { enqueue } = require("../jobQueue");
const { parseQuote } = require("../mediaReply");
const { getUserAvatar } = require("../runtime/requesterProfile");
const stkDiscord = require("../stkDiscordService");

const PREFIX = () => global.config?.prefix || "/";

module.exports.config = {
  name: "stk",
  aliases: [],
  version: "2.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Xem menu Discord và tạo sticker bằng một trong 200 khung",
  category: "Tiện ích",
  usage: "stk [1-200] (reply ảnh/sticker/GIF/video)",
  cooldowns: 0,
  backgroundExecution: true,
  preferCommandOnBare: true,
  dependencies: {}
};

function parseArguments(args) {
  const tokens = Array.isArray(args)
    ? args.map(value => String(value ?? "").trim()).filter(Boolean)
    : [];

  if (!tokens.length || ["menu", "help", "list"].includes(tokens[0]?.toLowerCase())) {
    return { help: false, menu: true, decorationId: null, error: null };
  }

  if (tokens[0].toLowerCase() === "dis") {
    return {
      help: false,
      menu: false,
      decorationId: null,
      error: "Cú pháp /stk dis đã bỏ. Dùng /stk để xem menu hoặc /stk 12 để tạo khung số 12."
    };
  }

  if (tokens.length !== 1 || !/^\d{1,3}$/.test(tokens[0])) {
    return {
      help: false,
      menu: false,
      decorationId: null,
      error: "Cú pháp: /stk để xem menu hoặc /stk <1-200> để tạo sticker."
    };
  }

  const decorationId = Number(tokens[0]);
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
    // Reactions are optional UI feedback and must not cancel sticker work.
  }
}

function helpText(prefix = PREFIX()) {
  return [
    "✨ DISCORD AVATAR DECORATION — 200 KHUNG ✨",
    "",
    "Xem danh sách khung: " + prefix + "stk",
    "1. Reply vào ảnh, sticker, GIF hoặc video.",
    "2. Gõ: " + prefix + "stk <1-200>",
    "",
    "Ví dụ: " + prefix + "stk 12",
    "Không reply media? Bot sẽ thử dùng avatar Zalo của người gửi lệnh."
  ].join("\n");
}

async function sendMenu(api, event) {
  try {
    const menuPath = await stkDiscord.ensureMenuFile();
    return await api.sendMessage(
      {
        msg: "✨ AVATAR DECORATION — DISCORD (200 KHUNG) ✨",
        attachments: [menuPath]
      },
      event.threadId,
      event.type
    );
  } catch (error) {
    console.error("[stk] Không tải/gửi được menu Discord:", error?.stack || error);
    const warning = [
      "⚠️ Không gửi được menu Discord từ kho raw GitHub.",
      "Nguồn ảnh: " + stkDiscord.RAW_BASE_URL,
      "Lỗi: " + String(error?.message || error).slice(0, 260)
    ];
    return safeSend(api, event, helpText() + "\n\n" + warning.join("\n"));
  }
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
    waitMs: 1800,
    fetchTimeoutMs: 2500,
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
      decorationId: media.decorationId,
      cacheIdentity: media.cacheIdentity || null
    });
  } catch (error) {
    if (media.usingAvatar || !isNotFoundError(error)) throw error;

    const avatarUrl = await getUserAvatar(api, media.targetUid, {
      waitMs: 1800,
      fetchTimeoutMs: 2500,
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
      decorationId: media.decorationId,
      cacheIdentity: media.cacheIdentity || media.targetUid || null
    });
  }
}

module.exports.run = async function ({ api, event, args }) {
  const options = parseArguments(args);

  if (options.help) return safeSend(api, event, helpText());
  if (options.menu) return sendMenu(api, event);
  if (options.error) return safeSend(api, event, "⚠️ " + options.error);

  const decoration = stkDiscord.getDecoration(options.decorationId);
  if (!decoration) {
    return safeSend(api, event, "❌ Không tìm thấy khung #" + options.decorationId + ".");
  }

  const quotedUrl = getQuotedMediaUrl(event);
  const uid = getAuthorId(event);
  const mentions = uid ? [{ uid, pos: 0, len: tag.length }] : [];

  // For avatar-based commands, check the short-lived UID cache before
  // looking up the profile or warming the frame. A hit needs only one Zalo send.
  const targetUid = getQuotedOwnerId(event);
  const avatarCacheIdentity = !quotedUrl && targetUid ? targetUid : null;
  const avatarCacheKey = avatarCacheIdentity
    ? stkDiscord.createIdentityResultCacheKey(avatarCacheIdentity, options.decorationId)
    : null;
  const avatarCacheHit = avatarCacheKey
    ? stkDiscord.readStickerResultCache(avatarCacheKey, {
      ttlMs: stkDiscord.AVATAR_RESULT_CACHE_TTL_MS
    })
    : null;

  // Queue work immediately; only the final sticker or an error is sent to chat.
  // Cold requests warm both network inputs in parallel after acknowledgement.
  const queuedAt = Date.now();
  const frameWarmPromise = avatarCacheHit
    ? Promise.resolve(null)
    : stkDiscord.ensureDecorationFile(options.decorationId);
  void frameWarmPromise.catch(error => {
    console.warn("[stk] Prefetch khung thất bại; sẽ thử lại khi xử lý:", error?.message || error);
  });
  const mediaWarmPromise = avatarCacheHit
    ? null
    : resolveMediaSource(api, event, quotedUrl);
  if (mediaWarmPromise) void mediaWarmPromise.catch(() => {});

  const jobKey = [
    String(event.threadId),
    String(event?.data?.msgId || event?.data?.cliMsgId || Date.now()),
    String(options.decorationId)
  ].join(":");

  let job;
  try {
    job = enqueue("sticker", async () => {
      console.info("[stk] queueWait #" + options.decorationId + "=" +
        (Date.now() - queuedAt) + "ms");

      if (avatarCacheHit && avatarCacheIdentity) {
        const cached = await stkDiscord.sendCachedStickerForIdentity({
          api,
          event,
          decorationId: options.decorationId,
          identity: avatarCacheIdentity
        });
        if (cached) return cached;
      }

      const media = await (mediaWarmPromise || resolveMediaSource(api, event, quotedUrl));
      media.decorationId = options.decorationId;
      media.cacheIdentity = media.usingAvatar ? avatarCacheIdentity : null;
      return processWithAvatarFallback(api, event, media);
    }, {
      key: jobKey,
      label: "STK Discord · #" + options.decorationId,
      concurrency: 2,
      retries: 0
    });
  } catch (error) {
    void safeSend(api, event, "❌ Không thể đưa STK vào hàng đợi: " +
      String(error?.message || error).slice(0, 280), mentions);
    void safeReaction(api, event, "😢");
    return false;
  }

  void Promise.resolve(job).then(() => {
    // The sticker itself is the success response; avoid a duplicate text message.
    void safeReaction(api, event, "✅");
  }).catch(async error => {
    const errorId = randomUUID().slice(0, 8).toUpperCase();
    const stage = String(error?.stickerStage || "background-job").slice(0, 48);
    const details = String(error?.userMessage || error?.message || error).slice(0, 280);
    try {
      require("../../utils/logger").log(
        "[" + errorId + "] [stk] Giai đoạn " + stage + " thất bại: " +
          String(error?.stack || error),
        "error",
        {
          source: "sticker-job",
          commandName: "stk",
          code: error?.code,
          isGroup: Number(event?.type) === 1,
          groupId: Number(event?.type) === 1 ? event?.threadId : ""
        }
      );
    } catch {
      console.error("[stk] [" + errorId + "] Tạo sticker thất bại:", error?.stack || error);
    }
    await safeSend(
      api,
      event,
      "❌ Đã xảy ra lỗi khi tạo sticker Discord.\n" +
        "Mã lỗi: " + errorId + "\n" +
        "Giai đoạn: " + stage + "\n" + details,
      mentions
    );
    void safeReaction(api, event, "😢");
  });

  return true;
};

module.exports._test = {
  parseArguments,
  getAuthorId,
  getQuotedOwnerId,
  getQuotedMediaUrl,
  helpText,
  isNotFoundError
};
