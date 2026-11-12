const handleCommand = require("./handle/handleCommand");
const handleEvent = require("./handle/handleEvent");
const { wrapForThread } = require("./runtime/adapters/zalo");
const logger = require("../utils/logger");
const { updateMessageCache, getMessageCache } = require("../utils/index");
const { ThreadType } = require("zalo-client");
const { createCipherReadyGate } = require("./topchat/historyBootstrap");

const Threads = require("./controller/controllerThreads");
const panelBridge = require("./panelBridge");
const { getRequesterProfile } = require("./runtime/requesterProfile");
const { vietnamDateKey } = require("./topchat/stats");
const {
  HISTORY_PAGE_DELAY_MS,
  HISTORY_REQUEST_TIMEOUT_MS,
  maxHistoryPages,
  inspectGroupHistoryPage
} = require("./topchat/wsBackfill");

const RECONNECT_BASE_DELAY = 5000;
const RECONNECT_MAX_DELAY = 60000;
// Sau N lần đóng WS liên tiếp mà không kết nối lại được → thoát process,
// supervisor (index.js / botManager) tự khởi động lại + đăng nhập lại từ đầu
const CONNECT_FAIL_LIMIT = 3;
const WATCHDOG_INTERVAL = 30000;
// 30 phút không có frame nào MỚI coi là half-open (nhóm im lặng vài phút là bình thường)
const WATCHDOG_STALE_MS = 1800000;

function shouldReplayOldMessage(message, reconnectSince) {
  const rawTimestamp = Number(message?.data?.ts);
  if (!Number.isFinite(rawTimestamp) || rawTimestamp <= 0) return false;
  const timestamp = rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp;
  return timestamp >= reconnectSince - 5000;
}

function startListening(api) {
  if (!api?.listener?.on || !api.listener.start) {
    logger.log("API listener không hợp lệ.", "error");
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
  const onMessage = async (event) => {
    // allow_private_command: false → bỏ qua HOÀN TOÀN tin riêng (cả lệnh lẫn auto-reply)
    if (event.type === ThreadType.User && global.config.allow_private_command === false) {
      return;
    }

    // Tin do chính bot gửi: bỏ qua cache (không cần undo) nhưng vẫn xử lý lệnh
    // Mọi bước dưới đây đều phải cô lập lỗi: 1 plugin/module hỏng không được
    // chặn việc xử lý lệnh (complaint: "bot không phản hồi")
    try {
      if (!event.isSelf) updateMessageCache(event);
    } catch (err) {
      logger.log(`Lỗi updateMessageCache (bỏ qua): ${err.message}`, "warn");
    }

    // Panel chat: ghi tin vào bộ nhớ để panel xem/gửi tiếp
    try {
      panelBridge.recordIncoming(event);
    } catch { /* bỏ qua */ }

    // Prefetch the sender profile in the background. The lookup is single-flight
    // and TTL-cached, so repeated messages do not trigger repeated Zalo requests.
    if (!event.isSelf && event?.data?.uidFrom) {
      void getRequesterProfile(api, event).catch(() => {});
    }

    // Active groups are normally already cached. Use the synchronous cache
    // hit so a hot message can enter command parsing without an avoidable
    // Promise/microtask boundary; cold groups retain the safe async fallback.
    let threadData = null;
    try {
      threadData = Threads.getCachedData?.(event.threadId) || null;
      if (!threadData) threadData = await Threads.getData(event.threadId);
    } catch (err) {
      // DB (Supabase) hỏng / timeout → vẫn chạy lệnh với threadInfo rỗng
      logger.log(`Lỗi đọc dữ liệu nhóm ${event.threadId} (bỏ qua): ${err.message}`, "warn");
    }

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

    const dispatchMessageEvents = () => {
      if (threadInfo?.bot_enabled === false) return;
      try {
        handleEvent("message", event, api, event.isSelf === true);
      } catch (err) {
        logger.log(`Lỗi handleEvent message (bỏ qua): ${err.message}`, "warn");
      }
    };

    if (canRunCommand && typeof content === "string" && content.startsWith(prefix)) {
      // Start command parsing immediately. Passive event handlers run on the
      // next event-loop turn so they cannot delay the command hot path.
      Promise.resolve(handleCommand(content, event, api, threadInfo, prefix, threadData)).catch((err) => {
        logger.log(`Lỗi xử lý lệnh: ${err.message}`, "error");
      });
      if (threadInfo?.bot_enabled !== false) setImmediate(dispatchMessageEvents);
      return;
    }

    dispatchMessageEvents();

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

  const handleIncoming = (event) => {
    // Include groups that receive live messages while historical paging runs,
    // so their coverage status is finalized even if that group is absent from
    // the last history page returned by Zalo.
    if (topchatHistorySync?.active && event?.type === ThreadType.Group && event?.threadId) {
      topchatHistorySync.groups.add(String(event.threadId));
    }
    const cliMsgId = event?.data?.cliMsgId;
    if (cliMsgId && processedIds.has(cliMsgId)) return; // trùng lặp (server gửi lại / backfill)
    markProcessed(cliMsgId);

    // Daily Topchat counting is independent of bot_enabled and passive plugin
    // dispatch, so a disabled bot in a group still records that group's chat.
    if (event?.type === ThreadType.Group && !event?.isSelf) {
      const topchatCounter = require("../plugins/events/topchatCounter");
      void topchatCounter.run({ event, Threads, isSelf: false }).catch((err) => {
        logger.log(`Lỗi ghi thống kê Topchat: ${err.message}`, "warn");
      });
    }

    Promise.resolve(onMessage(event)).catch((err) => {
      logger.log(`Lỗi listener message: ${err.message}`, "error");
    });
  };

  listener.on("message", handleIncoming);

  // ===== Backfill: tin nhắn gửi lúc socket rớt =====
  // Tin lịch sử được cache nhưng không thực thi lại lệnh cũ.
  let reconnectSince = Date.now();
  let topchatHistorySync = null;

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
        if (message?.type === ThreadType.Group && message.threadId) {
          state.groups.add(String(message.threadId));
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
      const complete = [
        "day-boundary-reached",
        "history-exhausted",
        "empty-page"
      ].includes(page.reason);
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
      handleIncoming(message);
    }
  });

  // Cho phép event chỉ trong nhóm khi tắt chat riêng
  const allowPrivate = () => global.config.allow_private_command !== false;
  const skipPrivate = (event) => event.type === ThreadType.User && !allowPrivate();

  listener.on("group_event", (event) => {
    if (skipPrivate(event)) return;
    handleEvent("group_event", event, api, event.isSelf === true);
  });

  listener.on("reaction", (event) => {
    if (skipPrivate(event) || event.isSelf) return;
    handleEvent("reaction", event, api, event.isSelf === true);
  });

  listener.on("undo", (event) => {
    // Không xử lý undo của chính bot (tránh anti_undo tự đăng thông báo cho tin bot xoá)
    if (skipPrivate(event) || event.isSelf) return;
    handleEvent("undo", event, api, event.isSelf === true);
  });

  // ===== Tự kết nối lại: Zalo đóng WS (rớt mạng, đăng nhập lại, trùng kết nối)
  // là bot im lặng vĩnh viễn nếu không reconnect =====
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let connectFailStreak = 0;
  let lastFrameAt = 0;
  let connectingSince = 0;

  const connectListener = (reason) => {
    // connectListener chỉ chạy khi không có timer pending hoặc từ chính timer đã fired
    reconnectTimer = null;
    try {
      // retryOnClose: false → mọi lần đóng WS đều phát event "closed",
      // reconnect chỉ đi qua MỘT luồng duy nhất (tránh 2 WS đấu nhau)
      listener.start({ retryOnClose: false });
      connectingSince = Date.now();
      logger.log(`Đã bắt đầu lắng nghe sự kiện${reason ? ` (${reason})` : ""}`, "info");
    } catch (error) {
      reconnectAttempt += 1;
      const delay = Math.min(RECONNECT_BASE_DELAY * reconnectAttempt, RECONNECT_MAX_DELAY);
      logger.log(`Chưa kết nối được listener (${error.message}) — thử lại sau ${delay / 1000}s`, "warn");
      reconnectTimer = setTimeout(() => connectListener("tự kết nối lại"), delay);
    }
  };

  const scheduleReconnect = (reason) => {
    if (reconnectTimer) return;
    reconnectAttempt += 1;
    const delay = Math.min(RECONNECT_BASE_DELAY * reconnectAttempt, RECONNECT_MAX_DELAY);
    logger.log(`Listener đóng (${reason}) — kết nối lại sau ${delay / 1000}s`, "warn");
    reconnectTimer = setTimeout(() => connectListener("tự kết nối lại"), delay);
  };

  // Zalo emits "connected" as soon as the socket opens, before its cipher_key
  // frame arrives. History responses are encrypted, so requesting them here can
  // race the key handshake and make the initial Topchat backfill silently fail.
  const historyBootstrapGate = createCipherReadyGate(() => {
    logger.log("WebSocket đã cấp cipher key; bắt đầu đồng bộ lịch sử nhóm cho Topchat", "info");
    try {
      listener.requestOldMessages(ThreadType.User);
    } catch (error) {
      logger.log(`Không yêu cầu được tin nhắn riêng cũ: ${error.message}`, "warn");
    }
    try {
      startTopchatHistorySync();
    } catch (error) {
      logger.log(`Không thể bắt đầu đồng bộ lịch sử Topchat: ${error.message}`, "warn");
    }
  });

  // Backoff chỉ reset khi kết nối THẬT (start() thành công chỉ là tạo ws object)
  listener.on("connected", () => {
    reconnectAttempt = 0;
    connectFailStreak = 0;
    lastFrameAt = Date.now();
    connectingSince = 0;
    historyBootstrapGate.connected();
  });

  listener.on("disconnected", (code, reason) => {
    logger.log(`Listener mất kết nối (code ${code}) ${reason || ""}`, "warn");
  });

  listener.on("closed", (code) => {
    reconnectSince = Date.now();
    if (topchatHistorySync?.active) {
      void finishTopchatHistorySync(false, "connection-closed");
    }
    connectFailStreak += 1;
    if (connectFailStreak >= CONNECT_FAIL_LIMIT) {
      logger.log(`Listener rớt ${connectFailStreak} lần liên tiếp không kết nối lại được — khởi động lại tiến trình để đăng nhập lại`, "error");
      process.exit(2); // supervisor tự dựng lại (index.js restart code 2 / botManager autoRestart)
    }
    scheduleReconnect(`code ${code}`);
  });

  // Chỉ log lỗi WS — "error" không tự reconnect (tránh 2 luồng kết nối đấu nhau);
  // việc kết nối lại do event "closed" + watchdog đảm nhiệm
  listener.on("error", (error) => {
    logger.log(`Listener lỗi: ${error?.message || error}`, "error");
  });

  // Đánh dấu freshness cho watchdog (dùng cho cả message và cipher_key)
  const markAlive = () => { lastFrameAt = Date.now(); };
  listener.on("message", markAlive);
  listener.on("cipher_key", () => {\n    markAlive();\n    historyBootstrapGate.cipherReady();\n  });

  // Watchdog: chỉ dựa vào trạng thái socket THẬT — không coi "im lặng vài phút"
  // là chết (nhóm không ai nhắn thì bot vẫn sống, ép reconnect chỉ làm mất tin)
  const watchdog = setInterval(() => {
    const ws = listener.ws;
    const state = ws ? ws.readyState : -1;

    // OPEN → sống, thôi. Chỉ khi im lặng RẤT lâu (30 phút) mới coi là half-open
    if (state === 1) {
      connectingSince = 0;
      if (Date.now() - lastFrameAt < WATCHDOG_STALE_MS) return;
      logger.log("Watchdog: 30 phút không có frame nào — thử khôi phục kết nối", "warn");
    } else if (state === 0) {
      // CONNECTING: chỉ nhảy khi kẹt quá 90s
      if (!connectingSince) connectingSince = Date.now();
      if (Date.now() - connectingSince < 90000) return;
      logger.log("Watchdog: kẹt kết nối quá 90s — buộc thử lại", "warn");
    } else if (reconnectTimer) {
      return; // đã có lịch reconnect
    } else {
      logger.log(`Watchdog: socket state=${state} — buộc kết nối lại`, "warn");
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
module.exports.shouldReplayOldMessage = shouldReplayOldMessage;
