// /stk — TẠO STICKER THẬT từ nội dung reply (ảnh/GIF/video/sticker) hoặc URL
const fs = require("fs");
const path = require("path");
const http = require("../../core/http");
const { runInWorker } = require("../../core/workerPool");
const { pickMediaUrl, cleanMediaUrl } = require("../../core/stickerCreate");
const { buildStickerUrl } = require("../../core/stickerFactory");
const { parseQuote } = require("../../core/mediaReply");
const { enqueue } = require("../../core/jobQueue");

module.exports.config = {
  name: "stk",
  version: "7.0.2",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Tạo sticker ảnh/GIF/video phong cách tối giản, không khung",
  category: "Tiện ích",
  usage: "stk (reply ảnh/gif/video/sticker) | stk <link media>",
  cooldowns: 5,
  dependencies: {}
};

module.exports._test = { isValidMediaUrl, sourceExtension, pickSourceFetcher, uploadStickerToZalo };

const GUIDE =
  "CÁCH DÙNG STK\n"
  + "• Reply ảnh, GIF hoặc video rồi gõ /stk\n"
  + "• Hoặc gửi /stk kèm link ảnh/GIF/video\n"
  + "Sticker mới: ảnh tràn khung, không viền trang trí.";

const ZALO_HOST_RE = /(^|\.)(zdn\.vn|dlfl\.vn|zadn\.vn|zaloapp\.com|zalo\.me|zalo\.ai)$/i;


function isValidMediaUrl(url) {
  return /^https?:\/\/\S+$/i.test(String(url || ""));
}

function sourceExtension(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return /^\.(png|jpe?g|gif|webp|mp4|webm|mov|m4v)$/.test(ext) ? ext : ".bin";
  } catch {
    return ".bin";
  }
}

function errDetail(error) {
  return [error?.code != null ? "code=" + error.code : "", error?.message || String(error)]
    .filter(Boolean).join(" ");
}

function pickSourceFetcher(api, url) {
  let host = "";
  try { host = new URL(url).hostname; } catch { return null; }
  if (ZALO_HOST_RE.test(host) && typeof api?.fetchZaloMedia === "function") {
    return (u) => api.fetchZaloMedia({ url: u });
  }
  return null;
}

const CACHE_DIR = path.join(__dirname, "..", "..", "assets", "cache", "sticker");

async function safeSend(api, payload, threadId, type) {
  try {
    return await api.sendMessage(payload, threadId, type);
  } catch (e) {
    console.error("[stk] sendMessage failed:", e?.message || e);
    return null;
  }
}

async function uploadStickerToZalo(api, stickerFile, threadId, type) {
  if (!Buffer.isBuffer(stickerFile?.buffer) || stickerFile.buffer.length < 64) {
    throw new Error("Worker không trả về dữ liệu sticker hợp lệ");
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const ext = stickerFile.format === "gif" ? "gif" : "webp";
  const filePath = path.join(CACHE_DIR, `stk_send_${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, stickerFile.buffer);
  try {
    const uploaded = await api.uploadStickerImage({ filePath, threadId, threadType: type });
    const u = (uploaded && typeof uploaded === "object") ? uploaded : {};
    const d = (u.data && typeof u.data === "object" && !Array.isArray(u.data)) ? u.data : u;
    const cdnUrl = d.normalUrl || d.hdUrl || d.thumbUrl || d.url || d.oriUrl ||
      u.normalUrl || u.hdUrl || u.thumbUrl || u.url;
    if (!cdnUrl) {
      throw new Error("Zalo không trả về URL CDN sau khi upload");
    }
    return buildStickerUrl(String(cdnUrl), stickerFile.format === "webp");
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* bỏ qua */ }
  }
}

module.exports.run = async function ({ api, event, args }) {
  const threadId = event?.threadId;
  const type = event?.type;
  const data = event?.data || {};
  let srcPath = null;

  try {
    const commandArgs = Array.isArray(args) ? args : [];
    const urlArg = commandArgs.find((arg) => isValidMediaUrl(arg));
    const media = parseQuote(event);
    if (!urlArg && !media) {
      return safeSend(api, { plain: true, msg: GUIDE }, threadId, type);
    }
    const url = urlArg ? cleanMediaUrl(urlArg) : cleanMediaUrl(pickMediaUrl(media));
    if (!url) {
      return safeSend(api, { plain: true, msg: "❌ Tin reply không có ảnh/video/GIF để tạo sticker.", ttl: 60000 }, threadId, type);
    }

    await safeSend(api, { msg: "⏳ Đang tạo sticker...", plain: true, ttl: 60000 }, threadId, type);

    const variant = (urlArg || (media && (media.video || media.webpUrl))) ? "std" : "ai";

    // Main thread tải media (host Zalo cần api.session qua api.fetchZaloMedia);
    // worker chỉ nhận file cục bộ và làm ffmpeg convert, không chạm API Zalo.
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const fetcher = pickSourceFetcher(api, url) || ((u) => http.getBuffer(u, { timeout: 60000 }));
      const { buffer } = await fetcher(url);
      if (!buffer || buffer.length < 64) throw new Error("File tải về quá nhỏ hoặc rỗng");
      const srcExt = sourceExtension(url);
      srcPath = path.join(CACHE_DIR, `stk_src_${Date.now()}${srcExt}`);
      fs.writeFileSync(srcPath, buffer);
    } catch (error) {
      const detail = errDetail(error);
      console.error("[stk] download failed:", detail || error);
      if (error?.stack) console.error(error.stack);
      const msg = "❌ Tải media thất bại: " + (detail || "lỗi không xác định");
      return safeSend(api, { plain: true, msg, ttl: 60000 }, threadId, type);
    }

    // Chuyển đổi ffmpeg chạy ở worker pool để không chặn main thread.
    let stickerFile;
    try {
      stickerFile = await enqueue("sticker", () => runInWorker("stickerWorker", {
        url: srcPath,
        forceStatic: false,
        threadId,
        type,
        apiToken: global.config?.token
      }, { timeout: 300000 }), {
        key: url,
        label: "Tạo sticker không khung",
        retries: 1,
        retryDelayMs: 500,
        retryOn: error => /workerPool: timeout|worker .* exited|worker .* stopped/i.test(String(error?.message || error))
      });
    } catch (error) {
      const detail = errDetail(error);
      console.error("[stk] worker failed:", detail || error);
      if (error?.stack) console.error(error.stack);
      try { fs.unlinkSync(srcPath); } catch { /* bỏ qua */ }
      srcPath = null;
      const msg = error?.userMessage || ("❌ Tạo sticker thất bại: " + (detail || "lỗi không xác định"));
      return safeSend(api, { plain: true, msg, ttl: 60000 }, threadId, type);
    }

    // Worker đã đọc xong nguồn; giải phóng file ngay trước bước upload.
    try { fs.unlinkSync(srcPath); } catch { /* already removed */ }
    srcPath = null;
    let stickerUrl;
    try {
      stickerUrl = await uploadStickerToZalo(api, stickerFile, threadId, type);
    } catch (error) {
      const detail = errDetail(error);
      console.error("[stk] Zalo upload failed:", detail, error?.stack ? "\n" + error.stack : "");
      const msg = "❌ Upload sticker lên Zalo CDN thất bại" +
        (detail ? ` (${detail})` : "") +
        ". Vui lòng thử lại sau hoặc kiểm tra phiên đăng nhập Zalo.";
      return safeSend(api, { plain: true, msg, ttl: 60000 }, threadId, type);
    }

    const quote = data.quote || data.dQuote || event?.quote;
    const replyMsgId = quote?.msgId || null;
    try {
      await api.sendCustomStickerUrl({
        staticImgUrl: stickerUrl,
        animationImgUrl: stickerUrl,
        threadId,
        threadType: type,
        reply: replyMsgId,
        width: stickerFile.width,
        height: stickerFile.height,
        variant
      });
    } catch (error) {
      const detail = errDetail(error);
      console.error("[stk] sendCustomStickerUrl failed:", detail || error);
      if (error?.stack) console.error(error.stack);
      return safeSend(api, { plain: true, msg: "❌ Gửi sticker thất bại: " + (detail || "lỗi không xác định"), ttl: 60000 }, threadId, type);
    }
  } catch (error) {
    if (srcPath) {
      try { fs.unlinkSync(srcPath); } catch { /* best effort cleanup */ }
    }
    const detail = errDetail(error);
    console.error("[stk] unexpected:", detail || error);
    if (error?.stack) console.error(error.stack);
    const stackHint = (error?.stack || "").split("\n").slice(0, 3).join(" | ").slice(0, 200);
    const hint = stackHint ? " (trace: " + stackHint + ")" : "";
    return safeSend(api, { plain: true, msg: "❌ Lệnh /stk gặp lỗi: " + (detail || "lỗi không xác định") + hint, ttl: 60000 }, threadId, type);
  }
};

