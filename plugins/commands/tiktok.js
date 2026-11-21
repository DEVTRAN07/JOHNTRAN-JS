// /tiktok — Tải video/nhạc TikTok (hỗ trợ cả Douyin)
//   /tiktok <link> → tải video + music, gửi lên Zalo
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { getBuffer: queuedGetBuffer } = require("../../core/runtime/queuedHttp");
const { enqueue } = require("../../core/jobQueue");
const { mediaCache } = require("../../core/mediaCache");
const { getVideoInfo } = require("../../core/tiktok");

module.exports.config = {
  name: "tiktok",
  aliases: ["tt", "tik"],
  version: "2.0.0",
  role: 0,
  author: "J^H^N T^R^A^N",
  description: "Tải video/nhạc TikTok theo link",
  category: "Tiện ích",
  usage: "tiktok <link TikTok/Douyin>",
  cooldowns: 10,
  dependencies: {}
};

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function urlCacheKey(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex");
}

const SOURCE_INDEX_MAX = 256;
// MediaCache keys are content hashes, not URL hashes. Keep a bounded URL →
// content-key index so repeated TikTok links can actually reuse cached bytes.
const sourceIndex = new Map();

function rememberSource(url, type, cacheKey) {
  const sourceKey = urlCacheKey(url);
  sourceIndex.delete(sourceKey);
  sourceIndex.set(sourceKey, { type, cacheKey, savedAt: Date.now() });
  while (sourceIndex.size > SOURCE_INDEX_MAX) {
    sourceIndex.delete(sourceIndex.keys().next().value);
  }
}

async function cachedMedia(url, type) {
  const sourceKey = urlCacheKey(url);
  const indexed = sourceIndex.get(sourceKey);
  if (!indexed || indexed.type !== type) return { key: sourceKey, cached: false };

  const cached = await enqueue("media", () => mediaCache.get(indexed.cacheKey), {
    key: `media-cache-read|${indexed.cacheKey}`,
    label: "Đọc cache media TikTok"
  });
  if (cached?.buffer?.length) {
    // Refresh LRU order only after the cache entry has passed integrity/TTL checks.
    sourceIndex.delete(sourceKey);
    sourceIndex.set(sourceKey, indexed);
    return { buffer: cached.buffer, cached: true, key: indexed.cacheKey };
  }

  sourceIndex.delete(sourceKey);
  return { key: sourceKey, cached: false };
}

async function storeMedia(url, buffer, type, metadata) {
  const result = await enqueue("media", () => mediaCache.upload(buffer, type, Object.assign({ sourceUrl: url }, metadata || {})), {
    key: `media-cache-write|${urlCacheKey(url)}`,
    label: "Lưu cache media TikTok"
  });
  rememberSource(url, type, result.key);
  return { buffer, cached: result.cached, key: result.key };
}

function audioExtensionFromUrl(rawUrl) {
  try {
    const extension = path.extname(new URL(rawUrl).pathname).slice(1).toLowerCase();
    if (["mp3", "m4a", "aac", "wav", "ogg", "opus"].includes(extension)) return extension;
  } catch { /* use a safe default below */ }
  return "mp3";
}

function writeMediaAttachment(tempDir, name, media, extension) {
  if (!media?.buffer || !Buffer.isBuffer(media.buffer) || media.buffer.length === 0) {
    throw new Error("Dữ liệu media rỗng hoặc không hợp lệ: " + name);
  }
  const safeExtension = String(extension || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!safeExtension) throw new Error("Thiếu phần mở rộng file media: " + name);
  const filePath = path.join(tempDir, name + "." + safeExtension);
  fs.writeFileSync(filePath, media.buffer);
  return filePath;
}

function buildSendableAttachments(tempDir, videoResult, musicResult, musicUrl = "") {
  const attachments = [];
  if (videoResult) attachments.push(writeMediaAttachment(tempDir, "video", videoResult, "mp4"));
  if (musicResult) attachments.push(writeMediaAttachment(
    tempDir,
    "audio",
    musicResult,
    audioExtensionFromUrl(musicUrl)
  ));
  return attachments;
}

module.exports._test = {
  urlCacheKey,
  sourceIndex,
  rememberSource,
  cachedMedia,
  storeMedia,
  audioExtensionFromUrl,
  writeMediaAttachment,
  buildSendableAttachments,
  SOURCE_INDEX_MAX
};

module.exports.run = async function ({ api, event, args }) {
  const { threadId, type } = event;
  const url = (args[0] || "").trim();

  if (!url) {
    return api.sendMessage({
      plain: true,
      msg: "⚠️ Vui lòng nhập link TikTok/Douyin.\nVD: /tiktok https://www.tiktok.com/@user/video/123"
    }, threadId, type);
  }

  if (!isHttpUrl(url)) {
    return api.sendMessage({
      plain: true,
      msg: "❌ Link không hợp lệ. Vui lòng nhập link bắt đầu bằng http(s)://"
    }, threadId, type);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_tk_"));
  try {
    const info = await enqueue("download", () => getVideoInfo(url), {
      key: `tiktok-info|${urlCacheKey(url)}`,
      label: "Lấy metadata TikTok"
    });
    const videoUrl = info.videoUrl || "";
    const musicUrl = info.musicUrl || "";

    // ---- VIDEO ----
    let videoResult = null;
    if (videoUrl) {
      const videoCached = await cachedMedia(videoUrl, "video");
      if (videoCached.cached) {
        videoResult = { buffer: videoCached.buffer, cached: true, key: videoCached.key };
      } else {
        const { buffer } = await queuedGetBuffer(videoUrl, { timeout: 180000, retries: 1 });
        if (!buffer || !buffer.length) throw new Error("Video tải về rỗng");
        videoResult = await storeMedia(videoUrl, buffer, "video", {
          title: info.title,
          author: info.author,
          duration: info.duration,
        });
      }
    }

    // ---- MUSIC ----
    let musicResult = null;
    if (musicUrl) {
      const musicCached = await cachedMedia(musicUrl, "audio");
      if (musicCached.cached) {
        musicResult = { buffer: musicCached.buffer, cached: true, key: musicCached.key };
      } else {
        const { buffer } = await queuedGetBuffer(musicUrl, { timeout: 120000, retries: 1 });
        if (buffer && buffer.length) {
          musicResult = await storeMedia(musicUrl, buffer, "audio", {
            title: info.title,
            author: info.author,
          });
        }
      }
    }

    // The Zalo message SDK accepts local paths or Buffer sources for attachments.
    // A thumbnail URL is not part of sendMessage's supported attachment contract,
    // so avoid downloading it as an unused third network request.

    if (!videoResult && !musicResult) {
      return api.sendMessage({
        plain: true,
        msg: "❌ Không tìm thấy video hoặc nhạc trong link này."
      }, threadId, type);
    }

    // ---- GỬI KẾT QUẢ ----
    const lines = ["🎬 " + String(info.title || "TikTok video").slice(0, 60)];
    lines.push("👤 " + String(info.author || "Không rõ"));
    if (videoResult) lines.push("🎥 Video " + (videoResult.cached ? "(cache)" : "(mới)"));
    if (musicResult) lines.push("🎵 Nhạc gốc " + (musicResult.cached ? "(cache, đính kèm)" : "(đính kèm)"));

    const attachments = buildSendableAttachments(tmpDir, videoResult, musicResult, musicUrl);
    if (!attachments.length) {
      return api.sendMessage({
        plain: true,
        msg: "❌ Không có file video hoặc âm thanh hợp lệ để gửi."
      }, threadId, type);
    }

    // Upload real local files; file:// and signed R2 URLs are not valid SDK sources.
    await api.sendMessage({
      msg: lines.join("\n"),
      attachments
    }, threadId, type);
  } catch (error) {
    console.error("tiktok:", error.message);
    return api.sendMessage({
      plain: true,
      msg: "❌ Tải TikTok thất bại: " + String(error.message || error).slice(0, 180)
    }, threadId, type);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  }
};
