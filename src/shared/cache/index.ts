export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheOptions {
  max?: number;
  ttl?: number;
}

export interface CacheStats {
  size: number;
  max: number;
  ttl: number;
  hits: number;
  misses: number;
  hitRate: string;
}

export class LRUCache<T> {
  private max: number;
  private ttl: number;
  private store: Map<string, CacheEntry<T>>;
  private hits: number;
  private misses: number;
  private lastPruned: number;

  constructor({ max = 1000, ttl = 300000 }: CacheOptions = {}) {
    this.max = max;
    this.ttl = ttl;
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
    this.lastPruned = 0;
  }

  private _isExpired(entry: CacheEntry<T>): boolean {
    return entry.expiresAt < Date.now();
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this._isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  get(key: string): T | undefined {
    if (!this.has(key)) {
      this.misses++;
      return undefined;
    }
    const entry = this.store.get(key)!;
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttl: number = this.ttl): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
  }

  invalidate(key: string): boolean {
    return this.store.delete(key);
  }

  delete(key: string): boolean {
    return this.invalidate(key);
  }

  async remember(key: string, fn: () => Promise<T>, ttl: number = this.ttl): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = await fn();
    this.set(key, value, ttl);
    return value;
  }

  clear(): void {
    this.store.clear();
  }

  stats(): CacheStats {
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

  pruneExpired(): number {
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

export function createCache<T>(options?: CacheOptions): LRUCache<T> {
  return new LRUCache<T>(options);
}

export const threadCache = createCache({ max: 1000, ttl: 5 * 60 * 1000 });
export const userCache = createCache({ max: 1000, ttl: 10 * 60 * 1000 });

export const caches: Record<string, LRUCache<unknown>> = {
  threadCache,
  userCache,
  groupInfo: new LRUCache<unknown>({ max: 200, ttl: 300000 }),
  userInfo: new LRUCache<unknown>({ max: 500, ttl: 600000 }),
  musicSearch: new LRUCache<unknown>({ max: 100, ttl: 300000 }),
  musicResolve: new LRUCache<unknown>({ max: 200, ttl: 1800000 }),
  musicPending: new LRUCache<unknown>({ max: 200, ttl: 300000 }),
  mediaMeta: new LRUCache<unknown>({ max: 200, ttl: 600000 })
};

let cleanupTimer: NodeJS.Timeout | null = null;
let cleanupIntervalMs = 60 * 1000;

export function runCleanup(): number {
  let total = 0;
  for (const cache of Object.values(caches)) {
    try {
      total += cache.pruneExpired();
    } catch {
      // ignore
    }
  }
  return total;
}

export function startAutoCleanup(intervalMs = 60000): NodeJS.Timeout {
  stopAutoCleanup();
  cleanupIntervalMs = intervalMs;
  runCleanup();
  cleanupTimer = setInterval(runCleanup, intervalMs);
  return cleanupTimer;
}

export function stopAutoCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function cleanupOnce(): number {
  return runCleanup();
}

export function allStats(): Record<string, CacheStats> {
  return Object.fromEntries(Object.entries(caches).map(([name, cache]) => [name, cache.stats()]));
}
