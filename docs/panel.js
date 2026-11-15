"use strict";

/* JOHNTRAN Control Center — frontend rebuilt without dependencies. */
const $ = (id) => document.getElementById(id);
const state = {
  api: "", token: "", view: "overview",
  bots: [], metrics: null, commands: [], commandStatus: [],
  botStats: {}, selectedProfile: "",
  chatData: { friends: { list: [] }, groups: { list: [] } },
  adminGroups: [], selectedThread: null, messages: [],
  threadFilter: "all", chatStyle: { b:false, i:false, u:false, s:false, color:"", font:"" },
  timers: { refresh:null, messages:null, threads:null, logs:null, qr:null },
  modalKind: "", modalBot: "", mutedThreads: readMuted()
};

const VIEWS = {
  overview: ["Tổng quan hệ thống", "OVERVIEW"],
  chat: ["Zalo Chat", "MESSAGES"],
  commands: ["Quản lý lệnh", "COMMANDS"],
  groups: ["Thiết lập nhóm", "GROUPS"],
  profile: ["Hồ sơ & dữ liệu", "ACCOUNT DATA"],
  system: ["Hệ thống", "INFRASTRUCTURE"]
};
const STATUS = {
  online:["Đang chạy","online"],offline:["Chưa chạy","offline"],stopped:["Đã dừng","stopped"],
  restarting:["Đang khởi động lại","starting"],starting:["Đang khởi động","starting"],
  qr_pending:["Đang chờ QR","qr_pending"],qr_scanned:["Đã quét QR","qr_scanned"],
  waiting_login:["Chờ đăng nhập","qr_pending"],cookie_login:["Đăng nhập cookie","starting"],
  failed:["Đăng nhập lỗi","failed"]
};
const ZALO_COLORS = {"#f43f5e":"c_db342e","#f97316":"c_f27806","#f59e0b":"c_f7b503","#22c55e":"c_15a85f"};
const ZALO_FONTS = {"13px":"f_13","18px":"f_18"};
const $escape = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const enc = value => encodeURIComponent(String(value ?? ""));
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function readMuted() {
  try { const data = JSON.parse(localStorage.getItem("jt_panel_muted") || "[]"); return Array.isArray(data) ? data : []; }
  catch { return []; }
}
function saveMuted() { localStorage.setItem("jt_panel_muted", JSON.stringify(state.mutedThreads)); }
function safeImage(url) {
  const value = String(url || "");
  return /^https?:\/\//i.test(value) ? $escape(value) : "";
}
function initials(value) {
  return Array.from(String(value || "?").trim())[0]?.toUpperCase() || "?";
}
function avatarHtml(url, name, extra = "") {
  const src = safeImage(url);
  return src
    ? '<span class="avatar ' + extra + '"><img src="' + src + '" alt="" loading="lazy"></span>'
    : '<span class="avatar ' + extra + '">' + $escape(initials(name)) + '</span>';
}
function fmtUptime(ms) {
  let seconds = Math.max(0, Math.floor(number(ms) / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  if (days) return days + "d " + hours + "h";
  if (hours) return hours + "h " + minutes + "m";
  return minutes + "m " + (seconds % 60) + "s";
}
function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}
function botStatus(bot) {
  const key = String(bot?.loginState || bot?.status || "offline");
  return STATUS[key] || [key, "offline"];
}
function toast(message, kind = "") {
  const node = $("toast");
  if (!node) return;
  node.textContent = String(message || "");
  node.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove("show"), 2700);
}
function setConnection(ok, label, error = "") {
  const pill = $("connectionPill");
  if (pill) pill.className = "connection-pill " + (ok ? "online" : "offline");
  if ($("connectionText")) $("connectionText").textContent = label;
  if ($("sideDot")) $("sideDot").className = "live-dot " + (ok ? "online" : "offline");
  if ($("sideConnection")) $("sideConnection").textContent = ok ? "Đã kết nối" : "Mất kết nối";
  if ($("sideHost")) $("sideHost").textContent = state.api || "Panel host";
  if ($("connectionBanner")) $("connectionBanner").hidden = ok;
  if ($("connectionError") && error) $("connectionError").textContent = error;
  if ($("settingsStatus")) $("settingsStatus").textContent = ok ? "Kết nối thành công." : (error || "Chưa có kết nối.");
}
function loadSettings() {
  state.api = (localStorage.getItem("jt_panel_url") || window.location.origin).replace(/\/+$/, "");
  state.token = sessionStorage.getItem("jt_panel_token") || "";
  $("remoteUrl").value = state.api;
  $("panelToken").value = state.token;
}
function openSettings() {
  $("settingsDrawer").classList.add("open");
  $("settingsDrawer").setAttribute("aria-hidden","false");
  $("settingsBackdrop").hidden = false;
}
function closeSettings() {
  $("settingsDrawer").classList.remove("open");
  $("settingsDrawer").setAttribute("aria-hidden","true");
  $("settingsBackdrop").hidden = true;
}
async function api(path, options = {}) {
  if (!state.api) throw new Error("Chưa cấu hình Panel URL.");
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = "Bearer " + state.token;
  const response = await fetch(state.api + path, { ...options, headers, cache:"no-store" });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json().catch(() => ({})) : await response.text();
  if (!response.ok) {
    const message = typeof body === "object" ? (body.error || "HTTP " + response.status) : String(body || "HTTP " + response.status);
    throw new Error(message);
  }
  return body;
}
function jsonBody(value) { return JSON.stringify(value || {}); }

function showView(name) {
  if (!VIEWS[name]) return;
  state.view = name;
  document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === "view-" + name));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === name));
  $("viewTitle").textContent = VIEWS[name][0];
  $("crumb").textContent = VIEWS[name][1];
  $("sidebar").classList.remove("open");
  if (name === "chat") {
    loadThreads();
    startThreadPolling();
  } else stopThreadPolling();
  if (name === "commands") loadCommands();
  if (name === "profile") loadProfiles();
  if (name === "system") loadSystem();
  if (name === "overview") refreshOverview();
  window.scrollTo({top:0,behavior:"smooth"});
}

async function refreshOverview() {
  try {
    const data = await api("/api/bots");
    state.bots = Array.isArray(data.bots) ? data.bots : [];
    renderBots();
    await loadMetrics();
    $("lastSync").textContent = "Đồng bộ " + new Date().toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    setConnection(true, state.bots.length + " bot");
    return true;
  } catch (error) {
    setConnection(false, "Chưa kết nối", error.message);
    $("botList").innerHTML = '<div class="empty-state">Không tải được bot. ' + $escape(error.message) + '</div>';
    return false;
  }
}
async function loadMetrics() {
  try {
    const m = await api("/api/metrics");
    state.metrics = m;
    const running = state.bots.filter(b => b.status === "online").length;
    const t = m.today || {};
    $("metricsGrid").innerHTML = [
      ["BOT ĐANG CHẠY", running, state.bots.length + " tài khoản được quản lý"],
      ["LỆNH HÔM NAY", t.commands || 0, "Tổng số lần thực thi"],
      ["LỖI HÔM NAY", t.errors || 0, number(t.errors) ? "Cần kiểm tra nhật ký" : "Không ghi nhận lỗi"],
      ["RAM HOST", (m.memoryMb || 0) + " MB", "Node " + (m.node || processVersionFallback())]
    ].map(([label,value,hint]) => '<div class="metric"><span>' + label + '</span><b>' + $escape(value) + '</b><small>' + $escape(hint) + '</small></div>').join("");
    renderTopCommands(m.topCommands || []);
    renderHostSummary(m);
  } catch (error) {
    $("metricsGrid").innerHTML = '<div class="empty-state">Không tải được metrics: ' + $escape(error.message) + '</div>';
  }
}
function processVersionFallback() { return "—"; }
function renderBots() {
  if (!state.bots.length) {
    $("botList").innerHTML = '<div class="empty-state">Chưa có bot nào trong registry.</div>';
    return;
  }
  $("botList").innerHTML = state.bots.map(bot => {
    const [label, cls] = botStatus(bot);
    const main = bot.name === "main";
    return '<article class="bot-row">' +
      '<div class="bot-identity"><div class="bot-mark">◈</div><div><div class="bot-name">' + $escape(bot.name) + (main ? ' <span class="role-tag">MASTER</span>' : '') + '</div><div class="bot-meta">PID ' + $escape(bot.pid || "—") + ' · ' + (bot.flapping ? '<span style="color:var(--red)">CRASH LOOP</span>' : (bot.sessionHint ? $escape(bot.sessionHint) : "JOHNTRAN instance")) + '</div></div></div>' +
      '<div><div class="status-label ' + cls + '"><i class="dot"></i>' + $escape(label) + '</div><div class="bot-meta">Uptime ' + fmtUptime(bot.uptimeMs) + ' · restart ' + number(bot.restarts) + '</div></div>' +
      '<div class="bot-stats"><span>PORT <b>' + $escape(bot.bridgePort || "—") + '</b></span><span>QR <b>' + (bot.hasQr ? "READY" : "—") + '</b></span><label class="auto-restart"><input type="checkbox" data-action="auto-restart" data-bot="' + $escape(bot.name) + '" ' + (bot.autoRestart ? "checked" : "") + '> Auto restart</label></div>' +
      '<div class="bot-actions">' +
        '<button class="mini-action" data-action="bot-start" data-bot="' + $escape(bot.name) + '">Chạy</button>' +
        '<button class="mini-action" data-action="bot-stop" data-bot="' + $escape(bot.name) + '">Dừng</button>' +
        '<button class="mini-action" data-action="bot-restart" data-bot="' + $escape(bot.name) + '">Restart</button>' +
        '<button class="mini-action" data-action="bot-qr" data-bot="' + $escape(bot.name) + '">QR</button>' +
        '<button class="mini-action" data-action="bot-session" data-bot="' + $escape(bot.name) + '">Phiên</button>' +
        '<button class="mini-action" data-action="bot-logs" data-bot="' + $escape(bot.name) + '">Logs</button>' +
        (main ? "" : '<button class="mini-action danger" data-action="bot-remove" data-bot="' + $escape(bot.name) + '">Xoá</button>') +
      '</div></article>';
  }).join("");
}
function renderTopCommands(rows) {
  if (!rows.length) { $("topCommands").innerHTML = '<div class="empty-state">Chưa có lệnh nào hôm nay.</div>'; return; }
  const max = Math.max(1, ...rows.map(row => number(row[1])));
  $("topCommands").innerHTML = rows.slice(0,7).map((row,index) => '<div class="top-command"><span class="rank">' + String(index+1).padStart(2,"0") + '</span><code>/' + $escape(row[0]) + '</code><span class="bar"><i style="width:' + (number(row[1])/max*100).toFixed(1) + '%"></i></span><b>' + number(row[1]) + '</b></div>').join("");
}
function renderHostSummary(m) {
  const values = [["NODE",m.node || "—"],["UPTIME",fmtUptime(m.uptimeMs)],["RAM",number(m.memoryMb)+" MB"],["BOT CON",state.bots.filter(b=>b.name!=="main").length]];
  $("hostSummary").innerHTML = values.map(([k,v]) => '<div class="host-item"><small>' + k + '</small><b>' + $escape(v) + '</b></div>').join("");
}

async function createBot() {
  const name = window.prompt("Tên bot con (chỉ chữ, số, - hoặc _):");
  if (!name) return;
  try {
    await api("/api/bots",{method:"POST",body:jsonBody({name:name.trim()})});
    toast("Đã tạo bot " + name,"success");
    await refreshOverview();
  } catch (error) { toast(error.message,"error"); }
}
async function botAction(name, action) {
  try {
    await api("/api/bots/" + enc(name) + "/" + action,{method:"POST"});
    toast("Đã gửi lệnh " + action + " cho " + name,"success");
    await refreshOverview();
  } catch (error) { toast(error.message,"error"); }
}
async function setAutoRestart(name, enabled) {
  try {
    await api("/api/bots/" + enc(name),{method:"PATCH",body:jsonBody({autoRestart:enabled})});
    toast(name + ": auto-restart " + (enabled ? "BẬT" : "TẮT"),"success");
  } catch (error) { toast(error.message,"error"); await refreshOverview(); }
}
async function removeBot(name) {
  if (!window.confirm("Xoá bot '" + name + "' và toàn bộ dữ liệu riêng của bot này? Không thể hoàn tác.")) return;
  try {
    await api("/api/bots/" + enc(name),{method:"DELETE"});
    toast("Đã xoá bot " + name,"success");
    await refreshOverview();
  } catch (error) { toast(error.message,"error"); }
}

function openModal(title, kind = "info", eyebrow = "JOHNTRAN") {
  state.modalKind = kind;
  $("modalTitle").textContent = title;
  $("modalEyebrow").textContent = eyebrow;
  $("modalContent").innerHTML = '<div class="empty-state">Đang tải…</div>';
  $("modalActions").innerHTML = "";
  $("modalBackdrop").hidden = false;
}
function closeModal() {
  $("modalBackdrop").hidden = true;
  clearInterval(state.timers.logs); state.timers.logs = null;
  clearInterval(state.timers.qr); state.timers.qr = null;
  if (state.qrObjectUrl) { URL.revokeObjectURL(state.qrObjectUrl); state.qrObjectUrl = null; }
  state.modalKind = "";
}
async function showLogs(name) {
  state.modalBot = name;
  openModal("Logs · " + name,"logs","LIVE PROCESS OUTPUT");
  const render = async () => {
    if (state.modalKind !== "logs") return;
    try {
      const data = await api("/api/bots/" + enc(name) + "/logs?lines=240");
      $("modalContent").innerHTML = '<pre>' + $escape((data.logs || []).join("\n") || "(chưa có log)") + '</pre>';
      const pre = $("modalContent").querySelector("pre");
      if (pre) pre.scrollTop = pre.scrollHeight;
    } catch (error) { $("modalContent").innerHTML = '<div class="empty-state">' + $escape(error.message) + '</div>'; }
  };
  await render();
  state.timers.logs = setInterval(render,3500);
}
async function showQr(name) {
  state.modalBot = name;
  openModal("QR đăng nhập · " + name,"qr","ZALO AUTHENTICATION");
  const render = async () => {
    if (state.modalKind !== "qr") return;
    try {
      const bot = (await api("/api/bots")).bots?.find(item => item.name === name);
      const response = await fetch(state.api + "/api/bots/" + enc(name) + "/qr?ts=" + Date.now(), {headers:state.token ? {Authorization:"Bearer "+state.token} : {},cache:"no-store"});
      if (response.ok) {
        const blob = await response.blob();
        if (state.qrObjectUrl) URL.revokeObjectURL(state.qrObjectUrl);
        state.qrObjectUrl = URL.createObjectURL(blob);
        $("modalContent").innerHTML = '<div class="qr-view"><img src="' + state.qrObjectUrl + '" alt="QR đăng nhập Zalo"><b>Quét mã QR bằng ứng dụng Zalo</b><p>' + $escape(bot?.loginState || bot?.status || "Đang chờ đăng nhập") + '</p></div>';
      } else {
        const data = await response.json().catch(() => ({}));
        const waiting = bot && ["starting","qr_pending","qr_scanned","waiting_login","cookie_login"].includes(bot.loginState || bot.status);
        $("modalContent").innerHTML = '<div class="qr-view"><div class="conversation-empty"><span>▦</span><b>' + $escape(bot?.status === "online" ? "Bot đã chạy / có thể đã đăng nhập" : "QR chưa sẵn sàng") + '</b><small>' + $escape(data.error || (waiting ? "Đang chờ bot tạo mã QR…" : "Khởi động bot để tạo QR.")) + '</small></div></div>';
        if (!waiting && bot?.status !== "online") clearInterval(state.timers.qr);
      }
    } catch (error) {
      $("modalContent").innerHTML = '<div class="empty-state">' + $escape(error.message) + '</div>';
    }
  };
  await render();
  state.timers.qr = setInterval(render,4500);
}
async function showSession(name) {
  openModal("Phiên đăng nhập · " + name,"session","SESSION HEALTH");
  try {
    const s = await api("/api/bots/" + enc(name) + "/session");
    const rows = [
      ["Trạng thái",s.loginState || s.status || "—"],
      ["account.json",s.hasAccountFile ? "Có" : "Không"],
      ["cookie.json",s.hasCookieFile ? "Có" : "Không"],
      ["Cookie có cấu trúc hợp lệ",s.cookieLooksValidShape ? "Có" : "Không"],
      ["Cập nhật",fmtDate(s.updatedAt)],
      ["Account path",s.accountPathRelative],
      ["Cookie path",s.cookiePathRelative],
      ["Database path",s.dbPathRelative]
    ];
    $("modalContent").innerHTML = '<div class="session-table">' + rows.map(([k,v]) => '<div>' + $escape(k) + '</div><div>' + $escape(v || "—") + '</div>').join("") + '</div><p class="hint-line" style="margin-top:14px">Panel chỉ hiển thị metadata an toàn; không đọc hoặc trả token, cookie hay nội dung account.json.</p>';
  } catch (error) { $("modalContent").innerHTML = '<div class="empty-state">' + $escape(error.message) + '</div>'; }
}

async function loadCommands() {
  try {
    const [cmdData,statusData] = await Promise.all([api("/api/commands"),api("/api/commands/status")]);
    state.commands = cmdData.commands || [];
    state.commandStatus = statusData.commands || [];
    renderCommands();
    renderCommandHealth(statusData);
  } catch (error) { $("commandGrid").innerHTML = '<div class="empty-state">' + $escape(error.message) + '</div>'; }
}
function renderCommands() {
  const q = ($("commandSearch").value || "").trim().toLowerCase();
  const category = $("commandCategory").value;
  const role = $("commandRole").value;
  const cats = [...new Set(state.commands.map(c => c.category || "Khác"))].sort((a,b)=>a.localeCompare(b,"vi"));
  const current = $("commandCategory").value;
  $("commandCategory").innerHTML = '<option value="">Tất cả danh mục</option>' + cats.map(c => '<option value="' + $escape(c) + '">' + $escape(c) + '</option>').join("");
  $("commandCategory").value = cats.includes(category) ? category : current && cats.includes(current) ? current : "";
  const list = state.commands.filter(c => {
    if ($("commandCategory").value && c.category !== $("commandCategory").value) return false;
    if (role !== "" && String(c.role) !== role) return false;
    const hay = [c.name,(c.aliases||[]).join(" "),c.description,c.category].join(" ").toLowerCase();
    return !q || hay.includes(q);
  });
  $("commandSummary").innerHTML = [
    ["TỔNG LỆNH",state.commands.length],["HIỂN THỊ",list.length],["DANH MỤC",cats.length]
  ].map(([k,v])=>'<div class="summary-chip"><span>'+k+'</span><b>'+v+'</b></div>').join("");
  $("commandGrid").innerHTML = list.length ? list.map(c => '<div class="command-item"><span class="command-symbol">⌘</span><div class="command-copy"><b>/' + $escape(c.name) + '</b><small>' + $escape(c.description || "Chưa có mô tả") + (c.aliases?.length ? " · alias: " + $escape(c.aliases.join(", ")) : "") + '</small></div><span class="role-tag">' + (c.role === 2 ? "ADMIN" : c.role === 1 ? "SUPPORT" : "MEMBER") + '</span></div>').join("") : '<div class="empty-state">Không có lệnh phù hợp bộ lọc.</div>';
}
function renderCommandHealth(data) {
  $("commandStatusCount").textContent = (data.ready ?? 0) + "/" + (data.total ?? 0) + " READY";
  $("commandStatusHint").textContent = data.blocked ? data.blocked + " lệnh đang thiếu API hoặc cấu hình phụ thuộc." : "Tất cả lệnh đã đủ cấu hình theo bản audit hiện tại.";
  $("commandStatusHint").className = "hint-line" + (data.blocked ? " bad" : "");
  const rows = [...state.commandStatus.filter(c=>!c.ready),...state.commandStatus.filter(c=>c.ready)];
  $("commandStatusList").innerHTML = rows.map(c => '<div class="command-health ' + (c.ready ? "" : "bad") + '"><i class="health-dot"></i><b>/' + $escape(c.name) + '</b><span>' + (c.ready ? "READY" : "MISSING · " + $escape((c.missing||[]).join(", "))) + '</span></div>').join("") || '<div class="empty-state">Không có dữ liệu.</div>';
}
async function loadGroupCommands() {
  const gid = $("groupIdInput").value.trim();
  if (!gid) return toast("Nhập Group ID trước.","error");
  try {
    if (!state.commands.length) await loadCommands();
    const data = await api("/api/groups/" + enc(gid) + "/commands");
    const disabled = new Set(data.disabled || []);
    $("groupHint").textContent = "Nhóm " + gid + " · " + disabled.size + " lệnh đang tắt.";
    $("groupCommandList").innerHTML = state.commands.map(c => '<div class="group-command"><div><b>/' + $escape(c.name) + '</b><small>' + $escape(c.description || "Chưa có mô tả") + '</small></div><label class="switch"><input type="checkbox" data-action="toggle-command" data-command="' + $escape(c.name) + '" ' + (disabled.has(c.name) ? "" : "checked") + '><span></span></label></div>').join("");
    state.activeGroup = gid;
  } catch (error) { toast(error.message,"error"); }
}
async function toggleGroupCommand(command, enabled, checkbox) {
  const gid = state.activeGroup || $("groupIdInput").value.trim();
  if (!gid) return;
  checkbox.disabled = true;
  try {
    await api("/api/groups/" + enc(gid) + "/commands",{method:"PATCH",body:jsonBody({command,enabled})});
    $("groupHint").textContent = "Đã " + (enabled ? "bật" : "tắt") + " /" + command + " cho nhóm " + gid + ".";
  } catch (error) {
    checkbox.checked = !enabled;
    toast(error.message,"error");
  } finally { checkbox.disabled = false; }
}

async function loadProfiles() {
  try {
    const {stats} = await api("/api/stats");
    state.botStats = stats || {};
    const names = Object.keys(state.botStats).sort((a,b)=>(number(state.botStats[b]?.updatedAt)-number(state.botStats[a]?.updatedAt)));
    const selected = state.selectedProfile && state.botStats[state.selectedProfile] ? state.selectedProfile : names[0] || "";
    state.selectedProfile = selected;
    $("profileBotSelect").innerHTML = names.length ? names.map(n=>'<option value="'+$escape(n)+'">'+$escape(n)+'</option>').join("") : '<option value="">Chưa có dữ liệu</option>';
    $("profileBotSelect").value = selected;
    renderProfile(selected);
  } catch (error) { $("profileDetails").innerHTML = '<div class="empty-state">'+$escape(error.message)+'</div>'; }
}
function renderProfile(name) {
  const data = state.botStats[name] || {};
  const p = data.profile || {};
  if (!name || !Object.keys(data).length) {
    $("profileAvatar").textContent = "JT"; $("profileName").textContent = "Chưa có dữ liệu";
    $("profileUid").textContent = "Bot chưa gửi thống kê tài khoản.";
    $("profileDetails").innerHTML = '<div class="empty-state">Chưa nhận dữ liệu hồ sơ. Bot cần đăng nhập và gửi thống kê.</div>';
    $("friendList").innerHTML = '<div class="empty-state">Không có dữ liệu</div>';
    $("profileGroupList").innerHTML = '<div class="empty-state">Không có dữ liệu</div>';
    $("friendCount").textContent = "0"; $("profileGroupCount").textContent = "0";
    return;
  }
  const online = data.loginState === "logged_in" || (data.status === "online" && number(data.updatedAt) > Date.now()-90000);
  $("profileAvatar").innerHTML = safeImage(p.avatar) ? '<img src="'+safeImage(p.avatar)+'" alt="">' : $escape(initials(p.displayName || name));
  $("profileName").textContent = p.displayName || name;
  $("profileUid").textContent = p.uid || "—";
  $("profileState").textContent = online ? "ONLINE" : "OFFLINE";
  $("profileState").style.color = online ? "var(--green)" : "var(--muted)";
  $("profileUpdated").textContent = "Cập nhật: " + fmtDate(data.updatedAt);
  const rows = [["Bot",name],["UID",p.uid],["Số điện thoại",p.phoneNumber],["Bạn bè",data.friends?.total ?? 0],["Nhóm",data.groups?.total ?? 0],["Login state",data.loginState],["Cập nhật",fmtDate(data.updatedAt)]];
  $("profileDetails").innerHTML = rows.map(([k,v])=>'<div class="detail-row"><span>'+$escape(k)+'</span><b>'+$escape(v ?? "—")+'</b></div>').join("");
  const friends = data.friends?.list || [], groups = data.groups?.list || [];
  $("friendCount").textContent = data.friends?.total ?? friends.length;
  $("profileGroupCount").textContent = data.groups?.total ?? groups.length;
  $("friendList").innerHTML = friends.length ? friends.slice(0,160).map(f=>'<div class="entity-row">'+avatarHtml(f.avatar,f.displayName||f.zaloName||f.uid)+'<div><b>'+$escape(f.displayName||f.zaloName||f.uid)+'</b><small>'+$escape(f.uid)+'</small></div></div>').join("") : '<div class="empty-state">Không có bạn bè được ghi nhận.</div>';
  $("profileGroupList").innerHTML = groups.length ? groups.slice(0,160).map(g=>'<div class="entity-row">'+avatarHtml(g.avatar,g.name||g.groupName||g.id)+'<div><b>'+$escape(g.name||g.groupName||g.id)+'</b><small>'+$escape(g.id)+'</small></div></div>').join("") : '<div class="empty-state">Không có nhóm được ghi nhận.</div>';
}

async function loadSystem() {
  try {
    const m = await api("/api/metrics");
    const values = [["Bot con",Math.max(0,state.bots.length-1)],["Node",m.node],["Uptime host",fmtUptime(m.uptimeMs)],["RAM",number(m.memoryMb)+" MB"],["Lệnh hôm nay",m.today?.commands ?? 0],["Lỗi hôm nay",m.today?.errors ?? 0],["Tìm nhạc",m.today?.musicSearch ?? 0],["Tải nhạc",m.today?.musicDownload ?? 0]];
    $("systemDetails").innerHTML = values.map(([k,v])=>'<div class="detail-row"><span>'+$escape(k)+'</span><b>'+$escape(v ?? "—")+'</b></div>').join("");
    const cache = m.cache || {};
    const tables = cache.tables || {};
    const entries = Object.entries(tables);
    $("cacheDetails").innerHTML = entries.length ? entries.map(([name,item])=>'<div class="cache-row"><span>'+$escape(name)+'</span><b>'+number(item.hits)+' hit / '+number(item.misses)+' miss</b></div>').join("") : '<div class="cache-row"><span>Total hits</span><b>'+number(cache.total)+'</b></div>';
    $("auditLog").textContent = (m.audit || []).join("\n") || "(chưa có hành động admin)";
  } catch (error) { $("systemDetails").innerHTML = '<div class="empty-state">'+$escape(error.message)+'</div>'; }
}

function readMutedThreads() { return state.mutedThreads || []; }
function threadRows() {
  const friends = state.chatData.friends?.list || [], groups = state.chatData.groups?.list || [];
  return [
    ...groups.map(g=>({id:String(g.gid||g.id||""),type:1,name:g.name||g.groupName||g.gid||g.id,avatar:g.avatar||"",last:g.lastMessage,isGroup:true})),
    ...friends.map(f=>({id:String(f.uid||""),type:0,name:f.displayName||f.zaloName||f.uid,avatar:f.avatar||"",last:f.lastMessage,isGroup:false}))
  ].filter(t=>t.id && !state.mutedThreads.includes(t.id));
}
async function loadThreads() {
  try {
    const bot = $("chatBotSelect").value || "main";
    const data = await api("/api/chat/" + enc(bot) + "/threads");
    state.chatData = data;
    state.adminGroups = data.adminGroups || [];
    renderThreads();
    if (state.selectedThread) {
      const found = threadRows().find(t=>t.id===state.selectedThread.id && t.type===state.selectedThread.type);
      if (!found) closeThread();
    }
  } catch (error) {
    $("threadList").innerHTML = '<div class="empty-state">' + $escape(error.message) + '<br>Bot có thể chưa đăng nhập hoặc cầu nối chat chưa hoạt động.</div>';
  }
}
function renderThreads() {
  const q = ($("threadSearch").value||"").trim().toLowerCase();
  const rows = threadRows().filter(t=>{
    if (state.threadFilter === "groups" && !t.isGroup) return false;
    if (state.threadFilter === "friends" && t.isGroup) return false;
    return !q || (t.name+" "+t.id).toLowerCase().includes(q);
  });
  $("threadList").innerHTML = rows.length ? rows.map(t=>{
    const active = state.selectedThread?.id===t.id && state.selectedThread?.type===t.type;
    const preview = t.last ? (t.last.name ? t.last.name+": " : "") + (t.last.text || "[tin nhắn]") : "Chưa có tin nhắn";
    const time = t.last?.ts ? new Date(t.last.ts).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"}) : "";
    const key = state.adminGroups.includes(t.id) ? " · 👑" : "";
    return '<button class="thread-item '+(active?"active":"")+'" data-action="open-thread" data-id="'+$escape(t.id)+'" data-type="'+t.type+'"><span class="avatar">'+(safeImage(t.avatar)?'<img src="'+safeImage(t.avatar)+'" alt="">':$escape(initials(t.name)))+'</span><span class="thread-copy"><span class="thread-title">'+$escape(t.name)+$escape(key)+' <small class="thread-kind">'+(t.isGroup?"NHÓM":"BẠN BÈ")+'</small></span><span class="thread-preview">'+$escape(preview)+'</span></span><small style="color:var(--muted-2)">'+$escape(time)+'</small></button>';
  }).join("") : '<div class="empty-state">Không tìm thấy hội thoại.</div>';
}
async function openThread(t) {
  state.selectedThread = t;
  $("chatWorkspace")?.classList.add("thread-open");
  $("activeThreadName").textContent = t.name;
  $("activeThreadSub").textContent = t.isGroup ? "Nhóm Zalo · " + t.id : "Người dùng · " + t.id;
  $("activeAvatar").innerHTML = safeImage(t.avatar) ? '<img src="'+safeImage(t.avatar)+'" alt="">' : $escape(initials(t.name));
  $("chatMessage").disabled = false; $("sendButton").disabled = false; $("threadInfoButton").disabled = false;
  renderThreads();
  await loadMessages();
  clearInterval(state.timers.messages);
  state.timers.messages = setInterval(loadMessages,2800);
}
function closeThread() {
  state.selectedThread = null;
  clearInterval(state.timers.messages); state.timers.messages = null;
  $("chatWorkspace")?.classList.remove("thread-open");
  $("activeThreadName").textContent = "Chọn hội thoại";
  $("activeThreadSub").textContent = "Chưa mở cuộc trò chuyện";
  $("activeAvatar").textContent = "Z";
  $("chatMessage").disabled = true; $("sendButton").disabled = true; $("threadInfoButton").disabled = true;
  $("messageList").innerHTML = '<div class="conversation-empty"><span>◌</span><b>Chưa chọn hội thoại</b><small>Chọn một người dùng hoặc nhóm ở danh sách bên trái.</small></div>';
  renderThreads();
}
async function loadMessages() {
  const t = state.selectedThread;
  if (!t) return;
  try {
    const bot = $("chatBotSelect").value || "main";
    const data = await api("/api/chat/"+enc(bot)+"/messages?threadId="+enc(t.id)+"&type="+t.type+"&limit=80");
    state.messages = data.messages || [];
    renderMessages();
  } catch (error) { $("messageList").innerHTML = '<div class="empty-state">'+$escape(error.message)+'</div>'; }
}
function renderMessages() {
  const list = state.messages || [];
  if (!list.length) {
    $("messageList").innerHTML = '<div class="conversation-empty"><span>◌</span><b>Chưa có tin nhắn</b><small>Panel chỉ có lịch sử nhóm mà bridge lấy được và tin nhận trong thời gian bot hoạt động.</small></div>';
    return;
  }
  const html = list.map(m=>{
    const outgoing = Boolean(m.isSelf);
    const time = m.ts ? new Date(m.ts).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"}) : "";
    const name = m.name || m.from || "Thành viên";
    const avatar = safeImage(m.avatar) ? '<span class="message-avatar"><img src="'+safeImage(m.avatar)+'" alt=""></span>' : '<span class="message-avatar">'+$escape(initials(name))+'</span>';
    return '<div class="message-row '+(outgoing?"outgoing":"")+'">'+(outgoing?"":avatar)+'<div class="message-content">'+(!outgoing && state.selectedThread?.isGroup?'<small class="message-sender">'+$escape(name)+'</small>':"")+'<div class="message-bubble">'+$escape(m.text||"")+'<div class="message-time">'+$escape(time)+'</div></div></div></div>';
  }).join("");
  const box = $("messageList");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
  box.innerHTML = html;
  if (nearBottom) box.scrollTop = box.scrollHeight;
}
function buildZaloStyles(message) {
  const styles = [];
  const len = String(message).length;
  const push = st => styles.push({start:0,len,st});
  for (const k of ["b","i","u","s"]) if (state.chatStyle[k]) push(k);
  if (state.chatStyle.color && ZALO_COLORS[state.chatStyle.color]) push(ZALO_COLORS[state.chatStyle.color]);
  if (state.chatStyle.font && ZALO_FONTS[state.chatStyle.font]) push(ZALO_FONTS[state.chatStyle.font]);
  return styles;
}
async function sendChat(event) {
  event.preventDefault();
  const t = state.selectedThread;
  const message = $("chatMessage").value.trim();
  if (!t || !message) return;
  $("sendButton").disabled = true;
  try {
    const bot = $("chatBotSelect").value || "main";
    await api("/api/chat/"+enc(bot)+"/send",{method:"POST",body:jsonBody({threadId:t.id,type:t.type,msg:message,styles:buildZaloStyles(message)})});
    $("chatMessage").value = "";
    await loadMessages();
  } catch (error) { toast(error.message,"error"); }
  finally { $("sendButton").disabled = false; }
}
function startThreadPolling() {
  clearInterval(state.timers.threads);
  state.timers.threads = setInterval(()=>{if(state.view==="chat")loadThreads();},12000);
}
function stopThreadPolling() {
  clearInterval(state.timers.threads); state.timers.threads = null;
  clearInterval(state.timers.messages); state.timers.messages = null;
}
async function toggleAdminGroup(id) {
  const bot = $("chatBotSelect").value || "main";
  try {
    const data = await api("/api/chat/"+enc(bot)+"/toggle-admin-group",{method:"POST",body:jsonBody({gid:id})});
    state.adminGroups = data.groups || [];
    toast(state.adminGroups.includes(id) ? "Đã đánh dấu nhóm bot cầm key" : "Đã bỏ đánh dấu nhóm","success");
    if (state.selectedThread) await openThreadInfo();
    renderThreads();
  } catch (error) { toast(error.message,"error"); }
}
function openUserInfo(uid) {
  const bot = $("chatBotSelect").value || "main";
  openModal("Hồ sơ thành viên","user","ZALO USER");
  api("/api/chat/"+enc(bot)+"/user-info?uid="+enc(uid)).then(info=>renderUserInfo(info)).catch(error=>$("modalContent").innerHTML='<div class="empty-state">'+$escape(error.message)+'</div>');
}
async function openThreadInfo() {
  const t = state.selectedThread; if (!t) return;
  const bot = $("chatBotSelect").value || "main";
  openModal(t.isGroup ? "Thông tin nhóm" : "Hồ sơ người dùng","thread","ZALO DETAILS");
  try {
    const info = await api("/api/chat/"+enc(bot)+"/thread-info?threadId="+enc(t.id)+"&type="+t.type);
    if (t.isGroup) renderGroupInfo(info); else renderUserInfo(info);
  } catch (error) { $("modalContent").innerHTML='<div class="empty-state">'+$escape(error.message)+'</div>'; }
}
function renderUserInfo(info) {
  const uid = info.uid || info.id || "";
  const canManageGroup = Boolean(state.selectedThread?.isGroup && state.adminGroups.includes(state.selectedThread.id));
  $("modalContent").innerHTML = '<div class="info-hero">'+avatarHtml(info.avatar,info.name,'')+'<div><b>'+$escape(info.name || uid)+'</b><small>UID: '+$escape(uid)+'</small><small>'+$escape(info.status || "")+'</small></div></div><div class="detail-table"><div class="detail-row"><span>UID</span><b>'+$escape(uid)+'</b></div><div class="detail-row"><span>Trạng thái</span><b>'+$escape(info.status || "—")+'</b></div></div><div class="info-actions"><button class="button button-quiet" data-action="copy-uid" data-uid="'+$escape(uid)+'">Copy UID</button>'+(canManageGroup?'<button class="button button-quiet" data-action="user-deputy" data-uid="'+$escape(uid)+'">Đặt phó nhóm</button><button class="button button-quiet" data-action="user-remove" data-uid="'+$escape(uid)+'">Xoá khỏi nhóm</button><button class="button button-quiet" data-action="user-block-group" data-uid="'+$escape(uid)+'">Chặn khỏi nhóm</button>':'<button class="button button-quiet" data-action="user-block" data-uid="'+$escape(uid)+'">Chặn người dùng</button>')+'</div>';
}
function renderGroupInfo(info) {
  const id = info.id || "";
  const marked = state.adminGroups.includes(id);
  const members = info.members || [];
  $("modalContent").innerHTML = '<div class="info-hero">'+avatarHtml(info.avatar,info.name,'')+'<div><b>'+$escape(info.name || id)+'</b><small>'+number(info.totalMember)+' thành viên · '+$escape(id)+'</small><small>'+(marked?"Đang đánh dấu bot cầm key":"Bot chưa được đánh dấu cầm key")+'</small></div></div><div class="info-actions"><button class="button button-quiet" data-action="toggle-admin-group" data-id="'+$escape(id)+'">'+(marked?"Bỏ đánh dấu cầm key":"Đánh dấu bot cầm key")+'</button><button class="button button-quiet" data-action="rename-group">Đổi tên</button><button class="button button-quiet" data-action="add-member">Thêm UID</button><button class="button button-quiet" data-action="leave-group">Rời nhóm</button>'+(marked?'<button class="button button-quiet" data-action="disperse-group">Giải tán nhóm</button>':"")+'</div>'+(marked?'<div class="group-form"><input id="memberActionUid" placeholder="UID thành viên"><button class="button button-quiet" data-action="remove-member">Xoá</button><button class="button button-quiet" data-action="block-member">Chặn</button><button class="button button-quiet" data-action="deputy-member">Đặt phó</button></div>':'<p class="hint-line">Chỉ dùng các hành động quản trị thành viên khi bot thực sự có quyền quản trị trong Zalo. Việc đánh dấu ở đây chỉ là cờ giao diện, không cấp quyền Zalo.</p>')+'<div class="section-heading compact" style="margin-top:18px"><h3>Thành viên ('+members.length+'/'+number(info.totalMember)+')</h3></div><div class="member-list">'+(members.length?members.slice(0,120).map(m=>'<div class="member-row">'+avatarHtml(m.avatar,m.name||m.uid)+'<span>'+$escape(m.name||m.uid)+'</span><small style="margin-left:auto;color:var(--muted-2)">'+(m.isAdmin?"ADMIN":"")+'</small></div>').join(""):'<div class="empty-state">Zalo chưa trả danh sách thành viên chi tiết.</div>')+'</div>';
}
async function chatAction(action, extra = {}) {
  const t = state.selectedThread;
  if (!t) return;
  const bot = $("chatBotSelect").value || "main";
  const body = {action,threadId:t.id,...extra};
  await api("/api/chat/"+enc(bot)+"/action",{method:"POST",body:jsonBody(body)});
}
async function handleChatAction(action, el) {
  const uid = el.dataset.uid || $("memberActionUid")?.value.trim() || "";
  try {
    switch(action) {
      case "copy-uid": await navigator.clipboard?.writeText(el.dataset.uid||""); toast("Đã copy UID","success"); return;
      case "toggle-admin-group": return toggleAdminGroup(el.dataset.id);
      case "rename-group": {
        const name = prompt("Tên nhóm mới:",state.selectedThread?.name||"");
        if (!name?.trim()) return;
        await chatAction("rename-group",{value:name.trim()}); state.selectedThread.name=name.trim(); toast("Đã đổi tên nhóm","success"); return openThreadInfo();
      }
      case "add-member": {
        const target = prompt("UID cần thêm vào nhóm:");
        if (!target?.trim()) return;
        await chatAction("add-user",{uid:target.trim()}); toast("Đã gửi yêu cầu thêm thành viên","success"); return;
      }
      case "leave-group":
        if (!confirm("Rời nhóm này? Đây là thao tác thật trên Zalo.")) return;
        await chatAction("leave-group"); closeModal(); closeThread(); toast("Đã gửi yêu cầu rời nhóm","success"); return loadThreads();
      case "disperse-group":
        if (!confirm("Giải tán nhóm? Hành động này không thể hoàn tác.")) return;
        if (!confirm("Xác nhận lần cuối: giải tán nhóm?")) return;
        await chatAction("disperse-group"); closeModal(); toast("Đã gửi yêu cầu giải tán nhóm","success"); return loadThreads();
      case "remove-member":
        if (!uid) return toast("Nhập UID thành viên","error");
        if (!confirm("Xoá UID "+uid+" khỏi nhóm?")) return;
        await chatAction("remove-user",{uid}); toast("Đã gửi yêu cầu xoá thành viên","success"); return;
      case "block-member":
        if (!uid) return toast("Nhập UID thành viên","error");
        if (!confirm("Chặn UID "+uid+" khỏi nhóm?")) return;
        await chatAction("block-group-user",{uid}); toast("Đã gửi yêu cầu chặn","success"); return;
      case "deputy-member":
      case "user-deputy":
        if (!uid) return toast("Không có UID","error");
        if (!confirm("Đặt UID "+uid+" làm phó nhóm?")) return;
        await chatAction("set-deputy",{uid}); toast("Đã gửi yêu cầu đặt phó nhóm","success"); return;
      case "user-remove":
        if (!uid || !confirm("Xoá UID "+uid+" khỏi nhóm?")) return;
        await chatAction("remove-user",{uid}); toast("Đã gửi yêu cầu xoá","success"); return;
      case "user-block-group":
        if (!uid || !confirm("Chặn UID "+uid+" khỏi nhóm?")) return;
        await chatAction("block-group-user",{uid}); toast("Đã gửi yêu cầu chặn","success"); return;
      case "user-block":
        if (!uid || !confirm("Chặn người dùng UID "+uid+"?")) return;
        await chatAction("block-user",{uid}); toast("Đã gửi yêu cầu chặn người dùng","success"); return;
    }
  } catch(error) { toast(error.message,"error"); }
}

function bindEvents() {
  document.addEventListener("click", async event => {
    const nav = event.target.closest("[data-view]");
    if (nav) return showView(nav.dataset.view);
    const action = event.target.closest("[data-action]");
    if (action) {
      const kind = action.dataset.action;
      if (kind === "open-thread") {
        const id=action.dataset.id,type=Number(action.dataset.type);
        const t=threadRows().find(row=>row.id===id&&row.type===type);
        if (t) return openThread(t);
      }
      if (kind.startsWith("bot-")) {
        const name=action.dataset.bot;
        if (kind==="bot-start") return botAction(name,"start");
        if (kind==="bot-stop") return botAction(name,"stop");
        if (kind==="bot-restart") return botAction(name,"restart");
        if (kind==="bot-remove") return removeBot(name);
        if (kind==="bot-qr") return showQr(name);
        if (kind==="bot-session") return showSession(name);
        if (kind==="bot-logs") return showLogs(name);
      }
      if (["copy-uid","toggle-admin-group","rename-group","add-member","leave-group","disperse-group","remove-member","block-member","deputy-member","user-deputy","user-remove","user-block-group","user-block"].includes(kind)) return handleChatAction(kind,action);
    }
    const format=event.target.closest("[data-format]");
    if (format) {
      const key=format.dataset.format; state.chatStyle[key]=!state.chatStyle[key];
      format.classList.toggle("active",state.chatStyle[key]); return;
    }
    const color=event.target.closest("[data-color]");
    if (color) {
      state.chatStyle.color=color.dataset.color;
      document.querySelectorAll(".color-chip").forEach(el=>el.classList.toggle("active",el===color));
      return;
    }
  });
  document.addEventListener("change", event => {
    const el=event.target;
    if (el.matches('[data-action="auto-restart"]')) setAutoRestart(el.dataset.bot,el.checked);
    if (el.matches('[data-action="toggle-command"]')) toggleGroupCommand(el.dataset.command,el.checked,el);
    if (el.id==="commandCategory" || el.id==="commandRole") renderCommands();
    if (el.id==="profileBotSelect") {state.selectedProfile=el.value;renderProfile(el.value);}
    if (el.id==="chatFontSize") state.chatStyle.font=el.value;
    if (el.id==="chatBotSelect") {closeThread();loadThreads();}
  });
  document.addEventListener("input",event=>{
    if(event.target.id==="threadSearch")renderThreads();
    if(event.target.id==="commandSearch")renderCommands();
  });
  $("settingsForm").addEventListener("submit",event=>{
    event.preventDefault();
    state.api=$("remoteUrl").value.trim().replace(/\/+$/,"");
    state.token=$("panelToken").value.trim();
    localStorage.setItem("jt_panel_url",state.api);
    if(state.token)sessionStorage.setItem("jt_panel_token",state.token);else sessionStorage.removeItem("jt_panel_token");
    closeSettings();refreshOverview().then(async ok=>{if(ok){toast("Đã kết nối Panel","success");await loadCommands();}else openSettings();});
  });
  $("clearToken").addEventListener("click",()=>{
    state.token="";sessionStorage.removeItem("jt_panel_token");$("panelToken").value="";
    toast("Đã xoá token khỏi phiên trình duyệt");
  });
  ["openSettings","settingsButton","bannerSettings"].forEach(id=>$(id).addEventListener("click",openSettings));
  $("closeSettings").addEventListener("click",closeSettings);
  $("settingsBackdrop").addEventListener("click",closeSettings);
  $("refreshButton").addEventListener("click",()=>refreshOverview());
  $("reloadBots").addEventListener("click",()=>refreshOverview());
  $("createBotShortcut").addEventListener("click",createBot);
  $("reloadCommands").addEventListener("click",loadCommands);
  $("reloadProfile").addEventListener("click",loadProfiles);
  $("reloadSystem").addEventListener("click",loadSystem);
  $("reloadThreads").addEventListener("click",loadThreads);
  $("threadInfoButton").addEventListener("click",openThreadInfo);
  $("groupForm").addEventListener("submit",event=>{event.preventDefault();loadGroupCommands();});
  $("chatForm").addEventListener("submit",sendChat);
  $("chatMessage").addEventListener("keydown",event=>{
    if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();$("chatForm").requestSubmit();}
  });
  $("mobileMenu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
  $("closeModal").addEventListener("click",closeModal);
  $("modalBackdrop").addEventListener("click",event=>{if(event.target===$("modalBackdrop"))closeModal();});
  $("threadInfoButton").disabled=true;
  document.querySelectorAll("[data-thread-filter]").forEach(button=>button.addEventListener("click",()=>{
    state.threadFilter=button.dataset.threadFilter;
    document.querySelectorAll("[data-thread-filter]").forEach(el=>el.classList.toggle("active",el===button));
    renderThreads();
  }));
  window.addEventListener("keydown",event=>{
    if(event.key==="Escape"){closeModal();closeSettings();}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();openSettings();}
  });
}

async function initialLoad() {
  loadSettings();
  bindEvents();
  $("clock").textContent=new Date().toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"});
  setInterval(()=>$("clock").textContent=new Date().toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"}),10000);
  const connected=await refreshOverview();
  if(!connected && !state.token)openSettings();
  loadCommands();
  setInterval(()=>{
    if(document.visibilityState==="visible" && state.view==="overview")refreshOverview();
  },10000);
  showView("overview");
}
document.addEventListener("DOMContentLoaded",initialLoad);
