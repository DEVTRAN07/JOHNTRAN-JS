const { convertTimestamp, getMessageCache } = require("../../utils/index");
const fs = require("fs").promises;
const path = require("path");
const { ThreadType } = require("zalo-client");
const http = require("../../core/http");
const { renderCanvas } = require("../../core/canvas/workerRender");
const { getGroupAdminState } = require("../../core/runtime/groupAdmin");
const fsSync = require("fs");
const { getBotGroupRole, getBotId } = require("../../core/runtime/botGroupKey");
const { ANTI_PROTECTION_KEYS } = require("../../core/runtime/antiProtection");
const { runThreadQueue } = require("../../core/runtime/threadQueue");
const { sendAntiToggleNotice } = require("../../core/runtime/antiToggle");

const ANTI_SELF_ECHO_TTL_MS = 60_000;
const ANTI_SELF_ECHO_LIMIT = 3000;
const antiSelfEchoes = new Map();
const antiSkipLogAt = new Map();

function createUrlScanCache(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const safeTtlMs = Math.max(0, Number(options.safeTtlMs) || 30_000);
  const unsafeTtlMs = Math.max(0, Number(options.unsafeTtlMs) || 120_000);
  const maxEntries = Math.max(1, Math.floor(Number(options.maxEntries) || 1000));
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  const cache = new Map();
  const pending = new Map();

  async function scan(rawUrl, scanner) {
    const url = String(rawUrl || "").trim();
    if (!url || typeof scanner !== "function") return false;

    const timestamp = now();
    const cached = cache.get(url);
    if (cached) {
      if (cached.expiresAt > timestamp) {
        // LRU refresh so actively shared URLs survive the bounded cache.
        cache.delete(url);
        cache.set(url, cached);
        return cached.unsafe;
      }
      cache.delete(url);
    }

    // Coalesce duplicate links from simultaneous messages in the same group.
    if (pending.has(url)) return pending.get(url);

    const task = Promise.resolve()
      .then(() => scanner(url))
      .then(result => {
        const unsafe = result?.isSafe === false;
        const ttlMs = unsafe ? unsafeTtlMs : safeTtlMs;
        if (ttlMs > 0) {
          cache.delete(url);
          cache.set(url, { unsafe, expiresAt: now() + ttlMs });
          while (cache.size > maxEntries) {
            cache.delete(cache.keys().next().value);
          }
        }
        return unsafe;
      })
      .catch(error => {
        // Do not cache transport errors: the next message gets a fresh scan.
        try { onError(error, url); } catch {}
        return false;
      })
      .finally(() => pending.delete(url));

    pending.set(url, task);
    return task;
  }

  return {
    scan,
    clear() {
      cache.clear();
      pending.clear();
    },
    stats() {
      return { cached: cache.size, pending: pending.size, maxEntries };
    }
  };
}

const urlScanCache = createUrlScanCache({
  onError(error) {
    console.warn("[antilink] Zalo scanURL thất bại:", error?.message || error);
  }
});

function normalizeEchoText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function echoKeysFromPayload(threadId, payload) {
  const keys = [];
  const add = (kind, value) => {
    const normalized = normalizeEchoText(value);
    if (normalized) keys.push(String(threadId) + ":" + kind + ":" + normalized);
  };
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (value == null || depth > 5) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^https?:\/\//i.test(trimmed)) add("url", trimmed);
      else add("text", trimmed);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const field of ["msg", "text", "title", "description", "href", "url", "link", "videoUrl", "voiceUrl"]) {
      if (value[field] != null) visit(value[field], depth + 1);
    }
    for (const field of ["msgId", "cliMsgId"]) {
      if (value[field] != null) add(field, value[field]);
    }
    for (const field of ["message", "attachment", "attachments", "data", "content"]) {
      if (value[field] != null) visit(value[field], depth + 1);
    }
  };
  visit(payload);
  return [...new Set(keys)];
}

function pruneAntiSelfEchoes(now = Date.now()) {
  for (const [key, expiresAt] of antiSelfEchoes) {
    if (expiresAt <= now) antiSelfEchoes.delete(key);
  }
  while (antiSelfEchoes.size > ANTI_SELF_ECHO_LIMIT) {
    antiSelfEchoes.delete(antiSelfEchoes.keys().next().value);
  }
}

function rememberAntiSelfEcho(threadId, payload) {
  const keys = echoKeysFromPayload(threadId, payload);
  const expiresAt = Date.now() + ANTI_SELF_ECHO_TTL_MS;
  pruneAntiSelfEchoes();
  for (const key of keys) antiSelfEchoes.set(key, expiresAt);
  return keys;
}

function forgetAntiSelfEchoes(keys) {
  for (const key of Array.isArray(keys) ? keys : []) antiSelfEchoes.delete(key);
}

function isAntiGeneratedSelfEcho(event, consume = true) {
  const data = event?.data || {};
  const threadId = String(event?.threadId || "");
  if (!threadId) return false;
  pruneAntiSelfEchoes();
  let matched = false;
  for (const key of echoKeysFromPayload(threadId, data)) {
    if (!antiSelfEchoes.has(key)) continue;
    if (consume) antiSelfEchoes.delete(key);
    matched = true;
  }
  return matched;
}

function shouldSkipSelfEvent(context = {}) {
  const event = context.event || {};
  const userId = String(event?.data?.uidFrom || "");
  if (userId === "0") return true;
  const isSelf = context.isSelf === true || event.isSelf === true;
  if (!isSelf) return false;
  if (isAntiGeneratedSelfEcho(event)) return true;
  return global.config?.allow_self_anti !== true;
}

function logAntiSkip(threadId, reason) {
  const key = String(threadId || "") + ":" + String(reason || "");
  const now = Date.now();
  const previous = antiSkipLogAt.get(key) || 0;
  if (now - previous < 30_000) return;
  antiSkipLogAt.set(key, now);
  if (antiSkipLogAt.size > 1000) antiSkipLogAt.delete(antiSkipLogAt.keys().next().value);
  console.warn("[ANTI] Bỏ qua nhóm " + String(threadId || "?") + ": " + reason);
}

async function sendAntiAction(api, method, payload, threadId, type) {
  if (typeof api?.[method] !== "function") {
    throw new Error("Zalo API " + method + " không khả dụng");
  }
  const echoKeys = rememberAntiSelfEcho(threadId, payload);
  try {
    const response = await api[method](payload, threadId, type);
    rememberAntiSelfEcho(threadId, response);
    return response;
  } catch (error) {
    forgetAntiSelfEchoes(echoKeys);
    throw error;
  }
}

function sendAntiMessage(api, payload, threadId, type) {
  const body = typeof payload === "string" ? { msg: payload } : payload;
  return sendAntiAction(api, "sendMessage", body, threadId, type);
}

module.exports.config = {
  name: "anti",
  version: "1.1.7",
  role: 0,
  author: "ShinTHL09",
  description: "Bật/tắt các chế độ Anti của nhóm",
  category: "Anti",
  usage: "anti [link|undo|spam] [on|off]",
  preferCommandOnBare: true,
  cooldowns: 2,
  event_type: ["message", "undo", "reaction", "group_event"],
  // Anti remains active on command messages for link/word/media moderation.
  allowCommandMessages: true
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

  await sendAntiMessage(api, { msg: msgBody, attachments: [tempFilePath] }, threadId, type);
  return tempFilePath;
}


const nudeModerationInFlight = new Set();
const nudeEnforcementQueues = new Map();
const ANTI_NUDE_WARNING_LIMIT = 3;
const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";


function extractMessageUrls(data) {
  const candidates = [];
  const seen = new Set();
  const addText = (value) => {
    if (typeof value !== "string" || !value) return;
    candidates.push(...(value.match(/https?:\/\/[^\s<>"']+/gi) || []));
  };
  const visit = (value, depth = 0) => {
    if (value == null || depth > 6) return;
    if (typeof value === "string") { addText(value); return; }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const fields = ["href", "url", "link", "src", "oriUrl", "ori_url", "text", "title", "description", "content", "msg"];
    for (const field of fields) {
      if (value[field] != null) visit(value[field], depth + 1);
    }
    for (const [field, nested] of Object.entries(value)) {
      if (!fields.includes(field) &&
          (typeof nested === "string" || Array.isArray(nested) || (nested && typeof nested === "object"))) {
        visit(nested, depth + 1);
      }
    }
  };

  visit(data?.content);
  visit(data?.propertyExt);
  visit(data?.quote);
  visit(data?.href);
  visit(data?.msg);
  visit(data?.text);

  if (data?.msgType === "chat.recommended" &&
      data?.content?.action === "recommended.link" &&
      data.content.href) {
    candidates.push(String(data.content.href));
  }

  const urls = [];
  const unique = new Set();
  for (const raw of candidates) {
    const url = String(raw || "").replace(/[.,;:!?]+$/g, "").replace(/[)}\]]+$/g, "");
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) continue;
      // Validate with URL, but preserve the exact submitted URL.
      // Zalo scanURL and platform providers may compare/resolve the original string.
      const normalized = url;
      if (!unique.has(normalized)) {
        unique.add(normalized);
        urls.push(normalized);
      }
    } catch { /* URL không hợp lệ */ }
  }
  return urls;
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
  return urlScanCache.scan(rawUrl, url => api.scanURL(url));
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

const ANTI_QR_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function decodeQrFromImageBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > ANTI_QR_MAX_IMAGE_BYTES) {
    return null;
  }

  // Jimp decoding and jsQR scanning are CPU work. Keep them off the Zalo
  // listener's main thread so a large photo cannot pause command dispatch.
  const runInWorker = typeof options.runInWorker === "function"
    ? options.runInWorker
    : require("../../core/workerPool").runInWorker;
  const decoded = await runInWorker("qrWorker", { buffer }, {
    timeout: 8000,
    size: 1,
    maxPending: 8
  });
  return typeof decoded === "string" && decoded ? decoded : null;
}

async function imageContainsQr(data, options = {}) {
  const imageUrl = getImageUrl(data);
  if (!imageUrl) return false;
  const client = options.httpClient || http;
  const decode = options.decode || decodeQrFromImageBuffer;
  try {
    const response = await client.getBuffer(imageUrl, { timeout: 5000, retries: 0 });
    const buffer = response?.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > ANTI_QR_MAX_IMAGE_BYTES) {
      return false;
    }
    const contentType = String(response?.contentType || "").toLowerCase();
    if (contentType && !contentType.startsWith("image/")) return false;
    return Boolean(await decode(buffer));
  } catch (error) {
    console.warn("[ANTI_QR] Không thể quét QR trong ảnh:", error?.message || error);
    return false;
  }
}

function isPhotoMessage(data) {
  const type = String(data?.msgType || "").toLowerCase();
  return type === "chat.photo" || type === "chat.image" || type.includes("photo");
}

function isStickerMessage(data) {
  const type = String(data?.msgType || "").toLowerCase();
  return type === "chat.sticker" || type === "sticker" || type.endsWith(".sticker");
}

function getMessageKind(data = {}) {
  const type = String(data?.msgType || "").toLowerCase();
  const content = data?.content && typeof data.content === "object" ? data.content : {};
  const action = String(content.action || "").toLowerCase();
  const mime = String(content.mimeType || content.mime_type || content.contentType || "").toLowerCase();
  const hints = [content.type, content.subType, content.category, content.kind, content.fileType]
    .map(value => String(value || "").toLowerCase()).join(" ");
  if (type.includes("qr") || content.isQr === true || content.isQR === true ||
      content.qrCode === true || /(^|[._ -])qr([._ -]|$)/i.test(hints)) return "qr";
  if (type.includes("doodle") || action.includes("doodle") || hints.includes("doodle") || content.isDoodle === true) return "doodle";
  if ((type === "chat.recommended" && action === "recommended.user") ||
      type.includes("card") || hints.includes("contact_card")) return "card";
  if (type === "share.file" || type.includes(".file") || hints.includes("file")) return "file";
  if (type.includes("gif") || mime === "image/gif" || hints.includes("gif") ||
      String(content.href || "").toLowerCase().split("?")[0].endsWith(".gif")) return "gif";
  if (type.includes("location") || type.includes("map") || hints.includes("location") ||
      ((content.lat != null || content.latitude != null) &&
       (content.lng != null || content.long != null || content.longitude != null))) return "location";
  if (type.includes("video") || mime.startsWith("video/")) return "video";
  if (type.includes("voice") || mime.startsWith("audio/")) return "voice";
  if (type.includes("sticker")) return "sticker";
  if (type.includes("photo") || type.includes("image") || mime.startsWith("image/")) return "photo";
  if (type === "webchat" || type === "chat.text" || type === "text" || type.includes("text") ||
      (!type && typeof data?.content === "string")) return "text";
  if (/unknown|unsupported|error|bug/.test(type)) return "other";
  return type ? "other" : null;
}

function extractPlainMessageText(data = {}) {
  const content = data?.content;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    for (const key of ["title", "text", "description", "msg"]) {
      if (typeof content[key] === "string") return content[key];
    }
  }
  return typeof data?.text === "string" ? data.text : "";
}

function normalizeAntiWord(value) {
  // Preserve Vietnamese tone marks: stripping them turns the profanity "đĩ"
  // into "di", which would incorrectly block the ordinary word "đi".
  return String(value || "").toLowerCase().normalize("NFC")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const ANTI_BAD_WORDS = (() => {
  const words = ["địt", "đụ", "lồn", "cặc", "buồi", "đéo", "đĩ", "fuck", "shit", "bitch", "asshole"];
  try {
    const file = path.join(__dirname, "../../assets/spam/badwords.txt");
    const lines = fsSync.readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const value = line.trim();
      if (value && !value.startsWith("#")) words.push(value);
    }
  } catch (error) {
    console.warn("[ANTI_WORD] Không đọc được danh sách từ cấm:", error?.message || error);
  }
  return [...new Set(words.map(normalizeAntiWord).filter(Boolean))];
})();

function findAntiBadWord(data = {}) {
  const text = " " + normalizeAntiWord(extractPlainMessageText(data)) + " ";
  if (text.trim() === "") return null;
  for (const word of ANTI_BAD_WORDS) {
    if (text.includes(" " + word + " ")) return word;
  }
  return null;
}

function hasHiddenMention(data = {}) {
  const content = data?.content && typeof data.content === "object" ? data.content : {};
  const mentions = Array.isArray(data?.mentions) ? data.mentions
    : (Array.isArray(content.mentions) ? content.mentions : []);
  const text = extractPlainMessageText(data);
  return mentions.some(mention => {
    if (!mention || typeof mention !== "object") return true;
    if (mention.hidden === true || mention.isHidden === true || mention.visibility === "hidden") return true;
    const pos = Number(mention.pos);
    const len = Number(mention.len);
    if (!Number.isInteger(pos) || !Number.isInteger(len) || pos < 0 || len <= 0 || pos + len > text.length) return true;
    return !text.slice(pos, pos + len).includes("@");
  });
}

function isMalformedAntiPayload(data = {}) {
  const type = String(data?.msgType || "").toLowerCase();
  const content = data?.content;
  return /(^|[._-])(unknown|unsupported|error|bug)([._-]|$)/.test(type) ||
    (content && typeof content === "object" &&
      (content.error === true || content.unsupported === true || content.malformed === true));
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

async function isBotAuthoredMessage(api, event) {
  if (event?.isSelf === true) return true;
  if (typeof api?.getOwnId !== "function") return false;
  try {
    const ownId = String(await api.getOwnId() || "");
    return Boolean(ownId && ownId === String(event?.data?.uidFrom || ""));
  } catch {
    return false;
  }
}

async function deleteGroupMessage(api, event, options = {}) {
  const destination = buildDeleteDestination(event);

  // zalo-client explicitly rejects deleteMessage(..., false) for a message
  // sent by the logged-in bot account. Zalo requires the undo endpoint for
  // that case; regular members' messages still use group deleteMessage.
  const isBotMessage = options.isBotMessage === true ||
    await isBotAuthoredMessage(api, event);

  if (isBotMessage) {
    if (typeof api?.undo !== "function") {
      throw new Error("Zalo API undo không khả dụng để thu hồi tin nhắn do bot gửi");
    }
    return api.undo(
      {
        msgId: destination.data.msgId,
        cliMsgId: destination.data.cliMsgId
      },
      destination.threadId,
      ThreadType.Group
    );
  }

  if (typeof api?.deleteMessage !== "function") {
    throw new Error("Zalo API deleteMessage không khả dụng");
  }
  return api.deleteMessage(destination, false);
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

async function withNudeEnforcementLock(threadId, task) {
  const key = String(threadId || "");
  const previous = nudeEnforcementQueues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  nudeEnforcementQueues.set(key, queued);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (nudeEnforcementQueues.get(key) === queued) nudeEnforcementQueues.delete(key);
  }
}

async function registerAntiViolation(Threads, api, threadId, userId, warningsKey = "anti_nude_warnings") {
  return withNudeEnforcementLock(threadId, async () => {
    if (typeof Threads?.getData !== "function") {
      return { warningCount: 0, persistError: new Error("Không đọc được dữ liệu nhóm để lưu cảnh cáo") };
    }

    let record;
    try {
      record = await Threads.getData(threadId);
    } catch (error) {
      return { warningCount: 0, persistError: error };
    }
    const threadData = {
      ...((record?.data && typeof record.data === "object") ? record.data : (record || {}))
    };
    const storedWarnings = threadData[warningsKey];
    const warnings = storedWarnings && typeof storedWarnings === "object" && !Array.isArray(storedWarnings)
      ? { ...storedWarnings }
      : {};
    const uid = String(userId || "");
    const current = Math.min(
      ANTI_NUDE_WARNING_LIMIT,
      Math.max(0, Math.floor(Number(warnings[uid]) || 0))
    );

    const save = Threads.setDataAndWait || Threads.setData;
    if (typeof save !== "function") {
      return { warningCount: current, persistError: new Error("Không có API lưu số lần cảnh cáo Anti") };
    }

    // Three strikes are warnings. The fourth violating message attempts the kick.
    if (current < ANTI_NUDE_WARNING_LIMIT) {
      const nextCount = current + 1;
      warnings[uid] = nextCount;
      while (Object.keys(warnings).length > 1000) {
        const oldestUid = Object.keys(warnings).find(key => key !== uid);
        if (!oldestUid) break;
        delete warnings[oldestUid];
      }
      threadData[warningsKey] = warnings;
      try {
        await save.call(Threads, threadId, threadData);
        return { warningCount: nextCount, kicked: false };
      } catch (error) {
        return { warningCount: current, persistError: error };
      }
    }

    try {
      await kickGroupMember(api, uid, threadId);
    } catch (error) {
      return { warningCount: ANTI_NUDE_WARNING_LIMIT, kicked: false, kickError: error };
    }

    delete warnings[uid];
    threadData[warningsKey] = warnings;
    let cleanupError = null;
    try {
      await save.call(Threads, threadId, threadData);
    } catch (error) {
      cleanupError = error;
      console.error("[ANTI] Đã kick thành viên nhưng không xóa được bộ đếm cảnh cáo:", error?.message || error);
    }
    return { warningCount: ANTI_NUDE_WARNING_LIMIT, kicked: true, cleanupError };
  });
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

async function enforceAntiViolation({ api, event, Threads, sendNotice, userId, ensureBotKey, reason, warningKey, deleteEvents }) {
  // Verify only after a local rule has positively identified a violation.
  if (typeof ensureBotKey === "function" && !(await ensureBotKey())) {
    return { consumed: false, skipped: true };
  }
  const targets = Array.isArray(deleteEvents) && deleteEvents.length ? deleteEvents : [event];
  const botAuthored = await isBotAuthoredMessage(api, event);
  const deleteResults = await Promise.allSettled(
    targets.map(target => deleteGroupMessage(api, target, { isBotMessage: botAuthored }))
  );
  const deleted = deleteResults.filter(result => result.status === "fulfilled").length;
  const deleteFailures = deleteResults.filter(result => result.status === "rejected");
  const deleteNote = deleteFailures.length
    ? "⚠️ Bot xóa/thu hồi được " + deleted + "/" + targets.length + " tin; " +
      String(deleteFailures[0].reason?.message || deleteFailures[0].reason || "API Zalo từ chối")
    : (botAuthored ? "Đã thu hồi tin nhắn thử nghiệm." : "Đã xóa tin nhắn vi phạm.");

  if (botAuthored) {
    await sendNotice("🚫 {member}, " + reason + "\n" + deleteNote + " Bỏ qua cảnh cáo và không kick tài khoản bot.");
    return { consumed: true, moderated: true };
  }

  const enforcement = await registerAntiViolation(Threads, api, event.threadId, userId, warningKey);
  let warningNote;
  if (enforcement.persistError) {
    warningNote = "⚠️ Chưa lưu được cảnh cáo nên bot chưa kick: " +
      String(enforcement.persistError.message || enforcement.persistError);
  } else if (enforcement.kicked) {
    warningNote = "⛔ Đã đủ 3 lần cảnh cáo. Vi phạm lần thứ 4, bot đã kick thành viên.";
  } else if (enforcement.kickError) {
    warningNote = "⚠️ Đã đủ 3 lần cảnh cáo; bot thử kick nhưng Zalo từ chối kick thành viên. Bot sẽ thử lại khi thành viên tái phạm.";
  } else {
    warningNote = "⚠️ Cảnh cáo lần " + enforcement.warningCount +
      "/3. Sau 3 lần cảnh cáo, vi phạm lần thứ 4 sẽ bị kick.";
  }

  if (deleteFailures.length) warningNote += "\n" + deleteNote;
  await sendNotice("🚫 {member}, " + reason + "\n" + warningNote);
  return { consumed: true, moderated: true };
}

function getRelevantAntiProtectionKeys(eventType) {
  if (eventType === "group_event") return ["anti_join"];
  if (eventType === "reaction") return ["anti_reaction"];
  if (eventType === "undo") return ["anti_undo"];
  return ANTI_PROTECTION_KEYS.filter(key =>
    key !== "anti_join" && key !== "anti_reaction" && key !== "anti_undo"
  );
}

async function handleAntiEvent(context = {}) {
  const event = context.event || {};
  // Legacy direct callers historically passed only event/api/Threads.
  // Missing eventType therefore means a normal incoming message; Undo callers
  // must still identify themselves explicitly with eventType="undo".
  const eventType = context.eventType || "message";
  const api = context.api;
  const Threads = context.Threads;
  const data = event.data || {};
  const threadId = String(event.threadId || "");
  const undoCliMsgId = eventType === "undo"
    ? (data.content?.cliMsgId ?? data.cliMsgId)
    : null;
  const cachedUndoMessage = undoCliMsgId == null
    ? null
    : getMessageCache()[String(undoCliMsgId)];
  const userId = String(data.uidFrom || (eventType === "undo" ? cachedUndoMessage?.uidFrom : "") || "");
  const name = data.dName || (eventType === "undo" ? cachedUndoMessage?.dName : "") || "Bạn";
  const isGroup = event.type === ThreadType.Group || event.isGroup === true || eventType === "group_event";

  if (!isGroup || !threadId || (!userId && eventType !== "undo" && eventType !== "group_event")) return;
  if (eventType === "undo" && !userId) {
    logAntiSkip(threadId, "sự kiện thu hồi không có uid người gửi và không tìm thấy bản tin trong cache");
    return;
  }
  // GroupEvent.isSelf can mean either "the bot was added" OR
  // "the bot initiated the group action" (for example, it invited a human).
  // Anti-Join must still inspect human updateMembers when the bot is the inviter;
  // its own-ID guard below excludes the bot if the bot itself joined.
  const isGroupJoinEvent = eventType === "group_event" &&
    String(event.type || "").toLowerCase() === "join";
  if (shouldSkipSelfEvent(context) && !isGroupJoinEvent) {
    logAntiSkip(threadId, "tin do bot gửi bị chặn bởi allow_self_anti hoặc là phản hồi Anti do bot tạo");
    return;
  }

  if (typeof Threads?.getCachedData !== "function" &&
      typeof Threads?.getData !== "function") return;

  let threadData;
  try {
    // Moderation runs on every incoming group event. Read the controller's
    // last-known committed snapshot synchronously first, so a temporary
    // Supabase outage / startup sync does not silently disable Anti for an
    // already-configured group. Cold groups still use the durable async read.
    let record = context.cachedThreadRecord || null;
    // handleEvent checks the hot cache once before queueing so inactive Anti
    // rules never enter the serialized path. Reuse that result here.
    if (!record && context.cachedThreadCacheChecked !== true) {
      try {
        record = Threads.getCachedData?.(threadId) || null;
      } catch { /* fall back to the durable read below */ }
    }
    if (!record) {
      if (typeof Threads?.getData !== "function") return;
      record = await Threads.getData(threadId);
    }
    const source = record?.data || record || {};
    // Work on a detached snapshot. Anti-Join updates strike history locally;
    // failed writes must never mutate the controller cache by reference.
    threadData = { ...source };
  } catch (error) {
    console.error("[ANTI] Không đọc được cấu hình nhóm " + threadId + ":", error?.message || error);
    return;
  }

  const relevantKeys = getRelevantAntiProtectionKeys(eventType);
  if (!relevantKeys.some(key => threadData[key] === true)) return;

  // Verify the bot key lazily, only when an actual protection needs to
  // delete/restore a message, warn, or kick. Harmless text must not wait for
  // a live getGroupInfo round-trip just because an Anti switch is enabled.
  let botKeyCheck = null;
  const ensureBotKey = () => {
    if (!botKeyCheck) {
      botKeyCheck = (async () => {
        let botRole = "unknown";
        try {
          botRole = await getBotGroupRole(api, threadId);
        } catch (error) {
          logAntiSkip(threadId, "không xác minh được key QTV của bot: " + (error?.message || error));
          return false;
        }
        if (botRole !== "owner" && botRole !== "deputy") {
          logAntiSkip(threadId, "tài khoản bot chưa được xác minh là trưởng/phó nhóm (role=" + botRole + ")");
          return false;
        }
        return true;
      })();
    }
    return botKeyCheck;
  };

  // Anti rules apply uniformly to every human group member, including
  // the group owner and deputies. QTV privilege is enforced only by the
  // command that changes Anti settings, never by message moderation.
  const sendNotice = (message) => sendAntiMessage(
    api,
    createMentionMessage(message, name, userId),
    threadId,
    ThreadType.Group
  );
  const tempPath = path.join(__dirname, "temp");
  const tempFiles = [];

  try {
    if (eventType === "group_event") {
      if (threadData.anti_join === true && String(event.type || "").toLowerCase() === "join") {
        const members = Array.isArray(data.updateMembers) ? data.updateMembers : [];
        if (!members.length || !(await ensureBotKey())) return;
        // Reuse the UID already resolved during bot-role validation so a
        // transient second lookup failure cannot classify the bot as a member.
        let ownId = "";
        try { ownId = String(await getBotId(api) || ""); } catch {}
        const histories = threadData.anti_join_history && typeof threadData.anti_join_history === "object"
          ? { ...threadData.anti_join_history } : {};
        const warningCounts = threadData.anti_join_warnings && typeof threadData.anti_join_warnings === "object"
          ? { ...threadData.anti_join_warnings } : {};
        const now = Date.now();
        let changed = false;
        const sendJoinNotice = async message => {
          try {
            await sendAntiMessage(api, message, threadId, ThreadType.Group);
          } catch (error) {
            // Notification failure must not discard strike state or turn a
            // successful kick into a false "Zalo refused" report.
            console.error("[ANTI_JOIN] Không gửi được thông báo nhóm " + threadId + ":", error?.message || error);
          }
        };
        for (const member of members) {
          const joinedUid = String(member?.id || "");
          if (!joinedUid || (ownId && joinedUid === ownId)) continue;
          const history = (Array.isArray(histories[joinedUid]) ? histories[joinedUid] : [])
            .filter(timestamp => Number.isFinite(Number(timestamp)) && now - Number(timestamp) <= 10 * 60 * 1000);
          history.push(now);

          // The first join is normal. Rejoining starts the offence sequence:
          // three warnings on rejoin attempts, then kick on the next attempt.
          if (history.length === 1) {
            histories[joinedUid] = history;
            delete warningCounts[joinedUid];
          } else {
            const currentWarnings = Math.min(3, Math.max(0, Math.floor(Number(warningCounts[joinedUid]) || 0)));
            if (currentWarnings < 3) {
              const nextWarnings = currentWarnings + 1;
              warningCounts[joinedUid] = nextWarnings;
              histories[joinedUid] = history.slice(-10);
              const memberName = String(member?.dName || member?.name || joinedUid);
              await sendJoinNotice(
                "🚨 Anti-Join: " + memberName + " đã tái tham gia nhóm nhiều lần trong 10 phút. " +
                "Cảnh cáo lần " + nextWarnings + "/3; lần tái phạm tiếp theo sẽ bị kick."
              );
            } else {
              let kickError = null;
              try {
                await kickGroupMember(api, joinedUid, threadId);
              } catch (error) {
                kickError = error;
              }

              const memberName = String(member?.dName || member?.name || joinedUid);
              if (kickError) {
                histories[joinedUid] = history.slice(-10);
                warningCounts[joinedUid] = 3;
                await sendJoinNotice(
                  "⚠️ Anti-Join: đã đủ 3 lần cảnh cáo nhưng Zalo chưa cho kick thành viên. " +
                  "Bot sẽ thử lại khi thành viên tái tham gia: " + (kickError?.message || kickError)
                );
              } else {
                delete histories[joinedUid];
                delete warningCounts[joinedUid];
                await sendJoinNotice(
                  "⛔ Anti-Join: " + memberName + " đã vi phạm sau 3 lần cảnh cáo và bị kick khỏi nhóm."
                );
              }
            }
          }
          changed = true;
        }
        if (changed) {
          threadData.anti_join_history = histories;
          threadData.anti_join_warnings = warningCounts;
          const save = Threads.setDataAndWait || Threads.setData;
          await save.call(Threads, threadId, threadData);
        }
      }
      return;
    }

    if (eventType === "reaction") {
      if (threadData.anti_reaction !== true) return;
      const now = Date.now();
      const cache = global.antiReactionSpamCache instanceof Map
        ? global.antiReactionSpamCache
        : (global.antiReactionSpamCache = new Map());
      const cacheKey = threadId + ":" + userId;
      const history = (cache.get(cacheKey) || []).filter(timestamp => now - timestamp <= 10_000);
      history.push(now);
      if (history.length <= 5) {
        cache.set(cacheKey, history);
        if (cache.size > 10000) cache.delete(cache.keys().next().value);
        return;
      }
      cache.delete(cacheKey);
      if (!(await ensureBotKey())) return;
      const strikes = threadData.anti_reaction_warnings && typeof threadData.anti_reaction_warnings === "object"
        ? { ...threadData.anti_reaction_warnings } : {};
      const current = Math.min(3, Math.max(0, Math.floor(Number(strikes[userId]) || 0)));
      if (current < 3) {
        const nextStrike = current + 1;
        strikes[userId] = nextStrike;
        threadData.anti_reaction_warnings = strikes;
        const save = Threads.setDataAndWait || Threads.setData;
        await save.call(Threads, threadId, threadData);
        return sendNotice("🚨 {member}, phát hiện spam cảm xúc (hơn 5 reaction/10 giây). Cảnh cáo " + nextStrike + "/3; tái phạm lần 4 sẽ bị kick.");
      }
      try {
        await kickGroupMember(api, userId, threadId);
        delete strikes[userId];
        threadData.anti_reaction_warnings = strikes;
        const save = Threads.setDataAndWait || Threads.setData;
        await save.call(Threads, threadId, threadData);
        return sendNotice("⛔ {member}, đã tái phạm spam cảm xúc sau 3 lần cảnh cáo và bị kick khỏi nhóm.");
      } catch (error) {
        strikes[userId] = 3;
        threadData.anti_reaction_warnings = strikes;
        const save = Threads.setDataAndWait || Threads.setData;
        await save.call(Threads, threadId, threadData);
        return sendNotice("⚠️ {member}, đã đủ 3 lần cảnh cáo Anti-Reaction nhưng chưa kick được: " + (error?.message || error));
      }
    }

    // Undo payload from zalo-client has isGroup=true and no ThreadType field.
    if (threadData.anti_undo === true && eventType === "undo") {
      if (undoCliMsgId == null) return;
      const cached = cachedUndoMessage;
      if (!cached || (cached.threadId && String(cached.threadId) !== threadId)) {
        logAntiSkip(threadId, "không tìm thấy tin gốc trong cache để khôi phục (cliMsgId=" + String(undoCliMsgId) + ")");
        return;
      }
      if (!(await ensureBotKey())) return;

      const timeSend = cached.timestamp || cached.ts || Date.now();
      const timeUndo = data.ts || Date.now();
      const sendUndoMessage = (msg, extra) => sendAntiMessage(
        api, { msg, ...(extra || {}) }, threadId, ThreadType.Group
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
            await sendAntiAction(api, "sendVideo", {
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
            await sendAntiAction(api, "sendSticker", {
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
            await sendAntiAction(api, "sendVoice", { voiceUrl }, threadId, ThreadType.Group);
          }
          break;
        }
        case "chat.recommended": {
          const content = cached.content || {};
          const href = content.href || "";
          if (content.action === "recommended.link" && typeof api.sendLink === "function") {
            const title = String(content.title || "").replace(href, "").trim();
            await sendAntiAction(api, "sendLink", {
              msg: formatUndoMessage(name, timeSend, timeUndo, title),
              link: href
            }, threadId, ThreadType.Group);
          } else if (content.action === "recommended.user" && typeof api.sendCard === "function") {
            await sendUndoMessage(formatUndoMessage(name, timeSend, timeUndo));
            await sendAntiAction(api, "sendCard", { userId: content.params }, threadId, ThreadType.Group);
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
          await sendAntiMessage(api, {
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

    const kind = getMessageKind(data);
    const mediaRules = [
      ["anti_card", "card", "danh thiếp"],
      ["anti_doodle", "doodle", "nét vẽ doodle"],
      ["anti_file", "file", "tập tin đính kèm"],
      ["anti_gif", "gif", "ảnh động GIF"],
      ["anti_location", "location", "vị trí bản đồ"],
      ["anti_video", "video", "video clip"],
      ["anti_voice", "voice", "tin nhắn thoại"],
      ["anti_sticker", "sticker", "nhãn dán sticker"]
    ];
    const mediaBlock = mediaRules.find(([flag, expected]) =>
      threadData[flag] === true && kind === expected
    );
    // Anti-QR also decodes actual image pixels: QR codes shared as an ordinary
    // photo must not bypass the protection just because Zalo omitted QR metadata.
    const shouldScanQrImage = threadData.anti_qr === true &&
      kind === "photo" && threadData.anti_photo !== true;
    // Do not download/decode image pixels when the bot has no confirmed
    // group admin key and therefore cannot enforce the Anti-QR rule.
    const qrImageDetected = shouldScanQrImage && await ensureBotKey()
      ? await imageContainsQr(data)
      : false;
    const qrBlocked = threadData.anti_qr === true && (kind === "qr" || qrImageDetected);
    const photoBlocked = threadData.anti_photo === true && (kind === "photo" || kind === "qr");
    if (mediaBlock || qrBlocked || photoBlocked) {
      const featureKey = mediaBlock?.[0] || (qrBlocked ? "anti_qr" : "anti_photo");
      const label = mediaBlock?.[2] || (qrBlocked ? "mã QR" : "hình ảnh");
      return enforceAntiViolation({
        api, event, Threads, sendNotice, userId, ensureBotKey,
        warningKey: featureKey + "_warnings",
        reason: "nhóm không cho phép gửi " + label + "."
      });
    }

    if (threadData.anti_other === true && isMalformedAntiPayload(data)) {
      return enforceAntiViolation({
        api, event, Threads, sendNotice, userId, ensureBotKey,
        warningKey: "anti_other_warnings",
        reason: "payload lỗi hoặc không được Zalo hỗ trợ."
      });
    }

    if (threadData.anti_taghide === true && hasHiddenMention(data)) {
      return enforceAntiViolation({
        api, event, Threads, sendNotice, userId, ensureBotKey,
        warningKey: "anti_taghide_warnings",
        reason: "không được dùng nhắc tên ẩn hoặc mention sai vị trí."
      });
    }

    if (threadData.anti_word === true) {
      const blockedWord = findAntiBadWord(data);
      if (blockedWord) {
        return enforceAntiViolation({
          api, event, Threads, sendNotice, userId, ensureBotKey,
          warningKey: "anti_word_warnings",
          reason: "phát hiện từ ngữ bị cấm (" + blockedWord + ")."
        });
      }
    }

    if (threadData.anti_nude === true && isPhotoMessage(data)) {
      const imageUrl = getImageUrl(data);
      if (imageUrl) {
        if (!(await ensureBotKey())) return;
        const checkId = threadId + ":" + String(data.cliMsgId || data.msgId || imageUrl);
        if (!nudeModerationInFlight.has(checkId)) {
          nudeModerationInFlight.add(checkId);
          try {
            const moderation = await moderateImage(imageUrl);
            if (moderation.explicit) {
              let deleteError = null;
              const botAuthored = await isBotAuthoredMessage(api, event);
              try { await deleteGroupMessage(api, event, { isBotMessage: botAuthored }); }
              catch (error) { deleteError = error; }

              const actions = [];
              actions.push(deleteError ? "chưa thu hồi/xóa được ảnh" : (botAuthored ? "đã thu hồi ảnh thử nghiệm" : "đã xóa ảnh"));
              let enforcement = null;
              if (botAuthored) {
                actions.push("bỏ qua cảnh cáo và kick tài khoản bot khi tự kiểm tra");
              } else {
                enforcement = await registerAntiViolation(Threads, api, threadId, userId, "anti_nude_warnings");
                if (enforcement.persistError) {
                  actions.push("chưa lưu được lượt cảnh cáo nên chưa kick");
                } else if (enforcement.kicked) {
                  actions.push("đã đủ 3 lần cảnh cáo và đã kick thành viên");
                } else if (enforcement.kickError) {
                  actions.push("đã đủ 3 lần cảnh cáo nhưng Zalo chưa cho kick; bot sẽ thử lại ở lần vi phạm tiếp theo");
                } else {
                  actions.push("cảnh cáo lần " + enforcement.warningCount + "/" + ANTI_NUDE_WARNING_LIMIT + "; tái phạm tiếp theo sẽ bị kick");
                }
              }

              await sendNotice(
                "⛔ AI phát hiện ảnh vi phạm (điểm sexual " +
                Math.round(moderation.score * 100) + "%). {member}: " +
                actions.join(", ") + "." +
                (deleteError ? "\n⚠️ " + deleteError.message : "") +
                (enforcement?.persistError ? "\n⚠️ " + enforcement.persistError.message : "") +
                (enforcement?.kickError ? "\n⚠️ " + enforcement.kickError.message : "") +
                (enforcement?.cleanupError ? "\n⚠️ " + enforcement.cleanupError.message : "")
              );
              return { consumed: true, moderated: true };
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
      if (!(await ensureBotKey())) return;
      let blockedUrl = null;
      for (const url of urls) {
        if (await isUnsafeLink(url, api)) {
          blockedUrl = url;
          break;
        }
      }
      if (blockedUrl) {
        return enforceAntiViolation({
          api, event, Threads, sendNotice, userId, ensureBotKey,
          warningKey: "anti_link_warnings",
          reason: "phát hiện link mời nhóm khác trên Zalo hoặc URL không an toàn (" + blockedUrl.slice(0, 90) + ")."
        });
      }
    }

    if (urls.length && threadData.anti_link === true) {
      return enforceAntiViolation({
        api, event, Threads, sendNotice, userId, ensureBotKey,
        warningKey: "anti_link_warnings",
        reason: "không được gửi link trong nhóm này."
      });
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
        return enforceAntiViolation({
          api, event, Threads, sendNotice, userId, ensureBotKey,
          warningKey: "anti_sticker_spam_warnings",
          reason: "không được dội bom sticker (hơn 5 sticker trong 4 giây).",
          deleteEvents: history.map(item => ({
            threadId,
            type: ThreadType.Group,
            data: item.data
          }))
        });
      }

      cache.set(cacheKey, history);
      if (cache.size > 10000) cache.delete(cache.keys().next().value);
    }

    // Anti-Spam measures rapid plain-text messages only. Media payloads have
    // dedicated Anti modes and must never contribute to the text spam counter.
    if (threadData.anti_spam === true && kind === "text") {
      const now = Date.now();
      const cache = global.spamCache && typeof global.spamCache === "object"
        ? global.spamCache
        : (global.spamCache = {});
      if (!cache[threadId]) cache[threadId] = {};
      const rawHistory = Array.isArray(cache[threadId][userId]) ? cache[threadId][userId] : [];
      const history = rawHistory.filter(item => {
        const at = typeof item === "number" ? item : Number(item?.at);
        return Number.isFinite(at) && now - at <= 5000;
      });
      history.push({
        at: now,
        data: { cliMsgId: data.cliMsgId, msgId: data.msgId, uidFrom: userId }
      });
      cache[threadId][userId] = history;

      if (history.length > 5) {
        // Reset this burst after processing it, so each burst generates one warning.
        cache[threadId][userId] = [];
        const deleteEvents = history
          .filter(item => item?.data?.cliMsgId != null && item?.data?.msgId != null)
          .map(item => ({
            threadId,
            type: ThreadType.Group,
            data: item.data
          }));
        return enforceAntiViolation({
          api, event, Threads, sendNotice, userId, ensureBotKey,
          warningKey: "anti_spam_warnings",
          reason: "vui lòng không spam: gửi tin nhắn quá dồn dập (hơn 5 tin trong 5 giây).",
          deleteEvents: deleteEvents.length ? deleteEvents : [event]
        });
      }

      const groupIds = Object.keys(cache);
      if (groupIds.length > 500) delete cache[groupIds[0]];
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
  createUrlScanCache,
  urlScanCache,
  isExplicitAdultImage,
  getImageUrl,
  decodeQrFromImageBuffer,
  imageContainsQr,
  isPhotoMessage,
  isStickerMessage,
  shouldSkipSelfEvent,
  isAntiGeneratedSelfEcho,
  rememberAntiSelfEcho,
  clearAntiSelfEchoes: () => antiSelfEchoes.clear(),
  buildDeleteDestination,
  isBotAuthoredMessage,
  deleteGroupMessage,
  kickGroupMember,
  registerAntiViolation,
  getMessageKind,
  extractPlainMessageText,
  findAntiBadWord,
  hasHiddenMention,
  isMalformedAntiPayload,
  handleAntiEvent,
  getRelevantAntiProtectionKeys
};


const ANTI_MENU_ITEMS = Object.freeze([
  { key:"anti_card", label:"Chặn gửi danh thiếp", detail:"Chặn chia sẻ hồ sơ", command:"/anticard", alias:"", icon:"ID", tone:"#138fe5" },
  { key:"anti_doodle", label:"Chặn doodle", detail:"Chặn nét vẽ / bản vẽ", command:"/antidoodle", alias:"", icon:"✎", tone:"#a94ce5" },
  { key:"anti_file", label:"Chặn tập tin", detail:"Chặn tệp đính kèm", command:"/antifile", alias:"", icon:"FILE", tone:"#f18b1c" },
  { key:"anti_gif", label:"Chặn GIF", detail:"Chặn ảnh động", command:"/antigif", alias:"", icon:"GIF", tone:"#08aeba" },
  { key:"anti_danger_link", label:"Chặn link mời nhóm", detail:"Chặn link mời nhóm Zalo khác", command:"/antiinvite", alias:"", icon:"INV", tone:"#138fe5" },
  { key:"anti_join", label:"Chặn spam vào nhóm", detail:"3 lần tái tham gia bị cảnh cáo; lần tiếp theo sẽ kick", command:"/antijoin", alias:"", icon:"JOIN", tone:"#e83f9e" },
  { key:"anti_link", label:"Chặn tất cả liên kết", detail:"Chặn mọi URL", command:"/antilink", alias:"", icon:"URL", tone:"#08aeba" },
  { key:"anti_location", label:"Chặn vị trí", detail:"Chặn chia sẻ bản đồ / tọa độ", command:"/antilocation", alias:"", icon:"MAP", tone:"#4d9c77" },
  { key:"anti_other", label:"Chặn payload lỗi", detail:"Chặn payload unknown / error", command:"/antiother", alias:"", icon:"BUG", tone:"#e4b91e" },
  { key:"anti_photo", label:"Chặn hình ảnh", detail:"Chặn ảnh được gửi vào nhóm", command:"/antiphoto", alias:"", icon:"IMG", tone:"#e83f9e" },
  { key:"anti_qr", label:"Chặn mã QR", detail:"Giải mã QR trong ảnh thường và chặn payload QR", command:"/antiqr", alias:"", icon:"QR", tone:"#a94ce5" },
  { key:"anti_reaction", label:"Chống spam cảm xúc", detail:"3 cảnh cáo, lần 4 kick", command:"/antireaction", alias:"", icon:"❤", tone:"#e83f9e" },
  { key:"anti_nude", label:"Chặn nội dung 18+", detail:"3 cảnh cáo, lần 4 kick", command:"/antisex", alias:"/antinude", icon:"18+", tone:"#e83f9e" },
  { key:"anti_spam", label:"Chặn spam tin nhắn", detail:"Hơn 5 tin chữ / 5 giây", command:"/antispam", alias:"", icon:"SP", tone:"#e4b91e" },
  { key:"anti_sticker", label:"Chặn mọi sticker", detail:"Không cho gửi sticker", command:"/antistk", alias:"", icon:"ST", tone:"#f18b1c" },
  { key:"anti_sticker_spam", label:"Chặn spam sticker", detail:"Hơn 5 sticker / 4 giây", command:"/antistklag", alias:"", icon:"LAG", tone:"#f18b1c" },
  { key:"anti_taghide", label:"Chặn nhắc tên ẩn", detail:"Chặn mention ẩn / sai vị trí", command:"/antitaghide", alias:"", icon:"TAG", tone:"#138fe5" },
  { key:"anti_video", label:"Chặn video", detail:"Chặn video clip", command:"/antivideo", alias:"", icon:"VID", tone:"#08aeba" },
  { key:"anti_voice", label:"Chặn tin nhắn thoại", detail:"Chặn voice", command:"/antivoice", alias:"", icon:"VOX", tone:"#a94ce5" },
  { key:"anti_word", label:"Chặn từ ngữ thô tục", detail:"Danh sách từ cấm tiếng Việt", command:"/antiword", alias:"", icon:"TXT", tone:"#e83f9e" },
  { key:"anti_undo", label:"Chống thu hồi tin nhắn", detail:"Khôi phục nội dung đã thu hồi", command:"/antirecall", alias:"", icon:"↶", tone:"#a94ce5" }
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

async function sendAntiMenu({ api, event, Threads, threadData }) {
  const prefix = global.config?.prefix || "/";
  const record = threadData && typeof threadData === "object"
    ? threadData
    : await Threads.getData(event.threadId);
  const data = record?.data && typeof record.data === "object"
    ? record.data
    : record && typeof record === "object" ? record : {};
  const items = ANTI_MENU_ITEMS.map(item => ({
    key:item.key,
    label:item.label,
    detail:item.detail,
    command:prefix + item.command.replace(/^\//, ""),
    icon:item.icon,
    tone:item.tone,
    enabled:data[item.key] === true
  }));

  // Expose the runtime prerequisite beside the persisted ON/OFF flags.
  let botRole = "unknown";
  try { botRole = await getBotGroupRole(api, event.threadId); } catch {}
  const botRoleNotice = botRole === "owner" || botRole === "deputy"
    ? "✅ TÀI KHOẢN BOT ĐÃ CÓ QTV — Anti đang đủ điều kiện hoạt động."
    : botRole === "member"
      ? "⛔ BOT CHƯA CÓ QTV — Anti đang tạm ngừng xử lý. Hãy thêm bot làm phó nhóm."
      : "⚠️ CHƯA XÁC MINH ĐƯỢC QTV CỦA BOT — Anti đang tạm ngừng xử lý.";

  let imagePath = null;
  try {
    imagePath = await renderCanvas("anti-protection-v2", { items, prefix });
    // The image already contains all six live statuses and concise usage
    // guidance. Send one caption with it; do not repeat the same table as text.
    await api.sendMessage({
      msg:"🛡️ ANTI-PROTECTION V2\n" + botRoleNotice,
      attachments:[imagePath],
      ttlKind:"card"
    }, event.threadId, event.type);
  } catch (error) {
    console.error("[ANTI_MENU_V2] Canvas mới không render được:", error?.stack || error);
    return api.sendMessage({
      msg:botRoleNotice + "\n\n" + buildAntiMenuText(data, prefix) + "\n⚠️ Không tạo được ảnh Anti-Protection, bot đã gửi hướng dẫn dạng chữ."
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

module.exports.run = async function ({ api, event, args, Threads, threadData }) {
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
    return sendAntiMenu({ api, event, Threads, threadData });
  }

  const mode = String(args?.[1] || "").trim().toLowerCase();
  if (mode && mode !== "on" && mode !== "off") {
    return sendAntiMenu({ api, event, Threads, threadData });
  }

  const userId = event?.data?.uidFrom;
  const groupAdminState = await getGroupAdminState(api, threadId, userId);
  if (groupAdminState !== true) {
    return api.sendMessage({
      msg:"🚫 Chỉ trưởng nhóm hoặc phó nhóm (QTV BOX) mới được bật/tắt chế độ Anti."
    }, threadId, type);
  }

  const record = threadData && typeof threadData === "object"
    ? threadData
    : await Threads.getData(threadId);
  const data = record?.data && typeof record.data === "object"
    ? { ...record.data }
    : record && typeof record === "object" ? { ...record } : {};
  const newValue = mode === "on" ? true : mode === "off" ? false : data[key] !== true;

  // Keep the legacy /anti link|undo|spam route consistent with dedicated
  // Anti commands. Disabling is always allowed for a verified group QTV,
  // but enabling must be rejected unless the bot itself is group owner/deputy.
  if (newValue) {
    const botRole = await getBotGroupRole(api, threadId);
    if (botRole !== "owner" && botRole !== "deputy") {
      return api.sendMessage({
        msg:"⛔ Không thể bật Anti: tài khoản bot chưa có quyền QTV trong nhóm. Hãy thêm bot làm phó nhóm rồi bật lại."
      }, threadId, type);
    }
  }

  data[key] = newValue;

  const save = Threads.setDataAndWait || Threads.setData;
  await save.call(Threads, threadId, data);

  const notices = {
    anti_link: {
      label: "Anti-Link",
      detail: "Chặn mọi URL được gửi trong nhóm."
    },
    anti_undo: {
      label: "Anti-Recall",
      detail: "Lưu và khôi phục nội dung khi thành viên thu hồi tin nhắn."
    },
    anti_spam: {
      label: "Anti-Spam",
      detail: "Phát hiện và xử lý tin nhắn văn bản gửi dồn dập."
    }
  };
  const notice = notices[key] || {
    label: "Anti-" + key.replace("anti_", "").toUpperCase(),
    detail: "Thiết lập bảo vệ nhóm đã được cập nhật."
  };
  return sendAntiToggleNotice(api, threadId, type, {
    label: notice.label,
    enabled: newValue,
    detail: notice.detail
  });
};

module.exports.handleEvent = function (context = {}) {
  const threadId = String(context.event?.threadId || "");
  if (!threadId) return Promise.resolve();

  // Snapshot the hot cache once. Reuse it in the queued handler so inactive
  // protections return immediately and active protections do not read twice.
  // The listener already snapshots this group's settings before dispatch.
  // Reuse that exact lookup; otherwise this wrapper performs a second cache
  // read on every protected group message and defeats the listener fast path.
  let cachedThreadRecord = context.cachedThreadRecord || null;
  let cachedThreadCacheChecked = context.cachedThreadCacheChecked === true;
  try {
    if (!cachedThreadCacheChecked && typeof context.Threads?.getCachedData === "function") {
      cachedThreadCacheChecked = true;
      cachedThreadRecord = context.Threads.getCachedData(threadId) || null;
    }
    if (cachedThreadRecord) {
      const source = cachedThreadRecord?.data || cachedThreadRecord;
      const eventType = context.eventType || "message";
      const relevantKeys = getRelevantAntiProtectionKeys(eventType);
      if (!relevantKeys.some(key => source?.[key] === true)) return Promise.resolve();
    }
  } catch { /* the queued handler retains the durable read fallback */ }

  const queuedContext = {
    ...context,
    cachedThreadRecord,
    cachedThreadCacheChecked
  };

  // Incoming messages have their rate counters updated synchronously before
  // any network await. Do not put them behind a per-group queue: a slow URL
  // scan or image moderation must not hold every later message in that group.
  // Stateful non-message events (undo/reaction/join) remain serialized.
  const eventType = context.eventType || "message";
  if (eventType === "message") {
    return handleAntiEvent(queuedContext);
  }
  return runThreadQueue(threadId, () => handleAntiEvent(queuedContext));
};
