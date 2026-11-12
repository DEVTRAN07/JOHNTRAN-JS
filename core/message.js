const { Reactions } = require("zalo-client");
const cache = require("./cache");
const logger = require("../utils/logger");
const styledText = require("./styled");
const fs = require("fs");
const crypto = require("crypto");

const DEFAULT_AUTO_RECALL_MS = 60 * 1000;

function scheduleRecall(api, response, threadId, type) {
  const messages = [];
  if (response?.message) messages.push(response.message);
  if (Array.isArray(response?.attachment)) messages.push(...response.attachment);
  if (response?.msgId) messages.push(response);

  const seen = new Set();
  for (const message of messages) {
    const { msgId, cliMsgId } = message || {};
    if ((typeof msgId !== "number" && typeof msgId !== "string") ||
        (typeof cliMsgId !== "number" && typeof cliMsgId !== "string")) {
      logger.log("Không thể lên lịch thu hồi tin nhắn: thiếu msgId hoặc cliMsgId.", "warn");
      continue;
    }

    const key = `${msgId}:${cliMsgId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (typeof api?.undo !== "function") {
      logger.log("Không thể thu hồi tin nhắn: API undo không khả dụng.", "error");
      continue;
    }

    const timer = setTimeout(async () => {
      try {
        await api.undo({ msgId, cliMsgId }, threadId, type);
        logger.log("Đã gửi yêu cầu thu hồi tin bot sau 1 phút.", "info");
      } catch (error) {
        logger.log(`Không thể thu hồi tin bot sau 1 phút: ${error?.message || error}`, "warn");
      }
    }, DEFAULT_AUTO_RECALL_MS);
    timer.unref?.();
  }
}

// ===== CACHE ẢNH THẺ ĐÃ RENDER =====
// Render 1 thẻ canvas mất ~0.7s trên máy mạnh, 2-3s trên Render free tier.
// Thẻ lặp lại (menu, thông báo lỗi cùng nội dung, hướng dẫn...) giờ dùng lại
// ảnh đã render trong 5 phút — không render lại, không chờ CPU.
const CARD_TTL = 5 * 60 * 1000;
const CARD_MAX = 60;
const cardCache = new Map(); // hash → { path, at, cached }
const cardFlights = new Map(); // hash → Promise<path|null>

function hashSpec(spec, ttl) {
  return crypto.createHash("md5").update(JSON.stringify({ ttl, ...(spec || {}) })).digest("hex");
}

async function renderCachedCard(spec, ttl) {
  const hash = hashSpec(spec, ttl);

  const hit = cardCache.get(hash);
  if (hit && Date.now() - hit.at < CARD_TTL && fs.existsSync(hit.path)) {
    hit.at = Date.now();
    return hit.path;
  }

  // Coalesce identical concurrent renders. A burst of the same card should
  // consume one canvas render, not one render per incoming command.
  const active = cardFlights.get(hash);
  if (active) return active;

  const flight = (async () => {
    const { renderVipCard } = require("./canvas/vip");
    const filePath = await renderVipCard({ ttl, ...(spec || {}) });
    if (!filePath) return null;

    if (cardCache.size >= CARD_MAX) {
      const oldestKey = [...cardCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
      if (oldestKey) {
        const old = cardCache.get(oldestKey);
        try { if (old?.path) fs.unlinkSync(old.path); } catch { /* bỏ qua */ }
        cardCache.delete(oldestKey);
      }
    }

    cardCache.set(hash, { path: filePath, at: Date.now(), cached: true });
    return filePath;
  })();

  cardFlights.set(hash, flight);
  try {
    return await flight;
  } finally {
    if (cardFlights.get(hash) === flight) cardFlights.delete(hash);
  }
}

class Reply {
  constructor(api, threadId, type, commandName, event = null) {
    this.api = api;
    this.threadId = threadId;
    this.type = type;
    this.commandName = commandName || "bot";
    this.event = event;
    this.reacted = false; // đã thả reaction cho tin này → handleCommand không thả lại
    this._responseStarted = false;
    this._commandCompleted = false;
    this._ackSent = false;
    this._ackTimer = null;
  }

  // Universal textual progress messages are disabled. Commands send only
  // their actual result, error, or command-specific output.
  scheduleAcknowledgement() {
    this.cancelAcknowledgement();
    return false;
  }

  markResponseStarted() {
    this._responseStarted = true;
    this.cancelAcknowledgement();
  }

  cancelAcknowledgement() {
    if (!this._ackTimer) return;
    clearTimeout(this._ackTimer);
    this._ackTimer = null;
  }

  finishCommand() {
    this._commandCompleted = true;
    this.cancelAcknowledgement();
  }

  // ===== MẶC ĐỊNH: TEXT CÓ STYLE — phản hồi tức thì (0ms, 1 API call) =====
  // Zalo style text trực tiếp (bold/màu/cỡ chữ) nên vẫn đẹp như thẻ ảnh
  // nhưng KHÔNG render canvas, KHÔNG upload ảnh. Ảnh thẻ chỉ khi lệnh
  // chủ ý gọi reply.card().
  async text(msg, options = {}) {
    if (options.plain) {
      return this.api.sendMessage({ msg, styles: options.styles, ttl: options.ttl }, this.threadId, this.type);
    }
    const styled = styledText.plain(msg);
    return this.api.sendMessage({ ...styled, ttl: options.ttl }, this.threadId, this.type);
  }

  async error(msg, options = {}) {
    const styled = styledText.frame(msg, { kind: "error", title: options.title });
    return this.api.sendMessage({ ...styled, ttl: options.ttl }, this.threadId, this.type);
  }

  async success(msg, options = {}) {
    const styled = styledText.frame(msg, { kind: "success", title: options.title });
    return this.api.sendMessage({ ...styled, ttl: options.ttl }, this.threadId, this.type);
  }

  // Thẻ thông tin / hướng dẫn
  async info(msg, options = {}) {
    const styled = styledText.frame(msg, { kind: "info", title: options.title });
    return this.api.sendMessage({ ...styled, ttl: options.ttl }, this.threadId, this.type);
  }

  async warn(msg, options = {}) {
    const styled = styledText.frame(msg, { kind: "warn", title: options.title });
    return this.api.sendMessage({ ...styled, ttl: options.ttl }, this.threadId, this.type);
  }

  // ===== Ảnh THẺ (opt-in): chỉ dùng khi thật sự muốn ảnh đẹp =====
  async card(spec = {}) {
    const ttl = spec.ttl;
    const filePath = await renderCachedCard(spec, ttl);
    if (!filePath) {
      // render hỏng → gửi text thuần, không mất phản hồi
      const plainMsg = spec.subtitle || spec.title || String(spec.msg || "");
      return this.api.sendMessage({ msg: plainMsg, ttl }, this.threadId, this.type);
    }
    return this.api.sendMessage({ msg: "", attachments: filePath, ttl }, this.threadId, this.type);
  }

  async media({ msg, attachments, ttl }) {
    return this.api.sendMessage({ msg, attachments, ttl }, this.threadId, this.type);
  }

  async voice({ voiceUrl, msg, ttl }) {
    if (msg) await this.text(msg, { plain: true });
    return this.api.sendVoice({ voiceUrl, ttl }, this.threadId, this.type);
  }

  async video({ videoUrl, thumbnailUrl, msg, duration, width, height, ttl }) {
    return this.api.sendVideo({
      videoUrl,
      thumbnailUrl,
      duration,
      width,
      height,
      msg,
      ttl
    }, this.threadId, this.type);
  }

  // ===== Reaction trạng thái: 👀 (đang xử lý) → ✅ (xong) / 😢 (lỗi) =====
  async react(reaction) {
    this.reacted = true; // đánh dấu để handleCommand không tự thả thêm
    if (!this.event?.data?.msgId || !this.api?.addReaction) return false;
    try {
      await this.api.addReaction(reaction, {
        data: { msgId: this.event.data.msgId, cliMsgId: this.event.data.cliMsgId },
        threadId: this.threadId,
        type: this.type
      });
      return true;
    } catch {
      return false;
    }
  }

  working() { return this.react(Reactions.PRAY); }
  done() { return this.react(Reactions.OK); }
  failed() { return this.react(Reactions.CRY); }
}

// ZaloApi của zalo-client khai báo MỌI method bằng accessor get/set (lazy).
// Gán trực tiếp (wrapped.sendMessage = fn) sẽ rơi vào SETTER của api gốc,
// ghi đè method gốc bằng chính wrapper → wrapper gọi lại chính nó → đệ qu vô hạn.
// Bắt buộc defineProperty để tạo OWN property trên wrapped.
function defineWrapped(wrapped, name, fn) {
  Object.defineProperty(wrapped, name, {
    value: fn,
    writable: true,
    enumerable: true,
    configurable: true
  });
}

function wrapApi(api, threadId, type, commandName, event = null) {
  if (!api) return api;
  const wrapped = Object.create(api);
  let reply = null;
  const markResponseStarted = () => reply?.markResponseStarted?.();

  defineWrapped(wrapped, "sendMessage", async (message, tid, ty) => {
    const targetThreadId = threadId || tid;
    const targetType = type || ty;
    const content = typeof message === "string" ? { msg: message } : { ...message };
    if (content.plain) delete content.plain;
    const response = await api.sendMessage(content, targetThreadId, targetType);
    markResponseStarted();
    scheduleRecall(api, response, targetThreadId, targetType);
    return response;
  });

  defineWrapped(wrapped, "sendVoice", async (payload, tid, ty) => {
    const content = typeof payload === "string" ? { voiceUrl: payload } : { ...payload };
    const targetThreadId = threadId || tid;
    const targetType = type || ty;
    const response = await api.sendVoice(content, targetThreadId, targetType);
    markResponseStarted();
    scheduleRecall(api, response, targetThreadId, targetType);
    return response;
  });

  defineWrapped(wrapped, "sendVideo", async (payload, tid, ty) => {
    const targetThreadId = threadId || tid;
    const targetType = type || ty;
    const response = await api.sendVideo({ ...payload }, targetThreadId, targetType);
    markResponseStarted();
    scheduleRecall(api, response, targetThreadId, targetType);
    return response;
  });

  for (const method of ["sendSticker", "sendCard"]) {
    if (typeof api[method] !== "function") continue;
    defineWrapped(wrapped, method, async (payload, tid, ty) => {
      const targetThreadId = threadId || tid;
      const targetType = type || ty;
      const response = await api[method](payload, targetThreadId, targetType);
      markResponseStarted();
      scheduleRecall(api, response, targetThreadId, targetType);
      return response;
    });
  }

  if (typeof api.sendCustomStickerUrl === "function") {
    defineWrapped(wrapped, "sendCustomStickerUrl", async (payload) => {
      const targetThreadId = payload?.threadId || threadId;
      const targetType = payload?.threadType ?? type;
      const response = await api.sendCustomStickerUrl(payload);
      markResponseStarted();
      scheduleRecall(api, response, targetThreadId, targetType);
      return response;
    });
  }

  // ===== Cache tầng API Zalo: giảm gọi API, phản hồi nhanh hơn =====
  defineWrapped(wrapped, "getGroupInfo", async (tid) => {
    const key = String(tid);
    return cache.caches.groupInfo.remember(key, () => api.getGroupInfo(tid));
  });

  defineWrapped(wrapped, "getUserInfo", async (uid, avatarSize) => {
    const userId = String(uid);
    const size = Number(avatarSize) > 0 ? Math.floor(Number(avatarSize)) : 0;
    const key = size ? `${userId}:avatar:${size}` : userId;
    return cache.caches.userInfo.remember(key, () => api.getUserInfo(uid, size || undefined));
  });

  defineWrapped(wrapped, "invalidateCache", async (kind, key) => {
    if (kind === "group") cache.caches.groupInfo.delete(String(key));
    if (kind === "user") {
      cache.caches.userInfo.delete(String(key));
      cache.caches.userInfo.delete(`${String(key)}:avatar:240`);
    }
  });

  reply = new Reply(wrapped, threadId, type, commandName, event);
  Object.defineProperty(wrapped, "__reply", { value: reply, enumerable: false });
  return wrapped;
}

module.exports = { Reply, wrapApi, DEFAULT_AUTO_RECALL_MS };
