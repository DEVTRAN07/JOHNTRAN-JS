const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require("../../core/http");
const { mediaCache } = require("../../core/mediaCache");

const girlImages = require('../../assets/girl.json');

module.exports.config = {
  name: 'girl',
  aliases: ['gai'],
  version: '1.0.3',
  role: 0,
  author: 'ShinTHL09',
  description: 'Xem ảnh gái ngẫu nhiên',
  category: 'Giải trí',
  usage: 'girl',
  cooldowns: 2,
  dependencies: {}
};

function urlCacheKey(url) {
  return crypto.createHash('sha256').update(String(url)).digest('hex');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

async function getCachedAttachment(url) {
  const key = urlCacheKey(url);
  const cached = await mediaCache.get(key);
  if (!cached || !cached.buffer) return null;
  const cachedUrl = mediaCache.getUrl(key);
  if (isHttpUrl(cachedUrl)) return { attachment: cachedUrl, cleanup: null };

  const filePath = cachedUrl.startsWith('file://') ? cachedUrl.slice(7) : cachedUrl;
  if (fs.existsSync(filePath)) return { attachment: filePath, cleanup: null };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt_girl_cache_'));
  const tmpPath = path.join(tempDir, 'gai.jpg');
  fs.writeFileSync(tmpPath, cached.buffer);
  return { attachment: tmpPath, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
}

async function cacheDownloadedImage(url, buffer, contentType) {
  const key = urlCacheKey(url);
  const type = 'image';
  const ttl = (mediaCache.ttls && mediaCache.ttls[type]) || mediaCache.defaultTtl || 86400000;
  const expiresAt = Date.now() + ttl;
  await mediaCache._writeLocal(type, key, buffer, { sourceUrl: url }, ttl, contentType || 'image/jpeg', expiresAt);

  if (mediaCache.r2) {
    try {
      await mediaCache.r2.request({
        method: 'PUT',
        key: type + '/' + key,
        body: buffer,
        contentType: contentType || 'image/jpeg',
        metadata: { sourceUrl: url, type, expiresAt, size: String(buffer.length), createdAt: String(Date.now()) }
      });
      mediaCache._stats.r2Uploads = (mediaCache._stats.r2Uploads || 0) + 1;
    } catch (err) {
      // bỏ qua lỗi upload R2, cache local vẫn dùng được
    }
  }

  mediaCache._stats.uploads++;
  mediaCache._stats.bytes += buffer.length;
  if (typeof mediaCache._refreshLocalFileCount === 'function') mediaCache._refreshLocalFileCount();

  const cachedUrl = mediaCache.getUrl(key);
  return { key, cachedUrl };
}

module.exports.run = async ({ args, event, api, Users }) => {
  const { threadId, type } = event;
  if (!Array.isArray(girlImages) || girlImages.length === 0) {
    return api.sendMessage("❌ Hiện chưa có ảnh để gửi.", threadId, type);
  }

  const link = girlImages[Math.floor(Math.random() * girlImages.length)];
  let tempDir = null;
  let cleanup = null;
  try {
    const cached = await getCachedAttachment(link);
    let attachment;

    if (cached) {
      attachment = cached.attachment;
      cleanup = cached.cleanup;
    } else {
      const { buffer, contentType } = await http.getBuffer(link, {
        timeout: 30000,
        retries: 1,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://imgur.com/',
          'Accept': 'image/*,*/*;q=0.8'
        }
      });

      if (!buffer?.length) throw new Error("Ảnh tải về rỗng");

      const { cachedUrl } = await cacheDownloadedImage(link, buffer, contentType);
      if (isHttpUrl(cachedUrl)) {
        attachment = cachedUrl;
      } else {
        const filePath = cachedUrl.startsWith('file://') ? cachedUrl.slice(7) : cachedUrl;
        if (fs.existsSync(filePath)) {
          attachment = filePath;
        } else {
          tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt_girl_'));
          attachment = path.join(tempDir, 'gai.jpg');
          fs.writeFileSync(attachment, buffer);
        }
      }
    }

    await api.sendMessage({ msg: "📷 Ảnh gái ngẫu nhiên", attachments: attachment }, threadId, type);
  } catch (error) {
    console.error("Đã xảy ra lỗi khi tải ảnh gái:", error.message);
    return api.sendMessage("❌ Không thể tải ảnh gái lúc này. Vui lòng thử lại sau.", threadId, type);
  } finally {
    if (typeof cleanup === 'function') cleanup();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
