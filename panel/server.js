const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { botPaths } = require("./botManager");
const { assertPanelToken, isPanelRequestAuthorized } = require("../utils/tokenSecurity");
const { installMonitoring, httpMetricsMiddleware, register } = require("../core/monitoring");
let dbUtils, storeDb;
try { dbUtils = require("../utils/db"); storeDb = dbUtils.db || dbUtils; } catch { dbUtils = null; storeDb = null; }

function maybeSyncStore() {
  if (storeDb && typeof storeDb.sync === "function" && Date.now() - (storeDb.lastSyncAt || 0) > 15000) {
    storeDb.sync().catch(() => {});
  }
}

// ===== Đọc danh sách lệnh trực tiếp từ file (process panel không có global.client) =====
const COMMANDS_DIR = path.resolve(__dirname, "..", "plugins", "commands");

function loadCommandsFromFiles(config) {
  const commands = [];
  let files = [];
  try { files = fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith(".js")); } catch { return commands; }

  const previousConfig = global.config;
  global.config = config || {}; // một số lệnh đọc global.config lúc load
  try {
    for (const file of files) {
      try {
        const mod = require(path.join(COMMANDS_DIR, file));
        const cfg = mod?.config;
        if (!cfg?.name) continue;
        commands.push({
          name: cfg.name,
          aliases: cfg.aliases || [],
          description: cfg.description || "",
          category: cfg.category || "Khác",
          role: cfg.role || 0,
          usage: cfg.usage || cfg.name,
          cooldowns: cfg.cooldowns || 0,
          requires: Array.isArray(cfg.requires) ? cfg.requires : []
        });
      } catch { /* lệnh hỏng không được làm hỏng danh sách */ }
    }
  } finally {
    global.config = previousConfig;
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

function commandStatusFromFiles(config) {
  const audit = require("../core/commands/audit");
  return loadCommandsFromFiles(config).map((cmd) => audit.commandStatus(cmd.name, cmd));
}

const BOTSTATS_FRESH_MS = 90000;

function botStatUpdatedAtMs(row) {
  if (!row) return 0;
  const v = row.updatedAt != null ? row.updatedAt : row.updated_at;
  if (v == null) return 0;
  return Date.parse(String(v)) || Number(v) || 0;
}
function isBotStatFresh(row) {
  return botStatUpdatedAtMs(row) > Date.now() - BOTSTATS_FRESH_MS;
}
function findBotStatsRow(botName) {
  // 1) Ưu tiên store master (Supabase hoac store.json chung cua panel).
  if (storeDb) {
    try {
      const rows = storeDb.allData("BotStats");
      for (const row of rows || []) {
        const key = row?.name || row?.id;
        if (!key || key === "soundcloud_client_id") continue;
        if (key === botName) return row;
      }
    } catch { /* BotStats/Supabase unavailable */ }
  }
  // 2) Fallback an toàn: bot con (panel-child mode) ghi BotStats vào
  //    bots/<name>/store.json (JT_DB_FILE) — panel master không cùng file,
  //    nên đọc trực tiếp file JSON đó để lấy loginState/loginMessage.
  //    KHÔNG dùng chung JsonStore (nguy cơ concurrent writer).
  try {
    const childDbFile = botPaths(botName).dbFile;
    if (childDbFile && fs.existsSync(childDbFile)) {
      const raw = fs.readFileSync(childDbFile, "utf8");
      const parsed = JSON.parse(raw);
      const table = parsed?.BotStats;
      if (table && typeof table === "object") {
        const keys = Object.keys(table);
        for (const key of keys) {
          if (key === "soundcloud_client_id") continue;
          if (key === botName) {
            const rec = table[key];
            return rec?.data != null
              ? { name: key, data: rec.data, updatedAt: rec.updatedAt }
              : { name: key, data: rec, updatedAt: rec.updatedAt };
          }
        }
      }
    }
  } catch { /* child store unavailable/corrupt — bỏ qua */ }
  return null;
}
function enrichBot(bot) {
  const out = { ...bot };
  let loginState = out.loginState || null;
  const row = findBotStatsRow(out.name);
  const stats = row ? (row.data || row) : null;
  if (stats) {
    if (stats.loginState != null) loginState = stats.loginState;
    else if (!loginState && out.processStatus === "online" && stats.status === "online" && isBotStatFresh(stats)) {
      loginState = "logged_in";
    }
  }
  out.loginState = loginState;
  // Lấy tên/ảnh đại diện thật của tài khoản Zalo từ snapshot thống kê của bot.
  // Tên registry (ví dụ "main") chỉ là ID nội bộ, không phải tên hiển thị.
  const profile = stats?.profile && typeof stats.profile === "object" ? stats.profile : {};
  out.displayName = String(profile.displayName || profile.zaloName || out.name || "Bot");
  out.avatar = String(profile.avatar || "");
  out.uid = String(profile.uid || "");
  // Gợi ý lưu phiên (không chứa secrets) để Render redeploy không cần quét QR.
  if (loginState === "logged_in") {
    out.sessionHint = "Bot đã đăng nhập Zalo. Để không quét QR lại khi redeploy: set env JT_ACCOUNT_JSON và JT_COOKIE_JSON (Secret Text) từ phiên này trên Render Dashboard → Shell. Xem chi tiết nút 🔑 Phiên đăng nhập.";
  }
  const waiting = ["qr_pending","qr_scanned","cookie_login","starting","waiting_login","unknown"];
  let displayStatus;
  if (loginState === "logged_in") displayStatus = "online";
  else if (waiting.includes(loginState)) displayStatus = loginState;
  else if (loginState === "failed") displayStatus = "failed";
  else displayStatus = out.processStatus === "online" ? "waiting_login" : out.processStatus;
  out.status = displayStatus;
  out.displayStatus = displayStatus;
  return out;
}

function startPanel({ manager, config }) {
  const token = String(config?.panel?.token || process.env.JT_PANEL__TOKEN || "").trim();
  const port = Number(process.env.PORT) || Number(config?.panel?.port) || 3000;
  const host = config?.panel?.host || "0.0.0.0";
  assertPanelToken(token, host);

  // Bridge sử dụng secret riêng, không dùng lại token đăng nhập dashboard.
  let bridgeToken = config?.panel?.bridge_token || process.env.JT_BRIDGE_TOKEN || "";
  if (!bridgeToken) bridgeToken = crypto.randomBytes(32).toString("hex");
  if (manager && typeof manager.setBridgeToken === "function") {
    manager.setBridgeToken(bridgeToken);
  }
  // Koyeb/Railway inject PORT — panel phải bind đúng port đó để health check + routing

  const server = http.createServer(async (req, res) => {
    const trackHttp = httpMetricsMiddleware();
    await new Promise((resolve) => trackHttp(req, res, resolve));
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      // CORS chỉ mở cho những dashboard origin do chủ bot cấu hình.
      const origin = req.headers.origin || "";
      const allowedOrigins = Array.isArray(config?.panel?.allowed_origins) ? config.panel.allowed_origins : [];
      res.setHeader("Vary", "Origin");
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
      }
      if (req.method === "OPTIONS") {
        if (origin && !allowedOrigins.includes(origin)) return sendJson(res, 403, { error: "Origin chưa được cho phép trong panel.allowed_origins" });
        res.writeHead(204);
        return res.end();
      }

      // API, QR và metrics đều được bảo vệ. /health và tài nguyên giao diện tĩnh
      // giữ public để health-check/deploy không bị phá vỡ.
      const protectedPath = pathname === "/metrics" || pathname === "/qr" || pathname === "/qr.png"
        || pathname.startsWith("/qr/") || pathname === "/api" || pathname.startsWith("/api/");
      if (protectedPath && !isPanelRequestAuthorized(req, token, host)) {
        res.setHeader("Cache-Control", "no-store");
        return sendJson(res, 401, { error: "Unauthorized: cần Authorization: Bearer <panel-token>" });
      }

      // Prometheus metrics không công khai.
      if (req.method === "GET" && pathname === "/metrics") {
        const body = await register.metrics();
        res.writeHead(200, { "Content-Type": register.contentType, "Cache-Control": "no-store" });
        return res.end(body);
      }

      // QR endpoint cũng yêu cầu Bearer token; không còn URL public chứa QR session.
      if (req.method === "GET" && (pathname === "/qr" || pathname === "/qr.png" || pathname.startsWith("/qr/"))) {
        let botName = url.searchParams.get("bot") || "main";
        if (pathname.startsWith("/qr/")) {
          botName = pathname.slice("/qr/".length).replace(/\.png$/i, "") || botName;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(botName)) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ error: "Tên bot không hợp lệ" }));
        }
        const qrFile = botPaths(botName).qrFile;
        if (!fs.existsSync(qrFile)) {
          const body = `<!doctype html><meta charset="utf-8"><title>QR chưa sẵn sàng</title><body style="font-family:system-ui;padding:24px"><h2>Chưa có QR đăng nhập</h2><p>Bot <b>${botName}</b> chưa tạo QR hoặc đã đăng nhập. Nếu bạn vừa deploy, đợi bot khởi động rồi tải lại trang <code>/qr</code>.</p></body>`;
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          return res.end(body);
        }
        const buffer = fs.readFileSync(qrFile);
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
        return res.end(buffer);
      }

      // Panel UI tĩnh (docs/) — xử lý trước mọi route API
      if (!pathname.startsWith("/api") && serveStatic(pathname, res)) return;

      // ===== DHBC Question Bank API (đã được bảo vệ bằng Panel Bearer token) =====
      if (pathname === "/api/dhbc/questions" || pathname.startsWith("/api/dhbc/questions/")) {
        const bank = require("../core/games/dhbcBank");
        if (req.method === "GET" && pathname === "/api/dhbc/questions") {
          const questions = bank.getAll();
          return sendJson(res, 200, {
            success: true, total: questions.length,
            source: fs.existsSync(bank.FILE) ? "persistent-json" : "built-in-fallback",
            questions
          });
        }
        if (req.method === "POST" && pathname === "/api/dhbc/questions") {
          const body = await readBody(req);
          const questions = bank.add(body);
          return sendJson(res, 201, { success: true, total: questions.length, question: questions[questions.length - 1] });
        }
        const questionMatch = pathname.match(/^\/api\/dhbc\/questions\/([a-z0-9-]+)$/);
        if (questionMatch && req.method === "PATCH") {
          const body = await readBody(req);
          const questions = bank.update(questionMatch[1], body);
          return sendJson(res, 200, { success: true, total: questions.length, question: questions.find((q) => q.id === questionMatch[1]) });
        }
        if (questionMatch && req.method === "DELETE") {
          const removed = bank.remove(questionMatch[1]);
          return removed
            ? sendJson(res, 200, { success: true, removed: questionMatch[1], total: bank.getAll().length })
            : sendJson(res, 404, { error: "Không tìm thấy câu hỏi" });
        }
        return sendJson(res, 405, { error: "Method không hỗ trợ" });
      }

      if (pathname === "/api/bots" && req.method === "GET") {
        maybeSyncStore();
        const bots = manager.list().map(enrichBot);
        return sendJson(res, 200, { bots, master: { botCount: bots.length, uptimeMs: process.uptime() * 1000 } });
      }

      if (pathname === "/api/metrics" && req.method === "GET") {
        maybeSyncStore();
        try {
          const metrics = require("../core/metrics");
          const { allStats } = require("../core/cache");
          let supabaseStatus = null;
          try { supabaseStatus = storeDb && typeof storeDb.getStatus === "function" ? storeDb.getStatus() : null; } catch { supabaseStatus = null; }
          return sendJson(res, 200, {
            today: metrics.getDayStats(),
            topCommands: metrics.topCommands(),
            cache: allStats(),
            audit: metrics.readAudit(20),
            node: process.version,
            uptimeMs: process.uptime() * 1000,
            memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            supabase: supabaseStatus
          });
        } catch (error) {
          return sendJson(res, 500, { error: error.message });
        }
      }

      // Endpoint cũ không còn được dùng: cấu hình lệnh phải chạy trong đúng
      // tiến trình bot con để không truy cập nhầm global.client của master.
      if (/^\/api\/groups\/[^/]+\/commands$/.test(pathname)) {
        return sendJson(res, 410, {
          error: "API cũ đã ngừng. Hãy dùng /api/chat/:bot/group-commands?gid=:groupId"
        });
      }

      if (pathname === "/api/stats" && req.method === "GET") {
        maybeSyncStore();
        try {
          const db = require("../utils/db");
          const stats = {};
          // Đọc cả store dùng chung lẫn store riêng của từng bot con.
          // findBotStatsRow ưu tiên DB master và fallback an toàn sang
          // bots/<name>/store.json, không mở JsonStore thứ hai trên cùng file.
          for (const row of db.allData("BotStats") || []) {
            const key = row?.name || row?.id;
            if (!key || key === "soundcloud_client_id") continue;
            stats[key] = row.data || {};
          }
          for (const bot of manager.list()) {
            const row = findBotStatsRow(bot.name);
            const data = row ? (row.data || row) : {};
            stats[bot.name] = {
              ...data,
              updatedAt: data.updatedAt || row?.updatedAt || row?.updated_at || null,
              loginState: data.loginState || enrichBot(bot).loginState || null,
              processStatus: bot.processStatus || bot.status
            };
          }
          return sendJson(res, 200, { stats, bots: manager.list().map(enrichBot) });
        } catch (error) {
          return sendJson(res, 500, { error: error.message });
        }
      }

      // ===== Quản lý lệnh =====
      if (pathname === "/api/commands" && req.method === "GET") {
        try {
          // Dùng chính bộ phân loại được /menu sử dụng để Panel và Zalo
          // luôn có cùng thư mục, không phụ thuộc category nội bộ cũ.
          const commands = loadCommandsFromFiles(config);
          const menu = require("../core/runtime/folderMenu");
          const folders = menu.MENU_GROUPS.map(folder => {
            const items = commands.filter(command =>
              menu.menuGroupForCommand({ config: command }) === folder.slug
            );
            return { ...folder, count: items.length, commands: items };
          }).filter(folder => folder.count > 0);
          return sendJson(res, 200, {
            commands, folders, total: commands.length, folderCount: folders.length
          });
        } catch (error) {
          return sendJson(res, 500, { error: error.message });
        }
      }

      if (pathname === "/api/commands/status" && req.method === "GET") {
        try {
          const audit = require("../core/commands/audit");
          const list = audit.getAllCommandStatus()?.length
            ? audit.getAllCommandStatus()
            : commandStatusFromFiles(config);
          return sendJson(res, 200, { ...audit.summarize(list), commands: list });
        } catch (error) {
          return sendJson(res, 500, { error: error.message });
        }
      }

      // ===== CHAT (Zalo thu nhỏ): proxy sang cầu nối localhost của bot =====
      if (pathname.startsWith("/api/chat")) {
        const match = pathname.match(/^\/api\/chat\/([a-zA-Z0-9_-]+)\/(threads|messages|health|thread-info|user-info|action|admin-groups|toggle-admin-group|group-commands)$/);
        const sendMatch = pathname.match(/^\/api\/chat\/([a-zA-Z0-9_-]+)\/send$/);
        const botName = match?.[1] || sendMatch?.[1];
        if (!botName) return sendJson(res, 400, { error: "Thiếu tên bot" });
        const rawBot = manager.list().find((b) => b.name === botName);
        if (!rawBot?.bridgePort) return sendJson(res, 404, { error: "Chưa biết cổng cầu nối của bot" });
        const bot = enrichBot(rawBot);
        if (bot.loginState !== "logged_in") {
          return sendJson(res, 409, { error: `Bot "${botName}" chưa đăng nhập Zalo — đang chờ quét QR`, loginState: bot.loginState, requireLogin: true });
        }

        const route = match?.[2] || "send"; // bot bridge route
        let target = `http://127.0.0.1:${bot.bridgePort}/${route}`;
        // Giữ query string cho cả GET lẫn POST (gid là bắt buộc khi sửa lệnh nhóm).
        if (url.search) target += url.search;

        const proxyReq = http.request(target, {
          method: req.method,
          headers: { "x-bridge-token": bridgeToken }
        }, (proxyRes) => {
          let body = "";
          proxyRes.on("data", (c) => { body += c; });
          proxyRes.on("end", () => {
            res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json; charset=utf-8" });
            res.end(body);
          });
        });
        proxyReq.on("error", (error) => {
          sendJson(res, 502, { error: `Không gọi được bot (${error.message})` });
        });
        if (req.method === "POST") {
          req.pipe(proxyReq);
        } else {
          proxyReq.end();
        }
        return;
      }

      if (pathname === "/api/master" && req.method === "GET") {
        maybeSyncStore();
        let supabaseStatus = null;
        try { supabaseStatus = storeDb && typeof storeDb.getStatus === "function" ? storeDb.getStatus() : null; } catch { supabaseStatus = null; }
        return sendJson(res, 200, {
          botCount: manager.list().length,          uptimeMs: process.uptime() * 1000,
          node: process.version, supabase: supabaseStatus
        });
      }

      // health endpoint cho UptimeRobot / cloud monitor ping (luôn 200 để chống sleep)
      if (pathname === "/health" && req.method === "GET") {
        maybeSyncStore();
        let supabaseStatus = null;
        try { supabaseStatus = storeDb && typeof storeDb.getStatus === "function" ? storeDb.getStatus() : null; } catch { supabaseStatus = null; }
        return sendJson(res, 200, {
          status: global.api ? "ok" : "starting",
          bot: global.config?.name_bot || "bot",
          loggedIn: Boolean(global.api),
          commands: global.client?.commands?.size || 0,
          uptimeMs: process.uptime() * 1000,
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          node: process.version, supabase: supabaseStatus
        });
      }

      if (pathname === "/api/bots" && req.method === "POST") {
        const body = await readBody(req);
        const bot = manager.create(body.name, { autoRestart: body.autoRestart !== false });
        return sendJson(res, 201, { bot: bot.toJSON() });
      }

      const match = pathname.match(/^\/api\/bots\/([a-zA-Z0-9_-]+)(\/(start|stop|restart|logs|qr))?$/);
      if (match) {
        const name = match[1];
        const action = match[2];
        const bot = manager.get(name);
        if (!bot) return sendJson(res, 404, { error: `Bot '${name}' không tồn tại` });

        if (!action) {
          if (req.method === "DELETE") {
            await manager.remove(name);
            return sendJson(res, 200, { removed: name });
          }
          if (req.method === "PATCH" || req.method === "PUT") {
            const body = await readBody(req);
            if (typeof body.autoRestart === "boolean") {
              manager.setAutoRestart(name, body.autoRestart);
              return sendJson(res, 200, { bot: manager.get(name).toJSON() });
            }
            return sendJson(res, 400, { error: "Thiếu trường autoRestart (boolean)" });
          }
          return sendJson(res, 200, { bot: bot.toJSON() });
        }

        switch (action.slice(1)) {
          case "start": {
            const pid = bot.start();
            return sendJson(res, 200, { pid });
          }
          case "stop":
            await bot.stop();
            return sendJson(res, 200, { stopped: true });
          case "restart": {
            const pid = await bot.restart();
            return sendJson(res, 200, { pid });
          }
          case "logs": {
            const limit = Math.min(Number(url.searchParams.get("lines")) || MAX_LOG, 500);
            return sendJson(res, 200, { logs: bot.logs.slice(-limit) });
          }
          case "qr": {
            const qrFile = botPaths(name).qrFile;
            const bot = manager.get(name);
            const hasQr = fs.existsSync(qrFile);
            if (!hasQr) {
              const json = { error: "Chưa có QR (bot chưa chạy hoặc đã đăng nhập)", hasQr: false };
              if (bot) {
                const enriched = enrichBot(bot.toJSON());
                if (enriched.loginState) json.loginState = enriched.loginState;
                if (enriched.status === "failed") json.reason = "Đăng nhập thất bại";
              }
              return sendJson(res, 404, json);
            }
            const buffer = fs.readFileSync(qrFile);
            res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
            return res.end(buffer);
          }
        }
      }


      // ===== Phiên đăng nhập (an toàn, không lộ secrets) =====
      // Dùng để panel/UI hướng dẫn lưu phiên cho Render redeploy.
      // CHỈ trả về metadata (tồn tại file, hình dạng hợp lệ) — KHÔNG trả
      // JT_ACCOUNT_JSON / JT_COOKIE_JSON / cookie / imei / token.
      const sessMatch = pathname.match(/^\/api\/bots\/([a-zA-Z0-9_-]+)\/session$/);
      if (sessMatch) {
        const name = sessMatch[1];
        const paths = botPaths(name);
        const enriched = enrichBot(manager.get(name)?.toJSON() || { name, status: "offline" });
        const hasAccount = fs.existsSync(paths.accountFile);
        const cookiePath = path.join(paths.dir, "cookie.json");
        const hasCookie = fs.existsSync(cookiePath);
        let cookieLooksValid = false;
        if (hasCookie) {
          try {
            const ck = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
            if (ck && (Array.isArray(ck) ? ck.length : Object.keys(ck).length)) cookieLooksValid = true;
          } catch { /* ignore */ }
        }
        return sendJson(res, 200, {
          name,
          loginState: enriched.loginState || null,
          status: enriched.status || null,
          hasAccountFile: hasAccount,
          hasCookieFile: hasCookie,
          cookieLooksValidShape: cookieLooksValid,
          accountPathRelative: path.relative(ROOT, paths.accountFile),
          cookiePathRelative: path.relative(ROOT, cookiePath),
          dbPathRelative: path.relative(ROOT, paths.dbFile),
          updatedAt: botStatUpdatedAtMs(findBotStatsRow(name)) || null
        });
      }

      sendJson(res, 404, { error: "Không tìm thấy endpoint" });
    } catch (error) {
      sendJson(res, Number.isInteger(error?.statusCode) ? error.statusCode : 500, {
        error: error?.statusCode === 413 ? "Payload quá lớn" : error.message
      });
    }
  });

  installMonitoring(server);

  server.listen(port, host, () => {
    console.log(`[panel] Panel quản lý đang chạy: http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`);
  });

  return server;
}

const MAX_LOG = 300;
const MAX_BODY_BYTES = 1024 * 1024;

async function readBody(req, maxBytes = MAX_BODY_BYTES) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_BODY_BYTES;
  const chunks = [];
  let totalBytes = 0;
  let exceededLimit = false;

  // Continue draining the request after the limit is crossed, but never retain
  // additional payload data in memory.
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > limit) {
      exceededLimit = true;
      continue;
    }
    if (!exceededLimit) chunks.push(buffer);
  }

  if (exceededLimit) {
    const error = new Error("Payload quá lớn");
    error.statusCode = 413;
    throw error;
  }

  const raw = Buffer.concat(chunks, totalBytes).toString("utf8");
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("JSON không hợp lệ");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}


// Serve panel UI (docs/) trực tiếp từ host bot — không cần GitHub Pages
const STATIC_FILES = { "/": "panel.html", "/panel": "panel.html", "/panel.html": "panel.html", "/status": "index.html", "/index.html": "index.html", "/panel.v4.css": "panel.v4.css" };
function serveStatic(pathname, res) {
  const docDir = path.resolve(__dirname, "..", "docs");
  let filePath = null;
  if (STATIC_FILES[pathname]) filePath = path.join(docDir, STATIC_FILES[pathname]);
  else if (/^\/(panel\.(css|js)|index\.html)$/.test(pathname)) filePath = path.join(docDir, pathname.slice(1));
  if (!filePath) return false;
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  });
  return true;
}

module.exports = { startPanel, readBody, MAX_BODY_BYTES };
