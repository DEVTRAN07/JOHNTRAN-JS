"use strict";

const { loadImage } = require("canvas");
const { getBuffer } = require("../runtime/queuedHttp");

const MAX_ENTRIES = 64;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const CACHE_TTL_MS = 30 * 60 * 1000;
const images = new Map();
const pending = new Map();

function touch(url, entry) {
  images.delete(url);
  images.set(url, entry);
  while (images.size > MAX_ENTRIES) {
    const oldest = images.keys().next().value;
    if (oldest === undefined) break;
    images.delete(oldest);
  }
}

function getAvatar(url) {
  const key = String(url || "").trim();
  if (!/^https?:\/\//i.test(key)) return null;

  const cached = images.get(key);
  if (cached) {
    // Stale-while-revalidate: use the old image immediately during refresh.
    touch(key, cached);
    if (cached.expiresAt <= Date.now()) void warmAvatar(key);
    return cached.image;
  }

  void warmAvatar(key);
  return null;
}

function warmAvatar(url) {
  const key = String(url || "").trim();
  if (!/^https?:\/\//i.test(key)) return Promise.resolve(null);
  if (pending.has(key)) return pending.get(key);

  const task = (async () => {
    try {
      const result = await getBuffer(key, {
        timeout: 3500,
        retries: 0,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8"
        }
      });
      const buffer = result?.buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.length > MAX_IMAGE_BYTES) {
        return null;
      }

      const image = await loadImage(buffer);
      const entry = { image, expiresAt: Date.now() + CACHE_TTL_MS };
      touch(key, entry);
      return image;
    } catch {
      return null;
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, task);
  return task;
}

function clearAvatarCache() {
  images.clear();
  pending.clear();
}

module.exports = {
  getAvatar,
  warmAvatar,
  clearAvatarCache,
  MAX_ENTRIES,
  MAX_IMAGE_BYTES,
  CACHE_TTL_MS
};
