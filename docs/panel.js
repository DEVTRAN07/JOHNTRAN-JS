"use strict";

/* JOHNTRAN Control Center — frontend rebuilt without dependencies. */
const $ = (id) => document.getElementById(id);
const state = {
  api: "", token: "", view: "overview",
  bots: [], metrics: null, commands: [], commandStatus: [], commandFolders: [], selectedCommandFolder: "",
  botStats: {}, selectedProfile: "", groupList: [], selectedGroupBot: "", groupBotProfile: null,
  chatData: { friends: { list: [] }, groups: { list: [] } },
  adminGroups: [], selectedThread: null, messages: [],
  threadFilter: "all", chatStyle: { b:false, i:false, u:false, s:false, color:"", font:"" },
  groupFilter: "all", groupSort: "name-asc", groupStatusFlight: false,
  antiFeatures: {},
  groupBulkFlight: false, selectedGroupIds: new Set(),
  failedGroupAvatarUrls: new Set(),
  timers: { refresh:null, messages:null, threads:null, logs:null, qr:null, groupStatus:null, groupSearch:null },
  modalKind: "", modalBot: "", mutedThreads: readMuted()
};

const VIEWS = {
  overview: ["Tổng quan", "OVERVIEW"],
  chat: ["Zalo Chat", "MESSAGES"],
  commands: ["Danh mục lệnh", "COMMANDS"],
  groups: ["Quản lý nhóm", "GROUPS"],
  profile: ["Hồ sơ & dữ liệu", "ACCOUNT DATA"],
  system: ["Giám sát hệ thống", "INFRASTRUCTURE"]
};
const ANTI_PROTECTION_ITEMS = Object.freeze([
  { key:"anti_card", label:"Chặn gửi danh thiếp", detail:"Chặn chia sẻ hồ sơ Zalo", command:"/anticard", icon:"ID", tone:"blue" },
  { key:"anti_doodle", label:"Chặn doodle", detail:"Chặn nét vẽ / bản vẽ", command:"/antidoodle", icon:"✎", tone:"purple" },
  { key:"anti_file", label:"Chặn tập tin", detail:"Chặn tệp đính kèm", command:"/antifile", icon:"FILE", tone:"orange" },
  { key:"anti_gif", label:"Chặn GIF", detail:"Chặn ảnh động GIF", command:"/antigif", icon:"GIF", tone:"cyan" },
  { key:"anti_danger_link", label:"Chặn link mời nhóm", detail:"Chặn link mời vào nhóm Zalo khác", command:"/antiinvite", icon:"INV", tone:"blue" },
  { key:"anti_join", label:"Chặn spam vào nhóm", detail:"3 lần tái tham gia bị cảnh cáo; lần tiếp theo sẽ kick", command:"/antijoin", icon:"JOIN", tone:"pink" },
  { key:"anti_link", label:"Chặn tất cả liên kết", detail:"Chặn mọi URL được gửi vào nhóm", command:"/antilink", icon:"URL", tone:"cyan" },
  { key:"anti_location", label:"Chặn vị trí", detail:"Chặn chia sẻ bản đồ / tọa độ", command:"/antilocation", icon:"MAP", tone:"blue" },
  { key:"anti_other", label:"Chặn payload lỗi", detail:"Chặn nội dung unknown / malformed", command:"/antiother", icon:"BUG", tone:"yellow" },
  { key:"anti_photo", label:"Chặn hình ảnh", detail:"Chặn ảnh được gửi vào nhóm", command:"/antiphoto", icon:"IMG", tone:"pink" },
  { key:"anti_qr", label:"Chặn mã QR", detail:"Phát hiện QR trong ảnh thường và payload QR", command:"/antiqr", icon:"QR", tone:"purple" },
  { key:"anti_reaction", label:"Chống spam cảm xúc", detail:"3 lần cảnh cáo; lần vi phạm tiếp theo sẽ kick", command:"/antireaction", icon:"❤", tone:"pink" },
  { key:"anti_nude", label:"Chặn nội dung 18+", detail:"AI quét ảnh nhạy cảm · cần OPENAI_API_KEY", command:"/antisex · /antinude", icon:"18+", tone:"pink" },
  { key:"anti_spam", label:"Chặn spam tin nhắn", detail:"Phát hiện hơn 5 tin chữ trong 5 giây", command:"/antispam", icon:"SP", tone:"yellow" },
  { key:"anti_sticker", label:"Chặn mọi sticker", detail:"Không cho gửi sticker vào nhóm", command:"/antistk", icon:"ST", tone:"orange" },
  { key:"anti_sticker_spam", label:"Chặn spam sticker", detail:"Phát hiện hơn 5 sticker trong 4 giây", command:"/antistklag", icon:"LAG", tone:"orange" },
  { key:"anti_taghide", label:"Chặn nhắc tên ẩn", detail:"Chặn mention ẩn / sai vị trí", command:"/antitaghide", icon:"TAG", tone:"blue" },
  { key:"anti_video", label:"Chặn video", detail:"Chặn video clip được gửi vào nhóm", command:"/antivideo", icon:"VID", tone:"cyan" },
  { key:"anti_voice", label:"Chặn tin nhắn thoại", detail:"Chặn voice được gửi vào nhóm", command:"/antivoice", icon:"VOX", tone:"purple" },
  { key:"anti_word", label:"Chặn từ ngữ thô tục", detail:"Đối chiếu danh sách từ cấm tiếng Việt", command:"/antiword", icon:"TXT", tone:"pink" },
  { key:"anti_undo", label:"Chống thu hồi tin nhắn", detail:"Khôi phục chữ, ảnh, video, voice và sticker", command:"/antirecall", icon:"↶", tone:"purple" }
]);
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
function getBotDisplayName(nameOrBot) {
  const bot = nameOrBot && typeof nameOrBot === "object"
    ? nameOrBot
    : (state.bots || []).find(item => item.name === String(nameOrBot || ""));
  const key = typeof nameOrBot === "string" ? nameOrBot : bot?.name;
  const profile = state.botStats?.[key]?.profile || {};
  return String(bot?.displayName || profile.displayName || profile.zaloName || "Tài khoản Zalo");
}
function updateChatBotLabel() {
  const selected = $("chatBotSelect")?.value || "";
  if ($("chatTypingState")) $("chatTypingState").textContent = getBotDisplayName(selected).toLocaleUpperCase("vi");
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
    let message = typeof body === "object" ? (body.error || "HTTP " + response.status) : String(body || "HTTP " + response.status);
    if (response.status === 401) {
      message = "Panel Token chưa đúng hoặc chưa được gửi. Mở Cấu hình và nhập đúng token đang đặt trong Render → Environment (JT_PANEL__TOKEN hoặc JT_PANEL_TOKEN).";
    }
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
  if (name === "groups") {
    loadGroupOptions();
    startGroupStatusPolling();
  } else stopGroupStatusPolling();
  if (name === "profile") loadProfiles();
  if (name === "system") loadSystem();
  if (name === "overview") refreshOverview();
  window.scrollTo({top:0,behavior:"smooth"});
}

async function refreshOverview() {
  try {
    const data = await api("/api/bots");
    state.bots = Array.isArray(data.bots) ? data.bots : [];
    renderBotSelectors();
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
function renderBotSelectors() {
  const select = $("chatBotSelect");
  if (!select) return;
  const previous = select.value;
  const options = (state.bots || []).map(bot => {
    return '<option value="' + $escape(bot.name) + '">' + $escape(getBotDisplayName(bot)) + '</option>';
  }).join("");
  select.innerHTML = options || '<option value="">Chưa có bot</option>';
  select.value = (state.bots || []).some(bot => bot.name === previous)
    ? previous
    : (state.bots?.[0]?.name || "");
  const activeBot = (state.bots || []).find(bot => bot.name === select.value);
  if ($("chatTypingState")) $("chatTypingState").textContent = getBotDisplayName(activeBot || select.value).toLocaleUpperCase("vi");
}
function renderBots() {
  if (!state.bots.length) {
    $("botList").innerHTML = '<div class="empty-state">Chưa có bot nào trong registry.</div>';
    return;
  }
  $("botList").innerHTML = state.bots.map(bot => {
    const [label, cls] = botStatus(bot);
    const isMainBot = bot.name === "main";
    const displayName = bot.displayName || "Tài khoản Zalo";
    const avatar = avatarHtml(bot.avatar, displayName, "bot-avatar");
    return '<article class="bot-row">' +
      '<div class="bot-identity">' + avatar + '<div><div class="bot-name">' + $escape(displayName) + '</div><div class="bot-meta">TÀI KHOẢN ZALO · PID ' + $escape(bot.pid || "—") + ' · ' + (bot.flapping ? '<span style="color:var(--red)">CRASH LOOP</span>' : (bot.sessionHint ? $escape(bot.sessionHint) : "JOHNTRAN instance")) + '</div></div></div>' +
      '<div><div class="status-label ' + cls + '"><i class="dot"></i>' + $escape(label) + '</div><div class="bot-meta">Uptime ' + fmtUptime(bot.uptimeMs) + ' · restart ' + number(bot.restarts) + '</div></div>' +
      '<div class="bot-stats"><span>PORT <b>' + $escape(bot.bridgePort || "—") + '</b></span><span>QR <b>' + (bot.hasQr ? "READY" : "—") + '</b></span><label class="auto-restart"><input type="checkbox" data-action="auto-restart" data-bot="' + $escape(bot.name) + '" ' + (bot.autoRestart ? "checked" : "") + '> Auto restart</label></div>' +
      '<div class="bot-actions">' +
        '<button class="mini-action" data-action="bot-start" data-bot="' + $escape(bot.name) + '">Chạy</button>' +
        '<button class="mini-action" data-action="bot-stop" data-bot="' + $escape(bot.name) + '">Dừng</button>' +
        '<button class="mini-action" data-action="bot-restart" data-bot="' + $escape(bot.name) + '">Restart</button>' +
        '<button class="mini-action" data-action="bot-qr" data-bot="' + $escape(bot.name) + '">QR</button>' +
        '<button class="mini-action" data-action="bot-session" data-bot="' + $escape(bot.name) + '">Phiên</button>' +
        '<button class="mini-action" data-action="bot-logs" data-bot="' + $escape(bot.name) + '">Logs</button>' +
        (isMainBot ? "" : '<button class="mini-action danger" data-action="bot-remove" data-bot="' + $escape(bot.name) + '">Xoá</button>') +
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
    state.commandFolders = cmdData.folders || [];
    if (!state.commandFolders.some(folder => folder.slug === state.selectedCommandFolder)) {
      state.selectedCommandFolder = state.commandFolders[0]?.slug || "";
    }
    state.commandStatus = statusData.commands || [];
    renderCommands();
    renderCommandHealth(statusData);
  } catch (error) {
    $("commandFolders").innerHTML = '<div class="empty-state">' + $escape(error.message) + '</div>';
    $("commandGrid").innerHTML = '<div class="empty-state">' + $escape(error.message) + '</div>';
  }
}
function renderCommands() {
  const q = ($("commandSearch").value || "").trim().toLowerCase();
  const role = $("commandRole").value;
  const folder = state.commandFolders.find(item => item.slug === state.selectedCommandFolder);
  const allowed = new Set((folder?.commands || []).map(command => command.name));
  const list = state.commands.filter(command => {
    if (folder && !allowed.has(command.name)) return false;
    if (role !== "" && String(command.role) !== role) return false;
    const hay = [command.name,(command.aliases||[]).join(" "),command.description,command.category].join(" ").toLowerCase();
    return !q || hay.includes(q);
  });
  $("commandFolders").innerHTML = state.commandFolders.length ? state.commandFolders.map(item =>
    '<button type="button" class="command-folder' + (item.slug === state.selectedCommandFolder ? ' active' : '') + '" data-command-folder="' + $escape(item.slug) + '"><span class="folder-icon">' + $escape(item.icon || "📁") + '</span><span class="folder-copy"><b>' + $escape(item.name) + '</b><small>' + number(item.count) + ' lệnh</small></span><span class="folder-arrow">›</span></button>'
  ).join("") : '<div class="empty-state">Không có thư mục lệnh.</div>';
  $("commandFolderTitle").textContent = folder ? folder.name : "Tất cả lệnh";
  $("commandFolderCount").textContent = list.length + " / " + number(folder?.count ?? state.commands.length) + " lệnh";
  $("commandSummary").innerHTML = [
    ["TỔNG LỆNH",state.commands.length],["THƯ MỤC",state.commandFolders.length],["ĐANG HIỂN THỊ",list.length]
  ].map(([key,value])=>'<div class="summary-chip"><span>'+key+'</span><b>'+value+'</b></div>').join("");
  $("commandGrid").innerHTML = list.length ? list.map(command =>
    '<div class="command-item"><span class="command-symbol">⌘</span><div class="command-copy"><b>/' + $escape(command.name) + '</b><small>' + $escape(command.description || "Chưa có mô tả") + (command.aliases?.length ? " · alias: " + $escape(command.aliases.join(", ")) : "") + '</small></div><span class="role-tag">' + (command.role === 2 ? "ADMIN" : command.role === 1 ? "SUPPORT" : "MEMBER") + '</span></div>'
  ).join("") : '<div class="empty-state">Không có lệnh phù hợp trong thư mục này.</div>';
}
function renderCommandHealth(data) {
  $("commandStatusCount").textContent = (data.ready ?? 0) + "/" + (data.total ?? 0) + " READY";
  $("commandStatusHint").textContent = data.blocked ? data.blocked + " lệnh đang thiếu API hoặc cấu hình phụ thuộc." : "Tất cả lệnh đã đủ cấu hình theo bản audit hiện tại.";
  $("commandStatusHint").className = "hint-line" + (data.blocked ? " bad" : "");
  const rows = [...state.commandStatus.filter(c=>!c.ready),...state.commandStatus.filter(c=>c.ready)];
  $("commandStatusList").innerHTML = rows.map(c => '<div class="command-health ' + (c.ready ? "" : "bad") + '"><i class="health-dot"></i><b>/' + $escape(c.name) + '</b><span>' + (c.ready ? "READY" : "MISSING · " + $escape((c.missing||[]).join(", "))) + '</span></div>').join("") || '<div class="empty-state">Không có dữ liệu.</div>';
}
function renderGroupIdentities(botProfile, group) {
  const grid = $("groupIdentityGrid");
  const botName = botProfile?.displayName || botProfile?.zaloName || "Tài khoản Zalo";
  const botUid = botProfile?.uid || "";
  $("groupBotIdentity").innerHTML =
    avatarHtml(botProfile?.avatar || "", botName, "avatar-large") +
    '<div><small>BOT ZALO</small><b>' + $escape(botName) + '</b><span>' + $escape(botUid) + '</span></div>';

  if (group) {
    const groupName = group.name || group.gid || "Nhóm Zalo";
    $("selectedGroupIdentity").innerHTML =
      avatarHtml(group.avatar || group.avt || "", groupName, "avatar-large") +
      '<div><small>NHÓM ĐANG CẤU HÌNH</small><b>' + $escape(groupName) + '</b><span>' + $escape(group.gid || "") + '</span></div>';
  } else {
    $("selectedGroupIdentity").innerHTML = '<div class="empty-state">Chọn một nhóm để xem logo.</div>';
  }
  grid.hidden = !botProfile && !group;
}
function updateGroupBotToggle(enabled) {
  $("groupBotToggleRow").hidden = false;
  const toggle = $("groupBotEnabled");
  if (toggle) toggle.checked = enabled;
  $("groupBotToggleLabel").textContent = enabled ? "BOT ĐANG BẬT" : "BOT ĐANG TẮT";
  $("groupBotToggleHint").textContent = enabled
    ? "Bot sẽ phản hồi lệnh và xử lý sự kiện tự động trong nhóm."
    : "Bot đang im lặng: bỏ qua lệnh, tin nhắn điều hướng và sự kiện tự động.";
}

function renderGroupCards(emptyMessage = "") {
  const grid = $("groupCardGrid");
  if (!grid) return;

  const groups = Array.isArray(state.groupList) ? state.groupList : [];
  const selectedGid = String($("groupSelect")?.value || state.activeGroup || "");
  const query = String($("groupSearch")?.value || "").trim().toLocaleLowerCase("vi");
  const filter = state.groupFilter || "all";
  const sort = $("groupSort")?.value || state.groupSort || "name-asc";
  state.groupSort = sort;

  const enabledCount = groups.filter(group => group.botEnabled === true).length;
  const unknownCount = groups.filter(group => typeof group.botEnabled !== "boolean").length;
  if (!groups.length) {
    const counter = $("groupCardCount");
    if (counter) counter.textContent = "0 nhóm";
    grid.innerHTML = '<div class="group-card-empty">' +
      $escape(emptyMessage || "Chưa có nhóm Zalo. Hãy kiểm tra bot đã đăng nhập và đang chạy.") +
      '</div>';
    updateGroupBulkControls([]);
    return;
  }

  const filtered = groups.filter(group => {
    const enabled = group.botEnabled === true;
    if (filter === "on" && !enabled) return false;
    if (filter === "off" && enabled) return false;
    const name = String(group.name || "").toLocaleLowerCase("vi");
    const gid = String(group.gid || "").toLocaleLowerCase("vi");
    return !query || name.includes(query) || gid.includes(query);
  });

  const collator = new Intl.Collator("vi", { numeric:true, sensitivity:"base" });
  filtered.sort((a, b) => {
    const aMembers = Number(a.totalMember || a.memberCount) || 0;
    const bMembers = Number(b.totalMember || b.memberCount) || 0;
    if (sort === "members-desc") return bMembers - aMembers || collator.compare(a.name || a.gid, b.name || b.gid);
    if (sort === "members-asc") return aMembers - bMembers || collator.compare(a.name || a.gid, b.name || b.gid);
    if (sort === "status-on-first") {
      const status = Number(b.botEnabled === true) - Number(a.botEnabled === true);
      if (status) return status;
    }
    return collator.compare(a.name || a.gid, b.name || b.gid);
  });

  const counter = $("groupCardCount");
  if (counter) counter.textContent = groups.length + " nhóm · " + enabledCount + " đang bật" +
    (unknownCount ? " · " + unknownCount + " chưa xác minh" : "") + " · " + filtered.length + " đang hiển thị";

  if (!filtered.length) {
    const message = filter === "on" ? "Chưa có nhóm nào đang bật bot." :
      filter === "off" ? "Không có nhóm nào đang tắt bot phù hợp." :
      "Không tìm thấy nhóm phù hợp với “" + query + "”.";
    grid.innerHTML = '<div class="group-card-empty">' + $escape(message) + '</div>';
    updateGroupBulkControls([]);
    return;
  }

  grid.innerHTML = filtered.map(group => {
    const gid = String(group.gid || "");
    const name = String(group.name || gid || "Nhóm Zalo");
    const avatarRaw = String(group.avatar || group.avt || "");
    const avatarUrl = safeImage(avatarRaw);
    const hasAvatar = Boolean(avatarUrl && !state.failedGroupAvatarUrls.has(avatarRaw));
    const avatar = hasAvatar
      ? '<span class="group-card-avatar"><img src="' + avatarUrl + '" alt="" loading="lazy" decoding="async" fetchpriority="low" data-avatar-key="' + $escape(avatarRaw) + '" data-avatar-fallback="' + $escape(initials(name)) + '"></span>'
      : '<span class="group-card-avatar">' + $escape(initials(name)) + '</span>';
    const members = Number(group.totalMember || group.memberCount) || 0;
    const memberLabel = members > 0 ? members.toLocaleString("vi-VN") + " thành viên" : "Chưa rõ thành viên";
    const enabled = group.botEnabled === true;
    const statusClass = enabled ? "is-on" : group.botEnabled === false ? "is-off" : "is-unknown";
    const statusLabel = enabled ? "BOT ĐANG BẬT" : group.botEnabled === false ? "BOT ĐANG TẮT" : "CHƯA XÁC MINH";
    const selected = gid === selectedGid;
    const bulkSelected = state.selectedGroupIds.has(gid);
    return '<div class="group-card-item">' +
      '<label class="group-card-select" title="Chọn nhóm ' + $escape(name) + '">' +
        '<input type="checkbox" data-group-select="' + $escape(gid) + '"' + (bulkSelected ? ' checked' : '') + ' aria-label="Chọn nhóm ' + $escape(name) + '">' +
        '<span>Chọn nhóm</span>' +
      '</label>' +
      '<button type="button" class="group-card' + (selected ? ' selected' : '') + (bulkSelected ? ' selected-bulk' : '') +
        '" data-group-id="' + $escape(gid) + '" aria-pressed="' + (selected ? "true" : "false") +
        '" title="' + $escape(name) + '">' +
        avatar +
        '<span class="group-card-copy">' +
          '<span class="group-card-name">' + $escape(name) + '</span>' +
          '<span class="group-card-meta"><span>' + $escape(memberLabel) + '</span><span>·</span><span class="group-card-id">ID ' + $escape(gid) + '</span></span>' +
          '<span class="group-card-status ' + statusClass + '">' + statusLabel + '</span>' +
        '</span>' +
        '<span class="group-card-arrow" aria-hidden="true">›</span>' +
      '</button>' +
    '</div>';
  }).join("");
  updateGroupBulkControls(filtered.map(group => String(group.gid || "")));
}

function updateGroupBulkControls(visibleIds = []) {
  const selected = new Set(
    (state.groupList || [])
      .map(group => String(group.gid || ""))
      .filter(gid => gid && state.selectedGroupIds.has(gid))
  );
  state.selectedGroupIds = selected;
  const count = selected.size;
  const counter = $("groupBulkCount");
  if (counter) counter.textContent = count + " nhóm đã chọn";

  document.querySelectorAll("[data-group-bulk-action]").forEach(button => {
    button.disabled = count === 0 || state.groupBulkFlight;
  });
  const clearButton = $("groupClearSelection");
  if (clearButton) clearButton.disabled = count === 0 || state.groupBulkFlight;

  const master = $("groupSelectVisible");
  if (master) {
    const visible = [...new Set(visibleIds)].filter(Boolean);
    const selectedVisible = visible.filter(gid => selected.has(gid)).length;
    master.checked = visible.length > 0 && selectedVisible === visible.length;
    master.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    master.disabled = visible.length === 0 || state.groupBulkFlight;
  }
}

async function setGroupBotsBulk(enabled) {
  if (state.groupBulkFlight) return;
  const bot = $("groupBotSelect")?.value || state.selectedGroupBot;
  const selected = (state.groupList || []).filter(group =>
    state.selectedGroupIds.has(String(group.gid || ""))
  );
  if (!bot || !selected.length) return;

  const action = enabled ? "BẬT" : "TẮT";
  if (!window.confirm("Bạn sắp " + action + " bot cho " + selected.length +
      " nhóm đã chọn. Bạn có chắc chắn muốn tiếp tục?")) return;

  state.groupBulkFlight = true;
  updateGroupBulkControls([...document.querySelectorAll("#groupCardGrid [data-group-id]")].map(card => card.dataset.groupId));
  const failures = [];
  let succeeded = 0;

  try {
    // Limit concurrent writes so a large selection does not overwhelm the bot DB.
    for (let offset = 0; offset < selected.length; offset += 4) {
      const batch = selected.slice(offset, offset + 4);
      const results = await Promise.all(batch.map(async group => {
        const gid = String(group.gid || "");
        try {
          const data = await api("/api/chat/" + enc(bot) + "/group-commands?gid=" + enc(gid), {
            method:"POST", body:jsonBody({ botEnabled:enabled })
          });
          group.botEnabled = data.botEnabled === true;
          state.selectedGroupIds.delete(gid);
          succeeded += 1;
          return { ok:true, gid };
        } catch (error) {
          failures.push((group.name || gid) + ": " + error.message);
          return { ok:false, gid, error };
        }
      }));
      // Paint each completed batch rather than waiting for the whole selection.
      syncGroupCardStatuses();
    }
  } finally {
    state.groupBulkFlight = false;
  }

  renderGroupCards();
  const activeGid = String($("groupSelect")?.value || state.activeGroup || "");
  const activeGroup = state.groupList.find(group => String(group.gid) === activeGid);
  if (activeGroup && !$("groupBotToggleRow").hidden) {
    updateGroupBotToggle(activeGroup.botEnabled === true);
  }
  if (failures.length) {
    $("groupHint").textContent = "Đã cập nhật " + succeeded + "/" + selected.length +
      " nhóm. Chưa cập nhật được: " + failures.join(" · ");
    toast(succeeded + " nhóm thành công, " + failures.length + " nhóm lỗi. Có thể chọn lại nhóm lỗi để thử lại.", "warning");
  } else {
    $("groupHint").textContent = "Đã " + (enabled ? "bật" : "tắt") +
      " bot thành công cho " + succeeded + " nhóm đã chọn.";
    toast("Đã " + (enabled ? "bật" : "tắt") + " bot cho " + succeeded + " nhóm.", "success");
  }
}

function syncGroupCardStatuses() {
  if (state.groupFilter !== "all" || state.groupSort === "status-on-first") {
    renderGroupCards();
    return;
  }

  const groupsById = new Map((state.groupList || []).map(group => [String(group.gid || ""), group]));
  document.querySelectorAll("#groupCardGrid [data-group-id]").forEach(card => {
    const group = groupsById.get(String(card.dataset.groupId || ""));
    if (!group) return;
    const enabled = group.botEnabled === true;
    const known = typeof group.botEnabled === "boolean";
    const status = card.querySelector(".group-card-status");
    if (!status) return;
    status.className = "group-card-status " + (enabled ? "is-on" : known ? "is-off" : "is-unknown");
    status.textContent = enabled ? "BOT ĐANG BẬT" : known ? "BOT ĐANG TẮT" : "CHƯA XÁC MINH";
  });
  const total = (state.groupList || []).length;
  const enabled = (state.groupList || []).filter(group => group.botEnabled === true).length;
  const counter = $("groupCardCount");
  if (counter) counter.textContent = total + " nhóm · " + enabled + " đang bật · " +
    document.querySelectorAll("#groupCardGrid [data-group-id]").length + " đang hiển thị";
}

async function refreshGroupBotStates({ silent = true } = {}) {
  const bot = $("groupBotSelect")?.value || state.selectedGroupBot;
  if (!bot || !Array.isArray(state.groupList) || !state.groupList.length || state.groupStatusFlight) return false;

  state.groupStatusFlight = true;
  try {
    const data = await api("/api/chat/" + enc(bot) + "/group-status");
    if (bot !== state.selectedGroupBot || bot !== ($("groupBotSelect")?.value || state.selectedGroupBot)) return false;
    const stateById = new Map((Array.isArray(data.groups) ? data.groups : [])
      .map(item => [String(item.gid || ""), item.botEnabled === true]));
    for (const group of state.groupList) {
      group.botEnabled = stateById.get(String(group.gid || "")) === true;
    }
    syncGroupCardStatuses();

    const selectedGid = String($("groupSelect")?.value || state.activeGroup || "");
    const selectedGroup = state.groupList.find(group => String(group.gid) === selectedGid);
    if (selectedGroup && !$("groupBotToggleRow").hidden) updateGroupBotToggle(selectedGroup.botEnabled === true);
    return true;
  } catch (error) {
    if (!silent) toast("Không đồng bộ được trạng thái nhóm: " + error.message, "error");
    return false;
  } finally {
    state.groupStatusFlight = false;
  }
}

function startGroupStatusPolling() {
  stopGroupStatusPolling();
  state.timers.groupStatus = setInterval(() => {
    if (state.view === "groups" && document.visibilityState === "visible") {
      refreshGroupBotStates({ silent:true });
    }
  }, 15000);
}

function stopGroupStatusPolling() {
  if (state.timers.groupStatus) clearInterval(state.timers.groupStatus);
  state.timers.groupStatus = null;
}

function renderAntiProtection(antiFeatures = {}, group = null) {
  const panel = $("antiProtectionPanel");
  if (!panel) return;
  if (!group?.gid) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  state.antiFeatures = antiFeatures && typeof antiFeatures === "object" ? antiFeatures : {};
  const groupName = String(group.name || group.gid || "Nhóm Zalo");
  $("antiProtectionGroupName").textContent = groupName;
  $("antiProtectionGroupState").textContent = group.botEnabled === true ? "BOT ĐANG HOẠT ĐỘNG" : "BOT ĐANG TẮT";

  const avatarUrl = safeImage(group.avatar || group.avt || "");
  $("antiProtectionGroupAvatar").innerHTML = (avatarUrl
    ? '<img src="' + avatarUrl + '" alt="" loading="lazy">'
    : '<span>' + $escape(initials(groupName)) + '</span>') + '<i id="antiProtectionGroupDot" class="' +
      (group.botEnabled === true ? "is-online" : "is-offline") + '"></i>';

  const enabledCount = ANTI_PROTECTION_ITEMS.filter(item => state.antiFeatures[item.key] === true).length;
  $("antiProtectionSummary").textContent = enabledCount + "/" + ANTI_PROTECTION_ITEMS.length + " chế độ đang bật";

  $("antiProtectionGrid").innerHTML = ANTI_PROTECTION_ITEMS.map(item => {
    const enabled = state.antiFeatures[item.key] === true;
    return '<article class="anti-protection-card">' +
      '<div class="anti-protection-card-copy">' +
        '<span class="anti-protection-icon tone-' + item.tone + '" aria-hidden="true">' + item.icon + '</span>' +
        '<span class="anti-protection-card-text"><b>' + $escape(item.label) + '</b>' +
          '<small>' + $escape(item.detail) + '</small><em>' + $escape(item.command) + '</em></span>' +
      '</div>' +
      '<label class="anti-protection-switch" aria-label="' + $escape(item.label) + '">' +
        '<input type="checkbox" role="switch" data-anti-feature="' + item.key + '" ' + (enabled ? "checked" : "") + '>' +
        '<span aria-hidden="true"></span>' +
      '</label>' +
    '</article>';
  }).join("");
}

async function setAntiProtectionFeature(feature, enabled, checkbox) {
  const item = ANTI_PROTECTION_ITEMS.find(entry => entry.key === feature);
  const bot = $("groupBotSelect").value || state.selectedGroupBot;
  const gid = $("groupSelect").value || state.activeGroup;
  if (!item || !bot || !gid) return;

  checkbox.disabled = true;
  try {
    const data = await api("/api/chat/" + enc(bot) + "/group-commands?gid=" + enc(gid), {
      method:"POST",
      body:jsonBody({ antiFeature:feature, enabled })
    });
    state.antiFeatures = data.antiFeatures || { ...state.antiFeatures, [feature]: enabled };
    const group = state.groupList.find(entry => String(entry.gid) === String(gid)) || { gid, name:gid };
    renderAntiProtection(state.antiFeatures, group);
    toast((enabled ? "Đã bật " : "Đã tắt ") + item.label.toLocaleLowerCase("vi") + " cho nhóm.", "success");
  } catch (error) {
    checkbox.checked = !enabled;
    toast(error.message, "error");
  } finally {
    if (checkbox.isConnected) checkbox.disabled = false;
  }
}

async function loadGroupOptions() {
  const bots = state.bots || [];
  const botSelect = $("groupBotSelect");
  const groupSelect = $("groupSelect");
  const previousBot = state.selectedGroupBot || botSelect.value;
  const botNames = bots.map(bot => bot.name);
  const selectedBot = botNames.includes(previousBot) ? previousBot :
    (bots.find(bot => bot.loginState === "logged_in")?.name || botNames[0] || "");
  state.selectedGroupBot = selectedBot;
  botSelect.innerHTML = botNames.length ? bots.map(bot =>
    '<option value="' + $escape(bot.name) + '">' + $escape(getBotDisplayName(bot)) + (bot.loginState === "logged_in" ? " · online" : " · " + $escape(bot.loginState || bot.status || "offline")) + '</option>'
  ).join("") : '<option value="">Chưa có bot</option>';
  botSelect.value = selectedBot;
  if (!selectedBot) {
    state.groupList = [];
    $("antiProtectionPanel").hidden = true;
    $("groupBotToggleRow").hidden = true;
    groupSelect.innerHTML = '<option value="">Chưa có bot</option>';
    $("groupIdentityGrid").hidden = true;
    $("groupCommandList").innerHTML = '<div class="empty-state">Chưa có bot trong registry.</div>';
    $("groupHint").textContent = "Tạo bot trong mục Tổng quan trước.";
    renderGroupCards("Chưa có bot trong registry.");
    return;
  }
  $("antiProtectionPanel").hidden = true;
  $("groupBotToggleRow").hidden = true;
  groupSelect.innerHTML = '<option value="">Đang tải nhóm Zalo…</option>';
  $("groupCommandList").innerHTML = '<div class="empty-state">Đang tải danh sách nhóm…</div>';
  try {
    const data = await api("/api/chat/" + enc(selectedBot) + "/threads");
    const selectedBotRecord = bots.find(bot => bot.name === selectedBot) || { name: selectedBot };
    state.groupBotProfile = { ...selectedBotRecord, ...(data.profile || {}) };
    const selectedBotOption = [...botSelect.options].find(option => option.value === selectedBot);
    if (selectedBotOption && data.profile?.displayName) selectedBotOption.textContent = data.profile.displayName;
    state.groupList = Array.isArray(data.groups?.list) ? data.groups.list : [];
    renderGroupCards();
    renderGroupIdentities(state.groupBotProfile, null);
    const selectedGid = state.activeGroup && state.groupList.some(group => String(group.gid) === state.activeGroup)
      ? state.activeGroup : String(state.groupList[0]?.gid || "");
    groupSelect.innerHTML = state.groupList.length ? state.groupList.map(group =>
      '<option value="' + $escape(group.gid) + '">' + $escape(group.name || group.gid) + '</option>'
    ).join("") : '<option value="">Bot chưa có nhóm</option>';
    groupSelect.value = selectedGid;
    renderGroupCards();
    if (!selectedGid) {
      $("antiProtectionPanel").hidden = true;
      $("groupBotToggleRow").hidden = true;
      renderGroupIdentities(state.groupBotProfile, null);
      $("selectedGroupIdentity").innerHTML = '<div class="empty-state">Tài khoản này chưa có nhóm để cấu hình.</div>';
      $("groupCommandList").innerHTML = '<div class="empty-state">Tài khoản này chưa có nhóm để cấu hình.</div>';
      $("groupHint").textContent = "Không tìm thấy nhóm nào trong tài khoản " + getBotDisplayName(selectedBot) + ".";
      return;
    }
    await loadGroupCommands();
  } catch (error) {
    state.groupList = [];
    $("antiProtectionPanel").hidden = true;
    groupSelect.innerHTML = '<option value="">Không tải được nhóm</option>';
    $("groupCommandList").innerHTML = '<div class="empty-state">' + $escape(error.message) + '</div>';
    $("groupHint").textContent = "Bot cần đang chạy và đăng nhập Zalo để đọc danh sách nhóm.";
    renderGroupCards(error.message);
  }
}
async function loadGroupCommands() {
  const bot = $("groupBotSelect").value || state.selectedGroupBot;
  const gid = $("groupSelect").value;
  if (!bot || !gid) return;
  if (!state.commands.length) await loadCommands();
  $("groupCommandList").innerHTML = '<div class="empty-state">Đang đọc cấu hình nhóm…</div>';
  try {
    const data = await api("/api/chat/" + enc(bot) + "/group-commands?gid=" + enc(gid));
    const disabled = new Set(data.disabled || []);
    const group = state.groupList.find(item => String(item.gid) === gid);
    state.selectedGroupBot = bot;
    state.activeGroup = gid;
    if (group) group.botEnabled = data.botEnabled === true;
    renderGroupCards();
    renderGroupIdentities(state.groupBotProfile || { name: bot }, group || { gid, name: gid });
    updateGroupBotToggle(data.botEnabled === true);
    renderAntiProtection(data.antiFeatures || {}, group || { gid, name:gid, botEnabled:data.botEnabled === true });
    $("groupHint").textContent = (group?.name || "Nhóm") + " · " + gid + " · " + disabled.size + " lệnh đang tắt.";
    $("groupCommandList").innerHTML = state.commands.map(command =>
      '<div class="group-command"><div><b>/' + $escape(command.name) + '</b><small>' + $escape(command.description || "Chưa có mô tả") + '</small></div><label class="switch"><input type="checkbox" data-action="toggle-command" data-command="' + $escape(command.name) + '" ' + (disabled.has(command.name) ? "" : "checked") + '><span></span></label></div>'
    ).join("");
  } catch (error) {
    $("groupCommandList").innerHTML = '<div class="empty-state">' + $escape(error.message) + '</div>';
    $("groupHint").textContent = "Không thể đọc cấu hình nhóm.";
  }
}
async function setGroupBotEnabled(enabled, checkbox) {
  const bot = $("groupBotSelect").value || state.selectedGroupBot;
  const gid = $("groupSelect").value || state.activeGroup;
  if (!bot || !gid) return;
  checkbox.disabled = true;
  try {
    const data = await api("/api/chat/" + enc(bot) + "/group-commands?gid=" + enc(gid), {
      method: "POST", body: jsonBody({ botEnabled: enabled })
    });
    updateGroupBotToggle(data.botEnabled === true);
    const selectedGroup = state.groupList.find(group => String(group.gid) === String(gid));
    if (selectedGroup) selectedGroup.botEnabled = data.botEnabled === true;
    syncGroupCardStatuses();
    toast(enabled ? "Đã bật bot cho nhóm." : "Đã tắt bot cho nhóm; bot sẽ im lặng.", "success");
  } catch (error) {
    updateGroupBotToggle(!enabled);
    toast(error.message, "error");
  } finally {
    checkbox.disabled = false;
  }
}
async function toggleGroupCommand(command, enabled, checkbox) {
  const bot = $("groupBotSelect").value || state.selectedGroupBot;
  const gid = $("groupSelect").value || state.activeGroup;
  if (!bot || !gid) return;
  checkbox.disabled = true;
  try {
    await api("/api/chat/" + enc(bot) + "/group-commands?gid=" + enc(gid), {
      method:"POST", body:jsonBody({ command, enabled })
    });
    $("groupHint").textContent = "Đã " + (enabled ? "bật" : "tắt") + " /" + command + " cho nhóm " + gid + ".";
    toast("Đã lưu cấu hình lệnh cho nhóm.","success");
  } catch (error) {
    checkbox.checked = !enabled;
    toast(error.message,"error");
  } finally { checkbox.disabled = false; }
}

async function loadProfiles() {
  try {
    const {stats} = await api("/api/stats");
    state.botStats = stats || {};
    const names = [...new Set([...Object.keys(state.botStats), ...state.bots.map(bot => bot.name)])]
      .sort((a,b) => {
        const aOnline = state.botStats[a]?.loginState === "logged_in" ? 1 : 0;
        const bOnline = state.botStats[b]?.loginState === "logged_in" ? 1 : 0;
        return bOnline - aOnline || (number(state.botStats[b]?.updatedAt)-number(state.botStats[a]?.updatedAt)) || a.localeCompare(b);
      });
    const selected = names.includes(state.selectedProfile) ? state.selectedProfile :
      (names.includes("main") ? "main" : names[0] || "");
    state.selectedProfile = selected;
    const botLabels = new Map((state.bots || []).map(bot => [bot.name, getBotDisplayName(bot)]));
    $("profileBotSelect").innerHTML = names.length ? names.map(name=>'<option value="'+$escape(name)+'">'+$escape(botLabels.get(name) || getBotDisplayName(name))+'</option>').join("") : '<option value="">Chưa có bot</option>';
    $("profileBotSelect").value = selected;
    await loadProfileData(selected);
  } catch (error) {
    $("profileDetails").innerHTML = '<div class="empty-state">'+$escape(error.message)+'</div>';
  }
}
async function loadProfileData(name) {
  if (!name) return renderProfile("");
  state.selectedProfile = name;
  $("profileDetails").innerHTML = '<div class="empty-state">Đang lấy hồ sơ và danh bạ từ ' + $escape(getBotDisplayName(name)) + '…</div>';
  try {
    // Bridge trả dữ liệu trực tiếp từ phiên Zalo của đúng bot đã chọn.
    const live = await api("/api/chat/" + enc(name) + "/threads");
    state.botStats[name] = {
      ...(state.botStats[name] || {}),
      ...live,
      loginState: "logged_in",
      status: "online",
      updatedAt: Date.now(),
      live: true,
      loadError: ""
    };
  } catch (error) {
    state.botStats[name] = { ...(state.botStats[name] || {}), loadError: error.message };
  }
  renderProfile(name);
}
function renderProfile(name) {
  const data = state.botStats[name] || {};
  const p = data.profile || {};
  const hasData = Boolean(data.profile || data.friends?.list?.length || data.groups?.list?.length);
  if (!name || !hasData) {
    $("profileAvatar").textContent = "JT"; $("profileName").textContent = "Chưa có dữ liệu";
    $("profileUid").textContent = getBotDisplayName(name) + " chưa cung cấp được dữ liệu Zalo.";
    $("profileState").textContent = data.loadError ? "CHƯA KẾT NỐI" : "UNKNOWN";
    $("profileDetails").innerHTML = '<div class="empty-state">' + $escape(data.loadError || "Bot cần đang chạy và đăng nhập Zalo để tải hồ sơ, bạn bè và nhóm.") + '</div>';
    $("friendList").innerHTML = '<div class="empty-state">Chưa tải được danh sách bạn bè.</div>';
    $("profileGroupList").innerHTML = '<div class="empty-state">Chưa tải được danh sách nhóm.</div>';
    $("friendCount").textContent = "0"; $("profileGroupCount").textContent = "0";
    return;
  }
  const online = data.loginState === "logged_in" || data.live === true;
  const displayName = p.displayName || p.zaloName || getBotDisplayName(name);
  $("profileAvatar").innerHTML = safeImage(p.avatar) ? '<img src="'+safeImage(p.avatar)+'" alt="">' : $escape(initials(displayName));
  $("profileName").textContent = displayName;
  $("profileUid").textContent = p.uid || "—";
  $("profileState").textContent = online ? "ONLINE · ZALO" : "OFFLINE";
  $("profileState").style.color = online ? "var(--green)" : "var(--muted)";
  $("profileUpdated").textContent = "Cập nhật: " + fmtDate(data.updatedAt) + (data.loadError ? " · dữ liệu cache" : "");
  const rows = [["Tài khoản Zalo",displayName],["UID",p.uid],["Số điện thoại",p.phoneNumber],["Bạn bè",data.friends?.total ?? 0],["Nhóm",data.groups?.total ?? 0],["Login state",data.loginState || (online ? "logged_in" : "unknown")],["Cập nhật",fmtDate(data.updatedAt)]];
  $("profileDetails").innerHTML = rows.map(([key,value])=>'<div class="detail-row"><span>'+$escape(key)+'</span><b>'+$escape(value ?? "—")+'</b></div>').join("");
  const friends = data.friends?.list || [], groups = data.groups?.list || [];
  $("friendCount").textContent = data.friends?.total ?? friends.length;
  $("profileGroupCount").textContent = data.groups?.total ?? groups.length;
  $("friendList").innerHTML = friends.length ? friends.slice(0,160).map(friend=>'<div class="entity-row">'+avatarHtml(friend.avatar,friend.displayName||friend.zaloName||friend.uid)+'<div><b>'+$escape(friend.displayName||friend.zaloName||friend.uid)+'</b><small>'+$escape(friend.uid)+'</small></div></div>').join("") : '<div class="empty-state">Không có bạn bè được ghi nhận.</div>';
  $("profileGroupList").innerHTML = groups.length ? groups.slice(0,160).map(group=>'<div class="entity-row">'+avatarHtml(group.avatar,group.name||group.groupName||group.gid||group.id)+'<div><b>'+$escape(group.name||group.groupName||group.gid||group.id)+'</b><small>'+$escape(group.gid||group.id)+'</small></div></div>').join("") : '<div class="empty-state">Không có nhóm được ghi nhận.</div>';
}

async function loadSystem() {
  try {
    const [m, botData, database, recovery] = await Promise.all([
      api("/api/metrics"), api("/api/bots"), api("/api/database/health"),
      api("/api/recovery").catch(error => ({ error: error.message || "Recovery API chưa sẵn sàng" }))
    ]);
    state.bots = Array.isArray(botData.bots) ? botData.bots : state.bots;
    const values = [["Bot con",Math.max(0,state.bots.length-1)],["Tổng bot",state.bots.length],["Node",m.node],["Uptime host",fmtUptime(m.uptimeMs)],["RAM host",number(m.memoryMb)+" MB"],["Lệnh hôm nay",m.today?.commands ?? 0],["Lỗi hôm nay",m.today?.errors ?? 0],["Tìm nhạc",m.today?.musicSearch ?? 0],["Tải nhạc",m.today?.musicDownload ?? 0]];
    $("systemDetails").innerHTML = values.map(([key,value])=>'<div class="detail-row"><span>'+$escape(key)+'</span><b>'+$escape(value ?? "—")+'</b></div>').join("");

    const recoveryMaster = recovery?.master || {};
    const processHealth = recoveryMaster.process || {};
    const memoryHealth = processHealth.memory || {};
    const queueHealth = recoveryMaster.queues || {};
    const jobGlobal = queueHealth.jobs?.global || {};
    const workerPools = queueHealth.workers || {};
    const workerPending = number(queueHealth.workerPending || 0);
    const componentHealth = recoveryMaster.components || [];
    const listenerHealth = componentHealth.find(item => item.name === "listener");
    const recoveryStatusLabels = {
      healthy: "ỔN ĐỊNH",
      degraded: "ĐANG SUY GIẢM",
      critical: "NGUY HIỂM",
      recovering: "ĐANG PHỤC HỒI",
      connecting: "ĐANG KẾT NỐI",
      unknown: "CHƯA RÕ"
    };
    const recoveryClass = recovery?.status === "critical" ? "is-critical" :
      recovery?.status === "degraded" ? "is-warning" : "is-ok";
    const recoveryRows = [
      ["Trạng thái tổng", recoveryStatusLabels[recovery?.status] || "CHƯA RÕ"],
      ["CPU tiến trình", Number(processHealth.cpuPercent || 0).toFixed(1) + "%"],
      ["RAM tiến trình", number(Math.round((memoryHealth.rssBytes || 0) / 1024 / 1024)) + " MB · " + number(memoryHealth.rssRatio || 0) + "% giới hạn"],
      ["Nguồn giới hạn RAM", memoryHealth.source === "cgroup" ? "Container / cgroup" : "RAM host"],
      ["Event loop P95", Number(processHealth.eventLoop?.p95Ms || 0).toFixed(1) + " ms"],
      ["Job queue", number(jobGlobal.active || 0) + " chạy · " + number(jobGlobal.pending || 0) + "/" + number(jobGlobal.maxPending || 0) + " chờ"],
      ["Worker queue", workerPending + " chờ · " + Object.values(workerPools).filter(pool => pool.circuitOpen).length + " pool đang nghỉ"],
      ["Supabase retry", number(recoveryMaster.database?.retryQueueSize || 0) + " bản ghi · " + number(recoveryMaster.database?.consecutiveFailures || 0) + " lỗi sync · backoff " + (recoveryMaster.database?.nextSyncDelayMs ? Math.ceil(recoveryMaster.database.nextSyncDelayMs / 1000) + "s" : "—")],
      ["Listener", listenerHealth ? (recoveryStatusLabels[listenerHealth.status] || listenerHealth.status) + " · lần thử " + number(listenerHealth.attempt || 0) : "Chưa có snapshot"],
      ["Bot con", number(recovery?.counts?.healthyBots || 0) + " ổn định · " + number(recovery?.counts?.degradedBots || 0) + " suy giảm · " + number(recovery?.counts?.unavailableBots || 0) + " chưa kết nối"]
    ];
    $("recoveryDetails").innerHTML = recovery?.error
      ? '<div class="empty-state">Không tải được recovery: ' + $escape(recovery.error) + '</div>'
      : '<div class="recovery-state ' + recoveryClass + '">' + $escape(recoveryStatusLabels[recovery?.status] || "CHƯA RÕ") + '</div>' +
        recoveryRows.map(([key,value]) => '<div class="detail-row"><span>' + $escape(key) + '</span><b>' + $escape(value) + '</b></div>').join("");

    const recoveryAlerts = (recovery?.alerts || []).slice(0, 16).map(alert => {
      const severity = alert.severity === "critical" ? "is-critical" :
        alert.severity === "warning" ? "is-warning" : "is-info";
      const scope = alert.bot ? "Bot " + alert.bot : "Master";
      return '<div class="recovery-alert ' + severity + '"><b>' + $escape(alert.severity || "info") +
        '</b><span>' + $escape(alert.message || alert.code || "Cảnh báo") +
        '</span><small>' + $escape(scope + (alert.code ? " · " + alert.code : "")) + '</small></div>';
    }).join("");
    const childRecovery = (recovery?.bots || []).map(bot => {
      const childStatus = bot.available ? (recoveryStatusLabels[bot.recovery?.status] || bot.recovery?.status || "CHƯA RÕ") : "KHÔNG KẾT NỐI";
      const childClass = !bot.available ? "is-unknown" :
        bot.recovery?.status === "critical" ? "is-critical" :
        bot.recovery?.status === "degraded" ? "is-warning" : "is-ok";
      const rss = bot.recovery?.process?.memory?.rssBytes;
      const p95 = bot.recovery?.process?.eventLoop?.p95Ms;
      const details = bot.available
        ? number(Math.round((rss || 0) / 1024 / 1024)) + " MB RAM · " + Number(p95 || 0).toFixed(1) + " ms event loop"
        : (bot.reason || "Bridge chưa sẵn sàng");
      return '<div class="recovery-child-row"><b>' + $escape(bot.name) + '</b><span class="recovery-child-state ' + childClass + '">' +
        $escape(childStatus) + '</span><small>' + $escape(details) + '</small></div>';
    }).join("");
    $("recoveryAlertList").innerHTML = recovery?.error
      ? '<div class="empty-state">Chưa đọc được cảnh báo phục hồi.</div>'
      : (recoveryAlerts || '<div class="empty-state">Chưa có cảnh báo sức khỏe.</div>') +
        (childRecovery ? '<div class="recovery-child-list">' + childRecovery + '</div>' : "");

    const db = database || m.database || m.supabase || {};
    const probe = db.probe || {};
    let dbRows;
    if (db.driver === "supabase") {
      const threads = probe.tables?.bot_threads;
      dbRows = [
        ["Driver","Supabase"],
        ["Trạng thái",db.ok ? "Kết nối / đồng bộ ổn định" : "CẦN KIỂM TRA"],
        ["Bảng bot_threads",threads ? (threads.ok ? "Hoạt động · "+(threads.latencyMs ?? "—")+" ms" : "Lỗi: "+(threads.error || "không xác định")) : "Chưa có kết quả probe"],
        ["Kiểm tra gần nhất",fmtDate(probe.checkedAt || db.lastSyncAt)],
        ["Đồng bộ gần nhất",fmtDate(db.lastSyncAt)],
        ["Lỗi liên tiếp",db.consecutiveFailures ?? 0],
        ["Phân loại lỗi",db.classified || "—"],
        ["Lỗi gần nhất",db.syncError || threads?.error || "Không có"],
        ["Độ bền dữ liệu","Lưu trên database Supabase"]
      ];
    } else if (db.driver === "json") {
      const disk = db.persistentDisk || {};
      const diskLabels = {
        not_applicable:"Không áp dụng (không chạy trên Render)",
        unknown:"Chưa xác minh — chưa cấu hình JT_PERSISTENT_DIR",
        mount_not_verified:"Chưa xác minh được mount riêng tại đường dẫn này",
        mount_detected_unverified:"Có mount riêng nhưng chưa cấu hình JT_PERSISTENT_DIR",
        database_outside_disk:"File DB nằm ngoài JT_PERSISTENT_DIR",
        mounted_and_used:"Mount riêng đã xác minh và file DB đang sử dụng disk"
      };
      const durabilityLabels = {
        local:"Filesystem máy chủ hiện tại",
        unknown:"Chưa xác minh",
        disk_not_used:"File database nằm ngoài đường dẫn disk đã khai báo",
        persistent:"Persistent Disk đã được xác minh và đang sử dụng"
      };
      const probeFile = probe.fileExists === true;
      dbRows = [
        ["Driver","JSON"],
        ["Trạng thái",db.ok ? "File store sẵn sàng" : "CẦN KIỂM TRA — "+(db.lastFlushError || "lỗi đọc/ghi")],
        ["File database",db.filePath || "—"],
        ["File tồn tại",db.file?.exists || probeFile ? "Có" : "Chưa được tạo"],
        ["Dung lượng",number(db.file?.sizeBytes)+" bytes"],
        ["Ghi / sửa gần nhất",fmtDate(db.lastFlushAt || db.file?.modifiedAt)],
        ["Persistent Disk",diskLabels[disk.status] || "Chưa xác minh"],
        ["Mount path",disk.mountPath || "Chưa cấu hình"],
        ["File DB nằm trong mount path",disk.databaseFileOnDisk === true ? "Có (theo cấu hình)" : disk.databaseFileOnDisk === false ? "Không" : "Chưa rõ"],
        ["Độ bền dữ liệu",durabilityLabels[db.storage?.durability] || "Chưa xác minh"],
        ["Lỗi đọc/ghi",db.lastFlushError || "Không có"]
      ];
    } else {
      dbRows = [["Driver","Chưa xác định"],["Trạng thái",db.error || "Không đọc được cấu hình database"]];
    }
    const storageLayout = m.storageLayout || {};
    const registryDisk = storageLayout.persistence || {};
    dbRows.push(
      ["Registry bot", storageLayout.registryFile || "—"],
      ["Độ bền registry", registryDisk.message || "Chưa xác minh"],
      ["Thư mục bot con", storageLayout.botsRoot || "—"]
    );
    $("databaseDetails").innerHTML = dbRows.map(([key,value])=>'<div class="detail-row"><span>'+$escape(key)+'</span><b>'+$escape(value ?? "—")+'</b></div>').join("");

    // Kiểm tra database thật trong từng tiến trình bot con, không suy luận từ DB master.
    const botStorageResults = new Array(state.bots.length);
    let storageCursor = 0;
    const storageWorker = async () => {
      while (storageCursor < state.bots.length) {
        const index = storageCursor++;
        const bot = state.bots[index];
        if (bot.loginState !== "logged_in") {
          botStorageResults[index] = { bot, unavailable: "Bot chưa đăng nhập; chưa thể hỏi bridge của tiến trình này." };
          continue;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const result = await api("/api/chat/" + enc(bot.name) + "/storage-status", { signal:controller.signal });
          botStorageResults[index] = { bot, result };
        } catch (error) {
          botStorageResults[index] = { bot, unavailable: error.name === "AbortError" ? "Bridge quá thời gian kiểm tra." : error.message };
        } finally {
          clearTimeout(timeout);
        }
      }
    };
    await Promise.all(Array.from({length:Math.min(3,state.bots.length)}, () => storageWorker()));

    const persistenceLabels = {
      "verified-mount":"Mount riêng đã được xác minh",
      "mount-detected-unverified":"Có mount nhưng chưa khai báo",
      "unconfigured":"Chưa khai báo Persistent Disk",
      "database-outside-disk":"File database nằm ngoài disk",
      "mount-not-verified":"Chưa xác minh được mount",
      "host-local":"Filesystem của host",
      "managed-remote":"Database Supabase từ xa"
    };
    $("botStorageDetails").innerHTML = botStorageResults.length ? botStorageResults.map(item => {
      const name = item.bot.displayName || item.bot.name;
      if (item.unavailable) {
        return '<div class="bot-storage-row"><div><b>'+$escape(name)+'</b><small>'+$escape(item.unavailable)+'</small></div><span class="storage-state is-unknown">Chưa kiểm tra</span></div>';
      }
      const storage = item.result?.storage || {};
      const persistence = storage.persistence || {};
      const driver = storage.driver || "unknown";
      const healthy = storage.ok === true;
      const durability = persistenceLabels[persistence.status] || persistence.status || "Chưa xác minh";
      const summary = driver === "supabase"
        ? "Supabase · " + (healthy ? "Đã đồng bộ" : (storage.syncError || "Cần kiểm tra"))
        : "JSON · " + (storage.filePath || "Chưa rõ đường dẫn");
      const message = persistence.message || (driver === "supabase"
        ? "Dữ liệu bot được lưu trên Supabase."
        : storage.loadError || storage.lastFlushError || "Không có thông tin độ bền dữ liệu.");
      const className = !healthy ? "is-warning" :
        (driver === "supabase" || persistence.confirmed === true) ? "is-ok" : "is-unknown";
      return '<div class="bot-storage-row"><div><b>'+$escape(name)+'</b><small>'+$escape(summary)+'</small><small>'+$escape(message)+'</small></div><span class="storage-state '+className+'">'+$escape(durability)+'</span></div>';
    }).join("") : '<div class="empty-state">Chưa có bot con trong registry.</div>';

    $("systemBotList").innerHTML = state.bots.length ? state.bots.map(bot => {
      const [label,cls] = botStatus(bot);
      const identity = getBotDisplayName(bot);
      const processInfo = (bot.pid ? "PID " + bot.pid : "Chưa có PID") + " · " + fmtUptime(bot.uptimeMs);
      return '<div class="system-bot-row"><div class="system-bot-identity">' +
        avatarHtml(bot.avatar, identity, "avatar-large") +
        '<div><b>'+$escape(identity)+'</b><small>'+$escape(processInfo)+'</small></div></div>' +
        '<span class="status-label '+$escape(cls)+'"><i class="dot"></i>'+$escape(label)+'</span></div>';
    }).join("") : '<div class="empty-state">Không có bot trong registry.</div>';

    const cache = m.cache || {};
    const tables = cache.tables || {};
    const entries = Object.entries(tables);
    $("cacheDetails").innerHTML = entries.length ? entries.map(([name,item])=>'<div class="cache-row"><span>'+$escape(name)+'</span><b>'+number(item.hits)+' hit / '+number(item.misses)+' miss</b></div>').join("") : '<div class="cache-row"><span>Total hits</span><b>'+number(cache.total)+'</b></div>';

    let errorsData = { summary: {}, events: [], bots: [] };
    try {
      errorsData = await api("/api/errors");
    } catch (error) {
      errorsData.unavailable = error.message || "Không đọc được nhật ký lỗi";
    }
    const errorSummary = errorsData.summary || {};
    const errorHeader =
      '<div class="error-monitor-stats">' +
      '<div><b>' + number(errorSummary.errors || 0) + '</b><small>Lỗi</small></div>' +
      '<div><b>' + number(errorSummary.warnings || 0) + '</b><small>Cảnh báo</small></div>' +
      '<div><b>' + number(errorSummary.deduplicated || 0) + '</b><small>Lỗi lặp đã gộp</small></div>' +
      '<div><b>' + number(errorSummary.unique || 0) + '</b><small>Sự kiện riêng</small></div>' +
      '</div>';
    const summarizeErrorBuckets = (buckets, prefix) => Object.entries(buckets || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([name, count]) => prefix + $escape(name) + " · " + number(count))
      .join("  /  ") || "Chưa có";
    const errorBreakdown =
      '<div class="error-monitor-breakdown"><div><b>Top lệnh</b><span>' +
      summarizeErrorBuckets(errorSummary.byCommand, "/") +
      '</span></div><div><b>Nhóm có lỗi</b><span>' +
      summarizeErrorBuckets(errorSummary.byGroup, "") +
      '</span></div><div><b>Nguồn lỗi</b><span>' +
      summarizeErrorBuckets(errorSummary.bySource, "") +
      '</span></div></div>';
    const botErrorRows = (errorsData.bots || []).map(bot => {
      const stateLabel = bot.flapping ? "Đang flapping" : (bot.processStatus || "unknown");
      return '<div class="error-bot-row"><b>' + $escape(bot.name) + '</b><span>' +
        $escape(stateLabel) + '</span><small>Restart: ' + number(bot.restarts) + '</small></div>';
    }).join("");
    const eventRows = (errorsData.events || []).slice(0, 40).map(event => {
      const date = event.timestamp ? new Date(event.timestamp).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";
      const level = event.level === "warn" ? "CẢNH BÁO" : "LỖI";
      const levelClass = event.level === "warn" ? "is-warning" : "is-error";
      const labels = [
        event.bot ? "Bot " + event.bot : "",
        event.command ? "/" + event.command : "",
        event.event ? event.event : "",
        event.groupId ? "Nhóm " + event.groupId : ""
      ].filter(Boolean).join(" · ");
      return '<article class="error-monitor-item">' +
        '<div class="error-monitor-top"><span class="error-level ' + levelClass + '">' + level + '</span>' +
        '<time>' + $escape(date) + '</time><b>' + $escape("×" + number(event.count || 1)) + '</b></div>' +
        '<div class="error-monitor-message">' + $escape(event.message || "Không có nội dung") + '</div>' +
        '<div class="error-monitor-context">' + $escape(labels || event.source || "runtime") +
        ' · nguồn ' + $escape(event.source || "runtime") + '</div></article>';
    }).join("");
    $("errorMonitorSummary").innerHTML = errorsData.unavailable
      ? '<div class="empty-state">' + $escape(errorsData.unavailable) + '</div>'
      : errorHeader + errorBreakdown + '<div class="error-bot-list">' + (botErrorRows || '<small>Chưa có bot con</small>') + '</div>';
    $("errorMonitorList").innerHTML = eventRows ||
      '<div class="empty-state">' + (errorsData.unavailable ? $escape(errorsData.unavailable) : "Chưa ghi nhận lỗi hoặc cảnh báo gần đây.") + '</div>';

    const executions = new Map((m.commandExecutionLatency || []).map(item => [item.command, item]));
    const latencyRows = Array.isArray(m.commandLatency) ? m.commandLatency : [];
    const latencySummary = m.latency || {};
    const latencyHeader = '<div class="detail-row"><span>Tổng mẫu</span><b>'+number(latencySummary.count || 0)+'</b></div>' +
      '<div class="detail-row"><span>Trung bình toàn bot</span><b>'+Number(latencySummary.avgMs || 0).toFixed(1)+' ms</b></div>' +
      '<div class="detail-row"><span>P95 toàn bot</span><b>'+Number(latencySummary.p95Ms || 0).toFixed(1)+' ms</b></div>';
    const latencyDetails = latencyRows.map(item => {
      const execution = executions.get(item.command);
      const p95 = Number(item.p95Ms) || 0;
      const label = p95 >= 1000 ? "CẦN TỐI ƯU" : p95 >= 400 ? "THEO DÕI" : "ỔN";
      const handler = execution
        ? ' · Handler P95 '+Number(execution.p95Ms || 0).toFixed(1)+' ms'
        : '';
      return '<div class="detail-row"><span>/'+$escape(item.command)+' · '+number(item.count)+' mẫu</span><b>P95 '+p95.toFixed(1)+' ms · TB '+Number(item.avgMs || 0).toFixed(1)+' ms · '+label+handler+'</b></div>';
    }).join("");
    $("commandLatencyDetails").innerHTML = latencyHeader + (latencyDetails || '<div class="empty-state">Chưa có mẫu lệnh. Số liệu sẽ xuất hiện sau khi bot nhận lệnh thực tế.</div>');
    $("auditLog").textContent = (m.audit || []).join("\n") || "(chưa có hành động admin)";
  } catch (error) {
    $("systemDetails").innerHTML = '<div class="empty-state">'+$escape(error.message)+'</div>';
    $("databaseDetails").innerHTML = '<div class="empty-state">Không kiểm tra được database: '+$escape(error.message)+'</div>';
    if ($("botStorageDetails")) $("botStorageDetails").innerHTML = '<div class="empty-state">Không tải được trạng thái storage từng bot.</div>';
    $("systemBotList").innerHTML = '<div class="empty-state">Không tải được trạng thái bot.</div>';
  }
}

function readMutedThreads() { return state.mutedThreads || []; }
function threadRows() {
  const friends = state.chatData.friends?.list || [], groups = state.chatData.groups?.list || [];
  return [
    ...groups.map(g=>({id:String(g.gid||g.id||""),type:1,name:g.name||g.groupName||g.gid||g.id,avatar:g.avatar||"",last:g.lastMessage,isGroup:true,botEnabled:typeof g.botEnabled==="boolean"?g.botEnabled:null})),
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
    const botState = !t.isGroup ? "" : t.botEnabled === true
      ? '<small class="thread-bot-state is-on">BOT ON</small>'
      : t.botEnabled === false
        ? '<small class="thread-bot-state is-off">BOT OFF</small>'
        : '<small class="thread-bot-state is-unknown">CHƯA XÁC MINH</small>';
    return '<button class="thread-item '+(active?"active":"")+'" data-action="open-thread" data-id="'+$escape(t.id)+'" data-type="'+t.type+'"><span class="avatar">'+(safeImage(t.avatar)?'<img src="'+safeImage(t.avatar)+'" alt="">':$escape(initials(t.name)))+'</span><span class="thread-copy"><span class="thread-title">'+$escape(t.name)+$escape(key)+' <small class="thread-kind">'+(t.isGroup?"NHÓM":"BẠN BÈ")+'</small> '+botState+'</span><span class="thread-preview">'+$escape(preview)+'</span></span><small style="color:var(--muted-2)">'+$escape(time)+'</small></button>';
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
    const folder = event.target.closest("[data-command-folder]");
    if (folder) {
      state.selectedCommandFolder = folder.dataset.commandFolder;
      renderCommands();
      return;
    }
    const groupBulkAction = event.target.closest("[data-group-bulk-action]");
    if (groupBulkAction) {
      return setGroupBotsBulk(groupBulkAction.dataset.groupBulkAction === "on");
    }
    if (event.target.closest("#groupClearSelection")) {
      state.selectedGroupIds.clear();
      renderGroupCards();
      return;
    }
    const groupFilter = event.target.closest("[data-group-filter]");
    if (groupFilter) {
      state.groupFilter = groupFilter.dataset.groupFilter || "all";
      document.querySelectorAll("[data-group-filter]").forEach(button => {
        const active = button === groupFilter;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      renderGroupCards();
      return;
    }
    const groupCard = event.target.closest("[data-group-id]");
    if (groupCard) {
      const gid = String(groupCard.dataset.groupId || "");
      if (!gid || !state.groupList.some(group => String(group.gid) === gid)) return;
      $("groupSelect").value = gid;
      state.activeGroup = gid;
      renderGroupCards();
      return loadGroupCommands();
    }
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
  document.addEventListener("load", event => {
    if (event.target?.matches?.(".group-card-avatar img")) event.target.classList.add("loaded");
  }, true);
  document.addEventListener("error", event => {
    const image = event.target;
    if (!image?.matches?.(".group-card-avatar img")) return;
    const avatar = image.closest(".group-card-avatar");
    const key = image.dataset.avatarKey || image.src;
    if (key) state.failedGroupAvatarUrls.add(key);
    if (avatar) avatar.textContent = image.dataset.avatarFallback || "?";
  }, true);
  document.addEventListener("change", event => {
    const el=event.target;
    if (el.matches('[data-action="auto-restart"]')) setAutoRestart(el.dataset.bot,el.checked);
    if (el.matches('[data-action="toggle-command"]')) toggleGroupCommand(el.dataset.command,el.checked,el);
    if (el.matches("[data-anti-feature]")) setAntiProtectionFeature(el.dataset.antiFeature,el.checked,el);
    if (el.id==="commandRole") renderCommands();
    if (el.id==="profileBotSelect") loadProfileData(el.value);
    if (el.id==="groupBotSelect") {
      if (state.selectedGroupBot !== el.value) state.selectedGroupIds.clear();
      state.selectedGroupBot=el.value;state.activeGroup="";loadGroupOptions();
    }
    if (el.matches("[data-group-select]")) {
      const gid=String(el.dataset.groupSelect || "");
      if (gid) {
        if (el.checked) state.selectedGroupIds.add(gid);
        else state.selectedGroupIds.delete(gid);
      }
      renderGroupCards();
    }
    if (el.id==="groupSelectVisible") {
      const visible=[...document.querySelectorAll("#groupCardGrid [data-group-id]")].map(card=>String(card.dataset.groupId || ""));
      for (const gid of visible) {
        if (el.checked) state.selectedGroupIds.add(gid);
        else state.selectedGroupIds.delete(gid);
      }
      renderGroupCards();
    }
    if (el.id==="groupSelect") { renderGroupCards(); loadGroupCommands(); }
    if (el.id==="groupSort") { state.groupSort=el.value || "name-asc"; renderGroupCards(); }
    if (el.id==="chatFontSize") state.chatStyle.font=el.value;
    if (el.id==="chatBotSelect") {closeThread();loadThreads();}
  });
  document.addEventListener("input",event=>{
    if(event.target.id==="threadSearch")renderThreads();
    if(event.target.id==="commandSearch")renderCommands();
    if(event.target.id==="groupSearch") {
      clearTimeout(state.timers.groupSearch);
      state.timers.groupSearch = setTimeout(() => renderGroupCards(), 120);
    }
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
  $("chatBotSelect").addEventListener("change",()=>{
    updateChatBotLabel();
    closeThread();
    if(state.view === "chat") loadThreads();
  });
  $("threadInfoButton").addEventListener("click",openThreadInfo);
  $("groupForm").addEventListener("submit",event=>{event.preventDefault();loadGroupCommands();});
  $("groupBotEnabled").addEventListener("change",event=>setGroupBotEnabled(event.target.checked,event.target));
  $("reloadGroupChoices").addEventListener("click",loadGroupOptions);
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
