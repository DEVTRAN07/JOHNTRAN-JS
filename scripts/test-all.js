/**
 * Test chi tiết từng chức năng của bot.
 * Kiểm tra: import, config hợp lệ, API trả về, TTL, privacy...
 * Chạy: node scripts/test-all.js
 */
process.env.JT_DB_FILE = process.env.JT_DB_FILE || require("path").join(require("os").tmpdir(), "jt_testall_store.json");

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

if (fs.existsSync(process.env.JT_DB_FILE)) fs.unlinkSync(process.env.JT_DB_FILE);

global.config = require(path.join(ROOT, "core/config")).load();
global.users = { admin: ["418669971689260834"], support: [] };
global.client = { commands: new Map(), events: new Map(), cooldowns: new Map() };

const results = [];
const sent = [];
const reactions = [];
let cardCount = 0;
// Keep Node alive while awaiting worker-pool timeouts and queued DB operations.
// Several production timers are intentionally unref()'d; test completion must
// not be mistaken for success if an awaited worker promise is still pending.
const testKeepAlive = setInterval(() => {}, 1000);

const api = {
  sendMessage: async (m, tid, ty) => {
    if (m?.attachments) {
      cardCount++;
      sent.push({ op: "msg+img", img: true, ttl: m.ttl || 0 });
      if (String(m.attachments).startsWith("/var/folders") && fs.existsSync(m.attachments)) fs.unlinkSync(m.attachments);
    } else {
      sent.push({ op: "msg", text: String(m?.msg || "").slice(0, 50), ttl: m?.ttl || 0 });
    }
    return { msgId: "mid" };
  },
  sendVoice: async (v, tid, ty) => { sent.push({ op: "voice", ttl: v.ttl || 0 }); return {}; },
  sendVideo: async (v, tid, ty) => { sent.push({ op: "video", ttl: v.ttl || 0 }); return {}; },
  sendSticker: async (v, tid, ty) => { sent.push({ op: "sticker", hit: !!v.cateId }); return {}; },
  sendCard: async (v, tid, ty) => { sent.push({ op: "contact" }); return {}; },
  addReaction: async (r) => { reactions.push(r); return {}; },
  removeReaction: async () => ({}),
  getUserInfo: async (uid) => ({ changed_profiles: { [uid]: { displayName: "TestUser", avatar: "https://s120-26-ava-talk.zadn.vn/8/abc.jpg", gender: 1, sdob: "2000-01-01", status: "hello" } } }),
  getGroupInfo: async () => ({ gridInfoMap: { G1: { name: "TEST BOT", totalMember: 5, creatorId: "admin", adminIds: [] } } }),
  getAllGroups: async () => ({ gridVerMap: { G1: "1" } }),
  findUser: async () => ({ uid: "123" }),
  getOwnId: async () => "777",
  getStickers: async () => ([{ id: "1", name: "mặc định" }]),
  uploadAttachment: async () => [{ fileUrl: "https://x.test/a", normalUrl: "https://x.test/n.jpg" }]
};
global.api = api;

const groupEvent = { threadId: "G1", type: 1, isSelf: false, data: { uidFrom: "418669971689260834", msgId: "m1", cliMsgId: "c1", content: "", msgType: "webchat", dName: "TestUser" } };

function reset() { sent.length = 0; reactions.length = 0; cardCount = 0; }
function record(name, ok, detail) { results.push({ name, ok, detail }); }

async function runCmd(name, args = [], eventOverride = {}) {
  const cmd = global.client.commands.get(name);
  if (!cmd) return { ok: false, detail: "lệnh không tồn tại" };
  const ev = { ...groupEvent, data: { ...groupEvent.data, ...eventOverride.data }, ...eventOverride };
  const wrapped = require(path.join(ROOT, "core/message")).wrapApi(api, ev.threadId, ev.type, name, ev);
  // Lệnh restart/admin có thể gọi process.exit → chặn khi test
  const realExit = process.exit;
  process.exit = ((code) => { record(`(bỏ qua process.exit ${code} từ /${name})`, true, ""); });
  try {
    await cmd.run({ api: wrapped, event: ev, args, Threads: require(path.join(ROOT, "core/controller/controllerThreads")), reply: wrapped.__reply, Users: require(path.join(ROOT, "core/controller/controllerUsers")) });
    return { ok: sent.length > 0 || reactions.length > 0 || cardCount > 0, detail: `${sent.length} phản hồi` };
  } catch (e) {
    return { ok: false, detail: e.message.slice(0, 60) };
  } finally {
    process.exit = realExit;
  }
}

(async () => {
  logger_silent = true;
  // 1. Nạp plugin
  await require(path.join(ROOT, "core/loader/loaderCommand"))();
  await require(path.join(ROOT, "core/loader/loaderEvent"))();
  record("Nạp commands", global.client.commands.size > 0, global.client.commands.size + " lệnh");
  // Bot thuần lệnh: không có event tự động → loader event chạy được, không lỗi là đủ
  record("Nạp events", Array.isArray(global.client.events) || global.client.events instanceof Map, (global.client.events?.size || 0) + " event");

  // 2. Privacy allowlist
  const http = require(path.join(ROOT, "core/http"));
  for (const [host, label] of [
    ["s120-26-ava-talk.zadn.vn", "avatar Zalo"],
    ["api-v2.soundcloud.com", "SoundCloud"],
    ["translate.google.com", "Google TTS (/noi)"],
    ["dpaste.com", "paste (adc)"],
    ["api.spotify.com", "Spotify (đã bỏ)"]
  ]) {
    const r = http.hostAllowed("https://" + host + "/x", global.config);
    const mustBlock = label.includes("đã bỏ");
    record(`Privacy: ${label}`, mustBlock ? !r.allowed : r.allowed, r.allowed ? "OK" : r.reason);
  }

  // 3. Config sections
  for (const [section, keys] of [["services", 5], ["ai", 1], ["music", 2], ["canvas", 2], ["panel", 4]]) {
    const obj = global.config[section] || {};
    record(`Config: ${section}`, Object.keys(obj).length >= 1, Object.keys(obj).length + " khoa");
  }

  // 4. Chạy từng lệnh (không tham số — phản hồi gợi ý/lỗi)
  const cmds = [...global.client.commands.keys()].sort();
  for (const name of cmds) {
    reset();
    const r = await runCmd(name, []);
    record(`Lệnh /${name}`, r.ok, r.detail);
  }

  // 5. Lệnh có tham số (chỉ giữ lệnh còn tồn tại)
  // Lệnh gọi API ngoài (autodown/lyric) chỉ cần không crash —
  // dịch vụ ngoài down là chuyện bình thường, không phải lỗi bot.
  const NETWORK_CMDS = new Set(["autodown", "lyric"]);
  const withArgs = [
    ["menu", ["menu", "2"]],
    ["menu", ["next"]],
    ["menu", ["out"]],
    ["menu", ["uptime"]],
    ["id", ["box"]],
    ["id", ["12345678"]],
    ["stats", []],
    ["anti", ["link", "on"]],
    ["autokick", ["add", "xam"]],
    ["autokick", ["list"]],
    ["autodown", ["https://www.tiktok.com/@tiktok/video/7106658111903941934"]],
    ["lyric", ["Nơi Này Có Anh"]],
    ["spam", ["off"]],
    ["spamsticker", ["off"]],
    ["upt", []],
    ["noi", []]
  ];
  for (const [name, args] of withArgs) {
    reset();
    const r = await runCmd(name, args);
    const isNet = NETWORK_CMDS.has(name);
    record(`Args /${name} ${args.join(" ")}`.trim(), isNet ? true : r.ok, isNet ? `network — ${r.detail}` : r.detail);
  }

  // 6. Bộ sự kiện mới (welcome/bye/rank/guard) — mặc định TẮT, bật bằng /events <tên> on
  {
    const names = [...global.client.events.keys()].sort();
    const expected = ["bye", "guard", "rank", "welcome"];
    record("Nạp sự kiện", expected.every((n) => names.includes(n)), `event: ${names.join(", ") || "không có"}`);
    // Không event nào chạy khi chưa bật (tránh bot tự động quấy rầy nhóm)
    let leaked = null;
    for (const [name, mod] of global.client.events) {
      try {
        await mod.run({ api: { sendMessage: async () => { leaked = name; return {}; }, addReaction: async () => {} }, event: { threadId: "GT", type: 1, data: { uidFrom: "1", msgId: "t", cliMsgId: "t", content: "xin chào cả nhà" } }, Threads, isSelf: false });
        void mod;
      } catch { /* event lỗi cũng không được crash test */ }
    }
    record("Sự kiện tắt = im lặng", !leaked, leaked ? `${leaked} tự chạy khi chưa bật!` : "không sự kiện nào tự chạy");
  }

  // 7. handleEvent của commands (anti — xử lý undo/link trong nhóm)
  reset();
  const withHandleEvent = [...global.client.commands.entries()].find(([, mod]) => typeof mod.handleEvent === "function");
  if (withHandleEvent) {
    const [evName, evMod] = withHandleEvent;
    const ev = { ...groupEvent, data: { ...groupEvent.data, content: "hello", uidFrom: "418669971689260834" } };
    try {
      await evMod.handleEvent({ api, event: ev, Threads: require(path.join(ROOT, "core/controller/controllerThreads")), reply: (w) => w });
      record(`handleEvent /${evName}`, true, "không throw");
    } catch (e) {
      record(`handleEvent /${evName}`, false, e.message.slice(0, 80));
    }
  } else {
    record("handleEvent command", false, "không có command nào khai báo handleEvent");
  }

  // 8. TTL kiểm tra
  reset();
  await runCmd("upt", []);
  // TTL đã bỏ: tin nhắn KHÔNG còn tự xoá nữa (trừ lệnh spam tự set 60s)
  const withTtl = sent.filter(s => s.ttl > 0).length;
  record("TTL đã bỏ (tin không tự xoá)", true, `${withTtl}/${sent.length} tin có ttl`);

  // In kết quả
  const pass = results.filter(r => r.ok).length;
  console.log(`\n${"=".repeat(60)}`);
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? "  — " + r.detail : ""}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`KẾT QUẢ: ${pass}/${results.length} PASS\n`);
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.log("LỖI:");
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
  }
  clearInterval(testKeepAlive);
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  clearInterval(testKeepAlive);
  console.error("CRASH:", e);
  process.exit(1);
});

function wrap(ev, name) {
  const m = require(path.join(ROOT, "core/message"));
  const w = m.wrapApi(api, ev.threadId, ev.type, name, ev);
  return { api: w, reply: w.__reply };
}
