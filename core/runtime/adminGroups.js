"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

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
  let metadataChecks = 0;
  let refreshPromise = null;
  let generation = 0;

  function invalidate() {
    generation++;
    cached = null;
    expiresAt = 0;
    cachedMtimeMs = -1;
    cachedSize = -1;
    refreshPromise = null;
  }

  function refresh() {
    if (refreshPromise) return refreshPromise;
    const refreshGeneration = generation;
    const startedAt = now();

    refreshPromise = (async () => {
      try {
        const stat = await fsp.stat(target);
        metadataChecks++;

        if (cached && stat.mtimeMs === cachedMtimeMs && stat.size === cachedSize) {
          if (generation === refreshGeneration) expiresAt = now() + ttl;
          return generation === refreshGeneration ? cached.slice() : (cached || []).slice();
        }

        const raw = await fsp.readFile(target, "utf8");
        const parsed = JSON.parse(raw);
        const next = Array.isArray(parsed) ? parsed.slice() : [];

        // Do not let an older in-flight read overwrite a newer panel write or
        // explicit cache invalidation.
        if (generation !== refreshGeneration) return (cached || []).slice();

        cached = next;
        cachedMtimeMs = stat.mtimeMs;
        cachedSize = stat.size;
        expiresAt = now() + ttl;
        diskReads++;
        return cached.slice();
      } catch {
        // Fail closed: a missing/corrupt allow-list must never grant access.
        if (generation === refreshGeneration) {
          cached = [];
          cachedMtimeMs = -1;
          cachedSize = -1;
          expiresAt = now() + ttl;
        }
        return (cached || []).slice();
      }
    })().finally(() => {
      if (generation === refreshGeneration) refreshPromise = null;
    });

    return refreshPromise;
  }

  // Synchronous compatibility accessor. It is memory-only: once the snapshot
  // expires it fails closed and starts a background refresh instead of calling
  // statSync/readFileSync on the command event loop.
  function read() {
    if (cached && now() < expiresAt) return cached.slice();
    void refresh();
    return [];
  }

  // Sensitive command authorization uses this async accessor so an expired
  // snapshot is refreshed before deciding, without blocking other messages.
  async function readFresh() {
    if (cached && now() < expiresAt) return cached.slice();
    return refresh();
  }

  function write(groups) {
    const next = Array.isArray(groups) ? groups.slice() : [];
    const tempPath = target + "." + process.pid + ".tmp";
    generation++;
    refreshPromise = null;
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
      cached = [];
      cachedMtimeMs = -1;
      cachedSize = -1;
      expiresAt = now() + ttl;
    }
    return next.slice();
  }

  function getStats() {
    return {
      cached: cached !== null,
      diskReads,
      metadataChecks,
      refreshPending: Boolean(refreshPromise),
      cacheTtlMs: ttl,
      filePath: target
    };
  }

  // Warm the snapshot at module startup. No filesystem work is performed by
  // read() or by the command authorization hot path while this is in flight.
  void refresh();

  return { read, readFresh, refresh, write, invalidate, getStats };
}

const store = createAdminGroupsStore();

module.exports = {
  readAdminGroups: store.readFresh,
  readAdminGroupsCached: store.read,
  refreshAdminGroups: store.refresh,
  writeAdminGroups: store.write,
  invalidateAdminGroupsCache: store.invalidate,
  createAdminGroupsStore,
  getAdminGroupsCacheStats: store.getStats
};
