const logger = require("../utils/logger");

class LRUCache {
  constructor({ max = 1000, ttl = 300000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
    this.lastPruned = 0;
  }

  _isExpired(entry) {
    return entry.expiresAt < Date.now();
  }

  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this._isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  get(key) {
    if (!this.has(key)) {
      this.misses++;
      return undefined;
    }
    const entry = this.store.get(key);
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key, value, ttl = this.ttl) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
  }

  invalidate(key) {
    return this.store.delete(key);
  }

  delete(key) {
    return this.invalidate(key);
  }

  async remember(key, fn, ttl = this.ttl) {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = await fn();
    this.set(key, value, ttl);
    return value;
  }

  clear() {
    this.store.clear();
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      max: this.max,
      ttl: this.ttl,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total).toFixed(2) : "0"
    };
  }

  pruneExpired() {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        removed++;
      }
    }
    this.lastPruned = Date.now();
    return removed;
  }
}

function createCache(options = {}) {
  return new LRUCache(options);
}

const threadCache = createCache({ max: 1000, ttl: 5 * 60 * 1000 });
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
    } catch (err) {
    }
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

module.exports = { LRUCache, createCache, threadCache, userCache, caches, allStats, runCleanup, startAutoCleanup, stopAutoCleanup, cleanupOnce };
