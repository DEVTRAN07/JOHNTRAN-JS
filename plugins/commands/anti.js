const { convertTimestamp, getMessageCache } = require("../../utils/index");
const fs = require("fs").promises;
const path = require("path");
const { ThreadType } = require("zalo-client");
const http = require("../../core/http");
const { renderCanvas } = require("../../core/canvas/workerRender");
const { getGroupAdminState } = require("../../core/runtime/groupAdmin");
const fsSync = require("fs");

module.exports.config = {
  name: "anti",
  version: "1.1.7",
  role: 0,
  author: "ShinTHL09",
  description: "Bật/tắt các chế độ Anti của nhóm",
  category: "Anti",
  usage: "anti [link|undo|spam] [on|off]",
  preferCommandOnBare: true,
  cooldowns: 2
};

const baseUndoMsg = `👤 {name} đã thu hồi tin nhắn sau...\n` +
  `⏰ Thời gian gửi: {time_send}\n` +
  `🔔 Thời gian thu hồi: {time_undo}\n` +
  `📝 Nội Dung: {content}`;

function formatUndoMessage(name, timeSend, timeUndo, content) {
  return baseUndoMsg
    .replace('{name}', name)
    .replace('{time_send}', convertTimestamp(timeSend))
    .replace('{time_undo}', convertTimestamp(timeUndo))
    .replace('{content}', content || "");
}

async function handlePhoto(messageCache, tempPath, name, timeSend, timeUndo, threadId, api, type) {
  const tempFilePath = path.join(tempPath, `anti_undo_${Date.now()}.jpg`);
  const { buffer } = await http.getBuffer(messageCache.content.href);

  await fs.mkdir(tempPath, { recursive: true });
  await fs.writeFile(tempFilePath, buffer);

  const message = messageCache.content.title || "";
  const msgBody = formatUndoMessage(name, timeSend, timeUndo, message);

  await api.sendMessage({ msg: msgBody, attachments: [tempFilePath] }, threadId, type);
  return tempFilePath;
}

async function isAdmin(api, userId, threadId) {
  if (userId == null || typeof api?.getGroupInfo !== "function") return null;

  const info = await api.getGroupInfo(threadId);
  const groupInfo = info?.gridInfoMap?.[threadId];
  // Missing role metadata is "unknown", not proof that the sender is a member.
  if (!groupInfo || (groupInfo.creatorId == null && !Array.isArray(groupInfo.adminIds))) {
    return null;
  }

  const uid = String(userId);
  const isCreator = groupInfo.creatorId != null && String(groupInfo.creatorId) === uid;
  const isDeputy = Array.isArray(groupInfo.adminIds) &&
    groupInfo.adminIds.some(id => String(id) === uid);

  return isCreator || isDeputy;
}


const nudeModerationInFlight = new Set();
const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";

function extractMessageUrls(data) {
  const content = data?.content;
  const candidates = [];
  if (data?.msgType === "chat.recommended" && content?.action === "recommended.link" && content.href) {
    candidates.push(String(content.href));
  }
  if (typeof content === "string") {
    const matches = content.match(/https?:\/\/[^\s<>"']+/gi) || [];
    candidates.push(...matches);
  } else if (content && typeof content.href === "string") {
    candidates.push(content.href);
  }
  return [...new Set(candidates.map(url => url.replace(/[),.!?;:]+$/, "")).filter(Boolean))];
}

function isGroupInviteUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "zalo.me" &&
      /^\/g\/[a-z0-9_-]+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function isUnsafeLink(rawUrl, api) {
  if (isGroupInviteUrl(rawUrl)) return true;
  if (typeof api?.scanURL !== "function") return false;
  try {
    const result = await api.scanURL(rawUrl);
    return result?.isSafe === false;
  } catch (error) {
    console.warn("[antilink] Không kiểm tra được URL:", error?.message || error);
    return false;
  }
}

function isExplicitAdultImage(result, threshold = 0.9) {
  const appliedTypes = result?.category_applied_input_types?.sexual;
  if (Array.isArray(appliedTypes) && !appliedTypes.includes("image")) return false;
  const score = Number(result?.category_scores?.sexual);
  return Number.isFinite(score) && score >= threshold;
}

async function moderateImage(imageUrl) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.JT_ANTINUDE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Thiếu OPENAI_API_KEY");
  const parsedUrl = new URL(imageUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("URL ảnh không hợp lệ");
  }

  const response = await http.request(OPENAI_MODERATION_URL, {
    method: "POST",
    timeout: 8000,
    retries: 0,
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "omni-moderation-latest",
      input: [{
        type: "image_url",
        image_url: { url: imageUrl }
      }]
    })
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error("OpenAI Moderation trả về HTTP " + response.status);
  }
  const payload = response.json();
  const result = payload?.results?.[0];
  if (!result) throw new Error("Phản hồi AI không có kết quả phân loại");

  const configuredThreshold = Number(process.env.JT_ANTINUDE_SEXUAL_THRESHOLD || 0.9);
  const threshold = Number.isFinite(configuredThreshold)
    ? Math.min(0.99, Math.max(0.5, configuredThreshold))
    : 0.9;
  return {
    explicit: isExplicitAdultImage(result, threshold),
    score: Number(result?.category_scores?.sexual) || 0,
    threshold
  };
}



module.exports.handleEvent = async function ({ event, api, Threads, eventType, isSelf }) {
  const { threadId, isGroup, data, type } = event;
  const typeUndo = isGroup ? 1 : 0;
  const userId = data.uidFrom;
  const name = data.dName || "Bạn";

  // Không xử lý hành động của chính bot (tự xoá link/spam của bot, anti_undo tin bot)
  if (isSelf) return;

  const threadData = (await Threads.getData(threadId)).data || {};
  const tempPath = path.join(__dirname, "temp");
  const tempFiles = [];
  let groupAdminCheck = null;

  // Reuse one Zalo group-info lookup for every Anti rule on this message.
  // Unknown role metadata fails safe: do not delete a message that may belong to an admin.
  const isAdminOrUnknown = () => {
    if (!groupAdminCheck) {
      groupAdminCheck = isAdmin(api, userId, threadId).catch(() => null);
    }
    return groupAdminCheck.then(result => result !== false);
  };

  try {
    // === Anti Link nguy hiểm / link mời nhóm khác ===
    if (threadData.anti_danger_link && eventType === "message") {
      const urls = extractMessageUrls(data);
      if (urls.length && !(await isAdminOrUnknown())) {
        let blockedUrl = null;
        for (const url of urls) {
          if (await isUnsafeLink(url, api)) {
            blockedUrl = url;
            break;
          }
        }
        if (blockedUrl) {
          try {
            await api.deleteMessage({
              threadId,
              type,
              data: { cliMsgId: data.cliMsgId, msgId: data.msgId, uidFrom: userId }
            }, false);
          } catch (error) {
            console.warn("[antilink] Không xóa được tin nhắn:", error?.message || error);
          }
          return api.sendMessage({
            msg: "🚫 @" + name + ", link mời nhóm khác hoặc URL không an toàn đã bị chặn.",
            mentions: [{ pos: 3, uid: userId, len: name.length + 1 }]
          }, threadId, type);
        }
      }
    }

    // === AI Anti Nude: chỉ xử lý ảnh trong nhóm, bỏ qua admin và quyền không xác định ===
    if (threadData.anti_nude && eventType === "message" && data.msgType === "chat.photo") {
      const imageUrl = data.content?.href;
      if (imageUrl && !(await isAdminOrUnknown())) {
        const checkId = String(threadId) + ":" + String(data.cliMsgId || data.msgId || "");
        if (!nudeModerationInFlight.has(checkId)) {
          nudeModerationInFlight.add(checkId);
          try {
            const moderation = await moderateImage(imageUrl);
            if (moderation.explicit) {
              let deleteError = null;
              let kickError = null;
              try {
                await api.deleteMessage({
                  threadId,
                  type,
                  data: { cliMsgId: data.cliMsgId, msgId: data.msgId, uidFrom: userId }
                }, false);
              } catch (error) {
                deleteError = error;
              }
              try {
                if (typeof api.removeUserFromGroup !== "function") {
                  throw new Error("API kick thành viên không khả dụng");
                }
                await api.removeUserFromGroup(userId, threadId);
              } catch (error) {
                kickError = error;
              }
              const actions = [];
              actions.push(deleteError ? "không xóa được ảnh" : "đã xóa ảnh");
              actions.push(kickError ? "không kick được thành viên" : "đã kick thành viên");
              return api.sendMessage({
                msg: "⛔ AI phát hiện ảnh khỏa thân/khiêu dâm (độ tin cậy " +
                  Math.round(moderation.score * 100) + "%). @" + name + ": " +
                  actions.join(", ") + "." +
                  (kickError ? "\n⚠️ " + kickError.message : "") +
                  (deleteError ? "\n⚠️ " + deleteError.message : ""),
                mentions: [{ pos: 0, uid: userId, len: name.length + 1 }]
              }, threadId, type);
            }
          } catch (error) {
            console.error("[antinude] AI moderation thất bại:", error?.message || error);
          } finally {
            nudeModerationInFlight.delete(checkId);
          }
        }
      }
    }

    // === Chống dội bom sticker: hơn 5 sticker/4 giây từ cùng một thành viên ===
    if (threadData.anti_sticker_spam && eventType === "message" && data.msgType === "chat.sticker") {
      if (!(await isAdminOrUnknown())) {
        const now = Date.now();
        const cache = global.antiStickerSpamCache instanceof Map
          ? global.antiStickerSpamCache
          : (global.antiStickerSpamCache = new Map());
        const cacheKey = String(threadId) + ":" + String(userId);
        const history = (cache.get(cacheKey) || []).filter(item => now - item.at <= 4000);
        history.push({
          at: now,
          data: { cliMsgId: data.cliMsgId, msgId: data.msgId, uidFrom: userId }
        });

        if (history.length > 5) {
          cache.delete(cacheKey);
          const burst = history.slice(-8);
          await Promise.allSettled(burst.map(item => api.deleteMessage({
            threadId,
            type,
            data: item.data
          }, false)));

          const warnings = global.antiStickerSpamWarnings instanceof Map
            ? global.antiStickerSpamWarnings
            : (global.antiStickerSpamWarnings = new Map());
          const lastWarning = warnings.get(cacheKey) || 0;
          if (now - lastWarning >= 10000) {
            warnings.set(cacheKey, now);
            return api.sendMessage({
              msg: "🚫 @" + name + ", không được dội bom sticker! Bot đã xóa loạt sticker spam.",
              mentions: [{ pos: 3, uid: userId, len: name.length + 1 }]
            }, threadId, type);
          }
          return;
        }
        cache.set(cacheKey, history);
        if (cache.size > 10000) cache.delete(cache.keys().next().value);
      }
    }

    // === Anti Link ===
    if (threadData.anti_link) {
      if ((data.msgType == "chat.recommended" && data.content.action == "recommended.link") || (data.msgType == "webchat" && String(data.content).match(/https?:\/\/[^\s]+/))) {
        if (await isAdminOrUnknown()) return;
        await api.deleteMessage({
          threadId,
          type,
          data: {
            cliMsgId: data.cliMsgId,
            msgId: data.msgId,
            uidFrom: userId
          }
        }, false);

        const msg = `🚫 @${name}, không được gửi link trong nhóm này!`;
        return api.sendMessage({
          msg,
          mentions: [{ pos: 3, uid: userId, len: name.length + 1 }]
        }, threadId, type);
      }
    }

    // === Anti Spam ===
    const SPAM_LIMIT = 5;
    const SPAM_TIME = 5000;
    const now = Date.now();

    global.spamCache = global.spamCache || {};
    const spamCache = global.spamCache;

    if (threadData.anti_spam) {
      if (!spamCache[threadId]) spamCache[threadId] = {};
      if (!spamCache[threadId][userId]) spamCache[threadId][userId] = [];

      if (await isAdminOrUnknown()) return;

      spamCache[threadId][userId].push(now);
      spamCache[threadId][userId] = spamCache[threadId][userId].filter(ts => now - ts <= SPAM_TIME);

      if (spamCache[threadId][userId].length > SPAM_LIMIT) {
        await api.deleteMessage({
          threadId,
          type,
          data: {
            cliMsgId: data.cliMsgId,
            msgId: data.msgId,
            uidFrom: userId
          }
        }, false);

        const msg = `🚫 @${name}, vui lòng không spam!`;
        return api.sendMessage({
          msg,
          mentions: [{ pos: 3, uid: userId, len: name.length + 1 }]
        }, threadId, type);
      }
    }

    // === Anti Undo ===
    if (threadData.anti_undo && eventType === "undo") {
      const messageCache = getMessageCache()[data.content.cliMsgId];
      if (!messageCache) return;

      const timeSend = messageCache.timestamp;
      const timeUndo = data.ts;

      const sendUndoMessage = async (msg, extra) => {
        await api.sendMessage({ msg, ...(extra || {}) }, threadId, typeUndo);
      };

      switch (messageCache.msgType) {
        case "chat.photo": {
          const filePath = await handlePhoto(messageCache, tempPath, name, timeSend, timeUndo, threadId, api, typeUndo);
          tempFiles.push(filePath);
          break;
        }

        case "chat.video.msg": {
          const { href: videoUrl, thumb: thumbnailUrl, params } = messageCache.content;
          const { duration, video_width: width, video_height: height } = JSON.parse(params);

          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
          await api.sendVideo({ videoUrl, thumbnailUrl, duration, height, width }, threadId, typeUndo);
          break;
        }

        case "chat.sticker": {
          const { id, catId, type: stickerType } = messageCache.content;

          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
          await api.sendSticker({ id, cateId: catId, type: stickerType }, threadId, typeUndo);
          break;
        }

        case "chat.voice": {
          const { href: voiceUrl } = messageCache.content;

          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
          await api.sendVoice({ voiceUrl }, threadId, typeUndo);
          break;
        }

        case "chat.recommended": {
          const { action, href, title, params } = messageCache.content;

          if (action === "recommended.link") {
            const msg = formatUndoMessage(name, timeSend, timeUndo, title.replace(href, ""));
            await api.sendLink({ msg, link: href }, threadId, typeUndo);
          } else if (action === "recommended.user") {
            await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
            await api.sendCard({ userId: params }, threadId, typeUndo);
          }
          break;
        }

        case "chat.gif":
        case "share.file": {
          const fileUrl = messageCache.content?.href;
          if (!fileUrl) break;

          try {
            const response = await http.request(fileUrl);

            let fileName = `anti_undo_${Date.now()}.dat`;

            const disposition = response.headers["content-disposition"];
            if (disposition && disposition.includes("filename=")) {
              const match = disposition.match(/filename="?([^"]+)"?/);
              if (match && match[1]) {
                fileName = `${Date.now()}_${match[1]}`;
              }
            }

            const tempFilePath = path.join(tempPath, fileName);
            await fs.writeFile(tempFilePath, response.body);

            const msgBody = formatUndoMessage(name, timeSend, timeUndo, messageCache.content.title || "");

            await api.sendMessage({
              msg: msgBody,
              attachments: [tempFilePath]
            }, threadId, typeUndo);

            tempFiles.push(tempFilePath);
          } catch (err) {
            console.error("[share.file] Download failed:", err.message);
          }
          break;
        }

        case "webchat": {
          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo, messageCache.content));
          break;
        }
      }
    }
  } catch (err) {
    console.error("Lỗi khi xử lý anti:", err);
  } finally {
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
      } catch (err) {
        console.error(`Không thể xóa file tạm ${file}:`, err);
      }
    }
  }
};

module.exports._test = {
  extractMessageUrls,
  isGroupInviteUrl,
  isUnsafeLink,
  isExplicitAdultImage
};

const ANTI_MENU_ITEMS = Object.freeze([
  { key:"anti_nude", label:"Chặn nội dung nhạy cảm", detail:"AI quét ảnh 18+ / khỏa thân", command:"/antinude", alias:"", icon:"18+", tone:"#e83f9e" },
  { key:"anti_undo", label:"Chống thu hồi tin nhắn", detail:"Khôi phục chữ, ảnh, video, voice và sticker", command:"/antirecall", alias:"/anti undo", icon:"↶", tone:"#a94ce5" },
  { key:"anti_danger_link", label:"Chặn link nguy hiểm", detail:"Chặn link mời nhóm khác và URL không an toàn", command:"/antilink", alias:"", icon:"↗", tone:"#138fe5" },
  { key:"anti_sticker_spam", label:"Chống dội bom sticker", detail:"Phát hiện loạt sticker gửi dồn dập", command:"/antispam", alias:"", icon:"ST", tone:"#f18b1c" },
  { key:"anti_link", label:"Chặn tất cả link", detail:"Chế độ chống link cũ của lệnh anti", command:"/anti link", alias:"", icon:"URL", tone:"#08aeba" },
  { key:"anti_spam", label:"Chống spam tin nhắn", detail:"Chế độ chống spam tin nhắn cũ của lệnh anti", command:"/anti spam", alias:"", icon:"SP", tone:"#e4b91e" }
]);

function buildAntiMenuText(threadData = {}, prefix = "/") {
  const data = threadData && typeof threadData === "object" ? threadData : {};
  const lines = [
    "🛡️ BẢO VỆ NHÓM · TRẠNG THÁI HIỆN TẠI",
    "━━━━━━━━━━━━━━━━━━"
  ];
  for (const item of ANTI_MENU_ITEMS) {
    const enabled = data[item.key] === true;
    lines.push((enabled ? "🟢" : "⚪") + " " + item.label + ": " + (enabled ? "ĐANG BẬT" : "ĐANG TẮT"));
  }
  lines.push(
    "━━━━━━━━━━━━━━━━━━",
    "👑 CHỈ TRƯỞNG NHÓM / QTV BOX ĐƯỢC BẬT TẮT",
    "Cách dùng các lệnh:"
  );
  for (const item of ANTI_MENU_ITEMS) {
    lines.push("• " + prefix + item.command.replace(/^\//, "") + " on|off" +
      (item.alias ? "  (alias: " + item.alias + " on|off)" : ""));
  }
  lines.push(
    "Ví dụ: " + prefix + "antinude on",
    "Gõ /anti để xem lại bảng bảo vệ nhóm."
  );
  return lines.join("\n");
}

async function sendAntiMenu({ api, event, Threads }) {
  const prefix = global.config?.prefix || "/";
  const record = await Threads.getData(event.threadId);
  const data = record?.data || {};
  const items = ANTI_MENU_ITEMS.map(item => ({
    key:item.key,
    label:item.label,
    detail:item.detail,
    command:item.command,
    icon:item.icon,
    tone:item.tone,
    enabled:data[item.key] === true
  }));

  let imagePath = null;
  try {
    imagePath = await renderCanvas("anti-protection-v2", { items, prefix });
    await api.sendMessage({
      msg:"🛡️ BẢO VỆ NHÓM · ANTI-PROTECTION V2",
      attachments:[imagePath],
      ttlKind:"card"
    }, event.threadId, event.type);

    // Gửi phần hướng dẫn riêng sau ảnh để thứ tự hiển thị luôn là ảnh trước, nội dung sau.
    await api.sendMessage({
      msg:buildAntiMenuText(data, prefix)
    }, event.threadId, event.type);
  } catch (error) {
    console.error("[ANTI_MENU_V2] Canvas mới không render được:", error?.stack || error);
    return api.sendMessage({
      msg:buildAntiMenuText(data, prefix) + "\n⚠️ Không tạo được ảnh Anti-Protection, bot đã gửi hướng dẫn dạng chữ."
    }, event.threadId, event.type);
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => {
        try { fsSync.rmSync(imagePath, { force:true }); } catch {}
      }, 60000);
      timer.unref?.();
    }
  }
  return true;
}

module.exports._menu = {
  ANTI_MENU_ITEMS,
  buildAntiMenuText
};

module.exports.run = async function ({ api, event, args, Threads }) {
  const { threadId, type } = event;
  if (type !== ThreadType.Group) {
    return api.sendMessage("Lệnh này chỉ có thể được sử dụng trong nhóm chat.", threadId, type);
  }

  const action = String(args?.[0] || "").trim().toLowerCase();
  const keyMap = {
    link: "anti_link",
    undo: "anti_undo",
    spam: "anti_spam"
  };
  const key = keyMap[action];

  if (!key) {
    return sendAntiMenu({ api, event, Threads });
  }

  const mode = String(args?.[1] || "").trim().toLowerCase();
  if (mode && mode !== "on" && mode !== "off") {
    return sendAntiMenu({ api, event, Threads });
  }

  const userId = event?.data?.uidFrom;
  const groupAdminState = await getGroupAdminState(api, threadId, userId);
  if (groupAdminState !== true) {
    return api.sendMessage({
      msg:"🚫 Chỉ trưởng nhóm hoặc phó nhóm (QTV BOX) mới được bật/tắt chế độ Anti."
    }, threadId, type);
  }

  const record = await Threads.getData(threadId);
  const data = { ...(record?.data || {}) };
  const newValue = mode === "on" ? true : mode === "off" ? false : data[key] !== true;
  data[key] = newValue;

  const save = Threads.setDataAndWait || Threads.setData;
  await save.call(Threads, threadId, data);

  return api.sendMessage({
    msg:"✅ Đã " + (newValue ? "bật" : "tắt") + " chế độ Anti " +
      key.replace("anti_", "").toUpperCase() + "."
  }, threadId, type);
};
