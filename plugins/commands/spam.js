// Spam tin nhắn + tag người dùng (admin bot).
// Nội dung lấy từ folder assets/spam/*.txt — MỖI FILE = MỘT NGÔN NGỮ.
// Dùng: /spam <@tag|uid> [vi|en|zh|ja|ko|th|mix...] [tin nhắn tự gõ]
//      [-t số lần] [-d giây] | /spam off | reload | list | lang
const fs = require("fs");
const path = require("path");

const SPAM_DIR = path.join(__dirname, "..", "..", "assets", "spam");
const DEFAULT_TIMES = 20;
const MAX_TIMES = 500;
const DEFAULT_DELAY_MS = 1500;
const { startSerialJob, stopSerialJob } = require("../../core/serialJob");

// ===== Nạp ngôn ngữ từ folder =====
let languages = {}; // { vi: [câu...], en: [...], mix: [...] }

function loadWords() {
  const loaded = {};
  try {
    if (fs.existsSync(SPAM_DIR)) {
      for (const file of fs.readdirSync(SPAM_DIR).filter((f) => f.endsWith(".txt"))) {
        const name = file.replace(/\.txt$/, "").toLowerCase();
        const content = fs.readFileSync(path.join(SPAM_DIR, file), "utf8");
        const lines = [];
        for (const line of content.split(/\r?\n/)) {
          const text = line.trim();
          if (!text || text.startsWith("#")) continue; // bỏ trống + chú thích
          lines.push(text);
        }
        if (lines.length) loaded[name] = lines;
      }
    }
  } catch (error) {
    console.error("Lỗi nạp ngôn từ spam:", error.message);
  }
  languages = loaded;
  return loaded;
}

loadWords(); // nạp sẵn khi khởi động

function langNames() {
  return Object.keys(languages);
}

function pickSentence(langs) {
  // Chọn 1 câu ngẫu nhiên trong (các) ngôn ngữ được chọn
  const chosen = langs.length ? langs.filter((l) => languages[l]) : langNames();
  if (!chosen.length) return null;
  // Chọn ngôn ngữ trước rồi chọn câu → đều nhau
  const pool = languages[chosen[Math.floor(Math.random() * chosen.length)]];
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports.config = {
  name: "spam",
  aliases: ["sp", "chui", "tag"],
  version: "4.0.0",
  role: 2,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Spam tin nhắn có tag người dùng, nhiều ngôn ngữ (admin bot)",
  category: "Hệ thống",
  usage: "spam <@tag|uid> [ngôn ngữ] [tin nhắn] [-t số lần] [-d giây] | spam off | reload | list | lang",
  cooldowns: 5,
  dependencies: {}
};

const running = new Map(); // threadId -> job

// ===== Tách tham số: @tag/uid | ngôn ngữ | nội dung | -t | -d =====
function parseArgs(args) {
  const result = { targets: [], langs: [], message: "", times: DEFAULT_TIMES, delay: DEFAULT_DELAY_MS };
  const rest = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const lower = arg.toLowerCase();

    if (lower === "-t" && args[i + 1] !== undefined) {
      // 0 = spam không giới hạn (dừng bằng /spam off)
      const t = parseInt(args[++i], 10);
      result.times = Number.isFinite(t) && t >= 0 ? Math.min(t, MAX_TIMES) : DEFAULT_TIMES;
      continue;
    }
    if (lower === "-d" && args[i + 1] !== undefined) {
      const d = parseFloat(args[++i]);
      result.delay = Math.min(Math.max(Number.isFinite(d) && d > 0 ? d : DEFAULT_DELAY_MS / 1000, 0.3), 30) * 1000;
      continue;
    }
    // UID (10-15 số) hoặc ngôn ngữ (tên file tồn tại)
    if (/^\d{10,}$/.test(arg)) {
      if (!result.targets.includes(arg)) result.targets.push(arg);
      continue;
    }
    if (langNames().includes(lower)) {
      if (!result.langs.includes(lower)) result.langs.push(lower);
      continue;
    }
    rest.push(arg);
  }

  result.message = rest.join(" ").trim();
  return result;
}

module.exports.run = async function ({ api, event, args }) {
  const { threadId, type, data } = event;
  const sub = (args[0] || "").toLowerCase();

  // ===== TẮT =====
  if (sub === "off" || sub === "stop") {
    const job = running.get(threadId);
    if (!job) return api.sendMessage({ msg: "❌ Không có spam nào đang chạy." }, threadId, type);
    stopSerialJob(threadId, running);
    return api.sendMessage({ msg: `✅ Đã dừng spam (đã gửi ${job.count}/${job.timesText}).` }, threadId, type);
  }

  // ===== NẠP LẠI NGÔN NGỮ =====
  if (sub === "reload" || sub === "load") {
    loadWords();
    const total = Object.values(languages).reduce((sum, list) => sum + list.length, 0);
    return api.sendMessage({
      msg: total
        ? `✅ Đã nạp ${total} câu / ${langNames().length} ngôn ngữ: ${langNames().map((l) => l.toUpperCase()).join(", ")}`
        : "❌ Không đọc được câu nào trong assets/spam/ — kiểm tra folder."
    }, threadId, type);
  }

  // ===== XEM NGÔN NGỮ =====
  if (sub === "list" || sub === "lang" || sub === "langs" || sub === "info") {
    const detail = langNames().map((l) => `• ${l.toUpperCase()}: ${languages[l].length} câu`).join("\n");
    const total = Object.values(languages).reduce((sum, list) => sum + list.length, 0);
    return api.sendMessage({
      msg: `📚 NGÔN NGỮ SPAM (${total} câu)\n${detail}\n\n` +
           `Cách dùng: ${global.config.prefix}spam @bạn en (chỉ tiếng Anh)\n` +
           `Hoặc: ${global.config.prefix}spam @bạn vi en zh (nhiều ngôn ngữ)\n` +
           `Không gõ ngôn ngữ = lấy ngẫu nhiên tất cả.`
    }, threadId, type);
  }

  // ===== Thu thập mục tiêu: tag trước, sau đó args =====
  const targets = [];
  if (data?.mentions && Object.keys(data.mentions).length > 0) {
    for (const uid of Object.keys(data.mentions)) targets.push(uid);
  }
  // Keep the first argument: it may itself be the target UID.
  const opts = parseArgs(args);
  for (const t of opts.targets) if (!targets.includes(t)) targets.push(t);

  if (targets.length === 0) {
    const langList = langNames().join(" | ");
    return api.sendMessage({
      msg: `⚠️ Cách dùng:\n` +
           `${global.config.prefix}spam <@tag|uid> [ngôn ngữ] [tin nhắn] [-t n] [-d s]\n` +
           `${global.config.prefix}spam off — dừng\n` +
           `${global.config.prefix}spam reload — nạp lại ngôn ngữ\n` +
           `${global.config.prefix}spam list — xem ngôn ngữ\n\n` +
           `🌐 Ngôn ngữ: ${langList} (bỏ trống = tất cả)\n` +
           `📌 Ví dụ:\n` +
           `• /spam @bạn → 20 lần, câu ngẫu nhiên mọi ngôn ngữ\n` +
           `• /spam @bạn en → chỉ tiếng Anh\n` +
           `• /spam @bạn vi en → pha tiếng Việt + Anh\n` +
           `• /spam @bạn Xin chào -t 5 -d 1 → nội dung tự gõ\n` +
           `• /spam @bạn -t 0 → không giới hạn (dừng bằng /spam off)`
    }, threadId, type);
  }

  if (running.has(threadId)) {
    return api.sendMessage({ msg: "⚠️ Spam đang chạy. Gõ /spam off để dừng." }, threadId, type);
  }

  const usingFolder = !opts.message;
  if (usingFolder && !langNames().length) {
    return api.sendMessage({ msg: "❌ Không có câu spam nào trong assets/spam/." }, threadId, type);
  }

  const timesText = opts.times === 0 ? "∞" : String(opts.times);
  const job = { count: 0, times: opts.times, timesText, timer: null };

  // Tin nhắn có mention (Zalo yêu cầu pos/uid/len)
  const buildText = (message) => {
    let text = "";
    const mentions = [];
    for (const uid of targets) {
      const pos = text.length;
      const name = "@.";
      text += name;
      mentions.push({ pos, uid, len: name.length });
    }
    text += ` ${message}`;
    return { text, mentions };
  };

  const langText = opts.langs.length
    ? `ngôn ngữ: ${opts.langs.join(", ").toUpperCase()} (${opts.langs.reduce((s, l) => s + (languages[l]?.length || 0), 0)} câu)`
    : `câu ngẫu nhiên tất cả ${langNames().length} ngôn ngữ (${Object.values(languages).reduce((s, l) => s + l.length, 0)} câu)`;

  await api.sendMessage({
    msg: `▶️ Bắt đầu spam ${timesText} lần • mỗi ${opts.delay / 1000}s\n` +
         `👥 ${targets.length} người • ${usingFolder ? langText : `nội dung: ${opts.message}`}\n` +
         `Dừng: ${global.config.prefix}spam off`
  }, threadId, type);

  startSerialJob({
    threadId,
    running,
    job,
    delayMs: opts.delay,
    async run() {
      const message = opts.message || pickSentence(opts.langs) || "Hello";
      const payload = buildText(message);
      await api.sendMessage({ msg: payload.text, mentions: payload.mentions }, threadId, type);
    },
    onComplete() {
      return api.sendMessage({ msg: `✅ Đã spam xong ${job.count} lần.` }, threadId, type);
    },
    onError(error) {
      console.error("Lỗi gửi spam:", error?.message || error);
      return api.sendMessage({ msg: "❌ Lỗi khi gửi tin nhắn." }, threadId, type);
    }
  });
  return;
};


module.exports._test = { parseArgs, running, loadWords, pickSentence };
