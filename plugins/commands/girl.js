const fs = require("fs");
const os = require("os");
const path = require("path");
const { getBuffer: queuedGetBuffer } = require("../../core/runtime/queuedHttp");

const girlImages = require("../../assets/girl.json");
const IMAGE_CACHE_TTL = 60 * 60 * 1000;
const IMAGE_CACHE_MAX_ENTRIES = 12;
const IMAGE_CACHE_MAX_BYTES = 24 * 1024 * 1024;
const imageCache = new Map();
let imageCacheBytes = 0;

module.exports.config = {
  name: "girl",
  aliases: ["gai"],
  version: "1.0.5",
  role: 0,
  author: "ShinTHL09",
  description: "Xem ảnh ngẫu nhiên",
  category: "Giải trí",
  usage: "girl",
  cooldowns: 2,
  dependencies: {}
};

function imageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

function getCachedImage(url) {
  const entry = imageCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > IMAGE_CACHE_TTL) {
    imageCache.delete(url);
    imageCacheBytes -= entry.buffer.length;
    return null;
  }
  // LRU: đưa ảnh vừa dùng lên cuối Map.
  imageCache.delete(url);
  imageCache.set(url, entry);
  return entry;
}

function cacheImage(url, buffer, extension) {
  if (buffer.length > 4 * 1024 * 1024) return;
  const previous = imageCache.get(url);
  if (previous) imageCacheBytes -= previous.buffer.length;
  imageCache.delete(url);
  imageCache.set(url, { buffer, extension, createdAt: Date.now() });
  imageCacheBytes += buffer.length;

  while (imageCache.size > IMAGE_CACHE_MAX_ENTRIES || imageCacheBytes > IMAGE_CACHE_MAX_BYTES) {
    const oldestKey = imageCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = imageCache.get(oldestKey);
    imageCache.delete(oldestKey);
    imageCacheBytes -= oldest.buffer.length;
  }
}

async function getImageFromSource(url) {
  const cached = getCachedImage(url);
  if (cached) return { buffer: cached.buffer, extension: cached.extension, cached: true };

  const response = await queuedGetBuffer(url, {
    timeout: 30000,
    retries: 2,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
    }
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error("Nguồn ảnh trả HTTP " + response.status);
  }

  const extension = imageExtension(response.buffer);
  if (!extension) {
    throw new Error("Nguồn không trả về ảnh JPEG, PNG hoặc WebP hợp lệ");
  }

  cacheImage(url, response.buffer, extension);
  return { buffer: response.buffer, extension, cached: false };
}

module.exports.run = async ({ event, api }) => {
  const { threadId, type } = event;
  if (!Array.isArray(girlImages) || girlImages.length === 0) {
    return api.sendMessage("❌ Hiện chưa có ảnh để gửi.", threadId, type);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_girl_"));
  try {
    const start = Math.floor(Math.random() * girlImages.length);
    const attempts = Math.min(8, girlImages.length);
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
    // URL CDN không phải đường dẫn file local nên không được truyền trực tiếp vào attachments.
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

module.exports._test = {
  imageExtension,
  getImageFromSource,
  imageCache
};
