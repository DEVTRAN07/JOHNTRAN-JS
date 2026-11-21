const http = require("http");
const fs = require("fs");
const path = require("path");
const { isPanelRequestAuthorized } = require("../utils/tokenSecurity");
const { monitorEventLoopDelay } = require("node:perf_hooks");

// Observe Node event-loop pressure so CPU-bound work and blocking callbacks
// can be distinguished from Zalo/HTTP network latency in protected metrics.
const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
let eventLoopMonitorEnabled = false;

function enableEventLoopMonitor() {
  if (eventLoopMonitorEnabled) return;
  eventLoopHistogram.enable();
  eventLoopMonitorEnabled = true;
}

const START_TIME = Date.now();

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function getSupabaseStatus() {
  try {
    const { db } = require("../utils/db");
    return db && typeof db.getStatus === "function" ? db.getStatus() : (db?.db?.getStatus?.() || undefined);
  } catch {
    return undefined;
  }
}

function healthPayload() {
  return {
    status: "ok",
    bot: global.config?.name_bot || "bot",
    loggedIn: Boolean(global.api),
    commands: safe(() => global.client?.commands?.size, 0),
    events: safe(() => global.client?.events?.size, 0),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    node: process.version,
    startedAt: new Date(START_TIME).toISOString(),
    supabase: getSupabaseStatus()
  };
}

function getEventLoopMetrics(options = {}) {
  // Detailed event-loop sampling is only needed when metrics are queried.
  // Keep the normal bot hot path free from a permanently enabled histogram.
  enableEventLoopMonitor();
  const toMs = value => Number.isFinite(value) ? Number((value / 1e6).toFixed(2)) : 0;
  const snapshot = {
    minMs: toMs(eventLoopHistogram.min),
    maxMs: toMs(eventLoopHistogram.max),
    meanMs: toMs(eventLoopHistogram.mean),
    p95Ms: toMs(eventLoopHistogram.percentile(95)),
    p99Ms: toMs(eventLoopHistogram.percentile(99))
  };
  if (options.reset !== false) eventLoopHistogram.reset();
  return snapshot;
}

function speedPayload() {
  const metrics = safe(() => require("./metrics"), null);
  const jobQueue = safe(() => require("./jobQueue"), null);
  const workerPool = safe(() => require("./workerPool"), null);
  const mediaLimits = safe(() => require("./mediaResourceLimits"), null);
  return {
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    eventLoop: safe(() => getEventLoopMetrics({ reset: false }), null),
    firstResponseStartLatency: safe(() => metrics?.getFirstResponseStartLatencyStats?.(), null),
    firstResponseStartByCommand: safe(() => metrics?.getFirstResponseStartLatencyByCommandStats?.(10), []),
    firstResponseLatency: safe(() => metrics?.getFirstResponseLatencyStats?.(), null),
    firstResponseByCommand: safe(() => metrics?.getFirstResponseLatencyByCommandStats?.(10), []),
    listenerStageLatency: safe(() => metrics?.getListenerStageLatencyStats?.(20), []),
    commandLatency: safe(() => metrics?.getCommandLatencyStats?.(10), []),
    commandExecutionLatency: safe(() => metrics?.getCommandExecutionLatencyStats?.(10), []),
    zaloApiLatency: safe(() => metrics?.getZaloApiLatencyStats?.(10), []),
    httpTransport: safe(() => require("./http/transport").getZaloHttpTransportStats(), null),
    requestPolicy: safe(() => ({
      zalo: require("./http/requestPolicy").resolveRequestPolicy(
        process.env, global.config?.zalo_client_config?.retry || {}, "JT_ZALO_API"
      ),
      external: require("./http/requestPolicy").resolveRequestPolicy(process.env, {}, "JT_HTTP")
    }), null),
    jobQueues: safe(() => jobQueue?.stats?.(), {}),
    workers: safe(() => require("./workerPool").stats(), {}),
    mediaResources: safe(() => ({
      availableCpus: mediaLimits?.getAvailableCpuCount?.() || null,
      ffmpegThreads: mediaLimits?.FFMPEG_THREADS || null,
      workerPoolMaxSize: workerPool?.DEFAULT_POOL_SIZE || null,
      globalJobConcurrency: jobQueue?.GLOBAL_CONCURRENCY || null,
      defaultGlobalJobConcurrency: jobQueue?.DEFAULT_GLOBAL_CONCURRENCY || null,
      stickerConcurrency: jobQueue?.STICKER_CONCURRENCY || null,
      downloadConcurrency: jobQueue?.DOWNLOAD_CONCURRENCY || null
    }), null),
    topchat: safe(() => require("../plugins/events/topchatCounter").getStats(), {})
  };
}

function metricsPayload() {
  const metrics = safe(() => require("./metrics"), null);
  const { allStats } = safe(() => require("./cache"), { allStats: () => ({}) });
  const jobQueues = safe(() => require("./jobQueue").stats(), {});
  const workers = safe(() => require("./workerPool").stats(), {});
  const messageCache = safe(() => require("../utils/messageCache").getMessageCacheStats(), {});
  return {
    ...healthPayload(),
    today: safe(() => metrics?.getDayStats(), null),
    topCommands: safe(() => metrics?.topCommands(), []),
    // These in-memory samples already exist; expose them so operations can
    // identify which commands and handlers dominate P95 latency.
    pipelineLatency: safe(() => metrics?.getLatencyStats?.(), null),
    commandLatency: safe(() => metrics?.getCommandLatencyStats?.(15), []),
    commandExecutionLatency: safe(() => metrics?.getCommandExecutionLatencyStats?.(15), []),
    firstResponseStartLatency: safe(() => metrics?.getFirstResponseStartLatencyStats?.(), null),
    firstResponseStartByCommand: safe(() => metrics?.getFirstResponseStartLatencyByCommandStats?.(20), []),
    firstResponseLatency: safe(() => metrics?.getFirstResponseLatencyStats?.(), null),
    firstResponseByCommand: safe(() => metrics?.getFirstResponseLatencyByCommandStats?.(20), []),
    listenerStageLatency: safe(() => metrics?.getListenerStageLatencyStats?.(20), []),
    zaloApiLatency: safe(() => metrics?.getZaloApiLatencyStats?.(20), []),
    eventLoop: safe(getEventLoopMetrics, null),
    jobQueues,
    workers,
    topchat: safe(() => require("../plugins/events/topchatCounter").getStats(), {}),
    messageCache,
    cache: allStats(),
    // Error details are only exposed by the existing Bearer-protected
    // /metrics route. The journal redacts credentials before persistence.
    recentErrors: safe(() => require("./runtime/errorJournal").snapshot(20), null)
  };
}

function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const sendJson = (status, payload) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(payload));
  };

  switch (url.pathname) {
    case "/":
    case "/health":
    case "/healthz":
      // luôn 200: endpoint này để UptimeRobot giữ service thức (Render free),
      // trạng thái đăng nhập nằm trong JSON chứ không làm fail monitor
      return sendJson(200, { ...healthPayload(), status: global.api ? "ok" : "starting" });
    case "/ping":
      return sendJson(200, { pong: true });
    case "/speed":
      // Only aggregate timings and bounded queue counters are public. No chat
      // content, user IDs, command arguments, tokens or database credentials.
      return sendJson(200, speedPayload());
    case "/metrics": {
      // Health stays public for uptime monitors; detailed operational metrics
      // require the same Panel Bearer Token used by the management API.
      const token = String(global.config?.panel?.token || process.env.JT_PANEL__TOKEN || "").trim();
      if (!isPanelRequestAuthorized(req, token, "0.0.0.0")) {
        return sendJson(401, { error: "Unauthorized: cần Authorization: Bearer <panel-token>" });
      }
      return sendJson(200, metricsPayload());
    }
    default:
      return sendJson(404, { error: "not found", endpoints: ["/health", "/ping", "/speed", "/metrics"] });
  }
}

/**
 * Health server cho cloud platform (Render/Koyeb/Heroku/Railway...):
 * - PORT env → tự bật, không cần config (bắt buộc trên Render free để chống sleep)
 * - Kết hợp UptimeRobot ping /health mỗi 5 phút → service không bao giờ sleep
 * Trả về JSON, không phụ thuộc express.
 */
function startHealthServer() {
  const panel = global.config?.panel || {};
  const configuredPort = global.config?.health_port;
  const port = Number(process.env.PORT) || (configuredPort ? Number(configuredPort) : 8000);

  // panel đang chiếm port này rồi thì thôi (panel đã có /health riêng)
  if (panel.enabled && Number(panel.port) === port) {
    console.log("[health] Panel đã dùng port này — health do panel phục vụ");
    return null;
  }

  const server = http.createServer(requestHandler);
  server.listen(port, "0.0.0.0", () => {
    console.log(`[health] Health server đang chạy tại port ${port} (GET /health)`);
  });
  server.on("error", (error) => {
    console.log(`[health] Không thể mở port ${port}: ${error.message}`);
  });
  return server;
}

module.exports = { startHealthServer, healthPayload, requestHandler, getEventLoopMetrics, speedPayload };
