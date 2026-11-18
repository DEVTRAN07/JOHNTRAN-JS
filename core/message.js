const { Reactions } = require("zalo-client");
const { performance } = require("node:perf_hooks");
const cache = require("./cache");
const logger = require("../utils/logger");
const styledText = require("./styled");
const fs = require("fs");
const crypto = require("crypto");

async function callTrackedZaloApi(method, call, onStart = null) {
  const startedAt = performance.now();
  if (typeof onStart === "function") onStart();
  try {
    return await call();
  } finally {
    try {
      require("./metrics").trackZaloApiLatency?.(method, performance.now() - startedAt);
    } catch {
      // Telemetry must never interfere with Zalo message delivery.
    }
  }
}

const RECALL_REACTION_CONCURRENCY = readPositiveInt(process.env.JT_RECALL_REACTION_CONCURRENCY, 3, 1, 6);
const RECALL_REACTION_MAX_PENDING = 128;
const MAX_RECALL_CLOCK_UPDATES = 3;
const recallReactionQueue = [];
const recallReactionStates = new Map();
let activeRecallReactions = 0;

const DEFAULT_AUTO_RECALL_MS = readRecallDelay(process.env.JT_AUTO_RECALL_MS, 60 * 1000);
const MAX_RECALL_DELAY_MS = 2_147_483_647;
const RECALL_COUNTDOWN_CLOCKS = Object.freeze([
  "🕙", "🕘", "🕗", "🕖", "🕕", "🕔", "🕓", "🕒", "🕑", "🕐", "⏰"
]);

function readRecallDelay(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(Math.floor(parsed), MAX_RECALL_DELAY_MS)
    : fallback;
}

function readPositiveInt(value, fallback, min = 1, max = 100) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) return fallback;
  return Math.min(max, parsed);
}

// Legacy ttl is interpreted locally as a recall delay and never sent to Zalo.
function extractRecallOptions(input, fallbackDelay = DEFAULT_AUTO_RECALL_MS) {
  const source = input && typeof input === "object" ? input : {};
  const hasRecallAfter = Object.prototype.hasOwnProperty.call(source, "recallAfterMs")
    && source.recallAfterMs !== undefined;
  const hasLegacyTtl = Object.prototype.hasOwnProperty.call(source, "ttl")
    && source.ttl !== undefined;
  const requestedDelay = hasRecallAfter
    ? source.recallAfterMs
    : hasLegacyTtl ? source.ttl : fallbackDelay;
  const delayMs = readRecallDelay(requestedDelay, DEFAULT_AUTO_RECALL_MS);
  const payload = typeof input === "string" ? input : { ...source };

  if (payload && typeof payload === "object") {
    delete payload.ttl;
    delete payload.recallAfterMs;
  }
  return { payload, delayMs };
}

function recallReactionKey(message, threadId) {
  return [threadId, message?.msgId, message?.cliMsgId].map(value => String(value ?? "")).join(":");
}

function enqueueRecallReaction(state) {
  if (!state || state.queued || state.active || state.cancelled) return;
  if (state.expiresAt <= Date.now()) {
    state.cancelled = true;
    recallReactionStates.delete(state.key);
    return;
  }
  // Countdown is cosmetic. When the bounded queue is full, skip this update
  // rather than delaying the actual command reply or growing memory forever.
  if (recallReactionQueue.length >= RECALL_REACTION_MAX_PENDING) {
    state.cancelled = true;
    recallReactionStates.delete(state.key);
    return;
  }
  state.queued = true;
  recallReactionQueue.push(state);
  drainRecallReactionQueue();
}

function drainRecallReactionQueue() {
  while (activeRecallReactions < RECALL_REACTION_CONCURRENCY && recallReactionQueue.length) {
    const state = recallReactionQueue.shift();
    state.queued = false;
    if (state.cancelled || state.expiresAt <= Date.now()) {
      recallReactionStates.delete(state.key);
      continue;
    }

    state.active = true;
    activeRecallReactions++;
    const icon = state.icon;
    Promise.resolve()
      .then(() => callTrackedZaloApi("addReaction", () => state.api.addReaction({ rType: 0, source: 6, icon }, state.destination)))
      .catch(() => {
        // Zalo can throttle reactions during busy periods. A missed clock tick
        // must never affect message delivery or the scheduled recall itself.
      })
      .finally(() => {
        activeRecallReactions = Math.max(0, activeRecallReactions - 1);
        state.active = false;
        state.sentIcon = icon;
        if (!state.cancelled && state.icon !== state.sentIcon && state.expiresAt > Date.now()) {
          // Collapse all ticks that arrived during the request into one latest
          // update instead of sending a burst of stale reactions afterward.
          enqueueRecallReaction(state);
        } else {
          recallReactionStates.delete(state.key);
        }
        drainRecallReactionQueue();
      });
  }
}

function addRecallClock(api, message, threadId, type, icon, expiresAt = Date.now() + DEFAULT_AUTO_RECALL_MS) {
  if (typeof api?.addReaction !== "function") return;
  if (message?.msgId == null || message?.cliMsgId == null) return;
  const key = recallReactionKey(message, threadId);
  if (!key.replace(/:/g, "")) return;

  let state = recallReactionStates.get(key);
  if (!state || state.cancelled || state.expiresAt <= Date.now()) {
    state = {
      key,
      api,
      destination: {
        data: { msgId: String(message.msgId), cliMsgId: String(message.cliMsgId) },
        threadId: String(threadId),
        type
      },
      icon,
      expiresAt: Number(expiresAt) || Date.now(),
      queued: false,
      active: false,
      cancelled: false,
      sentIcon: null
    };
    recallReactionStates.set(key, state);
  } else {
    state.icon = icon;
    state.expiresAt = Math.max(state.expiresAt, Number(expiresAt) || state.expiresAt);
  }
  enqueueRecallReaction(state);
}

function getRecallCountdownUpdates(delayMs) {
  const delay = Math.max(0, Number(delayMs) || 0);
  if (!(delay > 0)) return [];
  const ticks = Math.min(MAX_RECALL_CLOCK_UPDATES, Math.max(1, Math.floor(delay / 1000)));
  return Array.from({ length: ticks }, (_, index) => {
    const step = index + 1;
    const waitMs = Math.min(delay - 1, Math.max(0, Math.round(delay * step / (ticks + 1))));
    const clockIndex = Math.min(
      RECALL_COUNTDOWN_CLOCKS.length - 1,
      Math.round((step / ticks) * (RECALL_COUNTDOWN_CLOCKS.length - 1))
    );
    return { waitMs, icon: RECALL_COUNTDOWN_CLOCKS[clockIndex] };
  });
}

function scheduleRecallCountdown(api, message, threadId, type, delayMs) {
  if (!(delayMs > 0) || typeof api?.addReaction !== "function") return;
  if (!message || (typeof message.msgId !== "number" && typeof message.msgId !== "string") ||
      (typeof message.cliMsgId !== "number" && typeof message.cliMsgId !== "string")) return;

  const expiresAt = Date.now() + delayMs;
  // Keep a visible countdown, but cap it at five updates per message. A
  // dedicated bounded scheduler limits concurrent Zalo reaction calls and
  // coalesces stale ticks while the API is busy.
  addRecallClock(api, message, threadId, type, RECALL_COUNTDOWN_CLOCKS[0], expiresAt);
  for (const update of getRecallCountdownUpdates(delayMs)) {
    const timer = setTimeout(
      () => addRecallClock(api, message, threadId, type, update.icon, expiresAt),
      update.waitMs
    );
    timer.unref?.();
  }
}

function scheduleRecall(api, response, threadId, type, delayMs = DEFAULT_AUTO_RECALL_MS) {
  if (!(delayMs > 0)) return;
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

    scheduleRecallCountdown(api, message, threadId, type, delayMs);
    const timer = setTimeout(async () => {
      try {
        await api.undo({ msgId, cliMsgId }, threadId, type);
        logger.log("Đã thu hồi tin bot sau " + Math.round(delayMs / 1000) + " giây.", "info");
      } catch (error) {
        logger.log("Không thể thu hồi tin bot sau " + Math.round(delayMs / 1000) + " giây: " + (error?.message || error), "warn");
      }
    }, delayMs);
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

function hashSpec(spec) {
  return crypto.createHash("md5").update(JSON.stringify(spec || {})).digest("hex");
}

async function renderCachedCard(spec) {
  const hash = hashSpec(spec);

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
    const filePath = await renderVipCard({ ...(spec || {}) });
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

  // Show a working reaction only when a command has not produced a reply
  // within the grace period. Fast commands avoid an extra Zalo API request.
  scheduleAcknowledgement(callback, delayMs = 600) {
    this.cancelAcknowledgement();
    if (this._responseStarted || this._commandCompleted || this._ackSent || typeof callback !== "function") return false;
    const parsed = Number(delayMs);
    const delay = Math.max(0, Math.min(5000, Number.isFinite(parsed) ? Math.floor(parsed) : 600));
    this._ackTimer = setTimeout(() => {
      this._ackTimer = null;
      if (this._responseStarted || this._commandCompleted || this._ackSent) return;
      this._ackSent = true;
      try { callback(); } catch { /* status indicators must not break commands */ }
    }, delay);
    this._ackTimer.unref?.();
    return true;
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
      return this.api.sendMessage({
        msg,
        styles: options.styles,
        recallAfterMs: options.recallAfterMs ?? options.ttl
      }, this.threadId, this.type);
    }
    const styled = styledText.plain(msg);
    return this.api.sendMessage({
      ...styled,
      recallAfterMs: options.recallAfterMs ?? options.ttl
    }, this.threadId, this.type);
  }

  async error(msg, options = {}) {
    const styled = styledText.frame(msg, { kind: "error", title: options.title });
    return this.api.sendMessage({
      ...styled,
      recallAfterMs: options.recallAfterMs ?? options.ttl
    }, this.threadId, this.type);
  }

  async success(msg, options = {}) {
    const styled = styledText.frame(msg, { kind: "success", title: options.title });
    return this.api.sendMessage({
      ...styled,
      recallAfterMs: options.recallAfterMs ?? options.ttl
    }, this.threadId, this.type);
  }

  // Thẻ thông tin / hướng dẫn
  async info(msg, options = {}) {
    const styled = styledText.frame(msg, { kind: "info", title: options.title });
    return this.api.sendMessage({
      ...styled,
      recallAfterMs: options.recallAfterMs ?? options.ttl
    }, this.threadId, this.type);
  }

  async warn(msg, options = {}) {
    const styled = styledText.frame(msg, { kind: "warn", title: options.title });
    return this.api.sendMessage({
      ...styled,
      recallAfterMs: options.recallAfterMs ?? options.ttl
    }, this.threadId, this.type);
  }

  // ===== Ảnh THẺ (opt-in): chỉ dùng khi thật sự muốn ảnh đẹp =====
  async card(spec = {}) {
    const recallAfterMs = spec.recallAfterMs ?? spec.ttl;
    const { payload: visualSpec } = extractRecallOptions(spec);
    const filePath = await renderCachedCard(visualSpec);
    if (!filePath) {
      // render hỏng → gửi text thuần, không mất phản hồi
      const plainMsg = spec.subtitle || spec.title || String(spec.msg || "");
      return this.api.sendMessage({ msg: plainMsg, recallAfterMs }, this.threadId, this.type);
    }
    return this.api.sendMessage({
      msg: "",
      attachments: filePath,
      recallAfterMs
    }, this.threadId, this.type);
  }

  async media({ msg, attachments, ttl, recallAfterMs }) {
    return this.api.sendMessage({
      msg,
      attachments,
      recallAfterMs: recallAfterMs ?? ttl
    }, this.threadId, this.type);
  }

  async voice({ voiceUrl, msg, ttl, recallAfterMs }) {
    const delay = recallAfterMs ?? ttl;
    if (msg) await this.text(msg, { plain: true, recallAfterMs: delay });
    return this.api.sendVoice({
      voiceUrl,
      recallAfterMs: delay
    }, this.threadId, this.type);
  }

  async video({ videoUrl, thumbnailUrl, msg, duration, width, height, ttl, recallAfterMs }) {
    return this.api.sendVideo({
      videoUrl,
      thumbnailUrl,
      duration,
      width,
      height,
      msg,
      recallAfterMs: recallAfterMs ?? ttl
    }, this.threadId, this.type);
  }

  // ===== Reaction trạng thái: 👀 (đang xử lý) → ✅ (xong) / 😢 (lỗi) =====
  async react(reaction) {
    this.reacted = true; // đánh dấu để handleCommand không tự thả thêm
    if (!this.event?.data?.msgId || !this.api?.addReaction) return false;
    try {
      await callTrackedZaloApi("addReaction", () => this.api.addReaction(reaction, {
        data: { msgId: this.event.data.msgId, cliMsgId: this.event.data.cliMsgId },
        threadId: this.threadId,
        type: this.type
      }));
      return true;
    } catch {
      return false;
    }
  }

  // Progress status is cosmetic. Never await a Zalo reaction before the
  // command can do useful work or return its primary result.
  working(options = {}) {
    const requestedDelay = Number(options?.delayMs);
    const delay = Number.isFinite(requestedDelay)
      ? Math.max(0, Math.min(5000, Math.floor(requestedDelay)))
      : 600;
    this.scheduleAcknowledgement(() => {
      void this.react(Reactions.PRAY);
    }, delay);
    return Promise.resolve(false);
  }

  finishWithReaction(reaction) {
    this.cancelAcknowledgement();
    this.reacted = true;
    setImmediate(() => {
      void this.react(reaction);
    });
    return Promise.resolve(false);
  }

  done() { return this.finishWithReaction(Reactions.OK); }
  failed() { return this.finishWithReaction(Reactions.CRY); }
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
  const markResponseStarted = () => {
    reply?.markResponseStarted?.();
  };
  const markResponseDelivered = () => {
    try {
      // Record the first response after Zalo resolves the send request, not
      // when the request is merely invoked.
      require("./metrics").trackFirstResponseLatency?.(event, performance.now());
    } catch {
      // Missing telemetry must not affect message delivery.
    }
  };

  defineWrapped(wrapped, "sendMessage", async (message, tid, ty) => {
    const targetThreadId = threadId || tid;
    const targetType = type || ty;
    const extracted = extractRecallOptions(message, DEFAULT_AUTO_RECALL_MS);
    const rawContent = typeof extracted.payload === "string"
      ? { msg: extracted.payload }
      : extracted.payload;
    const content = rawContent && typeof rawContent === "object"
      ? { ...rawContent }
      : rawContent;
    if (content && typeof content === "object" && content.plain) delete content.plain;

    // Màu ngẫu nhiên được áp dụng ở một điểm chung cho mọi tin nhắn text.
    // Nội dung, emoji, mentions và các định dạng không phải màu vẫn được giữ.
    let outgoing = content;
    try {
      outgoing = styledText.randomize(content);
    } catch (error) {
      logger.log("Không thể tô màu ngẫu nhiên cho tin nhắn: " + (error?.message || error), "warn");
    }

    const response = await callTrackedZaloApi("sendMessage", () => api.sendMessage(outgoing, targetThreadId, targetType), markResponseStarted);
    markResponseDelivered();
    scheduleRecall(api, response, targetThreadId, targetType, extracted.delayMs);
    return response;
  });

  defineWrapped(wrapped, "sendVoice", async (payload, tid, ty) => {
    const targetThreadId = threadId || tid;
    const targetType = type || ty;
    const extracted = extractRecallOptions(payload, DEFAULT_AUTO_RECALL_MS);
    const content = typeof extracted.payload === "string" ? { voiceUrl: extracted.payload } : extracted.payload;
    const response = await callTrackedZaloApi("sendVoice", () => api.sendVoice(content, targetThreadId, targetType), markResponseStarted);
    markResponseDelivered();
    scheduleRecall(api, response, targetThreadId, targetType, extracted.delayMs);
    return response;
  });

  defineWrapped(wrapped, "sendVideo", async (payload, tid, ty) => {
    const targetThreadId = threadId || tid;
    const targetType = type || ty;
    const extracted = extractRecallOptions(payload, DEFAULT_AUTO_RECALL_MS);
    const response = await callTrackedZaloApi("sendVideo", () => api.sendVideo(extracted.payload, targetThreadId, targetType), markResponseStarted);
    markResponseDelivered();
    scheduleRecall(api, response, targetThreadId, targetType, extracted.delayMs);
    return response;
  });

  for (const method of ["sendSticker", "sendCard"]) {
    if (typeof api[method] !== "function") continue;
    defineWrapped(wrapped, method, async (payload, tid, ty) => {
      const targetThreadId = threadId || tid;
      const targetType = type || ty;
      const extracted = extractRecallOptions(payload, DEFAULT_AUTO_RECALL_MS);
      const response = await callTrackedZaloApi(method, () => api[method](extracted.payload, targetThreadId, targetType), markResponseStarted);
      markResponseDelivered();
      scheduleRecall(api, response, targetThreadId, targetType, extracted.delayMs);
      return response;
    });
  }

  if (typeof api.sendCustomStickerUrl === "function") {
    defineWrapped(wrapped, "sendCustomStickerUrl", async (payload) => {
      const targetThreadId = payload?.threadId || threadId;
      const targetType = payload?.threadType ?? type;
      const extracted = extractRecallOptions(payload, DEFAULT_AUTO_RECALL_MS);
      const response = await callTrackedZaloApi("sendCustomStickerUrl", () => api.sendCustomStickerUrl(extracted.payload), markResponseStarted);
      markResponseDelivered();
      scheduleRecall(api, response, targetThreadId, targetType, extracted.delayMs);
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

module.exports = {
  Reply,
  wrapApi,
  DEFAULT_AUTO_RECALL_MS,
  extractRecallOptions,
  scheduleRecall,
  scheduleRecallCountdown,
  _test: {
    addRecallClock,
    getRecallCountdownUpdates,
    getRecallReactionQueueStats: () => ({
      active: activeRecallReactions,
      pending: recallReactionQueue.length,
      concurrency: RECALL_REACTION_CONCURRENCY,
      tracked: recallReactionStates.size
    })
  }
};
