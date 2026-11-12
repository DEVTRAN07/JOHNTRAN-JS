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

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ᴶᴼᴴᴺ ᵀᴿᴬᴺ • Bot Panel</title>
<style>
  :root {
    --bg: #0b0e14; --bg2: #131a26; --card: #121826; --border: #1f2a3a;
    --accent: #00d9ff; --accent2: #7c5cff; --text: #eef2f8; --sub: #8b98ad;
    --green: #22c55e; --red: #f43f5e; --yellow: #f59e0b;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  header { background: linear-gradient(135deg, var(--bg2), var(--bg)); border-bottom: 1px solid var(--border); padding: 18px 28px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: 1px; background: linear-gradient(90deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .meta { color: var(--sub); font-size: 13px; display: flex; gap: 18px; flex-wrap: wrap; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .toolbar { display: flex; gap: 12px; margin-bottom: 22px; flex-wrap: wrap; }
  button, input { font: inherit; border-radius: 10px; border: 1px solid var(--border); }
  button { background: var(--card); color: var(--text); padding: 10px 18px; cursor: pointer; transition: .15s; font-weight: 600; }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.primary { background: linear-gradient(90deg, var(--accent), var(--accent2)); color: #06121a; border: none; }
  button.danger:hover { border-color: var(--red); color: var(--red); }
  input { background: var(--bg); color: var(--text); padding: 10px 14px; outline: none; min-width: 220px; }
  input:focus { border-color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 18px; }
  .bot { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; }
  .bot h3 { font-size: 18px; display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--sub); }
  .dot.online { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .dot.offline { background: var(--sub); }
  .dot.stopped { background: var(--red); }
  .dot.restarting { background: var(--yellow); animation: pulse 1s infinite; }
  .dot.qr_wait { background: var(--yellow); box-shadow: 0 0 8px var(--yellow); animation: pulse 1.2s infinite; }
  @keyframes pulse { 50% { opacity: .3; } }
  .bot .sub { color: var(--sub); font-size: 13px; margin-bottom: 14px; }
  .bot .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .bot .actions button { padding: 7px 12px; font-size: 13px; }
  .badge { font-size: 11px; padding: 3px 9px; border-radius: 20px; background: var(--bg); border: 1px solid var(--border); color: var(--sub); }
  .badge.on { color: var(--green); border-color: var(--green); }
  .badge.off { color: var(--red); border-color: var(--red); }
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,.7); display: none; align-items: center; justify-content: center; z-index: 10; padding: 20px; }
  .modal.open { display: flex; }
  .modal-box { background: var(--card); border: 1px solid var(--border); border-radius: 16px; width: 100%; max-width: 760px; max-height: 84vh; display: flex; flex-direction: column; }
  .modal-box header { border: none; border-bottom: 1px solid var(--border); padding: 14px 20px; }
  .modal-body { padding: 20px; overflow: auto; }
  pre.logs { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; max-height: 50vh; overflow: auto; color: #c9d6e8; }
  .qr-box { text-align: center; }
  .qr-box img { max-width: 280px; border-radius: 12px; background: #fff; padding: 8px; }
  .empty { color: var(--sub); text-align: center; padding: 60px 0; grid-column: 1/-1; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 22px; }
  .metric { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 14px 18px; }
  .metric b { display: block; font-size: 24px; background: linear-gradient(90deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .metric span { color: var(--sub); font-size: 12px; }
  .toast { position: fixed; bottom: 24px; right: 24px; background: var(--card); border: 1px solid var(--accent); color: var(--text); padding: 12px 20px; border-radius: 12px; transform: translateY(80px); opacity: 0; transition: .25s; z-index: 20; }
  .toast.show { transform: none; opacity: 1; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  small { color: var(--sub); }
</style>
</head>
<body>
<header>
  <div class="brand">ᴶᴼᴴᴺ ᵀᴿᴬᴺ • BOT PANEL</div>
  <div class="meta">
    <span id="master-status">master: –</span>
    <span id="clock"></span>
  </div>
</header>
<main>
  <div class="metrics" id="metricsBar"></div>
  <div class="toolbar" id="authBar">
    <input id="panelToken" type="password" placeholder="Panel token (để trống nếu chỉ chạy localhost)" autocomplete="current-password">
    <button class="primary" onclick="connectPanel()">Kết nối Panel</button>
    <small>Token chỉ được giữ trong phiên tab hiện tại.</small>
  </div>
  <div class="toolbar">
    <input id="newBotName" placeholder="Tên bot con (vd: bot1)" maxlength="32">
    <button class="primary" onclick="createBot()">+ Tạo bot con</button>
    <button onclick="refresh()">Làm mới</button>
    <span><small id="bot-count"></small></span>
  </div>
  <div class="grid" id="botGrid"></div>
</main>

<div class="modal" id="modal" onclick="if(event.target===this) closeModal()">
  <div class="modal-box">
    <header class="row" style="justify-content:space-between">
      <strong id="modalTitle">Logs</strong>
      <button onclick="closeModal()">Đóng</button>
    </header>
    <div class="modal-body" id="modalBody"></div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
let TOKEN = sessionStorage.getItem("jt_panel_token") || "";
let logTimer = null;
const state = { bots: [] };

function connectPanel() {
  TOKEN = document.getElementById("panelToken")?.value.trim() || "";
  if (TOKEN) sessionStorage.setItem("jt_panel_token", TOKEN);
  else sessionStorage.removeItem("jt_panel_token");
  refresh();
}

async function api(pathname, options = {}) {
  const res = await fetch("/api" + pathname, {
    ...options,
    headers: { "Content-Type": "application/json", ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Lỗi " + res.status);
  return data;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function uptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? h + "h " + m + "m" : m + "m " + (s % 60) + "s";
}

const STATUS_LABEL = {
  online: ["online", "Đã đăng nhập"],
  offline: ["offline", "Chưa chạy"],
  stopped: ["stopped", "Đã dừng"],
  restarting: ["restarting", "Đang khởi động lại"],
  qr_pending: ["qr_wait", "Đang chờ quét QR"],
  qr_scanned: ["qr_wait", "Đã quét QR, chờ xác nhận"],
  cookie_login: ["restarting", "Đang đăng nhập cookie..."],
  starting: ["restarting", "Đang khởi động..."],
  waiting_login: ["qr_wait", "Chờ đăng nhập"],
  failed: ["offline", "Đăng nhập thất bại"]
};
function labelFor(status) {
  return STATUS_LABEL[status] || ["offline", status];
}
async function refresh() {
  try {
    const data = await api("/bots");
    state.bots = data.bots;
    render(data.master);
    loadMetrics();
  } catch (e) { toast(e.message); }
}

async function loadMetrics() {
  try {
    const m = await api("/metrics");
    const bar = document.getElementById("metricsBar");
    bar.innerHTML = [
      ["Lệnh hôm nay", m.today?.commands ?? 0],
      ["Tải nhạc", m.today?.musicDownload ?? 0],
      ["AI", m.today?.aiRequests ?? 0],
      ["Lỗi", m.today?.errors ?? 0],
      ["Cache hit", (m.cache?.musicSearch?.hitRate ?? 0) + "%"],
      ["RAM", m.memoryMb + "MB"],
      ["Node", m.node]
    ].map(([label, value]) => \`<div class="metric"><b>\${value}</b><span>\${label}</span></div>\`).join("");
  } catch { /* bỏ qua */ }
}

function render(master) {
  document.getElementById("master-status").textContent =
    "master: " + (master ? (master.botCount + " bot • uptime " + uptime(master.uptimeMs)) : "–");
  document.getElementById("bot-count").textContent = state.bots.length + " bot con";
  const grid = document.getElementById("botGrid");
  if (!state.bots.length) {
    grid.innerHTML = '<div class="empty">Chưa có bot con nào. Tạo bot đầu tiên ở trên!</div>';
    return;
  }
  grid.innerHTML = state.bots.map(b => \`
    <div class="bot">
      <h3><span class="dot \${labelFor(b.status)[0]}"></span>\${b.name}</h3>
      <div class="sub">trạng thái <b>\${labelFor(b.status)[1]}</b> (\${b.loginState || "–"}) • pid \${b.pid || "–"} • uptime \${uptime(b.uptimeMs)} • restart \${b.restarts || 0}\${b.flapping ? " • <span style=\\"color:var(--red)\\">CRASH LIÊN TỤC</span>" : ""} • <span class="badge \${b.autoRestart ? "on" : "off"}">auto-restart \${b.autoRestart ? "ON" : "OFF"}</span></div>
      <div class="actions">
        <button class="primary" onclick="botAction('\${b.name}','start')">Chạy</button>
        <button onclick="botAction('\${b.name}','stop')">Dừng</button>
        <button onclick="botAction('\${b.name}','restart')">Khởi động lại</button>
        <button onclick="showQr('\${b.name}')">QR</button>
        <button onclick="showLogs('\${b.name}')">Logs</button>
        <button class="danger" onclick="removeBot('\${b.name}')">Xoá</button>
      </div>
    </div>\`).join("");
}

async function botAction(name, action) {
  try {
    await api("/bots/" + name + "/" + action, { method: "POST" });
    toast("Đã gửi lệnh " + action + " → " + name);
    setTimeout(refresh, 500);
  } catch (e) { toast(e.message); }
}

async function createBot() {
  const name = document.getElementById("newBotName").value.trim();
  if (!name) return toast("Nhập tên bot");
  try {
    await api("/bots", { method: "POST", body: JSON.stringify({ name }) });
    document.getElementById("newBotName").value = "";
    toast("Đã tạo bot " + name);
    refresh();
  } catch (e) { toast(e.message); }
}

async function removeBot(name) {
  if (!confirm("Xoá bot " + name + " và toàn bộ dữ liệu?")) return;
  try {
    await api("/bots/" + name, { method: "DELETE" });
    toast("Đã xoá " + name);
    refresh();
  } catch (e) { toast(e.message); }
}

async function showLogs(name) {
  document.getElementById("modalTitle").textContent = "Logs • " + name;
  document.getElementById("modalBody").innerHTML = '<pre class="logs" id="logBox">đang tải...</pre>';
  document.getElementById("modal").classList.add("open");
  const load = async () => {
    try {
      const data = await api("/bots/" + name + "/logs");
      const box = document.getElementById("logBox");
      if (box) box.textContent = data.logs.join("\\n") || "(chưa có log)";
    } catch (e) { /* bỏ qua */ }
  };
  load();
  clearInterval(logTimer);
  logTimer = setInterval(load, 3000);
}

async function showQr(name) {
  const title = document.getElementById("modalTitle");
  if (title) title.textContent = "QR đăng nhập • " + name;
  const body = document.getElementById("modalBody");
  body.innerHTML = '<div class="qr-box"><div id="qrMsg" class="sub">Đang tải trạng thái QR...</div><br><br><img id="qrImg" alt="qr" style="display:none"></div>';
  document.getElementById("modal").classList.add("open");
  const load = async () => {
    const img = document.getElementById("qrImg");
    const msg = document.getElementById("qrMsg");
    if (!img || !msg) return;
    const res = await fetch("/api/bots/" + encodeURIComponent(name) + "/qr?ts=" + Date.now());
    if (res.ok) {
      const blob = await res.blob();
      img.src = URL.createObjectURL(blob);
      img.style.display = "";
      msg.textContent = "Mã QR đã sẵn sàng — mở Zalo và quét mã trên điện thoại.";
    } else {
      img.style.display = "none";
      let text = "Không tải được mã QR.";
      try {
        const data = await res.json().catch(() => ({}));
        if (data.error) text = data.error;
      } catch { /* bỏ qua */ }
      msg.textContent = text;
      // Không dừng polling: bot có thể đang khởi động hoặc chưa sinh QR
    }
  };
  load();
  clearInterval(logTimer);
  logTimer = setInterval(load, 5000);
}

function closeModal() {
  document.getElementById("modal").classList.remove("open");
  clearInterval(logTimer);
}

setInterval(() => {
  document.getElementById("clock").textContent = new Date().toLocaleString("vi-VN");
}, 1000);

if (TOKEN) document.getElementById("panelToken").value = TOKEN;
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

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
        const questionMatch = pathname.match(/^\\/api\\/dhbc\\/questions\\/([a-z0-9-]+)$/);
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

      // ===== Tắt/bật lệnh theo nhóm =====
      const cmdMatch = pathname.match(/^\/api\/groups\/([a-zA-Z0-9_-]+)\/commands$/);
      if (cmdMatch) {
        const gid = cmdMatch[1];
        const db = require("../utils/db");
        const Threads = require("../core/controller/controllerThreads");

        if (req.method === "GET") {
          const thread = await Threads.getData(gid);
          const all = Array.from(global.client.commands.keys());
          const disabled = thread.data?.disabled_commands || [];
          return sendJson(res, 200, { gid, disabled, all });
        }

        if (req.method === "PATCH" || req.method === "PUT" || req.method === "POST") {
          const body = await readBody(req);
          const command = String(body.command || "").toLowerCase();
          if (!global.client.commands.has(command)) {
            return sendJson(res, 404, { error: `Lệnh '${command}' không tồn tại` });
          }
          const thread = await Threads.getData(gid);
          const data = thread.data || {};
          const disabled = Array.isArray(data.disabled_commands) ? [...data.disabled_commands] : [];
          const index = disabled.indexOf(command);
          const enable = body.enabled === true;
          if (enable && index >= 0) disabled.splice(index, 1);
          if (!enable && index < 0) disabled.push(command);
          data.disabled_commands = disabled;
          await Threads.setData(gid, data);
          return sendJson(res, 200, { gid, command, enabled: enable, disabled });
        }
        return sendJson(res, 405, { error: "Method không hỗ trợ" });
      }

      if (pathname === "/api/stats" && req.method === "GET") {
        maybeSyncStore();
        try {
          const db = require("../utils/db");
          const rows = db.allData("BotStats");
          const stats = {};
          for (const row of rows) {
            // JsonStore lưu idField "name"; Supabase chỉ có cột "id" — lấy
            // key từ cả hai để cả local lẫn deploy đều đúng.
            const key = row?.name || row?.id;
            if (!key || key === "soundcloud_client_id") continue; // bỏ row config
            stats[key] = row.data || {};
          }
          return sendJson(res, 200, { stats });
        } catch (error) {
          return sendJson(res, 500, { error: error.message });
        }
      }

      // ===== Quản lý lệnh =====
      if (pathname === "/api/commands" && req.method === "GET") {
        try {
          // global.client chỉ tồn tại trong process BOT CON — panel (process cha)
          // đọc trực tiếp config từ file lệnh để luôn hiển thị đúng.
          const commands = loadCommandsFromFiles(config);
          return sendJson(res, 200, { commands, total: commands.length });
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
        const match = pathname.match(/^\/api\/chat\/([a-zA-Z0-9_-]+)\/(threads|messages|health|thread-info|user-info|action|admin-groups|toggle-admin-group)$/);
        const sendMatch = pathname.match(/^\/api\/chat\/([a-zA-Z0-9_-]+)\/send$/);
        const botName = match?.[1] || sendMatch?.[1];
        if (!botName) return sendJson(res, 400, { error: "Thiếu tên bot" });
        const rawBot = manager.list().find((b) => b.name === botName);
        if (!rawBot?.bridgePort) return sendJson(res, 404, { error: "Chưa biết cổng cầu nối của bot" });
        const bot = enrichBot(rawBot);
        if (bot.loginState !== "logged_in") {
          return sendJson(res, 409, { error: `Bot "${botName}" chưa đăng nhập Zalo — đang chờ quét QR`, loginState: bot.loginState, requireLogin: true });
        }

        const route = match?.[2] || "send"; // threads | messages | health | thread-info | action | send
        let target = `http://127.0.0.1:${bot.bridgePort}/${route}`;
        // GET (messages, thread-info) giữ nguyên query string
        if (req.method === "GET" && url.search) target += url.search;

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
      sendJson(res, 500, { error: error.message });
    }
  });

  installMonitoring(server);

  server.listen(port, host, () => {
    console.log(`[panel] Panel quản lý đang chạy: http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`);
  });

  return server;
}

const MAX_LOG = 300;

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

// Serve panel UI (docs/) trực tiếp từ host bot — không cần GitHub Pages
const STATIC_FILES = { "/": "index.html", "/panel": "panel.html", "/panel.html": "panel.html" };
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

module.exports = { startPanel };
