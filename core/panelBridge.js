// ===== CẦU NỐI PANEL ↔ BOT (localhost only) =====
// Panel cần xem bạn bè/nhóm và CHAT TRỰC TIẾP với bot (kiểu Zalo thu nhỏ).
// Bot con và panel chạy cùng máy nên bot mở 1 HTTP server nội bộ (127.0.0.1)
// để panel gọi — real-time, không đi mạng ngoài, không cần auth (chỉ localhost).
const http = require("http");
const crypto = require("crypto");
const { ThreadType } = require("zalo-client");
const stats = require("./stats");
const logger = require("../utils/logger");
const { wrapApi } = require("./message");

// ===== Bộ nhớ tin nhắn: RAM + lưu đĩa (sống sót qua restart) =====
// Zalo đã XOÁ API lịch sử nhóm (getGroupChatHistory → 404) nên panel chỉ
// xem được tin từ khi bot chạy; lưu ra JSON để restart không mất.
const fs = require("fs");
const path = require("path");
const MAX_PER_THREAD = 200;
const MAX_THREADS = 30;
const CACHE_FILE = path.join(__dirname, "..", "data", "panel_chat.json");
const ADMIN_GROUPS_FILE = path.join(__dirname, "..", "data", "bot_admin_groups.json");

// Zalo không trả memberIds cho nhóm lớn → không đo "bot có phải admin" qua
// API được. Người dùng tự đánh dấu nhóm bot CẦM KEY trong panel (lưu file).
function readAdminGroups() {
  try { return JSON.parse(fs.readFileSync(ADMIN_GROUPS_FILE, "utf8")) || []; } catch { return []; }
}
function writeAdminGroups(list) {
  try {
    fs.mkdirSync(path.dirname(ADMIN_GROUPS_FILE), { recursive: true });
    fs.writeFileSync(ADMIN_GROUPS_FILE, JSON.stringify(list));
  } catch { /* bỏ qua */ }
  return list;
}
const ring = new Map(); // threadId → [{ from, name, text, ts, isSelf }]
let persistTimer = null;

function loadRingFromDisk() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    const entries = Object.entries(data || {})
      .filter(([, list]) => Array.isArray(list) && list.length)
      .map(([tid, list]) => [String(tid), list.slice(-MAX_PER_THREAD)])
      .sort((a, b) => {
        const lastA = Number(a[1][a[1].length - 1]?.ts) || 0;
        const lastB = Number(b[1][b[1].length - 1]?.ts) || 0;
        return lastA - lastB;
      });
    for (const [tid, list] of entries.slice(-MAX_THREADS)) {
      ring.set(tid, list);
    }
  } catch { /* không đọc được thì thôi */ }
}

let persistInFlight = false;
let persistAgain = false;

function persistRing() {
  persistTimer = null;
  if (persistInFlight) {
    persistAgain = true;
    return;
  }

  persistInFlight = true;
  // Chỉ serialize tối đa MAX_THREADS × MAX_PER_THREAD tin nhắn.
  const keep = Object.fromEntries(ring.entries());
  const tempPath = `${CACHE_FILE}.${process.pid}.tmp`;

  fs.promises.mkdir(path.dirname(CACHE_FILE), { recursive: true })
    .then(() => fs.promises.writeFile(tempPath, JSON.stringify(keep), "utf8"))
    .then(() => fs.promises.rename(tempPath, CACHE_FILE))
    .catch(() => { /* lưu panel history không được làm gián đoạn bot */ })
    .finally(() => {
      persistInFlight = false;
      if (persistAgain) {
        persistAgain = false;
        schedulePersist();
      }
    });
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(persistRing, 10000).unref?.();
}

function touchThread(threadId, list) {
  const key = String(threadId);
  if (ring.has(key)) {
    // Chuyển hội thoại vừa hoạt động về cuối Map để giữ thứ tự LRU.
    ring.delete(key);
  } else if (ring.size >= MAX_THREADS) {
    const oldestKey = ring.keys().next().value;
    if (oldestKey !== undefined) ring.delete(oldestKey);
  }
  ring.set(key, list);
}

function record(threadId, message) {
  if (threadId == null || threadId === "") return;
  const key = String(threadId);
  const list = ring.get(key) || [];
  touchThread(key, list);
  list.push({ ts: Date.now(), ...message });
  if (list.length > MAX_PER_THREAD) list.splice(0, list.length - MAX_PER_THREAD);
  schedulePersist();
}

function getMessages(threadId, limit = 60) {
  const list = ring.get(threadId) || [];
  return list.slice(-limit);
}

// Nội dung tin nhắn → text hiển thị được
function contentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object") {
    return content.title || content.caption || content.description ||
           (content.href ? `[tệp] ${content.href.slice(0, 80)}` : "") || "[tin nhắn đặc biệt]";
  }
  return String(content);
}

// Ghi nhận tin ĐẾN (gọi từ core/listen.js)
function recordIncoming(event) {
  try {
    const data = event?.data || {};
    record(event.threadId, {
      from: String(data.uidFrom || ""),
      name: data.dName || "",
      text: contentToText(data.content),
      isSelf: false
    });
  } catch { /* bỏ qua */ }
}

let server = null;
let apiRef = null;

// Token bảo mật cầu nối panel↔bot (chỉ localhost, nhưng vẫn cần để tránh
// ai đó bind thêm cổng 127.0.0.1 và gọi được bot). Ưu tiên: token arg → env
// JT_BRIDGE_TOKEN → config.panel.bridge_token/token → env JT_PANEL__TOKEN →
// fallback ngẫu nhiên (luôn bảo vệ, không bao giờ để trống).
let BRIDGE_TOKEN = "";
const historyAt = new Map(); // threadId → ts lần cuối kéo lịch sử nhóm

// Zalo trả ts GIÂY cho lịch sử nhóm, ms cho tin realtime — quy về ms
function normTs(ts) {
  const n = Number(ts) || 0;
  return n < 1e12 ? n * 1000 : n;
}

// Kéo lịch sử tin nhắn NHÓM từ Zalo; giữ tin LIVE mới hơn lịch sử
async function loadGroupHistory(threadId, limit) {
  if (typeof apiRef?.getGroupChatHistory !== "function") return null;
  const cachedAt = historyAt.get(threadId) || 0;
  const current = getMessages(threadId, limit);
  // Mới kéo lịch sử < 30s và đã có tin → khỏi kéo lại
  if (Date.now() - cachedAt < 30000 && current.length) return current;

  try {
    const history = await apiRef.getGroupChatHistory(threadId, 80);
    const list = (history?.groupMsgs || []).map((m) => ({
      ts: normTs(m?.data?.ts),
      from: String(m?.data?.uidFrom || ""),
      name: m?.data?.dName || "",
      text: contentToText(m?.data?.content),
      isSelf: Boolean(m?.isSelf)
    })).filter((m) => m.ts > 0);
    if (!list.length) return current;
    const live = current.filter((m) => m.ts > list[list.length - 1].ts);
    touchThread(threadId, [...list, ...live].slice(-MAX_PER_THREAD));
    // The ring buffer is capped per thread; keep its history freshness map
    // capped too, otherwise opening many one-off group chats leaks Map entries.
    historyAt.delete(threadId);
    historyAt.set(threadId, Date.now());
    while (historyAt.size > MAX_THREADS) {
      const oldestThreadId = historyAt.keys().next().value;
      if (oldestThreadId === undefined) break;
      historyAt.delete(oldestThreadId);
    }
    return getMessages(threadId, limit);
  } catch (error) {
    logger.log(`[bridge] lịch sử nhóm ${threadId} lỗi: ${error.message}`, "warn");
    return current;
  }
}

// ===== HTTP server nội bộ =====
async function handleRequest(req, res, url) {
  const route = url.pathname;
  // Bảo mật: mọi route đều yêu cầu token (x-bridge-token hoặc Bearer).
  // health endpoint vẫn cần auth để panel proxy /health có thể kiểm tra bot.
  const header = req.headers["x-bridge-token"] || "";
  const authz = req.headers.authorization || "";
  const provided = header || (authz.startsWith("Bearer ") ? authz.slice(7) : "");
  if (BRIDGE_TOKEN && provided !== BRIDGE_TOKEN) {
    const json = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    return json(401, { error: "Unauthorized bridge token" });
  }
  const json = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };

  if (route === "/health") return json(200, { ok: true, pid: process.pid });

  // Danh sách bạn bè + nhóm (+ hồ sơ) — dùng cache 5 phút của core/stats
  if (route === "/threads") {
    const [friends, groups, profile] = await Promise.all([
      stats.getFriends(apiRef),
      stats.getGroups(apiRef),
      stats.getProfile(apiRef)
    ]);
    // Kèm tin cuối (từ ring) để panel hiện preview giống Zalo
    const withLast = (item, key) => {
      const last = getMessages(String(item[key]), 1)[0];
      return { ...item, lastMessage: last ? { text: last.text, ts: last.ts, name: last.name } : null };
    };
    return json(200, {
      friends: { ...friends, list: (friends.list || []).map((f) => withLast(f, "uid")) },
      groups: { ...groups, list: (groups.list || []).map((g) => withLast(g, "gid")) },
      profile,
      adminGroups: readAdminGroups()
    });
  }

  // Tin nhắn gần đây của 1 thread (nhóm: kéo thêm lịch sử từ Zalo)
  if (route === "/messages") {
    const threadId = url.searchParams.get("threadId") || "";
    const type = Number(url.searchParams.get("type")) || 0;
    if (!threadId) return json(400, { error: "Thiếu threadId" });
    const limit = Math.min(Number(url.searchParams.get("limit")) || 60, 100);
    let messages = getMessages(threadId, limit);
    let historyApi = false;
    if (type === 1) {
      const merged = await loadGroupHistory(threadId, limit);
      if (merged) messages = merged;
    }
    historyApi = messages.length > 0 && type === 1 && (historyAt.get(threadId) || 0) > 0;
    return json(200, { messages, historyApi });
  }

  // Danh sách nhóm bot cầm key (do người dùng đánh dấu trong panel)
  if (route === "/admin-groups") return json(200, { groups: readAdminGroups() });

  if (route === "/toggle-admin-group" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try {
        const { gid } = JSON.parse(body || "{}");
        if (!gid) return json(400, { error: "Thiếu gid" });
        const list = readAdminGroups();
        const has = list.includes(gid);
        const next = has ? list.filter((g) => g !== gid) : [...list, gid];
        return json(200, { groups: writeAdminGroups(next) });
      } catch (error) {
        return json(500, { error: error.message });
      }
    });
    return;
  }

  // Thông tin hội thoại (người dùng hoặc nhóm + thành viên)
  if (route === "/thread-info") {
    const threadId = url.searchParams.get("threadId") || "";
    const type = Number(url.searchParams.get("type")) || 0;
    if (!threadId) return json(400, { error: "Thiếu threadId" });
    try {
      if (type === 1) {
        const info = await apiRef.getGroupInfo(threadId);
        const g = info?.gridInfoMap?.[threadId] || {};
        // Nhóm lớn: Zalo hay trả memberIds/currentMems rỗng — panel sẽ hiện ô
        // nhập UID để chặn/xoá chính xác thay vì danh sách.
        const adminIds = g.adminIds || [];
        // currentMems = chi tiết (tên+avatar); memberIds = mọi uid (nhóm lớn
        // Zalo chỉ trả ids) → ghép lại, ưu tiên bản chi tiết.
        const seen = new Set();
        const members = [];
        for (const m of (g.currentMems || [])) {
          const uid = String(m.id || m.userId || "");
          if (!uid || seen.has(uid)) continue;
          seen.add(uid);
          members.push({ uid, name: m.dName || m.zaloName || "", avatar: m.avatar || "", isAdmin: adminIds.includes(uid) });
        }
        for (const uid of (g.memberIds || [])) {
          const id = String(uid);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          members.push({ uid: id, name: "", avatar: "", isAdmin: adminIds.includes(id) });
        }
        return json(200, {
          isGroup: true, id: threadId,
          name: g.name || "", avatar: g.avt || g.fullAvt || "",
          totalMember: g.totalMember || members.length,
          members,
          hasMoreMember: Boolean(g.hasMoreMember)
        });
      }
      const info = await apiRef.getUserInfo(threadId);
      const u = info?.changedProfiles?.[threadId] || info?.profiles?.[threadId] || {};
      return json(200, {
        isGroup: false, id: threadId,
        name: u.displayName || u.zaloName || threadId,
        avatar: u.avatar || "",
        uid: threadId,
        status: u.status || ""
      });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  // Hồ sơ 1 người dùng (bấm avatar trong tin nhắn nhóm)
  if (route === "/user-info") {
    const uid = url.searchParams.get("uid") || "";
    if (!uid) return json(400, { error: "Thiếu uid" });
    try {
      const info = await apiRef.getUserInfo(uid);
      const u = info?.changedProfiles?.[uid] || info?.profiles?.[uid] || info?.profiles?.[String(uid)] || {};
      return json(200, { isGroup: false, id: uid, uid, name: u.displayName || u.zaloName || uid, avatar: u.avatar || "", status: u.status || "" });
    } catch (error) {
      return json(500, { error: error.message });
    }
  }

  // Hành động: rời nhóm / xoá-chặn người / đổi tên nhóm...
  if (route === "/action" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", async () => {
      try {
        const { action, threadId, uid, value } = JSON.parse(body || "{}");
        if (!action) return json(400, { error: "Thiếu action" });
        const api = apiRef;
        switch (action) {
          case "leave-group":
            await api.leaveGroup(threadId);
            break;
          case "remove-user":
            await api.removeUserFromGroup(uid, threadId);
            break;
          case "block-user":
            await api.blockUser(uid);
            break;
          case "block-group-user":
            await api.addGroupBlockedMember(uid, threadId);
            break;
          case "rename-group":
            await api.changeGroupName(String(value || ""), threadId);
            break;
          case "add-user":
            // thêm thành viên vào nhóm (bot cần key)
            await api.addUserToGroup(uid, threadId);
            break;
          case "set-deputy":
            // đặt/gỡ phó nhóm
            await api.addGroupDeputy(uid, threadId);
            break;
          case "disperse-group":
            // giải tán nhóm (bot cần là chủ nhóm)
            await api.disperseGroup(threadId);
            break;
          default:
            return json(400, { error: "Hành động không hỗ trợ: " + action });
        }
        return json(200, { ok: true });
      } catch (error) {
        return json(500, { error: error.message });
      }
    });
    return;
  }

  // Gửi tin tới 1 thread (bạn bè hoặc nhóm)
  if (route === "/send" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", async () => {
      try {
        const { threadId, type, msg, styles } = JSON.parse(body || "{}");
        if (!threadId || !msg) return json(400, { error: "Thiếu threadId hoặc msg" });
        // styles: kiểu chữ gửi LUÔN lên Zalo (bold/màu/cỡ chữ...) — Zalo chỉ
        // hỗ trợ b/i/u/s + 4 màu + 2 cỡ chữ nên panel lọc trước khi gửi.
        const safeStyles = (Array.isArray(styles) ? styles : [])
          .filter((st) => st && Number.isFinite(st.start) && Number.isFinite(st.len) && typeof st.st === "string")
          .slice(0, 8);
        await wrapApi(apiRef, threadId, Number(type) === 1 ? ThreadType.Group : ThreadType.User, "panel").sendMessage(
          { msg: String(msg), ...(safeStyles.length ? { styles: safeStyles } : {}) },
          threadId,
          Number(type) === 1 ? ThreadType.Group : ThreadType.User
        );
        record(threadId, { from: "me", name: "Bot", text: String(msg), isSelf: true });
        return json(200, { ok: true });
      } catch (error) {
        return json(500, { error: error.message });
      }
    });
    return;
  }

  json(404, { error: "Không có route" });
}

// Cổng: env JT_BRIDGE_PORT, bận thì tự tăng
function findPort(preferred) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const srv = http.createServer();
      srv.once("error", () => tryPort(port + 1));
      srv.once("listening", () => srv.close(() => resolve(port)));
      srv.listen(port, "127.0.0.1");
    };
    tryPort(preferred);
  });
}

async function start({ api, port = 3901, token } = {}) {
  if (!api?.sendMessage) return;
  if (server) return server.address().port;
  apiRef = api;

  // ---- Token resolution (không bao giờ log giá trị token) ----
  let source = "random";
  let resolved = "";
  if (token) { resolved = String(token); source = "arg"; }
  else if (process.env.JT_BRIDGE_TOKEN) { resolved = process.env.JT_BRIDGE_TOKEN; source = "env:JT_BRIDGE_TOKEN"; }
  else if (global.config?.panel?.bridge_token) { resolved = global.config.panel.bridge_token; source = "config:panel.bridge_token"; }

  if (resolved) {
    BRIDGE_TOKEN = resolved;
  } else {
    // Fallback ngẫu nhiên per-process → luôn bảo vệ, không để trống.
    BRIDGE_TOKEN = crypto.randomBytes(24).toString("hex");
    if (typeof global !== "undefined") global.__JT_BRIDGE_TOKEN = BRIDGE_TOKEN;
  }
  logger.log(`[bridge] auth source: ${source}`, "info");

  loadRingFromDisk();
  const finalPort = await findPort(port);
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    Promise.resolve(handleRequest(req, res, url)).catch((error) => {
      logger.log(`[bridge] lỗi: ${error.message}`, "warn");
      try { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); } catch { /* bỏ qua */ }
    });
  });

  await new Promise((resolve) => server.listen(finalPort, "127.0.0.1", resolve));
  logger.log(`Cầu nối panel (chat) đang chạy: 127.0.0.1:${finalPort}`, "info");
  return finalPort;
}

module.exports = { start, record, recordIncoming, getMessages, contentToText };
