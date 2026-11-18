// /getvd — Reply video → download → upload asyncfile (original) → gửi video GỐC
//   Không nén/không xử lý lại — gửi đúng file video người ta gửi.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { parseQuote, hint } = require("../../core/mediaReply");
const { getBuffer: queuedGetBuffer, getJson: queuedGetJson } = require("../../core/runtime/queuedHttp");
const { ThreadType } = require("zalo-client");

const ADULT_VIDEO_API = "https://adultembed.com/api/v1/";
const ADULT_PLAYER_BASE = "https://adultembed.com/player/embed/";

function isAdultVideoRequest(args) {
  return Array.isArray(args) && String(args[0] || "").trim().toLowerCase() === "18+";
}

function cleanDisplayText(value, maxLength = 180) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildAdultVideoApiUrl(args = []) {
  const query = args.slice(1).join(" ").trim().slice(0, 120);
  const endpoint = new URL(query ? "search" : "videos/random", ADULT_VIDEO_API);
  if (query) {
    endpoint.searchParams.set("query", query);
    endpoint.searchParams.set("per_page", "5");
    endpoint.searchParams.set("sort", "popular");
    endpoint.searchParams.set("quality", "complete");
  } else {
    endpoint.searchParams.set("count", "1");
  }
  return endpoint.toString();
}

function normalizeAdultVideoResults(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results
    : Array.isArray(payload?.data?.results) ? payload.data.results
    : Array.isArray(payload?.data) ? payload.data
    : [];
  return rows.filter(item => Number.isSafeInteger(Number(item?.id)) && Number(item.id) > 0);
}

function formatAdultVideoResults(items, query = "") {
  const rows = (Array.isArray(items) ? items : []).slice(0, 5).map((item, index) => {
    const id = Number(item.id);
    const title = cleanDisplayText(item.title || item.name || ("Video " + id), 150);
    const duration = cleanDisplayText(item.duration || "", 30);
    const studio = cleanDisplayText(item.studio?.name || "", 80);
    return [
      (index + 1) + ". " + title,
      duration ? "   ⏱ " + duration : "",
      studio ? "   🏷 " + studio : "",
      "   ▶ Xem: " + ADULT_PLAYER_BASE + id + "/"
    ].filter(Boolean).join("\n");
  });
  const heading = query ? "🔎 TÌM VIDEO 18+ · " + cleanDisplayText(query, 80) : "🎲 VIDEO 18+ NGẪU NHIÊN";
  return [
    "🔞 " + heading,
    "Chỉ dành cho người từ đủ 18 tuổi và nơi việc truy cập nội dung này là hợp pháp.",
    "Không chia sẻ nội dung này cho người chưa thành niên.",
    "━━━━━━━━━━━━━━━━━━",
    ...(rows.length ? rows : ["Không tìm thấy video phù hợp. Thử từ khóa khác."]),
    "━━━━━━━━━━━━━━━━━━",
    "Nguồn dữ liệu/player: AdultEmbed · https://adultembed.com/"
  ].join("\n");
}

async function runAdultVideo({ api, event, args }) {
  const { threadId, type } = event || {};
  if (type !== ThreadType.User) {
    return api.sendMessage({
      plain: true,
      msg: "🔒 Lệnh /vd 18+ chỉ hoạt động trong tin nhắn riêng, không gửi nội dung người lớn vào nhóm."
    }, threadId, type);
  }

  const query = args.slice(1).join(" ").trim().slice(0, 120);
  await api.sendMessage({
    plain: true,
    msg: "🔞 Bạn đang yêu cầu nội dung 18+. Chỉ tiếp tục khi bạn đã đủ 18 tuổi và việc truy cập hợp pháp tại nơi bạn ở. Đang tìm video..."
  }, threadId, type);

  const response = await queuedGetJson(buildAdultVideoApiUrl(args), {
    timeout: 12000,
    retries: 1,
    headers: { Accept: "application/json" }
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error("API video 18+ trả HTTP " + response.status);
  }
  return api.sendMessage({
    plain: true,
    msg: formatAdultVideoResults(normalizeAdultVideoResults(response.data), query)
  }, threadId, type);
}

module.exports.config = {
  name: "getvd",
  aliases: ["vd", "getvideo"],
  version: "4.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Reply video rồi gửi lại video gốc (không nén)",
  category: "Tiện ích",
  usage: "getvd (reply video) | vd 18+ [từ khóa]",
  cooldowns: 10,
  dependencies: {}
};

// Đoán đuôi file từ URL để Zalo nhận diện đúng loại media
function extFromUrl(url, fallback = "mp4") {
  const m = String(url).split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : fallback;
}

module.exports.run = async function ({ api, event, args = [] }) {
  if (isAdultVideoRequest(args)) {
    try {
      return await runAdultVideo({ api, event, args });
    } catch (error) {
      console.error("[vd 18+]:", error?.message || error);
      return api.sendMessage({
        plain: true,
        msg: "❌ Không lấy được video 18+ lúc này: " + cleanDisplayText(error?.message || error, 160)
      }, event.threadId, event.type);
    }
  }

  const { threadId, type } = event;

  const media = parseQuote(event);
  if (!media) return api.sendMessage({ plain: true, msg: "❌ Hãy reply tin video cần gửi lại." }, threadId, type);

  const videoUrl = media.video || media.file;
  if (!videoUrl) return api.sendMessage({ plain: true, msg: hint("video") }, threadId, type);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_gvd_"));
  const ext = extFromUrl(videoUrl);
  const filePath = path.join(tmpDir, `video_${Date.now()}.${ext}`);

  try {
    await api.sendMessage({ msg: "⏳ Đang tải video gốc...", plain: true }, threadId, type);

    const http = require("../../core/http");
    const { buffer } = await queuedGetBuffer(videoUrl, { timeout: 180000, retries: 1 });
    fs.writeFileSync(filePath, buffer);

    const sizeMb = fs.statSync(filePath).size / 1048576;
    if (sizeMb > 100) {
      return api.sendMessage({ plain: true, msg: `❌ Video quá lớn (${sizeMb.toFixed(1)}MB > 100MB) nên Zalo không nhận.` }, threadId, type);
    }

    // Gửi file GỐC qua attachment (Zalo tự upload asyncfile)
    await api.sendMessage({
      msg: `🎬 GETVD — ${sizeMb.toFixed(1)}MB • ${ext.toUpperCase()}`,
      attachments: [filePath]
    }, threadId, type);
  } catch (error) {
    console.error("getvd:", error.message);
    return api.sendMessage({ plain: true, msg: `❌ Tải video thất bại: ${error.message}` }, threadId, type);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  }
};

module.exports._test = {
  isAdultVideoRequest,
  buildAdultVideoApiUrl,
  normalizeAdultVideoResults,
  formatAdultVideoResults
};
