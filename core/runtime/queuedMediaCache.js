"use strict";

const { enqueue } = require("../jobQueue");
const { mediaCache } = require("../mediaCache");

function get(key) {
  const cacheKey = String(key);
  return enqueue("media", () => mediaCache.get(cacheKey), {
    key: `media-cache-read|${cacheKey}`,
    label: "Đọc media cache"
  });
}

function upload(buffer, type, metadata = {}) {
  return enqueue("media", () => mediaCache.upload(buffer, type, metadata), {
    label: `Lưu media ${String(type || "file").slice(0, 24)}`
  });
}

module.exports = { get, upload };
