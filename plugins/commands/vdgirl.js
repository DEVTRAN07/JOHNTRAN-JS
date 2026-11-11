const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("../../core/http");
const { runInWorker } = require("../../core/workerPool");
const { mediaCache } = require("../../core/mediaCache");

let vdgirl = [];
try { vdgirl = require("../../assets/vdgirl.json"); } catch { vdgirl = []; }

module.exports.config = {
  name: "vdgirl",
  aliases: ["vdgai"],
  version: "1.0.5",
  role: 0,
  author: "ShinTHL09",
  description: "Xem video gái ngẫu nhiên",
  category: "Giải trí",
  usage: "vdgirl",
  cooldowns: 2
};

function urlCacheKey(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex");
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

async function getCachedVideo(key) {
  const cached = await mediaCache.get(key);
  if (!cached || !cached.buffer) return null;
  const cachedUrl = mediaCache.getUrl(key);
  if (isHttpUrl(cachedUrl)) return { url: cachedUrl, cleanup: null };

  const filePath = cachedUrl.startsWith("file://") ? cachedUrl.slice(7) : cachedUrl;
  if (fs.existsSync(filePath)) return { url: filePath, cleanup: null };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_vdgirl_cache_"));
  const tmpPath = path.join(tempDir, "gai.mp4");
  fs.writeFileSync(tmpPath, cached.buffer);
  return { url: tmpPath, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

module.exports.run = async ({ args, event, api, Users }) => {
  const { threadId, type } = event;
  if (vdgirl.length === 0) {
    return api.sendMessage("❌ Chưa có nguồn video.", threadId, type);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_vdgirl_"));
  const filePath = path.join(tempDir, "gai.mp4");
  try {
    const start = Math.floor(Math.random() * vdgirl.length);
    let lastError;
    let link;
    for (let attempt = 0; attempt < Math.min(3, vdgirl.length); attempt++) {
      link = vdgirl[(start + attempt) % vdgirl.length];
      const key = urlCacheKey(link);

      // Check cache before downloading
      const cached = await getCachedVideo(key);
      if (cached) {
        const videoUrl = cached.url;
        const cleanup = cached.cleanup;
        try {
          await api.sendVideo({
            videoUrl: videoUrl,
            msg: "🎥 Video gái ngẫu nhiên"
          }, threadId, type);
        } finally {
          if (typeof cleanup === "function") cleanup();
        }
        return;
      }

      try {
        const { buffer } = await http.getBuffer(link, {
          timeout: 60000,
          retries: 1,
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://files.catbox.moe/",
            "Accept": "video/*,*/*;q=0.8"
          }
        });
        if (!buffer?.length) throw new Error("Nguồn trả về video rỗng");
        fs.writeFileSync(filePath, buffer);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;

    const workerResult = await runInWorker("videoWorker", { videoPath: filePath }, { timeout: 60000 });
    const { metadata, thumbnailBuffer } = workerResult;

    // workerPool serializes via postMessage; thumbnailBuffer may arrive as a
    // serialized object rather than a real Buffer, so normalize it here.
    const thumbnailData = thumbnailBuffer && thumbnailBuffer.data
      ? thumbnailBuffer.data
      : thumbnailBuffer;
    const thumbnailBuf = Buffer.isBuffer(thumbnailBuffer)
      ? thumbnailBuffer
      : Buffer.from(thumbnailData || []);

    // Upload video and thumbnail to mediaCache
    const videoBuffer = fs.readFileSync(filePath);
    const videoResult = await mediaCache.upload(videoBuffer, "video", {
      sourceUrl: link,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
    });
    const thumbnailResult = await mediaCache.upload(thumbnailBuf, "image", {
      sourceUrl: link,
      isThumbnail: true,
    });

    const videoUrl = videoResult.url;
    const thumbnailUrl = thumbnailResult.url;

    await api.sendVideo({
      videoUrl: videoUrl,
      thumbnailUrl: thumbnailUrl,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      msg: "🎥 Video gái ngẫu nhiên"
    }, threadId, type);
  } catch (err) {
    console.error("Lỗi xử lý video:", err?.message || err);
    await api.sendMessage("❌ Không thể tải video: " + String(err?.message || err).slice(0, 180), threadId, type);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
