const http = require("http");
const fs = require("fs");
const path = require("path");

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

function metricsPayload() {
  const metrics = safe(() => require("./metrics"), null);
  const { allStats } = safe(() => require("./cache"), { allStats: () => ({}) });
  return {
    ...healthPayload(),
    today: safe(() => metrics?.getDayStats(), null),
    topCommands: safe(() => metrics?.topCommands(), []),
    pipelineLatency: safe(() => metrics?.getLatencyStats?.(), null),
    cache: allStats()
  };
}

function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const sendJson = (status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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
    case "/metrics":
      return sendJson(200, metricsPayload());
    default:
      return sendJson(404, { error: "not found", endpoints: ["/health", "/ping", "/metrics"] });
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

module.exports = { startHealthServer, healthPayload, requestHandler };
