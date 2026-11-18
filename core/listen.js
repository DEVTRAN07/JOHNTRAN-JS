const handleCommand = require("./handle/handleCommand");
const handleEvent = require("./handle/handleEvent");
const { wrapForThread } = require("./runtime/adapters/zalo");
const logger = require("../utils/logger");
const { reportComponent } = require("./runtime/recovery");
const { updateMessageCache, getMessageCache } = require("../utils/index");
const { ThreadType } = require("zalo-client");
const { performance } = require("node:perf_hooks");
const metrics = require("./metrics");
const { createCipherReadyGate, requestOldMessagesThen } = require("./topchat/historyBootstrap");
const { createReconnectFailureTracker } = require("./topchat/reconnectState");
const {
  isEnabled: isGroupBotEnabled,
  isAllowedControlMessage: isAllowedBotControlMessage
} = require("./runtime/groupBotState");

const Threads = require("./controller/controllerThreads");
const Users = require("./runtime/services/userService");
const panelBridge = require("./panelBridge");
const { vietnamDateKey, isGroupMessage } = require("./topchat/stats");
const {
  HISTORY_PAGE_DELAY_MS,
  HISTORY_REQUEST_TIMEOUT_MS,
  maxHistoryPages,
  inspectGroupHistoryPage
} = require("./topchat/wsBackfill");

const RECONNECT_BASE_DELAY = Math.max(250, Number(process.env.JT_LISTENER_RECONNECT_BASE_MS) || 5000);
const RECONNECT_MAX_DELAY = Math.max(RECONNECT_BASE_DELAY, Number(process.env.JT_LISTENER_RECONNECT_MAX_MS) || 60000);
const RECONNECT_JITTER_RATIO = Math.max(0, Math.min(0.5, Number(process.env.JT_LISTENER_RECONNECT_JITTER) || 0.15));
// Sau N lần đóng WS liên tiếp mà không kết nối lại được → thoát process,
// supervisor (index.js / botManager) tự khởi động lại + đăng nhập lại từ đầu
const CONNECT_FAIL_LIMIT = 3;
const WATCHDOG_INTERVAL = 30000;
// 30 phút không có frame nào MỚI coi là half-open (nhóm im lặng vài phút là bình thường)
const WATCHDOG_STALE_MS = 1800000;

function computeReconnectDelay(attempt, baseMs = RECONNECT_BASE_DELAY, maxMs = RECONNECT_MAX_DELAY, jitterRatio = RECONNECT_JITTER_RATIO, random = Math.random) {
  const step = Math.max(1, Math.floor(Number(attempt) || 1));
  const base = Math.max(1, Number(baseMs) || RECONNECT_BASE_DELAY);
  const maximum = Math.max(base, Number(maxMs) || RECONNECT_MAX_DELAY);
  const jitter = Math.max(0, Math.min(0.5, Number(jitterRatio) || 0));
  const raw = Math.min(base * (2 ** Math.min(16, step - 1)), maximum);
  const spread = Math.floor(raw * jitter * Math.max(0, Math.min(1, Number(random()) || 0)));
  return Math.min(maximum, raw + spread);
}

// Prevent accidental duplicate listener registration when startup paths race
// or a caller invokes startListening twice with the same SDK API instance.
const registeredApis = new WeakSet();
function claimListenerRegistration(api) {
  if (!api || (typeof api !== "object" && typeof api !== "function")) return false;
  if (registeredApis.has(api)) return false;
  registeredApis.add(api);
  return true;
}

function shouldExecuteMessageCommand(options = {}) {
  return options.skipCommandExecution !== true;
}

function shouldProcessUndoEvent(event) {
  return event?.isSelf !== true || global.config?.allow_self_anti === true;
}

function shouldCacheIncomingMessage(event) {
  if (!event) return false;
  if (event.isSelf !== true) return true;
  if (event.type !== ThreadType.Group || global.config?.allow_self_anti !== true) return false;

  // In self-test mode cache bot-authored test messages so /antirecall can
  // restore them. Do not cache Anti-generated notices/media, whose own recall
  // timers must not be replayed as user content.
  try {
    const anti = require("../plugins/commands/anti");
    return !anti?._test?.isAntiGeneratedSelfEcho?.(event, false);
  } catch {
    return true;
  }
}

function shouldReplayOldMessage(message, reconnectSince) {
  const rawTimestamp = Number(message?.data?.ts);
  if (!Number.isFinite(rawTimestamp) || rawTimestamp <= 0) return false;
  const timestamp = rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp;
  return timestamp >= reconnectSince - 5000;
}


async function dispatchAntiMessageBeforeGame({ api, event, Users, Threads, threadData = null, isSelf = false } = {}) {
  if (event?.type !== ThreadType.Group || !event?.threadId) {
    return { dispatched: false, consumed: false };
  }

  let antiCommand = global.client?.commands?.get?.("anti");
  if (typeof antiCommand?.handleEvent !== "function") {
    try { antiCommand = require("../plugins/commands/anti"); }
    catch { return { dispatched: false, consumed: false }; }
  }
  if (typeof antiCommand?.handleEvent !== "function") {
    return { dispatched: false, consumed: false };
  }

  // onMessage has already loaded the group's settings. Reuse that snapshot
  // and skip all Anti setup for groups with no active message protections.
  let cachedThreadRecord = threadData || null;
  let cachedThreadCacheChecked = Boolean(threadData);
  try {
    if (!cachedThreadRecord && typeof Threads?.getCachedData === "function") {
      cachedThreadCacheChecked = true;
      cachedThreadRecord = Threads.getCachedData(event.threadId) || null;
    }
    if (cachedThreadRecord) {
      const source = cachedThreadRecord?.data || cachedThreadRecord;
      const relevantKeys = antiCommand._test?.getRelevantAntiProtectionKeys?.("message") || [];
      if (relevantKeys.length && !relevantKeys.some(key => source?.[key] === true)) {
        return { dispatched: false, consumed: false, skipped: true };
      }
    }
  } catch {
    // Preserve the existing durable fallback when the snapshot cannot be read.
  }

  try {
    const wrapped = wrapForThread(api, event.threadId, ThreadType.Group, "anti", event);
    const result = await antiCommand.handleEvent({
      api: wrapped,
      event,
      eventType: "message",
      isSelf: isSelf === true || event?.isSelf === true,
      Users,
      Threads,
      cachedThreadRecord,
      cachedThreadCacheChecked,
      reply: wrapped?.__reply,
      threadType: ThreadType.Group
    });
    return { dispatched: true, consumed: result?.consumed === true };
  } catch (error) {
    logger.log("Lỗi kiểm duyệt Anti trước game: " + (error?.message || error), "error", {
      source: "listener-anti-before-game",
      groupId: event.threadId
    });
    return { dispatched: false, consumed: false };
  }
}

async function dispatchGroupMessageBeforeGame({
  api,
  event,
  Users,
  Threads,
  isSelf = false,
  threadData = null,
  antiDispatcher = dispatchAntiMessageBeforeGame,
  gameDispatcher = dispatchActiveGameMessage
} = {}) {
  const anti = await antiDispatcher({ api, event, Users, Threads, threadData, isSelf });
  if (anti?.consumed === true) {
    return { consumed: true, source: "anti", antiDispatched: anti.dispatched === true };
  }

  const gameConsumed = await gameDispatcher({ api, event, Users, Threads, isSelf });
  return {
    consumed: gameConsumed === true,
    source: gameConsumed === true ? "game" : null,
    antiDispatched: anti?.dispatched === true
  };
}

async function dispatchActiveGameMessage({ api, event, Users, Threads, isSelf = false } = {}) {
  // Keep Nối Từ available in any supported thread, but never send private chats
  // through the group-only TLMN handler.
  if (!event?.threadId || event?.type == null) return false;
  const selfMessage = isSelf === true || event?.isSelf === true;
  if (selfMessage && global.config?.allow_self_command !== true) return false;

  // Preserve Nối Từ priority: a message consumed by it must not reach another game.
  try {
    const noituCommand = require("../plugins/commands/noitu");
    const hasActiveGame = typeof noituCommand?.hasActiveGameForThread === "function"
      ? noituCommand.hasActiveGameForThread(event.threadId)
      : true;
    if (hasActiveGame && typeof noituCommand?.handleEvent === "function") {
      const consumed = await noituCommand.handleEvent({
        api, event, eventType: "message", isSelf: false, Users, Threads
      });
      if (consumed === true) return true;
    }
  } catch (error) {
    logger.log(`Lỗi xử lý tin nhắn game Nối Từ: ${error?.message || error}`, "error", {
      source: "listener-active-game-noitu",
      groupId: event?.threadId
    });
  }

  // TLMN receives plain-text card plays only in groups, before passive plugins.
  if (event?.type !== ThreadType.Group) return false;
  try {
    const tlmnCommand = require("../plugins/commands/tlmn");
    if (typeof tlmnCommand?.handleIncoming === "function") {
      const consumed = await tlmnCommand.handleIncoming({
        api, event, eventType: "message", isSelf: selfMessage, Users, Threads
      });
      if (consumed === true) return true;
    }
  } catch (error) {
    logger.log(`Lỗi xử lý nước đánh Tiến Lên: ${error?.message || error}`, "error", {
      source: "listener-active-game-tlmn",
      groupId: event?.threadId
    });
  }

  return false;
}

function startListening(api) {
  if (!api?.listener?.on || !api.listener.start) {
    logger.log("API listener không hợp lệ.", "error");
    return;
  }

  if (!claimListenerRegistration(api)) {
    logger.log("Bỏ qua yêu cầu đăng ký listener trùng cho cùng API instance.", "warn");
    return;
  }

  const listener = api.listener;

  // cliMsgId đã xử lý (chống backfill xử lý lại, đặc biệt tin self không vào file cache)
  const processedIds = new Set();
  const markProcessed = (cliMsgId) => {
    if (!cliMsgId) return;
    processedIds.add(cliMsgId);
    if (processedIds.size > 1000) {
      processedIds.delete(processedIds.values().next().value);
    }
  };

  // ===== Xử lý 1 tin nhắn (dùng chung cho realtime và backfill sau reconnect) =====
  const onMessage = async (event, options = {}) => {
    const receivedAt = typeof options.receivedAt === "number" && Number.isFinite(options.receivedAt)
      ? options.receivedAt
      : performance.now();
    const preprocessingStartedAt = performance.now();

    // allow_private_command: false → bỏ qua HOÀN TOÀN tin riêng (cả lệnh lẫn auto-reply)
    if (event.type === ThreadType.User && global.config.allow_private_command === false) {
      return;
    }

    // Normal member messages are cached for Anti recall restoration. In explicit
    // self-test mode, cache bot-authored group messages too, except Anti replies.
    // Every step is isolated so a cache failure cannot block command execution.
    try {
      if (shouldCacheIncomingMessage(event)) updateMessageCache(event);
    } catch (err) {
      logger.log(`Lỗi updateMessageCache (bỏ qua): ${err.message}`, "warn", { source: "listener-cache", isGroup: event?.type === ThreadType.Group, groupId: event?.threadId });
    }

    // Panel chat: ghi tin vào bộ nhớ để panel xem/gửi tiếp
    try {
      panelBridge.recordIncoming(event);
    } catch { /* bỏ qua */ }

    metrics.trackListenerStageLatency?.("message-preprocess", performance.now() - preprocessingStartedAt);

    // Backfill only records missed messages; historical commands/events must
    // never be executed again after reconnect.
    if (!shouldExecuteMessageCommand(options)) return;

    // Active groups are normally already cached. Use the synchronous cache
    // hit so a hot message can enter command parsing without an avoidable
    // Promise/microtask boundary; cold groups retain the safe async fallback.
    const threadLookupStartedAt = performance.now();
    let threadData = null;
    try {
      threadData = Threads.getCachedData?.(event.threadId) || null;
      if (!threadData) threadData = await Threads.getData(event.threadId);
    } catch (err) {
      // DB (Supabase) hỏng / timeout → vẫn chạy lệnh với threadInfo rỗng
      logger.log(`Lỗi đọc dữ liệu nhóm ${event.threadId} (bỏ qua): ${err.message}`, "warn", { source: "listener-database", isGroup: event?.type === ThreadType.Group, groupId: event?.threadId });
    }
    metrics.trackListenerStageLatency?.("thread-data", performance.now() - threadLookupStartedAt);

    // Chuẩn hoá @mention → event.mentions = [{ uid }] để mọi lệnh dùng chung
    try {
      event.mentions = require("./mentions").extractMentions(event?.data).map((uid) => ({ uid }));
    } catch { /* bỏ qua */ }

    const threadInfo = threadData?.data || {};
    const prefix = threadInfo.prefix ? threadInfo.prefix : global.config.prefix;

    const { data } = event;
    const content = typeof data?.content === "object" && data.content !== null
      ? (data.content.title ?? data.content)
      : data?.content;

    // Lệnh từ tin self: chỉ chạy khi bật config allow_self_command
    // (selfListen: true → uidFrom bị rewrite thành uid bot = admin, cần flag rõ ràng)
    const allowSelfCommand = global.config.allow_self_command === true;
    const canRunCommand = !event.isSelf || allowSelfCommand;
    const isGroupThread = event?.type === ThreadType.Group;
    const groupBotEnabled = !isGroupThread || isGroupBotEnabled(threadInfo);
    const isBotControlCommand = isAllowedBotControlMessage(content, prefix);

    // Every group starts OFF. Only /bot on and /bot status pass until enabled.
    if (isGroupThread && !groupBotEnabled && !(canRunCommand && isBotControlCommand)) return;

    const dispatchMessageEvents = (dispatchOptions = {}) => {
      if (isGroupThread && !groupBotEnabled) return;
      Promise.resolve(handleEvent("message", event, api, event.isSelf === true, dispatchOptions))
        .catch((err) => logger.log(`Lỗi handleEvent message (bỏ qua): ${err.message}`, "warn", {
          source: "listener-event",
          isGroup: event?.type === ThreadType.Group,
          groupId: event?.threadId
        }));
    };

    if (canRunCommand && typeof content === "string" && content.startsWith(prefix)) {
      metrics.trackListenerStageLatency?.("receive-to-command", performance.now() - receivedAt);
      // Start command parsing immediately. Passive event handlers run on the
      // next event-loop turn so they cannot delay the command hot path.
      Promise.resolve(handleCommand(content, event, api, threadInfo, prefix, threadData)).catch((err) => {
        logger.log(`Lỗi xử lý lệnh: ${err.message}`, "error", { source: "listener-command", commandName: String(content).slice(prefix.length).trim().split(/\s+/, 1)[0], isGroup: event?.type === ThreadType.Group, groupId: event?.threadId });
      });
      if (!isGroupThread || groupBotEnabled) setImmediate(dispatchMessageEvents);
      return;
    }

    // Run moderation before active games. A game move is still game input,
    // but it must not bypass Anti-Link, Anti-Word, Anti-Spam, media or AI rules.
    // If Anti removes/blocks the message, the game must never consume it.
    const activeDispatch = await dispatchGroupMessageBeforeGame({
      api, event, Users, Threads, threadData, isSelf: event?.isSelf === true
    });
    if (activeDispatch.consumed) return;

    // Anti and the game consumer have already had their single turn. Dispatch
    // other passive plugins without re-running either handler on the same event.
    dispatchMessageEvents({
      skipAnti: activeDispatch.antiDispatched,
      skipGameConsumers: true
    });

    // ===== Điều hướng bằng từ TRẦN (không cần prefix): next / prev / out / số =====
    // Xử lý TRỰC TIẾP tại đây (không đi qua handleEvent) để chắc chắn chạy:
    //   1) đang mở menu  → lật trang menu
    //   2) đang có kết quả nhạc → chọn bài / lật trang nhạc
    //   3) không có gì    → im lặng
    const NAV_WORDS = ["next", "prev", "previous", "back", "out", "exit", "close"];
    const trimmed = typeof content === "string" ? content.trim() : "";
    const isNavWord = NAV_WORDS.includes(trimmed.toLowerCase());
    const isNavNumber = /^\d{1,2}$/.test(trimmed);

    if (canRunCommand && (isNavWord || isNavNumber)) {
      const nav = trimmed.toLowerCase();

      // 1) Kết quả NHẠC đang chờ — ƯU TIÊN TRƯỚC menu.
      // Người dùng tìm nhạc xong gõ số là muốn chọn bài; nếu để menu_page
      // (còn sót từ lần mở menu trước) chặn trước thì rơi vào menu nhầm.
      const music = require("./music");
      const pending = music.getPending(music.pickKey(event.threadId, data.uidFrom));
      if (pending) {
        const wrapped = wrapForThread(api, event.threadId, event.type, pending.providerName, event);
        logger.log(`[listen] nhóm ${event.threadId} chọn nhạc "${nav}"`, "info");
        Promise.resolve()
          .then(() => require("./music/command").runMusic(pending.providerName, {
            api: wrapped, event, args: [nav], reply: wrapped.__reply
          }))
          .catch((err) => logger.log(`Lỗi điều hướng nhạc: ${err.message}`, "error"));
        return;
      }

      // 2) MENU đang mở trong nhóm này
      if (threadInfo?.menu_page) {
        const wrapped = wrapForThread(api, event.threadId, event.type, "menu", event);
        logger.log(`[listen] nhóm ${event.threadId} điều hướng menu "${nav}"`, "info");
        Promise.resolve()
          .then(() => global.client.commands.get("menu").run({
            api: wrapped, event, args: [nav], Threads, reply: wrapped.__reply
          }))
          .catch((err) => logger.log(`Lỗi điều hướng menu: ${err.message}`, "error"));
        return;
      }

      // 3) Không có gì đang mở → im lặng (không làm nhiễu nhóm)
      return;
    }
  };

  const handleIncoming = (event, options = {}) => {
    const receivedAt = performance.now();
    // Observe the raw SDK event before duplicate/self filters so /topchat can
    // distinguish "listener received nothing" from "self/duplicate was skipped".
    const topchatCounter = require("../plugins/events/topchatCounter");
    topchatCounter.observeIncomingEvent(event);

    const cliMsgId = event?.data?.cliMsgId;
    if (cliMsgId && processedIds.has(cliMsgId)) return; // trùng lặp (server gửi lại / backfill)
    markProcessed(cliMsgId);
    metrics.trackIncomingMessage?.(event, receivedAt);

    // Count every group event for diagnostics. The counter still excludes
    // bot-self messages from the actual member ranking.
    if (isGroupMessage(event)) {
      void topchatCounter.run({ event, Threads }).catch((err) => {
        logger.log(`Lỗi ghi thống kê Topchat: ${err.message}`, "warn");
      });
    }

    Promise.resolve(onMessage(event, { ...options, receivedAt })).catch((err) => {
      logger.log(`Lỗi listener message: ${err.message}`, "error");
    });
  };

  listener.on("message", handleIncoming);

  // ===== Backfill: tin nhắn gửi lúc socket rớt =====
  // Tin lịch sử được cache nhưng không thực thi lại lệnh cũ.
  let reconnectSince = Date.now();
  let topchatHistorySync = null;
  let cancelPrivateHistoryWait = null;

  function clearTopchatHistoryTimers(state) {
    if (!state) return;
    if (state.requestTimer) clearTimeout(state.requestTimer);
    if (state.nextPageTimer) clearTimeout(state.nextPageTimer);
    state.requestTimer = null;
    state.nextPageTimer = null;
  }

  async function finishTopchatHistorySync(complete, reason) {
    const state = topchatHistorySync;
    if (!state || !state.active) return;
    state.active = false;
    state.pending = false;
    clearTopchatHistoryTimers(state);

    // Never let a backfill started yesterday reset or mark today's counters.
    if (state.dateKey === vietnamDateKey()) {
      try {
        const counter = require("../plugins/events/topchatCounter");
        await counter.markHistoryCoverage(
          [...state.groups],
          Threads,
          state.dateKey,
          complete,
          state.pageCount,
          reason
        );
      } catch (error) {
        logger.log(`Không lưu được trạng thái lịch sử Topchat: ${error.message}`, "warn");
      }
    }

    logger.log(
      complete
        ? `Topchat đã quét lịch sử nhóm tới đầu ngày ${state.dateKey} (${state.pageCount} trang)`
        : `Topchat dừng đồng bộ lịch sử chưa đủ ngày (${state.pageCount} trang, ${reason})`,
      complete ? "info" : "warn"
    );
  }

  function requestTopchatHistoryPage(lastMsgId = null) {
    const state = topchatHistorySync;
    if (!state || !state.active || state.pending) return;

    const cursorKey = lastMsgId == null ? "__first__" : String(lastMsgId);
    if (state.cursors.has(cursorKey)) {
      void finishTopchatHistorySync(false, "cursor-duplicate");
      return;
    }
    if (state.pageCount >= state.maxPages) {
      void finishTopchatHistorySync(false, "page-limit");
      return;
    }

    state.cursors.add(cursorKey);
    state.pending = true;
    state.pageCount++;
    try {
      listener.requestOldMessages(ThreadType.Group, lastMsgId);
    } catch (error) {
      state.pending = false;
      void finishTopchatHistorySync(false, "request-error");
      logger.log(`Không yêu cầu được trang lịch sử Topchat: ${error.message}`, "warn");
      return;
    }

    state.requestTimer = setTimeout(() => {
      if (topchatHistorySync === state && state.active && state.pending) {
        void finishTopchatHistorySync(false, "response-timeout");
      }
    }, HISTORY_REQUEST_TIMEOUT_MS);
    state.requestTimer.unref?.();
  }

  function startTopchatHistorySync() {
    if (topchatHistorySync) clearTopchatHistoryTimers(topchatHistorySync);
    topchatHistorySync = {
      active: true,
      pending: false,
      dateKey: vietnamDateKey(),
      maxPages: maxHistoryPages(),
      pageCount: 0,
      cursors: new Set(),
      groups: new Set(),
      requestTimer: null,
      nextPageTimer: null
    };
    requestTopchatHistoryPage(null);
  }

  async function ingestTopchatHistoryPage(messages) {
    const state = topchatHistorySync;
    const counter = require("../plugins/events/topchatCounter");

    if (state?.active) {
      for (const message of messages) {
        if (isGroupMessage(message) && (message.threadId || message.data?.idTo)) {
          state.groups.add(String(message.threadId || message.data.idTo));
        }
      }
    }

    const result = await counter.recordHistoryMessages(messages, Threads);
    if (result.messages > 0) {
      logger.log(
        `Topchat đã bổ sung ${result.messages} tin nhắn hôm nay từ lịch sử WebSocket (${result.groups} nhóm)`,
        "info"
      );
    }

    // Only the response to the outstanding group-history request advances the
    // cursor. A batch may contain up to 50 messages; ask for the preceding
    // page using the oldest msgId until we cross today's 00:00 (Vietnam time).
    if (!state || !state.active || !state.pending) return;
    state.pending = false;
    if (state.requestTimer) clearTimeout(state.requestTimer);
    state.requestTimer = null;

    const page = inspectGroupHistoryPage(
      messages,
      state.dateKey,
      state.pageCount,
      state.maxPages
    );
    if (!page.continue) {
      const complete = require("./topchat/wsBackfill").isHistoryCoverageComplete(page.reason);
      await finishTopchatHistorySync(complete, page.reason);
      return;
    }

    state.nextPageTimer = setTimeout(() => {
      state.nextPageTimer = null;
      requestTopchatHistoryPage(page.cursor);
    }, HISTORY_PAGE_DELAY_MS);
    state.nextPageTimer.unref?.();
  }

  listener.on("old_messages", (messages, messageType) => {
    if (!Array.isArray(messages)) return;

    // REST /api/group/history is no longer reliable. Zalo's WebSocket sends
    // historical group messages via requestOldMessages(ThreadType.Group).
    // Fold today's messages into the same persisted daily counter as realtime.
    if (messageType === ThreadType.Group) {
      void ingestTopchatHistoryPage(messages)
        .catch((error) => logger.log(`Không thể đồng bộ lịch sử Topchat: ${error.message}`, "warn"));
    }

    for (const message of messages) {
      const cliMsgId = message?.data?.cliMsgId;
      if (cliMsgId && (processedIds.has(cliMsgId) || getMessageCache()[cliMsgId])) continue; // đã xử lý rồi
      if (!shouldReplayOldMessage(message, reconnectSince)) {
        if (!message?.isSelf) updateMessageCache(message);
        continue;
      }
      handleIncoming(message, { skipCommandExecution: true });
    }
  });

  // Cho phép event chỉ trong nhóm khi tắt chat riêng
  const allowPrivate = () => global.config.allow_private_command !== false;
  const skipPrivate = (event) => event.type === ThreadType.User && !allowPrivate();

  listener.on("group_event", (event) => {
    if (skipPrivate(event)) return;
    void Promise.resolve(handleEvent("group_event", event, api, event.isSelf === true)).catch((err) => logger.log(`Lỗi handleEvent group_event: ${err.message}`, "warn"));
  });

  listener.on("reaction", (event) => {
    if (skipPrivate(event) || event.isSelf) return;
    void Promise.resolve(handleEvent("reaction", event, api, event.isSelf === true)).catch((err) => logger.log(`Lỗi handleEvent reaction: ${err.message}`, "warn"));
  });

  listener.on("undo", (event) => {
    // Self undo is allowed only for Anti's explicit self-test mode.
    // handleEvent narrows that event to the Anti command, not every plugin.
    if (skipPrivate(event) || !shouldProcessUndoEvent(event)) return;
    void Promise.resolve(handleEvent("undo", event, api, event.isSelf === true)).catch((err) => logger.log(`Lỗi handleEvent undo: ${err.message}`, "warn"));
  });

  // ===== Tự kết nối lại: Zalo đóng WS (rớt mạng, đăng nhập lại, trùng kết nối)
  // là bot im lặng vĩnh viễn nếu không reconnect =====
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  const reconnectFailures = createReconnectFailureTracker(CONNECT_FAIL_LIMIT);
  let lastFrameAt = 0;
  let connectingSince = 0;

  const connectListener = (reason) => {
    // connectListener chỉ chạy khi không có timer pending hoặc từ chính timer đã fired
    reconnectTimer = null;
    reportComponent("listener", { status: "connecting", attempt: reconnectAttempt, message: "Đang mở kết nối WebSocket." });
    try {
      // retryOnClose: false → mọi lần đóng WS đều phát event "closed",
      // reconnect chỉ đi qua MỘT luồng duy nhất (tránh 2 WS đấu nhau)
      listener.start({ retryOnClose: false });
      connectingSince = Date.now();
      logger.log(`Đã bắt đầu lắng nghe sự kiện${reason ? ` (${reason})` : ""}`, "info");
    } catch (error) {
      reconnectAttempt += 1;
      const delay = computeReconnectDelay(reconnectAttempt);
      reportComponent("listener", {
        status: "recovering",
        attempt: reconnectAttempt,
        nextRetryAt: Date.now() + delay,
        message: "Không mở được WebSocket; đang thử lại theo exponential backoff."
      });
      logger.log(`Chưa kết nối được listener (${error.message}) — thử lại sau ${delay / 1000}s`, "warn", { source: "websocket-listener", eventName: "connect" });
      reconnectTimer = setTimeout(() => connectListener("tự kết nối lại"), delay);
    }
  };

  const scheduleReconnect = (reason) => {
    if (reconnectTimer) return;
    reconnectAttempt += 1;
    const delay = computeReconnectDelay(reconnectAttempt);
    reportComponent("listener", {
      status: "recovering",
      attempt: reconnectAttempt,
      nextRetryAt: Date.now() + delay,
      consecutiveHandshakeFailures: reconnectFailures.count || 0,
      message: "WebSocket đóng; đang tự kết nối lại theo backoff."
    });
    logger.log(`Listener đóng (${reason}) — kết nối lại sau ${delay / 1000}s`, "warn", { source: "websocket-listener", eventName: "closed" });
    reconnectTimer = setTimeout(() => connectListener("tự kết nối lại"), delay);
  };

  // Zalo emits "connected" as soon as the socket opens, before its cipher_key
  // frame arrives. History responses are encrypted, so requesting them here can
  // race the key handshake and make the initial Topchat backfill silently fail.
  const historyBootstrapGate = createCipherReadyGate(() => {
    logger.log("WebSocket đã cấp cipher key; đồng bộ lịch sử theo thứ tự DM → Group", "info");
    cancelPrivateHistoryWait?.();
    try {
      const wait = requestOldMessagesThen(listener, ThreadType.User, () => {
        cancelPrivateHistoryWait = null;
        if (listener.ws && listener.ws.readyState !== 1) return;
        try {
          startTopchatHistorySync();
        } catch (error) {
          logger.log(`Không thể bắt đầu đồng bộ lịch sử Topchat: ${error.message}`, "warn");
        }
      }, HISTORY_REQUEST_TIMEOUT_MS);
      cancelPrivateHistoryWait = wait.cancel;
      void wait.promise.then((reason) => {
        if (reason === "timeout" || reason === "request-error") {
          logger.log(`Đồng bộ DM kết thúc bằng ${reason}; chuyển sang lịch sử nhóm Topchat`, "warn");
        }
      }).catch((error) => {
        logger.log(`Lỗi tuần tự hóa yêu cầu lịch sử Zalo: ${error.message}`, "warn");
      });
    } catch (error) {
      logger.log(`Không yêu cầu được tin nhắn riêng cũ: ${error.message}`, "warn");
      try { startTopchatHistorySync(); } catch (startError) {
        logger.log(`Không thể bắt đầu đồng bộ lịch sử Topchat: ${startError.message}`, "warn");
      }
    }
  });

  // Backoff chỉ reset khi kết nối THẬT (start() thành công chỉ là tạo ws object)
  listener.on("connected", () => {
    // WebSocket OPEN is not yet a usable Zalo session; wait for cipher_key.
    lastFrameAt = Date.now();
    connectingSince = 0;
    reportComponent("listener", { status: "connecting", message: "WebSocket đã mở; đang chờ cipher key để hoàn tất handshake." });
    historyBootstrapGate.connected();
  });

  listener.on("disconnected", (code, reason) => {
    logger.log(`Listener mất kết nối (code ${code}) ${reason || ""}`, "warn", { source: "websocket-listener", eventName: "disconnected", code });
  });

  listener.on("closed", (code) => {
    cancelPrivateHistoryWait?.();
    cancelPrivateHistoryWait = null;
    historyBootstrapGate.disconnected();
    reconnectSince = Date.now();
    if (topchatHistorySync?.active) {
      void finishTopchatHistorySync(false, "connection-closed");
    }
    const failure = reconnectFailures.closed();
    if (failure.exhausted) {
      reportComponent("listener", { status: "critical", consecutiveHandshakeFailures: failure.count, message: "Handshake thất bại liên tiếp; yêu cầu supervisor khởi động lại tiến trình." });
      logger.log(`Listener rớt ${failure.count} lần liên tiếp không hoàn tất handshake — khởi động lại tiến trình để đăng nhập lại`, "error", { source: "websocket-listener", eventName: "handshake-failed", code: String(code) });
      process.exit(2); // supervisor tự dựng lại (index.js restart code 2 / botManager autoRestart)
    }
    scheduleReconnect(`code ${code}`);
  });

  // Chỉ log lỗi WS — "error" không tự reconnect (tránh 2 luồng kết nối đấu nhau);
  // việc kết nối lại do event "closed" + watchdog đảm nhiệm
  listener.on("error", (error) => {
    reportComponent("listener", { status: "degraded", message: "Listener phát sinh lỗi WebSocket; chờ event closed/watchdog xử lý." });
    logger.log(`Listener lỗi: ${error?.message || error}`, "error", { source: "websocket-listener", eventName: "error", code: error?.code });
  });

  // Đánh dấu freshness cho watchdog (dùng cho cả message và cipher_key)
  const markAlive = () => { lastFrameAt = Date.now(); };
  listener.on("message", markAlive);
  listener.on("cipher_key", () => {
    markAlive();
    // Only a completed Zalo handshake resets the consecutive-failure counter
    // and exponential backoff. A socket that opens then immediately closes
    // must still count as a failed connection attempt.
    reconnectAttempt = 0;
    reconnectFailures.markStable();
    reportComponent("listener", { status: "healthy", attempt: 0, consecutiveHandshakeFailures: 0, message: "WebSocket handshake hoàn tất; listener hoạt động." });
    historyBootstrapGate.cipherReady();
  });

  // Watchdog: chỉ dựa vào trạng thái socket THẬT — không coi "im lặng vài phút"
  // là chết (nhóm không ai nhắn thì bot vẫn sống, ép reconnect chỉ làm mất tin)
  const watchdog = setInterval(() => {
    const ws = listener.ws;
    const state = ws ? ws.readyState : -1;

    // OPEN → sống, thôi. Chỉ khi im lặng RẤT lâu (30 phút) mới coi là half-open
    if (state === 1) {
      connectingSince = 0;
      if (Date.now() - lastFrameAt < WATCHDOG_STALE_MS) return;
      logger.log("Watchdog: 30 phút không có frame nào — thử khôi phục kết nối", "warn", { source: "websocket-watchdog", eventName: "stale-frame" });
    } else if (state === 0) {
      // CONNECTING: chỉ nhảy khi kẹt quá 90s
      if (!connectingSince) connectingSince = Date.now();
      if (Date.now() - connectingSince < 90000) return;
      logger.log("Watchdog: kẹt kết nối quá 90s — buộc thử lại", "warn", { source: "websocket-watchdog", eventName: "connect-timeout" });
    } else if (reconnectTimer) {
      return; // đã có lịch reconnect
    } else {
      logger.log(`Watchdog: socket state=${state} — buộc kết nối lại`, "warn", { source: "websocket-watchdog", eventName: "socket-state" });
    }

    try {
      listener.stop();
    } catch {
      // stop() thất bại thì vẫn thử start lại ở dưới
    }
    scheduleReconnect("watchdog");
  }, WATCHDOG_INTERVAL);
  watchdog.unref();

  connectListener();
}

module.exports = startListening;
module.exports.dispatchActiveGameMessage = dispatchActiveGameMessage;
module.exports.dispatchAntiMessageBeforeGame = dispatchAntiMessageBeforeGame;
module.exports.dispatchGroupMessageBeforeGame = dispatchGroupMessageBeforeGame;
module.exports.shouldReplayOldMessage = shouldReplayOldMessage;
module.exports.claimListenerRegistration = claimListenerRegistration;
module.exports.shouldExecuteMessageCommand = shouldExecuteMessageCommand;
module.exports.shouldProcessUndoEvent = shouldProcessUndoEvent;
module.exports.shouldCacheIncomingMessage = shouldCacheIncomingMessage;

module.exports.computeReconnectDelay = computeReconnectDelay;
