"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = path.join(__dirname, "..", "..", "data", "bot_admin_groups.json");
const DEFAULT_CACHE_TTL_MS = 500;

function createAdminGroupsStore({
  filePath = DEFAULT_FILE,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = Date.now
} = {}) {
  const target = path.resolve(filePath);
  const ttl = Math.max(0, Number(cacheTtlMs) || 0);
  let cached = null;
  let expiresAt = 0;
  let cachedMtimeMs = -1;
  let cachedSize = -1;
  let diskReads = 0;

  function invalidate() {
    cached = null;
    expiresAt = 0;
    cachedMtimeMs = -1;
    cachedSize = -1;
  }

  function read() {
    const timestamp = now();
    if (cached && timestamp < expiresAt) return cached.slice();

    try {
      const stat = fs.statSync(target);
      if (cached && stat.mtimeMs === cachedMtimeMs && stat.size === cachedSize) {
        expiresAt = timestamp + ttl;
        return cached.slice();
      }

      diskReads++;
      const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
      cached = Array.isArray(parsed) ? parsed.slice() : [];
      cachedMtimeMs = stat.mtimeMs;
      cachedSize = stat.size;
      expiresAt = timestamp + ttl;
      return cached.slice();
    } catch {
      // Fail closed: a missing/corrupt config must not authorize admin-group
      // commands. Retry after the short TTL so a repaired file is reloaded.
      cached = [];
      cachedMtimeMs = -1;
      cachedSize = -1;
      expiresAt = timestamp + ttl;
      return [];
    }
  }

  function write(groups) {
    const next = Array.isArray(groups) ? groups.slice() : [];
    const tempPath = target + "." + process.pid + ".tmp";
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(tempPath, JSON.stringify(next), "utf8");
      fs.renameSync(tempPath, target);
      const stat = fs.statSync(target);
      cached = next;
      cachedMtimeMs = stat.mtimeMs;
      cachedSize = stat.size;
      expiresAt = now() + ttl;
    } catch {
      try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup errors */ }
      invalidate();
    }
    return next.slice();
  }

  function getStats() {
    return {
      cached: cached !== null,
      diskReads,
      cacheTtlMs: ttl,
      filePath: target
    };
  }

  return { read, write, invalidate, getStats };
}

const store = createAdminGroupsStore();

module.exports = {
  readAdminGroups: store.read,
  writeAdminGroups: store.write,
  invalidateAdminGroupsCache: store.invalidate,
  createAdminGroupsStore,
  getAdminGroupsCacheStats: store.getStats
};
