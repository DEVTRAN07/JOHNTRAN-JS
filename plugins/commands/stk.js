// /stk — TẠO STICKER THẬT từ nội dung reply (ảnh/GIF/video/sticker) hoặc URL
const fs = require("fs");
const path = require("path");
const http = require("../../core/http");
const { runInWorker } = require("../../core/workerPool");
const { pickMediaUrl, cleanMediaUrl } = require("../../core/stickerCreate");
const { buildStickerUrl } = require("../../core/stickerFactory");
const { parseQuote } = require("../../core/mediaReply");
const { frameList } = require("../../core/stickerFrames");
const { mediaCache } = require("../../core/mediaCache");

const FRAMES = frameList();
const frameOptions = () => FRAMES.map(({ id, name }) => `${id}. ${name}`).join("\n");

module.exports.config = {
  name: "stk",
  aliases: ["sticker", "stkvd", "stkvideo"],
  version: "7.0.2",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Tạo sticker với nhiều mẫu khung",
  category: "Tiện ích",
  usage: "stk [số khung] (reply ảnh/gif/video/sticker) | stk [số khung] <link media>",
  cooldowns: 5,
  dependencies: {}
};

const GUIDE =
  "❌ Reply ảnh/GIF/video/sticker rồi gõ /stk [số khung]\n"
  + "hoặc: /stk [số khung] <link ảnh/GIF/video>\n"
  + "Danh sách khung:\n" + frameOptions();

const ZALO_HOST_RE = /(^|\.)(zdn\.vn|dlfl\.vn|zadn\.vn|zaloapp\.com|zalo\.me|zalo\.ai)$/i;

function parseFrameSelection(args) {
  const commandArgs = Array.isArray(args) ? [...args] : [];
  if (!/^\d+$/.test(String(commandArgs[0] ?? ""))) {
    return { frameId: 1, args: commandArgs };
  }

  const frameId = Number(commandArgs.shift());
  if (!FRAMES.some((frame) => frame.id === frameId)) {
    return { frameId, args: commandArgs, invalid: true };
  }
  return { frameId, args: commandArgs };
}

function isValidMediaUrl(url) {
  return /^https?:\/\/\S+$/i.test(String(url || ""));
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

  try {
    const selection = parseFrameSelection(args);
    if (selection.invalid) {
      return safeSend(
        api,
        { plain: true, msg: `❌ Số khung không hợp lệ. Chọn từ 1 đến ${FRAMES.length}:\n${frameOptions()}`, ttl: 60000 },
        threadId,
        type
      );
    }

    const urlArg = selection.args.find((a) => isValidMediaUrl(a));
    if (!urlArg && !data?.quote) {
      return safeSend(api, { plain: true, msg: GUIDE }, threadId, type);
    }

    const media = parseQuote(event);
    const url = urlArg ? cleanMediaUrl(urlArg) : cleanMediaUrl(pickMediaUrl(media));
    if (!url) {
      return safeSend(api, { plain: true, msg: "❌ Tin reply không có ảnh/video/GIF để tạo sticker.", ttl: 60000 }, threadId, type);
    }

    await safeSend(api, { msg: "⏳ Đang tạo sticker...", plain: true, ttl: 60000 }, threadId, type);

    const variant = (urlArg || (media && (media.video || media.webpUrl))) ? "std" : "ai";

    // Main thread tải media (host Zalo cần api.session qua api.fetchZaloMedia);
    // worker chỉ nhận file cục bộ và làm ffmpeg convert, không chạm API Zalo.
    let srcPath;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const fetcher = pickSourceFetcher(api, url) || ((u) => http.getBuffer(u, { timeout: 60000 }));
      const { buffer } = await fetcher(url);
      if (!buffer || buffer.length < 64) throw new Error("File tải về quá nhỏ hoặc rỗng");
      const srcExt = path.extname(url) || ".bin";
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
      stickerFile = await runInWorker("stickerWorker", {
        url: srcPath,
        frameId: selection.frameId,
        forceStatic: false,
        threadId,
        type,
        apiToken: global.config?.token
      }, { timeout: 300000 });
    } catch (error) {
      const detail = errDetail(error);
      console.error("[stk] worker failed:", detail || error);
      if (error?.stack) console.error(error.stack);
      try { fs.unlinkSync(srcPath); } catch { /* bỏ qua */ }
      const msg = error?.userMessage || ("❌ Tạo sticker thất bại: " + (detail || "lỗi không xác định"));
      try { fs.unlinkSync(srcPath); } catch { /* bỏ qua */ }
      return safeSend(api, { plain: true, msg, ttl: 60000 }, threadId, type);
    }

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

    const replyMsgId = event?.data?.quote?.msgId || null;
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
    const detail = errDetail(error);
    console.error("[stk] unexpected:", detail || error);
    if (error?.stack) console.error(error.stack);
    const stackHint = (error?.stack || "").split("\n").slice(0, 3).join(" | ").slice(0, 200);
    const hint = stackHint ? " (trace: " + stackHint + ")" : "";
    return safeSend(api, { plain: true, msg: "❌ Lệnh /stk gặp lỗi: " + (detail || "lỗi không xác định") + hint, ttl: 60000 }, threadId, type);
  }
};

module.exports.parseFrameSelection = parseFrameSelection;
