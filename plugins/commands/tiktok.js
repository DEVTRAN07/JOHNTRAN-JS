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

async function cachedMedia(url, type) {
  const key = urlCacheKey(url);
  const cached = await mediaCache.get(key);
  if (cached && cached.buffer) {
    const cachedUrl = mediaCache.getUrl(key);
    return { buffer: cached.buffer, url: cachedUrl, cached: true, key };
  }
  return { key, cached: false };
}

async function storeMedia(url, buffer, type, metadata) {
  const result = await mediaCache.upload(buffer, type, Object.assign({ sourceUrl: url }, metadata || {}));
  return { buffer, url: result.url, cached: result.cached, key: result.key };
}

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
    await api.sendMessage({ msg: "⏳ Đang lấy thông tin TikTok...", plain: true }, threadId, type);

    const info = await enqueue("download", () => getVideoInfo(url), {
      key: `tiktok-info|${urlCacheKey(url)}`,
      label: "Lấy metadata TikTok"
    });
    const videoUrl = info.videoUrl;
    const musicUrl = info.music || "";
    const thumbUrl = info.thumbnail || "";

    // ---- VIDEO ----
    let videoResult = null;
    if (videoUrl) {
      const videoCached = await cachedMedia(videoUrl, "video");
      if (videoCached.cached) {
        videoResult = { buffer: videoCached.buffer, url: videoCached.url, cached: true };
      } else {
        const tmpVideo = path.join(tmpDir, "video.mp4");
        const { buffer } = await queuedGetBuffer(videoUrl, { timeout: 180000, retries: 1 });
        if (!buffer || !buffer.length) throw new Error("Video tải về rỗng");
        fs.writeFileSync(tmpVideo, buffer);
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
        musicResult = { buffer: musicCached.buffer, url: musicCached.url, cached: true };
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

    // ---- THUMBNAIL ----
    let thumbResult = null;
    if (thumbUrl) {
      const thumbCached = await cachedMedia(thumbUrl, "image");
      if (thumbCached.cached) {
        thumbResult = { buffer: thumbCached.buffer, url: thumbCached.url, cached: true };
      } else {
        const { buffer } = await queuedGetBuffer(thumbUrl, { timeout: 30000, retries: 1 });
        if (buffer && buffer.length) {
          thumbResult = await storeMedia(thumbUrl, buffer, "image", {
            title: info.title,
            isThumbnail: true,
          });
        }
      }
    }

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
    if (musicResult) lines.push("🎵 Music " + (musicResult.cached ? "(cache)" : "(mới)"));

    if (videoResult) {
      const payload = {
        msg: lines.join("\n"),
        attachments: [videoResult.url],
      };
      if (thumbResult) payload.thumbnailUrl = thumbResult.url;
      if (musicResult) payload.audioUrl = musicResult.url;
      await api.sendMessage(payload, threadId, type);
    } else if (musicResult) {
      await api.sendMessage({
        msg: lines.join("\n"),
        attachments: [musicResult.url],
      }, threadId, type);
    }
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
