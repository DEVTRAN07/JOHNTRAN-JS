"use strict";

const { stripStickerSuffix, jxlToJpg } = require("./stickerFactory");

// Chuẩn hoá URL gốc: gỡ hậu tố sticker và sửa đuôi JXL giả JPEG.
function cleanMediaUrl(url) {
  const raw = String(url || "").split("\\").join("/");
  return stripStickerSuffix(jxlToJpg(raw));
}

// Ưu tiên WebP động của sticker, sau đó video, ảnh và file đính kèm.
function pickMediaUrl(media) {
  if (!media) return null;
  return cleanMediaUrl(media.webpUrl) || cleanMediaUrl(media.video) ||
    cleanMediaUrl(media.image) || cleanMediaUrl(media.file) || null;
}

module.exports = { pickMediaUrl, cleanMediaUrl };
