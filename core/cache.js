const { LRUCache, createCache } = require("./cache/lru");

const threadCache = createCache({ max: 1000, ttl: 5 * 60 * 1000 });
// Retain the last committed group settings for the lifetime of this process.
// The hot thread cache expires quickly for normal reads, but an idle group that
// was explicitly enabled must remain enabled during a temporary DB/Supabase
// outage. Entries are LRU-bounded and intentionally never time out.
const durableThreadCache = new LRUCache({ max: 10000, ttl: Infinity });
const userCache = createCache({ max: 1000, ttl: 10 * 60 * 1000 });

const caches = {
  threadCache,
  userCache,
  groupInfo: new LRUCache({ max: 200, ttl: 300000 }),
  userInfo: new LRUCache({ max: 500, ttl: 600000 }),
  musicSearch: new LRUCache({ max: 100, ttl: 300000 }),
  musicResolve: new LRUCache({ max: 200, ttl: 1800000 }),
  musicPending: new LRUCache({ max: 200, ttl: 300000 }),
  mediaMeta: new LRUCache({ max: 200, ttl: 600000 })
};

let cleanupTimer = null;
let cleanupIntervalMs = 60 * 1000;

function runCleanup() {
  let total = 0;
  for (const cache of Object.values(caches)) {
    try {
      total += cache.pruneExpired();
    } catch (err) {}
  }
  return total;
}

function startAutoCleanup(intervalMs = 60000) {
  stopAutoCleanup();
  cleanupIntervalMs = intervalMs;
  runCleanup();
  cleanupTimer = setInterval(runCleanup, intervalMs);
  return cleanupTimer;
}

function stopAutoCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function cleanupOnce() {
  return runCleanup();
}

function allStats() {
  return Object.fromEntries(Object.entries(caches).map(([name, cache]) => [name, cache.stats()]));
}

module.exports = { LRUCache, createCache, threadCache, durableThreadCache, userCache, caches, allStats, runCleanup, startAutoCleanup, stopAutoCleanup, cleanupOnce };
