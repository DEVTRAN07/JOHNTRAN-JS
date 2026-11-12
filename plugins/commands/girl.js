const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { getBuffer: queuedGetBuffer } = require("../../core/runtime/queuedHttp");
const queuedMediaCache = require("../../core/runtime/queuedMediaCache");
const { enqueue } = require("../../core/jobQueue");
const { mediaCache } = require("../../core/mediaCache");

const girlImages = require("../../assets/girl.json");

module.exports.config = {
  name: "girl",
  aliases: ["gai"],
  version: "1.0.4",
  role: 0,
  author: "ShinTHL09",
  description: "Xem ảnh ngẫu nhiên",
  category: "Giải trí",
  usage: "girl",
  cooldowns: 2,
  dependencies: {}
};

function urlCacheKey(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex");
}

function imageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buffer.toString("ascii", 0, 3) === "GIF") return "gif";
  return null;
}

async function cacheDownloadedImage(url, buffer, contentType) {
  const key = urlCacheKey(url);
  const type = "image";
  const ttl = (mediaCache.ttls && mediaCache.ttls[type]) || mediaCache.defaultTtl || 86400000;
  const expiresAt = Date.now() + ttl;

  if (typeof mediaCache._writeLocal === "function") {
    await mediaCache._writeLocal(type, key, buffer, { sourceUrl: url }, ttl, contentType || "image/jpeg", expiresAt);
  }

  if (mediaCache.r2) {
    try {
      await enqueue("media", () => mediaCache.r2.request({
        method: "PUT",
        key: type + "/" + key,
        body: buffer,
        contentType: contentType || "image/jpeg",
        metadata: {
          sourceUrl: url,
          type,
          expiresAt,
          size: String(buffer.length),
          createdAt: String(Date.now())
        }
      }), { label: "Upload cache ảnh" });
      mediaCache._stats.r2Uploads = (mediaCache._stats.r2Uploads || 0) + 1;
    } catch (error) {
      // Cache local vẫn dùng được khi R2 tạm thời lỗi.
    }
  }

  mediaCache._stats.uploads++;
  mediaCache._stats.bytes += buffer.length;
  if (typeof mediaCache._refreshLocalFileCount === "function") mediaCache._refreshLocalFileCount();
}

async function getImageFromSource(url) {
  const key = urlCacheKey(url);
  const cached = await queuedMediaCache.get(key);
  if (cached?.buffer) {
    const ext = imageExtension(cached.buffer);
    if (ext) return { buffer: cached.buffer, extension: ext, cached: true };
  }

  const response = await queuedGetBuffer(url, {
    timeout: 30000,
    retries: 2,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    }
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error("Nguồn ảnh trả HTTP " + response.status);
  }

  const ext = imageExtension(response.buffer);
  if (!ext || ext === "gif") {
    throw new Error("Nguồn không trả về ảnh JPEG, PNG hoặc WebP hợp lệ");
  }

  await cacheDownloadedImage(url, response.buffer, response.contentType);
  return { buffer: response.buffer, extension: ext, cached: false };
}

module.exports.run = async ({ event, api }) => {
  const { threadId, type } = event;
  if (!Array.isArray(girlImages) || girlImages.length === 0) {
    return api.sendMessage("❌ Hiện chưa có ảnh để gửi.", threadId, type);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_girl_"));
  try {
    const start = Math.floor(Math.random() * girlImages.length);
    const attempts = Math.min(5, girlImages.length);
    let selected = null;
    let lastError = null;

    for (let index = 0; index < attempts; index++) {
      const link = girlImages[(start + index) % girlImages.length];
      try {
        selected = await getImageFromSource(link);
        if (selected) break;
      } catch (error) {
        lastError = error;
        console.warn("[girl] nguồn ảnh lỗi, thử nguồn tiếp theo:", error?.message || error);
      }
    }

    if (!selected) {
      throw lastError || new Error("Không có nguồn ảnh hợp lệ.");
    }

    // SDK Zalo uploadAttachment đọc file local và phân loại ảnh theo phần mở rộng.
    // Không đưa URL CDN vào attachments: SDK sẽ hiểu URL là đường dẫn file và gửi lỗi.
    const filePath = path.join(tempDir, "gai." + selected.extension);
    fs.writeFileSync(filePath, selected.buffer);

    await api.sendMessage({
      msg: "📷 Ảnh ngẫu nhiên",
      attachments: [filePath]
    }, threadId, type);
  } catch (error) {
    console.error("[girl] Không thể gửi ảnh:", error?.message || error);
    return api.sendMessage(
      "❌ Không thể tải/gửi ảnh lúc này: " + String(error?.message || error).slice(0, 160),
      threadId,
      type
    );
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
};

module.exports._test = { imageExtension, getImageFromSource };
