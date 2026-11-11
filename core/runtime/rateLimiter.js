"use strict";
class SlidingWindowLimiter {
  constructor({ windowMs = 10000, max = 12, maxKeys = 20000 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this.entries = new Map();
    this.operations = 0;
  }
  allow(key, now = Date.now()) {
    if (key === undefined || key === null || key === "") return false;
    const id = String(key);
    let entry = this.entries.get(id);
    if (!entry) {
      if (this.entries.size >= this.maxKeys) this.prune(now, true);
      entry = { timestamps: [], cursor: 0, touchedAt: now };
      this.entries.set(id, entry);
    }
    const times = entry.timestamps;
    while (entry.cursor < times.length && now - times[entry.cursor] > this.windowMs) entry.cursor++;
    if (times.length - entry.cursor >= this.max) {
      entry.touchedAt = now;
      return false;
    }
    times.push(now);
    entry.touchedAt = now;
    if (entry.cursor >= 64 && entry.cursor * 2 >= times.length) {
      entry.timestamps = times.slice(entry.cursor);
      entry.cursor = 0;
    }
    if ((++this.operations & 1023) === 0) this.prune(now);
    return true;
  }
  prune(now = Date.now(), force = false) {
    for (const [key, entry] of this.entries) {
      const active = entry.timestamps.length - entry.cursor;
      const expired = active === 0 && now - entry.touchedAt > this.windowMs;
      const staleForCapacity = force && now - entry.touchedAt > this.windowMs * 2;
      if (expired || staleForCapacity) this.entries.delete(key);
    }
  }
  clear() { this.entries.clear(); }
}
const commandLimiter = new SlidingWindowLimiter({ windowMs: 10000, max: 12 });
module.exports = { SlidingWindowLimiter, commandLimiter };
