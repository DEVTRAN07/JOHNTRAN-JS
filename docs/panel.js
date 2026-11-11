/* ===== ᴶᴼᴴᴺ ᵀᴿᴬᴺ PANEL — logic ===== */
const LS_URL = "jt_panel_url", LS_TOKEN = "jt_panel_token", LS_STYLE = "jt_chat_style";
let API = "", TOKEN = "";
let autoRefresh = null, logTimer = null, logPaused = false, currentBot = null, qrPoll = null;
let allBots = [];
let allCommands = [], allStatus = [];
const VIEW_TITLES = { bots: "Bot", chat: "Chat với bot", commands: "Lệnh", groups: "Lệnh theo nhóm", profile: "Hồ sơ bot", system: "Hệ thống" };

const $ = (id) => document.getElementById(id);

/* ---------- view router ---------- */
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const view = $("view-" + name);
  if (view) view.classList.add("active");
  document.querySelectorAll(".navbtn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $("viewTitle").textContent = VIEW_TITLES[name] || name;
  window.scrollTo({ top: 0 });
  if (name === "profile") loadBotStats();
  if (name === "system") loadSystem();
  if (name === "commands") { if (!allCommands.length) loadCommandList(); loadCommandStatus(); }
  if (name === "chat") { loadThreads(); } else { clearInterval(chatTimer); chatTimer = null; }
}

/* ---------- cấu hình kết nối ---------- */
function defaultApi() {
  return location.origin;
}
function toggleDrawer() { $("drawer").classList.toggle("open"); }
function saveConfig() {
  API = $("remoteUrl").value.trim().replace(/\/+$/, "");
  TOKEN = $("token").value.trim();
  localStorage.setItem(LS_URL, API);
  if (TOKEN) sessionStorage.setItem(LS_TOKEN, TOKEN);
  else sessionStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_TOKEN); // xóa token cũ từng được lưu bền vững trong localStorage
  toast("Đã lưu — đang kết nối...");
  refresh();
}
function loadConfig() {
  API = (localStorage.getItem(LS_URL) || defaultApi()).replace(/\/+$/, "");
  TOKEN = sessionStorage.getItem(LS_TOKEN) || "";
  localStorage.removeItem(LS_TOKEN);
  $("remoteUrl").value = API;
  $("token").value = TOKEN;
}

async function api(pathname, options = {}) {
  if (!API) throw new Error("Chưa cấu hình REMOTE PANEL URL");
  const res = await fetch(API + pathname, {
    ...options,
    headers: { "Content-Type": "application/json", ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Lỗi " + res.status);
  return data;
}

/* ---------- tiện ích ---------- */
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escapeAttr = (s) => escapeHtml(s);
function uptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
function toast(msg, type) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("success", "error", "warn");
  if (type === "success" || type === "error" || type === "warn") t.classList.add(type);
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2400);
}
function setConn(ok, text) {
  $("connDot").className = "dot " + (ok ? "online" : "offline");
  $("connText").textContent = text;
}
function botLoggedIn(b) {
  return b && (b.loginState === "logged_in" || b.status === "online");
}
function qrWaitStatus(st) {
  st = (st || "").toString();
  return st === "qr_pending" || st === "qr_scanned" || st === "waiting_login" || st === "starting" || st === "cookie_login";
}
function shouldShowQr(b) {
  if (!b) return false;
  return qrWaitStatus(b.status) || (b.hasQr && !botLoggedIn(b));
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

/* ---------- dữ liệu chính ---------- */
async function refresh() {
  if (!API) { setConn(false, "chưa cấu hình"); return; }
  try {
    const data = await api("/api/bots");
    allBots = data.bots || [];
    renderBots(data.bots);
    loadMetrics();
    setConn(true, `đã kết nối • ${data.bots.length} bot con`);
    if (autoRefresh) clearInterval(autoRefresh);
    autoRefresh = setInterval(() => { if (!$("modal").classList.contains("open")) refresh(); }, 10000);
  } catch (e) {
    setConn(false, e.message);
    $("mainBotCard").innerHTML = `<div class="empty">Không kết nối được: ${escapeHtml(e.message)}</div>`;
    $("childGrid").innerHTML = "";
    clearTimeout(window.__reconnectTimer);
    window.__reconnectTimer = setTimeout(() => { if (!API) return; refresh(); }, 5000);
  }
}

function renderBots(bots) {
  const main = bots.find((b) => b.name === "main") || bots[0];
  const children = bots.filter((b) => b !== main);
  $("child-count").textContent = children.length;
  const nav = $("navCmdCount");

  // ===== Bot chính: thẻ trạng thái lớn =====
  if (!main) {
    $("mainBotCard").innerHTML = '<div class="empty">Không có bot nào đang chạy. Bấm "Khởi động lại" hoặc kiểm tra host.</div>';
    $("mainBotBadge").textContent = "offline";
    $("mainBotBadge").className = "badge off";
  } else {
    const st = STATUS_LABEL[main.status] || ["offline", main.status];
    const online = st[0] === "online";
    $("mainBotBadge").textContent = st[1];
    $("mainBotBadge").className = "badge " + (online ? "on" : "off");
    $("mainBotCard").innerHTML = `
      <div class="bot-main">
        <div class="bt">
          <span class="dot ${st[0]}"></span>
          <div>
            <b>${escapeHtml(main.name)}</b>
            <div class="sub">${st[1]} • pid <b>${main.pid || "–"}</b> • uptime <b>${uptime(main.uptimeMs || 0)}</b> • restart <b>${main.restarts || 0}</b> lần${main.sessionHint ? ' • <span style="color:var(--accent)">${escapeHtml(main.sessionHint)}</span>' : ""}</div>
          </div>
        </div>
        <div class="badges">
          <span class="badge ${main.autoRestart ? "on" : "off"}">auto-restart ${main.autoRestart ? "ON" : "OFF"}</span>
          ${main.hasQr ? '<span class="badge qr">có QR</span>' : ""}
          ${main.flapping ? '<span class="badge crit">crash liên tục</span>' : ""}
        </div>
        <div class="actions">
          <button class="primary" onclick="botAction('${escapeAttr(main.name)}','restart')">🔄 Khởi động lại</button>
          <button onclick="botAction('${escapeAttr(main.name)}','start')">▶ Chạy</button>
          <button onclick="botAction('${escapeAttr(main.name)}','stop')">⏹ Dừng</button>
          <button class="primary" onclick="showSession('${escapeAttr(main.name)}')">🔑 Phiên đăng nhập</button>
          <button onclick="showLogs('${escapeAttr(main.name)}')">📜 Logs</button>
          ${shouldShowQr(main) ? `<button onclick="showQr('${escapeAttr(main.name)}')">📱 QR đăng nhập</button>` : ""}
        </div>
        <label class="row" style="gap:9px;font-size:12.5px;color:var(--sub);margin-top:2px">
          <span class="switch"><input type="checkbox" ${main.autoRestart ? "checked" : ""} onchange="setAutoRestart('${escapeAttr(main.name)}', this.checked)"><span class="tr"></span></span>
          Tự khởi động lại khi crash
        </label>
      </div>`;
  }

  // ===== Bot con: danh sách thu gọn =====
  $("childGrid").innerHTML = children.length ? children.map((b) => {
    const st = STATUS_LABEL[b.status] || ["offline", b.status];
    return `
    <div class="bot">
      <header>
        <span class="dot ${st[0]}"></span><b>${escapeHtml(b.name)}</b>
        <span style="flex:1"></span>
        <span class="badge ${st[0] === "online" ? "on" : "off"}">${st[1]}</span>
      </header>
      ${b.sessionHint ? `<div class="sub" style="color:var(--accent);margin-bottom:8px">${escapeHtml(b.sessionHint)}</div>` : ""}
      <div class="stats">
        <div><div class="k">Uptime</div><div class="v">${uptime(b.uptimeMs || 0)}</div></div>
        <div><div class="k">Restart</div><div class="v">${b.restarts || 0}</div></div>
        <div><div class="k">PID</div><div class="v">${b.pid || "–"}</div></div>
      </div>
      <div class="actions">
        <button class="primary small" onclick="botAction('${escapeAttr(b.name)}','start')">▶ Chạy</button>
        <button class="small" onclick="botAction('${escapeAttr(b.name)}','stop')">⏹ Dừng</button>
        <button class="small" onclick="botAction('${escapeAttr(b.name)}','restart')">🔄 Khởi động lại</button>
        <button class="small" onclick="showSession('${escapeAttr(b.name)}')">🔑 Phiên</button>
        <button class="small" onclick="showLogs('${escapeAttr(b.name)}')">📜 Logs</button>
        ${shouldShowQr(b) ? `<button class="small" onclick="showQr('${escapeAttr(b.name)}')">📱 QR</button>` : ""}
        <button class="small danger" onclick="removeBot('${escapeAttr(b.name)}')">🗑 Xoá</button>
      </div>
      <label class="row" style="gap:9px;font-size:12.5px;color:var(--sub)">
        <span class="switch"><input type="checkbox" ${b.autoRestart ? "checked" : ""} onchange="setAutoRestart('${escapeAttr(b.name)}', this.checked)"><span class="tr"></span></span>
        Tự khởi động lại khi crash
      </label>
    </div>`;
  }).join("") : '<div class="empty" style="grid-column:1/-1">Chưa có bot con nào — bot chính ở trên là tài khoản Zalo của bạn.</div>';
}

function toggleChildren() {
  const panel = $("childPanel");
  const open = panel.style.display !== "none";
  panel.style.display = open ? "none" : "grid";
  $("childToggle").textContent = open ? "Mở rộng" : "Thu gọn";
}

async function botAction(name, action) {
  try {
    await api(`/api/bots/${encodeURIComponent(name)}/${action}`, { method: "POST" });
    toast(`Đã gửi lệnh ${action} → ${name}`);
    refresh();
  } catch (e) { toast(e.message); }
}

async function createBot() {
  const name = $("newBotName").value.trim();
  if (!name) return toast("Nhập tên bot con");
  try {
    await api("/api/bots", { method: "POST", body: JSON.stringify({ name }) });
    toast("Đã tạo bot " + name);
    $("newBotName").value = "";
    refresh();
  } catch (e) { toast(e.message); }
}

async function removeBot(name) {
  if (!confirm(`Xoá bot "${name}" và toàn bộ dữ liệu của nó?`)) return;
  try {
    await api(`/api/bots/${encodeURIComponent(name)}`, { method: "DELETE" });
    toast("Đã xoá " + name);
    refresh();
  } catch (e) { toast(e.message); }
}

async function setAutoRestart(name, value) {
  try {
    await api(`/api/bots/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ autoRestart: Boolean(value) }) });
    toast(`${name}: auto-restart ${value ? "BẬT" : "TẮT"}`);
    refresh();
  } catch (e) { toast(e.message); }
}

/* ---------- metrics ---------- */
async function loadMetrics() {
  try {
    const m = await api("/api/metrics");
    const t = m.today || {};
    const cache = m.cache || {};
    const totalHits = cache.total ?? Object.values(cache.tables || {}).reduce((a, x) => a + (x.hits || 0), 0);
    const cards = [
      ["Lệnh hôm nay", t.commands || 0, ""],
      ["Lỗi", t.errors || 0, (t.errors || 0) > 0 ? "bad" : "good"],
      ["Tìm nhạc", t.musicSearch || 0, ""],
      ["Tải nhạc", t.musicDownload || 0, ""],
      ["AI requests", t.aiRequests || 0, ""],
      ["Uptime host", uptime(m.uptimeMs || 0), ""],
      ["RAM host", (m.memoryMb || 0) + "MB", (m.memoryMb || 0) > 400 ? "warn" : "good"],
      ["Cache", totalHits, ""]
    ];
    $("metricsBar").innerHTML = cards.map(([k, v, cls]) => `<div class="metric ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
    const top = m.topCommands || [];
    $("topCommands").innerHTML = top.length
      ? top.map(([name, n], i) => `<tr><td>${i + 1}. <code>/${escapeHtml(name)}</code></td><td style="text-align:right"><b>${n}</b> lần</td></tr>`).join("")
      : '<tr><td colspan="2" class="sub">(chưa có lệnh nào hôm nay)</td></tr>';
  } catch { /* bỏ qua */ }
}

/* ---------- danh sách lệnh ---------- */
async function loadCommandList() {
  try {
    const { commands, total } = await api("/api/commands");
    allCommands = commands;
    $("cmd-total").textContent = total;
    const nav = $("navCmdCount");
    nav.style.display = total ? "" : "none";
    nav.textContent = total;
    const cats = [...new Set(commands.map((c) => c.category))].sort();
    $("cmdCategory").innerHTML = '<option value="">Tất cả nhóm</option>' + cats.map((c) => `<option>${escapeHtml(c)}</option>`).join("");
    renderCommands();
  } catch (e) { toast(e.message); }
}

function renderCommands() {
  const q = ($("cmdSearch").value || "").trim().toLowerCase();
  const cat = $("cmdCategory").value;
  const role = $("cmdRole").value;
  const list = allCommands.filter((c) => {
    if (cat && c.category !== cat) return false;
    if (role !== "" && String(c.role) !== role) return false;
    if (!q) return true;
    return (c.name + " " + (c.aliases || []).join(" ") + " " + (c.description || "")).toLowerCase().includes(q);
  });
  $("cmdGrid").innerHTML = list.length ? list.map((c) => `
    <div class="cmd">
      <div style="min-width:0">
        <div class="nm">${escapeHtml(c.name)}</div>
        <div class="ds">${escapeHtml(c.description || "")}</div>
      </div>
      <span class="rl r${c.role}">${c.role === 2 ? "ADMIN" : c.role === 1 ? "SUPPORT" : "MEMBER"}</span>
    </div>`).join("") : '<div class="empty" style="grid-column:1/-1">Không có lệnh khớp bộ lọc.</div>';
}

/* ---------- trạng thái lệnh (thiếu API/config) ---------- */
async function loadCommandStatus() {
  try {
    const s = await api("/api/commands/status");
    allStatus = s.commands || [];
    $("cmdStatusCount").textContent = `${s.ready}/${s.total} sẵn sàng`;
    $("cmdStatusHint").innerHTML = s.blocked > 0
      ? `<b style="color:var(--red)">${s.blocked} lệnh đang thiếu API/endpoint</b> — thêm vào config.yml rồi redeploy.`
      : `✅ Tất cả lệnh đã đầy đủ cấu hình.`;
    renderCommandStatus();
  } catch { /* bỏ qua */ }
}

function renderCommandStatus() {
  const rows = [...allStatus.filter((c) => !c.ready), ...allStatus.filter((c) => c.ready)];
  $("cmdStatusGrid").innerHTML = rows.length ? rows.map((c) => `
    <div class="cmd-status ${c.ready ? "ready" : "blocked"}">
      <div style="min-width:0">
        <div class="cname">${escapeHtml(c.name)}</div>
        ${c.ready ? "" : `<div class="miss">thiếu: ${escapeHtml((c.missing || []).join(", "))}</div>`}
      </div>
      <div class="st">${c.ready ? "OK" : "THIẾU"}</div>
    </div>`).join("") : '<div class="empty">(không có dữ liệu)</div>';
}

/* ---------- lệnh theo nhóm ---------- */
async function loadGroupCommands() {
  const gid = $("cmdGroupId").value.trim();
  if (!gid) return toast("Nhập Group ID trước");
  try {
    if (!allCommands.length) await loadCommandList();
    const { disabled } = await api(`/api/groups/${encodeURIComponent(gid)}/commands`);
    const disabledSet = new Set(disabled || []);
    $("cmdGroupGrid").innerHTML = allCommands.map((c) => `
      <div class="cmd-item">
        <div class="txt">
          <div class="cname">${escapeHtml(c.name)}</div>
          <div class="cdesc">${escapeHtml(c.description || "")}</div>
        </div>
        <span class="switch"><input type="checkbox" ${disabledSet.has(c.name) ? "" : "checked"} onchange="toggleCommand(this, '${escapeAttr(c.name)}')"><span class="tr"></span></span>
      </div>`).join("");
    $("cmdHint").textContent = `Nhóm ${gid} — ${disabled.length} lệnh đang tắt.`;
  } catch (e) { toast(e.message); }
}

async function toggleCommand(el, name) {
  const gid = $("cmdGroupId").value.trim();
  if (!gid) return toast("Chưa có Group ID");
  const willEnable = el.checked;
  try {
    await api(`/api/groups/${encodeURIComponent(gid)}/commands`, {
      method: "PATCH",
      body: JSON.stringify({ command: name, enabled: willEnable })
    });
    toast(willEnable ? `Đã bật /${name}` : `Đã tắt /${name}`);
  } catch (e) { toast(e.message); }
}

/* ---------- hồ sơ bot ---------- */
async function loadBotStats() {
  try {
    const { stats } = await api("/api/stats");
    const entries = Object.entries(stats || {});
    if (!entries.length) {
      $("profileInfo").innerHTML = '<tr><td colspan="2" class="sub">(chưa có — bot con sẽ gửi sau 30s)</td></tr>';
      return;
    }
    entries.sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
    const [botName, s] = entries[0];
    const p = s.profile || {};
    if (p.avatar) $("botAvatar").src = p.avatar;
    const online = s.loginState === "logged_in" || (s.status === "online" && (s.updatedAt || 0) > Date.now() - 90000);
    $("botStateBadge").textContent = online ? "online" : "offline";
    $("botStateBadge").className = "badge " + (online ? "on" : "off");

    $("profileInfo").innerHTML = [
      ["Bot con", `<code>${escapeHtml(botName)}</code>`],
      ["Tên Zalo", escapeHtml(p.displayName || "—")],
      ["UID", `<code>${escapeHtml(p.uid || "—")}</code>`],
      ["Số điện thoại", `<code>${escapeHtml(p.phoneNumber || "—")}</code>`],
      ["Bạn bè", `<b>${s.friends?.total ?? 0}</b>`],
      ["Nhóm", `<b>${s.groups?.total ?? 0}</b>`],
      ["Cập nhật", new Date(s.updatedAt || Date.now()).toLocaleString("vi-VN")]
    ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");

    $("friendCount").textContent = s.friends?.total ?? 0;
    $("friendList").innerHTML = (s.friends?.list || []).length
      ? s.friends.list.map((f) => `<div class="it">${f.avatar ? `<img src="${escapeAttr(f.avatar)}" alt="">` : ""}<span class="nm">${escapeHtml(f.displayName || f.zaloName || f.uid)}</span><span class="id">${escapeHtml(f.uid)}</span></div>`).join("")
      : '<div class="empty">(không có)</div>';
    $("groupCount").textContent = s.groups?.total ?? 0;
    $("groupList").innerHTML = (s.groups?.list || []).length
      ? s.groups.list.map((g) => `<div class="it">${g.avatar ? `<img src="${escapeAttr(g.avatar)}" alt="">` : ""}<span class="nm">${escapeHtml(g.name || g.groupName || g.id)}</span><span class="id">${escapeHtml(g.id)}</span></div>`).join("")
      : '<div class="empty">(không có)</div>';
  } catch { /* bỏ qua */ }
}

/* ---------- hệ thống ---------- */
async function loadSystem() {
  try {
    const m = await api("/api/metrics");
    const master = m.master || {};
    $("masterInfo").innerHTML = [
      ["Số bot con", `<b>${master.botCount ?? "—"}</b>`],
      ["Node", m.node || "—"],
      ["Uptime host", uptime(m.uptimeMs || 0)],
      ["RAM host", (m.memoryMb || 0) + "MB"],
      ["Lệnh hôm nay", m.today?.commands || 0],
      ["Lỗi hôm nay", m.today?.errors || 0]
    ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
    const audit = m.audit || [];
    $("auditLog").textContent = audit.length ? audit.join("\n") : "(chưa có hành động admin nào)";
  } catch { /* bỏ qua */ }
}

/* ---------- modal: logs ---------- */
function togglePause() {
  logPaused = !logPaused;
  $("pauseBtn").textContent = logPaused ? "Tiếp tục" : "Tạm dừng";
}
function closeModal() {
  $("modal").classList.remove("open");
  clearInterval(logTimer);
  logTimer = null;
  clearInterval(qrPoll);
  qrPoll = null;
}
async function showLogs(name) {
  currentBot = name;
  logPaused = false;
  $("pauseBtn").textContent = "Tạm dừng";
  $("modalTitle").textContent = "Logs • " + name;
  $("modalBody").innerHTML = '<pre class="logs" id="logBox">đang tải...</pre>';
  $("modal").classList.add("open");

  const load = async () => {
    if (logPaused) return;
    try {
      const data = await api(`/api/bots/${encodeURIComponent(name)}/logs?lines=200`);
      const box = $("logBox");
      if (box) box.textContent = (data.logs || []).join("\n") || "(chưa có log)";
    } catch { /* bỏ qua */ }
  };
  load();
  clearInterval(logTimer);
  logTimer = setInterval(load, 4000);
}

/* ---------- modal: QR ---------- */
async function showQr(name) {
  $("modalTitle").textContent = `QR đăng nhập • ${name}`;
  $("modalBody").innerHTML = `
    <div class="qr-box">
      <div id="qrMsg" class="sub">Đang tải trạng thái...</div><br><br>
      <img id="qrImg" alt="QR code" style="display:none">
      <div id="qrHint" style="margin-top:10px"></div>
    </div>`;
  $("modal").classList.add("open");

  const load = async () => {
    const msg = $("qrMsg");
    const img = $("qrImg");
    const hint = $("qrHint");
    if (!msg || !img) return;

    // Lấy trạng thái bot mới nhất ở mỗi lượt poll
    let bot = allBots.find((b) => b.name === name) || {};
    try {
      const data = await api("/api/bots");
      const found = (data.bots || []).find((b) => b.name === name);
      if (found) { bot = found; allBots = data.bots || allBots; }
    } catch { /* giữ trạng thái lần trước */ }

    const st = (bot.loginState || bot.status || "").toString();
    const loggedIn = botLoggedIn(bot);
    const waiting = qrWaitStatus(st);

    let text = "";
    if (loggedIn) {
      text = "Đã đăng nhập Zalo";
    } else if (st === "cookie_login") {
      text = "Đang đăng nhập bằng cookie...";
    } else if (st === "starting") {
      text = "Bot đang khởi động...";
    } else if (st === "qr_scanned") {
      text = "Đã quét QR, hãy xác nhận trên điện thoại";
    } else if (st === "qr_pending" || st === "waiting_login") {
      text = "Đang chờ mã QR... mở Zalo và quét";
    } else if (st === "failed") {
      text = "Đăng nhập thất bại" + (bot.reason ? " — " + escapeHtml(bot.reason) : "");
    } else {
      text = "Chưa có mã QR...";
    }

    // Lấy ảnh QR (giữ nguyên token như trước)
    try {
      const res = await fetch(`${API}/api/bots/${encodeURIComponent(name)}/qr?ts=${Date.now()}`, {
        headers: TOKEN ? { Authorization: "Bearer " + TOKEN } : {}
      });
      if (res.ok) {
        const blob = await res.blob();
        img.src = URL.createObjectURL(blob);
        img.style.display = "";
        img.alt = "Mã QR đăng nhập Zalo";
        msg.textContent = text;
        if (hint) hint.textContent = "Mã QR được tải qua phiên Panel đã xác thực."; 
      } else {
        img.style.display = "none";
        let body = {};
        try { body = await res.json().catch(() => ({})); } catch { /* ignore */ }
        if (loggedIn) {
          msg.textContent = "Đã đăng nhập Zalo (không còn mã QR).";
          clearInterval(qrPoll);
          qrPoll = null;
        } else if (waiting) {
          msg.textContent = body.error || text;
          // bot vẫn đang khởi động/chờ đăng nhập → tiếp tục poll
        } else {
          msg.textContent = body.error || text || "Chưa có mã QR...";
        }
      }
    } catch {
      if (waiting || !loggedIn) msg.textContent = text;
      else msg.textContent = "Không tải được mã QR.";
    }
    if (!msg.textContent) msg.textContent = text;
  };

  load();
  clearInterval(qrPoll);
  qrPoll = setInterval(load, 5000);
}


/* ---------- Phiên đăng nhập (metadata an toàn, không lộ secrets) ---------- */
async function showSession(name) {
  $("modalTitle").textContent = "Phiên đăng nhập • " + name;
  $("modalBody").innerHTML = `
    <div id="sessionBody" class="sub">Đang tải...</div>
    <div style="margin-top:14px"><button class="small" onclick="document.getElementById('sessionBody').innerHTML=''">Đóng</button></div>
  `;
  $("modal").classList.add("open");
  const load = async () => {
    const body = $("sessionBody");
    if (!body) return;
    try {
      const s = await api("/api/bots/" + encodeURIComponent(name) + "/session");
      const bot = allBots.find((b) => b.name === name) || {};
      const st = (s.loginState || bot.loginState || bot.status || "").toString();
      const online = st === "logged_in" || st === "online";
      const rows = [
        ["Trạng thái", online
          ? '<span class="badge on">ĐÃ ĐĂNG NHẬP ZALO</span>'
          : (st === "failed" ? '<span class="badge off">Đăng nhập thất bại</span>'
             : '<span class="badge off">Chờ đăng nhập</span>')],
        ["loginState", escapeHtml(s.loginState || bot.loginState || "–")],
        ["Cập nhật", s.updatedAt ? new Date(s.updatedAt).toLocaleString("vi-VN") : "–"],
        ["account.json", s.hasAccountFile ? "có" : "không"],
        ["cookie.json", s.hasCookieFile ? "có" : "không"],
        ["Cookie hợp lệ", s.cookieLooksValidShape ? "có" : "không"],
        ["accountPath", escapeHtml(s.accountPathRelative || "–")],
        ["cookiePath", escapeHtml(s.cookiePathRelative || "–")],
        ["dbPath", escapeHtml(s.dbPathRelative || "–")]
      ];
      body.innerHTML = `
        <table class="info">
          ${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
        </table>
        ${online ? `
          <div class="card" style="margin-top:14px;border-color:var(--accent)">
            <h3 style="color:var(--accent)">Lưu phiên để Render redeploy không cần quét QR</h3>
            <p class="sub" style="margin:8px 0">
              Bot đang đăng nhập. Khi redeploy, account.json/cookie.json bị xoá — set env JT_ACCOUNT_JSON và JT_COOKIE_JSON từ phiên này.
            </p>
            <ol class="sub" style="margin:8px 0 14px 18px">
              <li>Vào <b>Render Shell</b> (Dashboard → Shell) của service.</li>
              <li>Điền 2 env vars (loại <b>Secret Text</b> để an toàn):</li>
              <pre style="background:var(--bg);padding:10px;border-radius:8px;overflow:auto">
JT_ACCOUNT_JSON=<i>nội dung file account.json</i>
JT_COOKIE_JSON=<i>nội dung file cookie.json</i></pre>
              <li>Chạy: <code>git push</code> hoặc redeploy.</li>
            </ol>
            <div class="sub" style="color:var(--red)">
              ⚠️ KHÔNG commit account.json/cookie.json lên GitHub. Dùng Render Shell/env vars hoặc .env (gitignored).
            </div>
          </div>
        ` : ""}
      `;
    } catch (e) {
      $("sessionBody").innerHTML = '<div class="empty">Không tải được: ' + escapeHtml(e.message) + '</div>';
    }
  };
  load();
  clearInterval(qrPoll);
  qrPoll = setInterval(load, 10000);
}

/* ---------- CHAT (kiểu Zalo PC) ---------- */
const CHAT_BOT = "main";
let chatThreads = { friends: { list: [] }, groups: { list: [] } };
let chatCurrent = null;
let chatTimer = null;
let chatUnread = {};
let chatLastSeen = {};
let chatStyle = { color: "", font: "", fontFamily: "", bold: false, italic: false, underline: false, strike: false, glow: false };
const STYLE_FONTS = { "": "Mặc định", cursive: "Cursive", monospace: "Monospace", sans: "Sans-serif", serif: "Serif" };
let chatAdminGroups = [];

function loadChatStyle() {
  try { chatStyle = { ...chatStyle, ...(JSON.parse(localStorage.getItem(LS_STYLE)) || {}) }; } catch { /* bo qua */ }
  applyStyleBar();
}
function saveChatStyle() {
  localStorage.setItem(LS_STYLE, JSON.stringify(chatStyle));
  applyStyleBar();
}
const CSS_FONTS = { cursive: "\"Comic Sans MS\", cursive", monospace: "ui-monospace, Menlo, Consolas, monospace", sans: "-apple-system, \"Segoe UI\", Roboto, sans-serif", serif: "Georgia, \"Times New Roman\", serif" };
function styleCss(extra = {}) {
  const css = [];
  if (chatStyle.color) css.push("color:" + chatStyle.color);
  if (chatStyle.font) css.push("font-size:" + chatStyle.font);
  if (chatStyle.fontFamily && CSS_FONTS[chatStyle.fontFamily]) css.push("font-family:" + CSS_FONTS[chatStyle.fontFamily]);
  if (chatStyle.bold) css.push("font-weight:700");
  if (chatStyle.italic) css.push("font-style:italic");
  if (chatStyle.underline || chatStyle.strike) css.push("text-decoration:" + (chatStyle.underline ? "underline " : "") + (chatStyle.strike ? "line-through" : ""));
  if (chatStyle.glow) css.push("text-shadow:0 0 10px currentColor, 0 0 22px currentColor");
  return css.concat(Object.entries(extra).map(([k, v]) => k + ":" + v)).join(";");
}
function applyStyleBar() {
  document.querySelectorAll(".stbtn").forEach((b) => {
    if (b.id === "glowBtn") b.classList.toggle("on", !!chatStyle.glow);
    else b.classList.toggle("on", !!chatStyle[b.dataset.k]);
  });
  document.querySelectorAll(".cdot").forEach((d) => d.classList.toggle("on", chatStyle.color === d.dataset.c));
  const f = $("chatFont");
  if (f) f.value = chatStyle.font || "";
  const ff = $("chatFontFamily");
  if (ff) ff.value = chatStyle.fontFamily || "";
  const sw = $("colorSwatch");
  const hx = $("colorHex");
  if (chatStyle.color) {
    if (sw) sw.style.background = chatStyle.color;
    if (hx) hx.textContent = chatStyle.color.toUpperCase();
  } else {
    if (sw) sw.style.background = "transparent";
    if (hx) hx.textContent = "Màu";
  }
}
function toggleStyle(key) {
  chatStyle[key] = !chatStyle[key];
  saveChatStyle();
}
function setChatStyle(patch, el) {
  Object.assign(chatStyle, patch);
  saveChatStyle();
}
function openStylePanel() {
  $("styleBody").innerHTML = `
    <div class="sub" style="margin-bottom:14px">Chỉ đổi cách <b>HIỂN THỊ</b> trên panel (không gửi lên Zalo).</div>
    <div class="row" style="margin-bottom:12px">
      <label style="flex:1;display:grid;gap:6px;font-size:11px;font-weight:800;letter-spacing:1.2px;color:var(--sub);text-transform:uppercase">Cỡ chữ
        <select onchange="setChatStyle({font:this.value})" style="width:100%">
          <option value="">Mặc định</option>
          <option value="13px" ${chatStyle.font==="13px"?"selected":""}>Nhỏ (13px)</option>
          <option value="18px" ${chatStyle.font==="18px"?"selected":""}>Lớn (18px)</option>
        </select>
      </label>
      <label style="flex:1;display:grid;gap:6px;font-size:11px;font-weight:800;letter-spacing:1.2px;color:var(--sub);text-transform:uppercase">Font chữ
        <select onchange="setChatStyle({fontFamily:this.value})" style="width:100%">
          ${Object.entries(STYLE_FONTS).map(([k, v]) => `<option value="${k}" ${chatStyle.fontFamily===k?"selected":""}>${v}</option>`).join("")}
        </select>
      </label>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:var(--sub);text-transform:uppercase;margin-bottom:8px">Màu chữ</div>
      <div class="color-dots" style="margin:0">${["#7c5cff","#f43f5e","#22c55e","#f59e0b","#f97316","#e5e7eb"].map((c) => '<button class="cdot ' + (chatStyle.color === c ? "on" : "") + '" style="--c:' + c + '" onclick="setChatStyle({color:\'' + c + '\'})"></button>').join("")}</div>
    </div>
    <div class="row" style="gap:14px;margin-bottom:16px">
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><span class="switch"><input type="checkbox" ${chatStyle.bold?"checked":""} onchange="toggleStyle('bold')"><span class="tr"></span></span>In đậm</label>
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><span class="switch"><input type="checkbox" ${chatStyle.italic?"checked":""} onchange="toggleStyle('italic')"><span class="tr"></span></span>Nghiêng</label>
    </div>
    <div class="row" style="gap:14px;margin-bottom:16px">
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><span class="switch"><input type="checkbox" ${chatStyle.underline?"checked":""} onchange="toggleStyle('underline')"><span class="tr"></span></span>Gạch chân</label>
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><span class="switch"><input type="checkbox" ${chatStyle.strike?"checked":""} onchange="toggleStyle('strike')"><span class="tr"></span></span>Gạch ngang</label>
      <label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><span class="switch"><input type="checkbox" ${chatStyle.glow?"checked":""} onchange="toggleStyle('glow')"><span class="tr"></span></span>✨ Phát sáng</label>
    </div>
    <div class="row" style="justify-content:flex-end">
      <button onclick="resetStyle()">Huỷ kiểu</button>
      <button class="primary" onclick="closeStylePanel()">Lưu</button>
    </div>`;
  $("styleModal").classList.add("open");
}
function closeStylePanel() { $("styleModal").classList.remove("open"); }
function resetStyle() {
  chatStyle = { color: "", font: "", fontFamily: "", bold: false, italic: false, underline: false, strike: false, glow: false };
  saveChatStyle();
  openStylePanel();
}

// ---- BẢNG KÉO CHỌN MÀU (HSV) ----
let pickerHsv = { h: 0, s: 1, v: 1 };

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255));
}
const rgbToHex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
function hsvToHex(h, s, v) { const [r, g, b] = hsvToRgb(h, s, v); return rgbToHex(r, g, b); }
function hexToHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255, g = parseInt(m[1].slice(2, 4), 16) / 255, b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function drawSvArea() {
  const cv = $("svArea");
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const base = hsvToRgb(pickerHsv.h, 1, 1);
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "rgb(255,255,255)");
  grad.addColorStop(1, `rgb(${base[0]},${base[1]},${base[2]})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const grad2 = ctx.createLinearGradient(0, 0, 0, H);
  grad2.addColorStop(0, "rgba(0,0,0,0)");
  grad2.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = grad2;
  ctx.fillRect(0, 0, W, H);
  const cx = pickerHsv.s * W, cy = (1 - pickerHsv.v) * H;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawHueBar() {
  const cv = $("hueBar");
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  for (let i = 0; i <= 6; i++) {
    const [r, g, b] = hsvToRgb(i * 60, 1, 1);
    grad.addColorStop(i / 6, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const x = (pickerHsv.h / 360) * W;
  ctx.fillStyle = "#fff";
  ctx.fillRect(Math.max(0, Math.min(W - 4, x - 2)), 0, 4, H);
}

function updateColorPreview() {
  const hex = hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v);
  setChatStyle({ color: chatStyle.color === "" ? hex : hex });
  const sw = $("colorSwatch"); if (sw) sw.style.background = hex;
  const hx = $("colorHex"); if (hx) hx.textContent = chatStyle.color ? hex.toUpperCase() : "Màu";
  const sw2 = $("colorSwatch2"); if (sw2) sw2.style.background = hex;
  const hx2 = $("colorHex2"); if (hx2) hx2.textContent = hex.toUpperCase();
  const hi = $("colorHexInput"); if (hi && document.activeElement !== hi) hi.value = hex.toUpperCase();
  drawSvArea();
  drawHueBar();
}

function pickerBind(cv, onPick) {
  if (!cv) return;
  const move = (e) => {
    const rect = cv.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    onPick(x / rect.width, y / rect.height);
  };
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    move(e);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function openColorPicker() {
  const from = hexToHsv(chatStyle.color || "#ff0000");
  if (from) pickerHsv = from;
  $("colorModal").classList.add("open");
  requestAnimationFrame(() => {
    pickerBind($("svArea"), (fx, fy) => { pickerHsv.s = fx; pickerHsv.v = 1 - fy; updateColorPreview(); });
    pickerBind($("hueBar"), (fx) => { pickerHsv.h = fx * 360; updateColorPreview(); });
    updateColorPreview();
  });
}

function closeColorPicker() {
  $("colorModal").classList.remove("open");
}

function applyHexInput() {
  const hex = ($("colorHexInput").value || "").trim();
  const hsv = hexToHsv(hex);
  if (hsv) { pickerHsv = hsv; updateColorPreview(); }
  else toast("Mã màu không hợp lệ (vd #ff0000)", "error");
}

function pickZaloColor(hex) {
  setChatStyle({ color: hex });
  closeColorPicker();
}

// ---- danh sách hội thoại ----
async function loadThreads() {
  try {
    setLoading("chatThreads", '<div class="empty">Đang tải hội thoại...</div>');
    const data = await api("/api/chat/" + CHAT_BOT + "/threads");
    chatThreads = data;
    chatAdminGroups = data.adminGroups || [];
    renderThreadList();
  } catch (e) {
    setLoading("chatThreads", '<div class="empty">' + escapeHtml(e.message) + '<br><br>Bot chưa bật cầu nối chat hoặc chưa chạy.</div>');
  }
}

function threadAvatar(t) {
  return t.avatar
    ? '<img src="' + escapeAttr(t.avatar) + '" alt="">'
    : '<span class="ph">' + (t.isGroup ? "👥" : "👤") + "</span>";
}

function renderThreadList() {
  const q = ($("chatSearch")?.value || "").trim().toLowerCase();
  const muted = JSON.parse(localStorage.getItem("jt_chat_muted") || "[]");
  const adminSet = new Set(chatAdminGroups || []);
  const friends = (chatThreads.friends?.list || []).filter((f) => !q || (f.displayName || "").toLowerCase().includes(q) || String(f.uid).includes(q));
  const groups = (chatThreads.groups?.list || []).filter((g) => !q || (g.name || "").toLowerCase().includes(q) || String(g.gid || g.id).includes(q));
  const rows = [
    ...groups.map((g) => ({ id: g.gid || g.id, type: 1, name: g.name || g.gid || g.id, avatar: g.avatar || "", last: g.lastMessage, isGroup: true })),
    ...friends.map((f) => ({ id: f.uid, type: 0, name: f.displayName || f.uid, avatar: f.avatar || "", last: f.lastMessage, isGroup: false }))
  ].filter((t) => !muted.includes(t.id));
  setLoading("chatThreads", rows.length ? rows.map((t) => {
    const unread = chatUnread[t.id] || 0;
    const tm = t.last?.ts ? new Date(t.last.ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
    const tJson = escapeAttr(JSON.stringify({ id: t.id, type: t.type, name: t.name, avatar: t.avatar, isGroup: t.isGroup }));
    const crown = t.isGroup && adminSet.has(t.id) ? '<span class="crown-badge" title="Bot cầm key">👑</span>' : "";
    return '<button class="thread ' + (chatCurrent?.id === t.id ? "active" : "") + '" data-t="' + tJson + '" onclick="openThreadJson(this)">' +
      '<span class="ava" onclick="event.stopPropagation();openThreadJson(this.parentElement)" title="Xem thông tin">' + threadAvatar(t) + (unread ? '<span class="unread">' + (unread > 9 ? "9+" : unread) + "</span>" : "") + "</span>" +
      "<span style=\"min-width:0\">" +
      '<span class="nm">' + escapeHtml(t.name) + " " + crown + ' <span class="tag ' + (t.isGroup ? "group" : "user") + '">' + (t.isGroup ? "Nhóm" : "Người dùng") + "</span></span>" +
      '<span class="pv">' + (t.last ? escapeHtml((t.last.name ? t.last.name + ": " : "") + String(t.last.text || "[tin nhắn]").slice(0, 42)) : (tm ? tm : "Chưa có tin nhắn")) + "</span>" +
      "</span></button>";
  }).join("") : '<div class="empty">Không có hội thoại khớp tìm kiếm.</div>');
}

// ---- mở hội thoại ----
function openThreadJson(el) {
  let t = {};
  try { t = JSON.parse(el.dataset.t || "{}"); } catch { return; }
  return openThread(t.id, t.type, t.name, t.avatar, t.isGroup);
}
async function openThread(id, type, name, avatar, isGroup) {
  chatCurrent = { id, type, name, avatar, isGroup };
  chatUnread[id] = 0;
  $("chatLayout").classList.add("opened");
  $("chatBack").style.display = "";
  $("chatTitle").textContent = name;
  $("chatSub").textContent = isGroup ? "Nhóm — bấm để xem thông tin" : "Người dùng — bấm để xem hồ sơ";
  if (avatar) $("chatAvatar").src = avatar;
  $("chatInput").disabled = false;
  $("chatSendBtn").disabled = false;
  renderThreadList();
  await loadChatMessages();
  clearInterval(chatTimer);
  chatTimer = setInterval(loadChatMessages, 2500);
}

function closeThread() {
  chatCurrent = null;
  clearInterval(chatTimer);
  chatTimer = null;
  $("chatLayout").classList.remove("opened");
  $("chatBack").style.display = "none";
  $("chatTitle").textContent = "Chọn hội thoại";
  $("chatSub").textContent = "bạn bè hoặc nhóm";
  $("chatInput").disabled = true;
  $("chatSendBtn").disabled = true;
  setLoading("chatMsgs", '<div class="empty">Chưa mở hội thoại — chọn bạn bè/nhóm để xem tin nhắn và chat trực tiếp.</div>');
  renderThreadList();
}

// ---- tin nhắn ----
async function loadChatMessages() {
  if (!chatCurrent) return;
  try {
    const data = await api("/api/chat/" + CHAT_BOT + "/messages?threadId=" + encodeURIComponent(chatCurrent.id) + "&type=" + chatCurrent.type + "&limit=80");
    const msgs = data.messages || [];
    const lastTs = msgs.length ? msgs[msgs.length - 1].ts : 0;
    chatLastSeen[chatCurrent.id] = lastTs;
    renderChatMessages(msgs);
  } catch { /* bo qua */ }
}

function renderChatMessages(messages) {
  if (!messages.length) {
    setLoading("chatMsgs", '<div class="empty">Chưa có tin nhắn nào.<br><br>Zalo không cho lấy lịch sử cũ — panel chỉ hiện tin từ khi bot hoạt động.</div>');
    return;
  }
  const box = $("chatMsgs");
  const input = $("chatInput");
  if (input) input.setAttribute("style", styleCss({ "max-width": "none" }));
  box.innerHTML = messages.map((m) => {
    const tm = new Date(m.ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    const personal = (styleExtra) => styleCss(styleExtra);
    if (m.isSelf) {
      return '<div class="msg out"><div class="col"><div class="bubble" style="' + personal() + '">' + escapeHtml(m.text || "") +
        '<div class="tm">' + tm + '</div><div class="acts"><button onclick="copyMsg(this)" title="Copy">📋</button></div></div></div></div>';
    }
    const ava = m.avatar || "";
    const showName = chatCurrent?.isGroup;
    const inStyle = styleCss();
    const avaHtml = '<span class="ava-click" onclick="openUserInfo(\'' + escapeAttr(m.from || "") + '\')" title="Xem hồ sơ">' +
      (ava ? '<img class="avatar" src="' + escapeAttr(ava) + '" alt="">' : '<span class="ph">👤</span>') + "</span>";
    return '<div class="msg">' + avaHtml +
      '<div class="col">' +
      (showName ? '<div class="who">' + escapeHtml(m.name || m.from || "") + "</div>" : "") +
      '<div class="bubble" style="' + inStyle + '">' + escapeHtml(m.text || "") + '<div class="tm">' + tm + '</div>' +
      '<div class="acts"><button onclick="copyMsg(this)" title="Copy">📋</button></div></div></div></div>';
  }).join("");
  box.scrollTop = box.scrollHeight;
}

function copyMsg(el) {
  const bubble = el.closest(".bubble");
  const text = bubble ? bubble.childNodes[0].textContent : "";
  navigator.clipboard?.writeText(text.trim());
  toast("Đã copy tin nhắn", "success");
}

// Zalo chỉ hỗ trợ: b/i/u/s + 4 màu + 2 cỡ chữ → quy đổi kiểu chữ panel
const ZALO_COLOR = { "#f43f5e": "c_db342e", "#f97316": "c_f27806", "#f59e0b": "c_f7b503", "#22c55e": "c_15a85f" };
const ZALO_FONT = { "13px": "f_13", "18px": "f_18" };
function zaloStyles(msg) {
  const styles = [];
  const push = (st) => styles.push({ start: 0, len: String(msg).length, st });
  if (chatStyle.bold) push("b");
  if (chatStyle.italic) push("i");
  if (chatStyle.underline) push("u");
  if (chatStyle.strike) push("s");
  if (chatStyle.color && ZALO_COLOR[chatStyle.color]) push(ZALO_COLOR[chatStyle.color]);
  if (chatStyle.font && ZALO_FONT[chatStyle.font]) push(ZALO_FONT[chatStyle.font]);
  return styles;
}

async function sendChat(e) {
  e.preventDefault();
  if (!chatCurrent) return;
  const msg = $("chatInput").value.trim();
  if (!msg) return;
  $("chatInput").value = "";
  try {
    const styles = zaloStyles(msg);
    await api("/api/chat/" + CHAT_BOT + "/send", {
      method: "POST",
      body: JSON.stringify({ threadId: chatCurrent.id, type: chatCurrent.type, msg, styles })
    });
    await loadChatMessages();
    if (chatStyle.fontFamily || chatStyle.glow) {
      toast("Font chữ + phát sáng chỉ hiển thị trên panel — Zalo không hỗ trợ 2 thứ này", "warn");
    }
  } catch (error) { toast(error.message, "error"); }
}

// ---- popup thông tin nhóm / hồ sơ người dùng ----
async function openUserInfo(uid) {
  if (!uid || uid === "me") return;
  $("infoTitle").textContent = "Hồ sơ";
  $("infoBody").innerHTML = '<div class="empty">Đang tải...</div>';
  $("infoModal").classList.add("open");
  try {
    const info = await api("/api/chat/" + CHAT_BOT + "/user-info?uid=" + encodeURIComponent(uid));
    renderUserInfo(info);
  } catch (e) {
    $("infoBody").innerHTML = '<div class="empty">' + escapeHtml(e.message) + "</div>";
  }
}

async function openThreadInfo() {
  if (!chatCurrent) return;
  const t = chatCurrent;
  $("infoTitle").textContent = t.isGroup ? "Thông tin nhóm" : "Hồ sơ";
  $("infoBody").innerHTML = '<div class="empty">Đang tải...</div>';
  $("infoModal").classList.add("open");
  try {
    const info = await api("/api/chat/" + CHAT_BOT + "/thread-info?threadId=" + encodeURIComponent(t.id) + "&type=" + t.type);
    if (t.isGroup) renderGroupInfo(info);
    else renderUserInfo(info);
  } catch (e) {
    $("infoBody").innerHTML = '<div class="empty">' + escapeHtml(e.message) + "</div>";
  }
}

function renderGroupInfo(g) {
  const uid = g.id || "";
  const hasKey = isAdminGroup(uid);
  $("infoBody").innerHTML = `
    <div class="info-ava">
      ${g.avatar ? '<img src="' + escapeAttr(g.avatar) + '" alt="">' : '<div class="ph">👥</div>'}
      <b>${escapeHtml(g.name || uid)}${hasKey ? ' <span style="color:var(--yellow)">👑</span>' : ""}</b>
      <div class="sub">${hasKey ? "Bot CẦM KEY nhóm này • quản trị viên" : "Bot chỉ là thành viên"} • ${g.totalMember || 0} thành viên • ID ${escapeHtml(uid)}</div>
    </div>
    <div class="info-grid">
      ${hasKey ? `
        <button class="info-act" onclick="groupAction('rename')"><span class="ic">✏️</span>Đổi tên nhóm</button>
        <button class="info-act" onclick="groupAction('adduser')"><span class="ic">➕</span>Thêm thành viên</button>
        <button class="info-act" onclick="groupAction('pinned')"><span class="ic">📍</span>Tin đã ghim</button>
        <button class="info-act" onclick="groupAction('priority')"><span class="ic">↩️</span>Chuyển sang Ưu tiên</button>` : `
        <button class="info-act" onclick="groupAction('info')"><span class="ic">🧾</span>Thông tin nhóm</button>
        <button class="info-act" onclick="groupAction('viewmsgs')"><span class="ic">💬</span>Xem tin nhắn</button>`}
      <button class="info-act" onclick="toggleMute('${escapeAttr(uid)}')"><span class="ic">🔕</span>${isMuted(uid) ? "Bỏ ẩn nhóm" : "Ẩn nhóm khỏi panel"}</button>
      <button class="info-act" onclick="toggleAdminGroup('${escapeAttr(uid)}')"><span class="ic">👑</span>${hasKey ? "Bỏ đánh dấu cầm key" : "Đánh dấu bot cầm key"}</button>
      <button class="info-act danger" onclick="groupAction('leave')"><span class="ic">🚪</span>Rời nhóm</button>
      ${hasKey ? `<button class="info-act full danger" onclick="groupAction('disperse')"><span class="ic">💥</span>Giải tán nhóm (không hoàn tác được)</button>` : ""}
    </div>
    ${hasKey ? `
    <div class="info-sec">Quản lý thành viên (nhập UID)</div>
    <div class="row">
      <input id="memberUidInput" placeholder="UID thành viên" style="flex:1;min-width:130px">
      <button class="small danger" onclick="userAction('remove', \$(\"memberUidInput\").value.trim())">Xoá</button>
      <button class="small danger" onclick="userAction('blockgroup', \$(\"memberUidInput\").value.trim())">Chặn</button>
      <button class="small" onclick="userAction('deputy', \$(\"memberUidInput\").value.trim())">👑 Phó nhóm</button>
      <button class="small" onclick="groupAction('adduser', \$(\"memberUidInput\").value.trim())">Thêm</button>
    </div>` : `
    <div class="sub" style="margin-top:12px">Bot chưa cầm key nhóm này — chỉ có thể rời nhóm và ẩn khỏi panel. Đánh dấu 👑 khi bạn tự cấp quyền quản trị cho bot trong Zalo.</div>`}
  `;
}

function renderUserInfo(u) {
  const uid = u.uid || u.id || "";
  const inGroup = chatCurrent?.isGroup;
  const hasKey = chatCurrent?.isGroup ? isAdminGroup(chatCurrent.id) : false;
  $("infoBody").innerHTML = `
    <div class="info-ava">
      ${u.avatar ? '<img src="' + escapeAttr(u.avatar) + '" alt="">' : '<div class="ph">👤</div>'}
      <b>${escapeHtml(u.name || uid)}</b>
      <div class="sub">UID: ${escapeHtml(uid)}${u.status ? " • " + escapeHtml(u.status) : ""}</div>
    </div>
    <div class="info-grid">
      <button class="info-act" onclick="userAction('check')"><span class="ic">🧾</span>Check profile</button>
      <button class="info-act" onclick="copyUid('${escapeAttr(uid)}')"><span class="ic">🆔</span>Get UID</button>
      ${inGroup && hasKey ? `
        <button class="info-act danger" onclick="userAction('remove', '${escapeAttr(uid)}')"><span class="ic">🗑️</span>Xoá khỏi nhóm</button>
        <button class="info-act danger" onclick="userAction('blockgroup', '${escapeAttr(uid)}')"><span class="ic">⛔</span>Chặn khỏi nhóm</button>
        <button class="info-act" onclick="userAction('deputy', '${escapeAttr(uid)}')"><span class="ic">👑</span>Đặt phó nhóm</button>` : `
        <button class="info-act danger" onclick="userAction('block')"><span class="ic">🚫</span>Chặn người dùng</button>`}
    </div>
    ${inGroup && !hasKey ? '<div class="sub" style="margin-top:12px">Bot chưa cầm key nhóm này — chỉ có thể chặn người dùng, không xoá khỏi nhóm được.</div>' : ""}
  `;
}

function closeInfoModal() { $("infoModal").classList.remove("open"); }
function toastSoon() { toast("Tính năng này chưa hỗ trợ", "warn"); }
function isAdminGroup(id) { return (chatAdminGroups || []).includes(id); }
async function toggleAdminGroup(id) {
  try {
    const res = await api("/api/chat/" + CHAT_BOT + "/toggle-admin-group", {
      method: "POST",
      body: JSON.stringify({ gid: id })
    });
    chatAdminGroups = res.groups || [];
    toast(chatAdminGroups.includes(id) ? "Đã đánh dấu bot cầm key 👑" : "Đã bỏ đánh dấu", "success");
    openThreadInfo();
    renderThreadList();
  } catch (e) { toast(e.message, "error"); }
}
function copyUid(uid) {
  navigator.clipboard?.writeText(uid);
  toast("Đã copy UID: " + uid, "success");
}
function isMuted(id) {
  try { return (JSON.parse(localStorage.getItem("jt_chat_muted") || "[]")).includes(id); } catch { return false; }
}
function toggleMute(id) {
  let muted = [];
  try { muted = JSON.parse(localStorage.getItem("jt_chat_muted") || "[]"); } catch { /* bo qua */ }
  muted = muted.includes(id) ? muted.filter((m) => m !== id) : [...muted, id];
  localStorage.setItem("jt_chat_muted", JSON.stringify(muted));
  toast(muted.includes(id) ? "Đã ẩn hội thoại khỏi panel" : "Đã bỏ ẩn", "success");
  openThreadInfo();
  renderThreadList();
}

async function groupAction(action, uid) {
  const soon = () => toast("Tính năng này chưa hỗ trợ", "warn");
  if (action === "pin" || action === "priority" || action === "avatar") return soon();
  if (action === "info" || action === "viewmsgs") return soon();
  if (action === "pinned") return soon();
  if (action !== "leave" && !isAdminGroup(chatCurrent?.id)) return toast("Bot chưa cầm key nhóm này — không có công cụ quản trị", "warn");
  if (action === "rename") {
    const name = prompt("Tên mới cho nhóm:", chatCurrent?.name || "");
    if (!name || !name.trim()) return;
    try {
      await api("/api/chat/" + CHAT_BOT + "/action", { method: "POST", body: JSON.stringify({ action: "rename-group", threadId: chatCurrent.id, value: name.trim() }) });
      toast("Đã đổi tên nhóm", "success");
      chatCurrent.name = name.trim();
      openThreadInfo();
    } catch (e) { toast(e.message, "error"); }
    return;
  }
  if (action === "adduser") {
    const target = (uid || (typeof $("memberUidInput") !== "undefined" && $("memberUidInput") ? $("memberUidInput").value : "") || "").trim();
    if (!target) return toast("Nhập UID cần thêm", "warn");
    try {
      await api("/api/chat/" + CHAT_BOT + "/action", { method: "POST", body: JSON.stringify({ action: "add-user", threadId: chatCurrent.id, uid: target }) });
      toast("Đã gửi lời mời thêm thành viên", "success");
      openThreadInfo();
    } catch (e) { toast(e.message, "error"); }
    return;
  }
  if (action === "disperse") {
    if (!confirm("GIẢI TÁN nhóm này? KHÔNG hoàn tác được!")) return;
    if (!confirm("Chắc chắn chứ? Nhóm sẽ mất hoàn toàn.")) return;
    try {
      await api("/api/chat/" + CHAT_BOT + "/action", { method: "POST", body: JSON.stringify({ action: "disperse-group", threadId: chatCurrent.id }) });
      toast("Đã giải tán nhóm", "success");
      closeInfoModal();
      loadThreads();
    } catch (e) { toast(e.message, "error"); }
    return;
  }
  if (action === "leave") {
    if (!confirm('Rời nhóm "' + chatCurrent?.name + '"? Hành động này thật trên Zalo.')) return;
    try {
      await api("/api/chat/" + CHAT_BOT + "/action", { method: "POST", body: JSON.stringify({ action: "leave-group", threadId: chatCurrent.id }) });
      toast("Đã rời nhóm", "success");
      closeInfoModal();
      loadThreads();
    } catch (e) { toast(e.message, "error"); }
  }
}

async function userAction(action, uid) {
  const targetUid = uid || chatCurrent?.id;
  const soon = () => toast("Tính năng này chưa hỗ trợ", "warn");
  if (action === "check" || action === "addfriend" || action === "call") return soon();
  if (action === "deputy") {
    if (!confirm("Đặt " + targetUid + " làm phó nhóm?")) return;
    try {
      await api("/api/chat/" + CHAT_BOT + "/action", { method: "POST", body: JSON.stringify({ action: "set-deputy", threadId: chatCurrent.id, uid: targetUid }) });
      toast("Đã đặt phó nhóm", "success");
      openThreadInfo();
    } catch (e) { toast(e.message, "error"); }
    return;
  }
  if (action === "remove" || action === "blockgroup") {
    if (chatCurrent?.isGroup && !isAdminGroup(chatCurrent.id)) return toast("Bot chưa cầm key nhóm này — không xoá/chặn thành viên được", "warn");
  }
  if (action === "block") {
    if (!confirm("Chặn người dùng " + targetUid + "? Hành động này thật trên Zalo.")) return;
    try {
      await api("/api/chat/" + CHAT_BOT + "/action", { method: "POST", body: JSON.stringify({ action: "block-user", uid: targetUid }) });
      toast("Đã chặn", "success");
    } catch (e) { toast(e.message, "error"); }
  }
  if (action === "remove") {
    if (!confirm("Xoá " + targetUid + " khỏi nhóm? Hành động này thật trên Zalo.")) return;
    try {
      await api("/api/chat/" + CHAT_BOT + "/action", { method: "POST", body: JSON.stringify({ action: "remove-user", threadId: chatCurrent.id, uid: targetUid }) });
      toast("Đã xoá khỏi nhóm", "success");
      openThreadInfo();
    } catch (e) { toast(e.message, "error"); }
  }
  if (action === "blockgroup") {
    if (!confirm("Chặn " + targetUid + " khỏi nhóm? Hành động này thật trên Zalo.")) return;
    try {
      await api("/api/chat/" + CHAT_BOT + "/action", { method: "POST", body: JSON.stringify({ action: "block-group-user", threadId: chatCurrent.id, uid: targetUid }) });
      toast("Đã chặn khỏi nhóm", "success");
    } catch (e) { toast(e.message, "error"); }
  }
}

/* ---------- VIP: keyboard shortcuts & debounced search ---------- */
function bindVipUi() {
  const cmdSearch = $("cmdSearch");
  if (cmdSearch) cmdSearch.addEventListener("input", debounce(renderCommands, 180));
  const chatSearch = $("chatSearch");
  if (chatSearch) chatSearch.addEventListener("input", debounce(renderThreadList, 180));

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggleDrawer();
    }
    if (e.key === "Escape") {
      ["styleModal", "colorModal", "infoModal", "modal"].forEach((id) => {
        const el = $(id);
        if (el && el.classList.contains("open")) el.classList.remove("open");
      });
      clearInterval(logTimer); logTimer = null;
      clearInterval(qrPoll); qrPoll = null;
    }
  });
}

/* ---------- khởi động ---------- */
loadConfig();
loadChatStyle();
bindVipUi();
if (!TOKEN) toggleDrawer();
refresh();
loadCommandList();
showView("bots");
