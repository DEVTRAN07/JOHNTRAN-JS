const { convertTimestamp, getMessageCache } = require("../../utils/index");
const fs = require("fs").promises;
const path = require("path");
const { ThreadType } = require("zalo-client");
const http = require("../../core/http");
const { renderCanvas } = require("../../core/canvas/workerRender");
const { getGroupAdminState } = require("../../core/runtime/groupAdmin");
const fsSync = require("fs");
const { hasBotGroupKey } = require("../../core/runtime/botGroupKey");

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


const nudeModerationInFlight = new Set();
const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";

function extractMessageUrls(data) {
  const content = data?.content;
  const candidates = [];
  const addText = (value) => {
    if (typeof value !== "string" || !value) return;
    candidates.push(...(value.match(/https?:\/\/[^\s<>"']+/gi) || []));
  };

  if (data?.msgType === "chat.recommended" && content?.action === "recommended.link" && content.href) {
    candidates.push(String(content.href));
  }
  if (typeof content === "string") {
    addText(content);
  } else if (content && typeof content === "object") {
    for (const field of ["href", "url", "link"]) {
      if (typeof content[field] === "string" && /^https?:\/\//i.test(content[field])) {
        candidates.push(content[field]);
      }
    }
    addText(content.title);
    addText(content.description);
  }
  addText(data?.text);
  return [...new Set(candidates.map(url => url.replace(/[),.!?;:]+$/, "")).filter(Boolean))];
}

function isGroupInviteUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return ["http:", "https:"].includes(parsed.protocol) &&
      host === "zalo.me" &&
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
    console.warn("[antilink] Zalo scanURL thất bại:", error?.message || error);
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
      input: [{ type: "image_url", image_url: { url: imageUrl } }]
    })
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error("OpenAI Moderation trả về HTTP " + response.status);
  }
  const result = response.json()?.results?.[0];
  if (!result) throw new Error("OpenAI Moderation không trả về kết quả");
  const configured = Number(process.env.JT_ANTINUDE_SEXUAL_THRESHOLD || 0.9);
  const threshold = Number.isFinite(configured)
    ? Math.min(0.99, Math.max(0.5, configured))
    : 0.9;
  return {
    explicit: isExplicitAdultImage(result, threshold),
    score: Number(result?.category_scores?.sexual) || 0,
    threshold
  };
}

function getImageUrl(data) {
  const content = data?.content;
  if (!content || typeof content !== "object") return null;
  for (const field of ["href", "url", "imageUrl", "image_url", "src"]) {
    const value = content[field];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  for (const attachment of (Array.isArray(content.attachments) ? content.attachments : [])) {
    const value = attachment?.href || attachment?.url || attachment?.imageUrl;
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

function isPhotoMessage(data) {
  const type = String(data?.msgType || "").toLowerCase();
  return type === "chat.photo" || type === "chat.image" || type.includes("photo");
}

function isStickerMessage(data) {
  const type = String(data?.msgType || "").toLowerCase();
  return type === "chat.sticker" || type === "sticker" || type.endsWith(".sticker");
}

function parseVideoParams(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value) return {};
  try { return JSON.parse(value); } catch { return {}; }
}

function buildDeleteDestination(event) {
  const data = event?.data || {};
  if (data.cliMsgId == null || data.msgId == null || data.uidFrom == null) {
    throw new Error("Tin nhắn thiếu cliMsgId/msgId/uidFrom nên không thể xóa");
  }
  return {
    threadId: String(event.threadId),
    type: ThreadType.Group,
    data: {
      cliMsgId: String(data.cliMsgId),
      msgId: String(data.msgId),
      uidFrom: String(data.uidFrom)
    }
  };
}

async function deleteGroupMessage(api, event) {
  if (typeof api?.deleteMessage !== "function") {
    throw new Error("Zalo API deleteMessage không khả dụng");
  }
  return api.deleteMessage(buildDeleteDestination(event), false);
}

async function kickGroupMember(api, userId, threadId) {
  if (typeof api?.removeUserFromGroup !== "function") {
    throw new Error("Zalo API removeUserFromGroup không khả dụng");
  }
  const result = await api.removeUserFromGroup(String(userId), String(threadId));
  const failedMembers = Array.isArray(result?.errorMembers) ? result.errorMembers.map(String) : [];
  if (failedMembers.includes(String(userId))) {
    throw new Error("Zalo từ chối kick thành viên (errorMembers)");
  }
  return result;
}

function createMentionMessage(text, name, userId) {
  const displayName = String(name || "Bạn");
  const uid = String(userId || "");
  const marker = "@" + displayName;
  const pos = text.indexOf("{member}");
  return {
    msg: text.replace("{member}", marker),
    mentions: uid && pos >= 0 ? [{ pos, uid, len: marker.length }] : []
  };
}

module.exports.handleEvent = async function (context = {}) {
  const event = context.event || {};
  // Legacy direct callers historically passed only event/api/Threads.
  // Missing eventType therefore means a normal incoming message; Undo callers
  // must still identify themselves explicitly with eventType="undo".
  const eventType = context.eventType || "message";
  const api = context.api;
  const Threads = context.Threads;
  const data = event.data || {};
  const threadId = String(event.threadId || "");
  const userId = String(data.uidFrom || "");
  const name = data.dName || "Bạn";
  const isGroup = event.type === ThreadType.Group || event.isGroup === true;

  if (!isGroup || !threadId || !userId) return;
  if (context.isSelf === true || event.isSelf === true || userId === "0") return;

  // Anti is available only when the bot account itself is the group owner or a deputy.
  // Unknown role data fails closed and stays silent; sender/admin status is irrelevant.
  if (!(await hasBotGroupKey(api, threadId))) return;
  if (typeof Threads?.getData !== "function") return;

  let threadData;
  try {
    const record = await Threads.getData(threadId);
    threadData = record?.data || record || {};
  } catch (error) {
    console.error("[ANTI] Không đọc được cấu hình nhóm " + threadId + ":", error?.message || error);
    return;
  }

  const activeFlags = [
    "anti_nude", "anti_undo", "anti_danger_link",
    "anti_sticker_spam", "anti_link", "anti_spam"
  ];
  if (!activeFlags.some(key => threadData[key] === true)) return;

  // Anti rules apply uniformly to every human group member, including
  // the group owner and deputies. QTV privilege is enforced only by the
  // command that changes Anti settings, never by message moderation.
  const sendNotice = (message) => api.sendMessage(
    createMentionMessage(message, name, userId),
    threadId,
    ThreadType.Group
  );
  const tempPath = path.join(__dirname, "temp");
  const tempFiles = [];

  try {
    // Undo payload from zalo-client has isGroup=true and no ThreadType field.
    if (threadData.anti_undo === true && eventType === "undo") {
      const undoCliMsgId = data.content?.cliMsgId ?? data.cliMsgId;
      if (undoCliMsgId == null) return;
      const cached = getMessageCache()[String(undoCliMsgId)];
      if (!cached || (cached.threadId && String(cached.threadId) !== threadId)) return;

      const timeSend = cached.timestamp || cached.ts || Date.now();
      const timeUndo = data.ts || Date.now();
      const sendUndoMessage = (msg, extra) => api.sendMessage(
        { msg, ...(extra || {}) }, threadId, ThreadType.Group
      );

      switch (cached.msgType) {
        case "chat.photo": {
          const tempFilePath = await handlePhoto(
            cached, tempPath, name, timeSend, timeUndo, threadId, api, ThreadType.Group
          );
          tempFiles.push(tempFilePath);
          break;
        }
        case "chat.video.msg": {
          const content = cached.content || {};
          const params = parseVideoParams(content.params);
          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
          if (content.href && typeof api.sendVideo === "function") {
            await api.sendVideo({
              videoUrl: content.href,
              thumbnailUrl: content.thumb,
              duration: Number(params.duration) || 0,
              width: Number(params.video_width) || 0,
              height: Number(params.video_height) || 0
            }, threadId, ThreadType.Group);
          }
          break;
        }
        case "chat.sticker": {
          const content = cached.content || {};
          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
          if (typeof api.sendSticker === "function") {
            await api.sendSticker({
              id: content.id,
              cateId: content.catId ?? content.cateId,
              type: content.type
            }, threadId, ThreadType.Group);
          }
          break;
        }
        case "chat.voice": {
          const voiceUrl = cached.content?.href;
          await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
          if (voiceUrl && typeof api.sendVoice === "function") {
            await api.sendVoice({ voiceUrl }, threadId, ThreadType.Group);
          }
          break;
        }
        case "chat.recommended": {
          const content = cached.content || {};
          const href = content.href || "";
          if (content.action === "recommended.link" && typeof api.sendLink === "function") {
            const title = String(content.title || "").replace(href, "").trim();
            await api.sendLink({
              msg: formatUndoMessage(name, timeSend, timeUndo, title),
              link: href
            }, threadId, ThreadType.Group);
          } else if (content.action === "recommended.user" && typeof api.sendCard === "function") {
            await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
            await api.sendCard({ userId: content.params }, threadId, ThreadType.Group);
          }
          break;
        }
        case "chat.gif":
        case "share.file": {
          const fileUrl = cached.content?.href;
          if (!fileUrl) break;
          await fs.mkdir(tempPath, { recursive: true });
          const response = await http.request(fileUrl, { timeout: 15000, retries: 1 });
          let fileName = "anti_undo_" + Date.now() + ".dat";
          const disposition = response.headers?.["content-disposition"];
          if (disposition && disposition.includes("filename=")) {
            const match = disposition.match(/filename="?([^"]+)"?/);
            if (match?.[1]) fileName = Date.now() + "_" + path.basename(match[1]);
          }
          const tempFilePath = path.join(tempPath, fileName);
          await fs.writeFile(tempFilePath, response.body);
          await api.sendMessage({
            msg: formatUndoMessage(name, timeSend, timeUndo, cached.content.title || ""),
            attachments: [tempFilePath]
          }, threadId, ThreadType.Group);
          tempFiles.push(tempFilePath);
          break;
        }
        case "webchat": {
          await sendUndoMessage(formatUndoMessage(
            name, timeSend, timeUndo,
            typeof cached.content === "string" ? cached.content : cached.content?.title || ""
          ));
          break;
        }
        default: {
          const text = typeof cached.content === "string"
            ? cached.content
            : cached.content?.title || "";
          if (text) await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo, text));
        }
      }
      return;
    }

    if (eventType !== "message") return;

    if (threadData.anti_nude === true && isPhotoMessage(data)) {
      const imageUrl = getImageUrl(data);
      if (imageUrl) {
        const checkId = threadId + ":" + String(data.cliMsgId || data.msgId || imageUrl);
        if (!nudeModerationInFlight.has(checkId)) {
          nudeModerationInFlight.add(checkId);
          try {
            const moderation = await moderateImage(imageUrl);
            if (moderation.explicit) {
              let deleteError = null;
              let kickError = null;
              try { await deleteGroupMessage(api, event); }
              catch (error) { deleteError = error; }
              try { await kickGroupMember(api, userId, threadId); }
              catch (error) { kickError = error; }

              const actions = [];
              actions.push(deleteError ? "chưa xóa được ảnh" : "đã xóa ảnh");
              actions.push(kickError ? "chưa kick được thành viên" : "đã kick thành viên");
              return sendNotice(
                "⛔ AI phát hiện ảnh vi phạm (điểm sexual " +
                Math.round(moderation.score * 100) + "%). {member}: " +
                actions.join(", ") + "." +
                (deleteError ? "\n⚠️ " + deleteError.message : "") +
                (kickError ? "\n⚠️ " + kickError.message : "")
              );
            }
          } catch (error) {
            console.error("[ANTINUDE] Không thể phân loại ảnh tại nhóm " + threadId + ":", error?.stack || error);
          } finally {
            nudeModerationInFlight.delete(checkId);
          }
        }
      }
    }

    const urls = extractMessageUrls(data);

    if (urls.length && threadData.anti_danger_link === true) {
      let blockedUrl = null;
      for (const url of urls) {
        if (await isUnsafeLink(url, api)) {
          blockedUrl = url;
          break;
        }
      }
      if (blockedUrl) {
        let deleteError = null;
        try { await deleteGroupMessage(api, event); }
        catch (error) { deleteError = error; }
        return sendNotice(
          deleteError
            ? "🚫 {member}, phát hiện link nguy hiểm nhưng bot chưa xóa được tin nhắn: " + deleteError.message
            : "🚫 {member}, link mời nhóm khác hoặc URL không an toàn đã bị chặn."
        );
      }
    }

    if (urls.length && threadData.anti_link === true) {
      let deleteError = null;
      try { await deleteGroupMessage(api, event); }
      catch (error) { deleteError = error; }
      return sendNotice(
        deleteError
          ? "🚫 {member}, không được gửi link. Bot chưa xóa được tin nhắn: " + deleteError.message
          : "🚫 {member}, không được gửi link trong nhóm này!"
      );
    }

    if (threadData.anti_sticker_spam === true && isStickerMessage(data)) {
      const now = Date.now();
      const cache = global.antiStickerSpamCache instanceof Map
        ? global.antiStickerSpamCache
        : (global.antiStickerSpamCache = new Map());
      const cacheKey = threadId + ":" + userId;
      const history = (cache.get(cacheKey) || []).filter(item => now - item.at <= 4000);

      if (data.cliMsgId != null && data.msgId != null) {
        history.push({
          at: now,
          data: { cliMsgId: data.cliMsgId, msgId: data.msgId, uidFrom: userId }
        });
      }

      if (history.length > 5) {
        cache.delete(cacheKey);
        const results = await Promise.allSettled(history.map(item => deleteGroupMessage(api, {
          threadId,
          type: ThreadType.Group,
          data: item.data
        })));
        const deleted = results.filter(item => item.status === "fulfilled").length;
        const warnings = global.antiStickerSpamWarnings instanceof Map
          ? global.antiStickerSpamWarnings
          : (global.antiStickerSpamWarnings = new Map());
        const lastWarning = warnings.get(cacheKey) || 0;
        if (now - lastWarning >= 10000) {
          warnings.set(cacheKey, now);
          return sendNotice(
            deleted
              ? "🚫 {member}, không được dội bom sticker! Bot đã xóa " + deleted + "/" + history.length + " sticker."
              : "🚫 {member}, phát hiện dội bom sticker nhưng Zalo không cho bot xóa sticker."
          );
        }
        return;
      }

      cache.set(cacheKey, history);
      if (cache.size > 10000) cache.delete(cache.keys().next().value);
    }

    if (threadData.anti_spam === true) {
      const now = Date.now();
      const cache = global.spamCache && typeof global.spamCache === "object"
        ? global.spamCache
        : (global.spamCache = {});
      if (!cache[threadId]) cache[threadId] = {};
      const history = (cache[threadId][userId] || []).filter(ts => now - ts <= 5000);
      history.push(now);
      cache[threadId][userId] = history;
      if (history.length > 5) {
        let deleteError = null;
        try { await deleteGroupMessage(api, event); }
        catch (error) { deleteError = error; }
        return sendNotice(
          deleteError
            ? "🚫 {member}, vui lòng không spam. Bot chưa xóa được tin nhắn: " + deleteError.message
            : "🚫 {member}, vui lòng không spam!"
        );
      }
    }
  } catch (error) {
    console.error("[ANTI] Lỗi xử lý tại nhóm " + threadId + ":", error?.stack || error);
  } finally {
    for (const file of tempFiles) {
      try { await fs.unlink(file); }
      catch (error) { console.error("[ANTI] Không thể xóa file tạm " + file + ":", error?.message || error); }
    }
  }
};



module.exports._test = {
  extractMessageUrls,
  isGroupInviteUrl,
  isUnsafeLink,
  isExplicitAdultImage,
  getImageUrl,
  isPhotoMessage,
  isStickerMessage,
  buildDeleteDestination,
  kickGroupMember
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
    command:prefix + item.command.replace(/^\//, ""),
    icon:item.icon,
    tone:item.tone,
    enabled:data[item.key] === true
  }));

  let imagePath = null;
  try {
    imagePath = await renderCanvas("anti-protection-v2", { items, prefix });
    // The image already contains all six live statuses and concise usage
    // guidance. Send one caption with it; do not repeat the same table as text.
    await api.sendMessage({
      msg:"🛡️ BẢO VỆ NHÓM · TRẠNG THÁI HIỆN TẠI",
      attachments:[imagePath],
      ttlKind:"card"
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
