class LRUCache {
  constructor({ max = 1000, ttl = 300000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
    this.lastPruned = 0;
    this.inFlight = new Map();
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
    if (cached !== undefined) return cached;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const pending = Promise.resolve().then(fn).then((value) => {
      this.set(key, value, ttl);
      return value;
    }).finally(() => {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    });
    this.inFlight.set(key, pending);
    return pending;
  }

  clear() {
    this.store.clear();
    this.inFlight.clear();
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

module.exports = { LRUCache, createCache };
