"use strict";

const PRUNE_BATCH_SIZE = 256;
const CAPACITY_PRUNE_BATCH_SIZE = 1024;

class SlidingWindowLimiter {
  constructor({ windowMs = 10000, max = 12, maxKeys = 20000 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this.entries = new Map();
    this.operations = 0;
    this.pruneIterator = null;
  }
  allow(key, now = Date.now()) {
    if (key === undefined || key === null || key === "") return false;
    const id = String(key);
    let entry = this.entries.get(id);
    if (!entry) {
      if (this.entries.size >= this.maxKeys) {
        this.prune(now, true);
        if (this.entries.size >= this.maxKeys) {
          const oldestKey = this.entries.keys().next().value;
          if (oldestKey !== undefined) this.entries.delete(oldestKey);
        }
      }
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
    // Scan a rotating, bounded slice instead of walking every tracked user
    // on one message. Capacity pressure gets a larger but still bounded pass.
    const batchSize = force ? CAPACITY_PRUNE_BATCH_SIZE : PRUNE_BATCH_SIZE;
    if (!this.pruneIterator) this.pruneIterator = this.entries.keys();

    let inspected = 0;
    while (inspected < batchSize) {
      const next = this.pruneIterator.next();
      if (next.done) {
        this.pruneIterator = null;
        break;
      }
      const key = next.value;
      const entry = this.entries.get(key);
      // All timestamps are at or before touchedAt. Once the last activity
      // is outside the window, the key is safe to discard without scanning
      // its timestamp array first.
      if (entry && now - entry.touchedAt > this.windowMs) {
        this.entries.delete(key);
      }
      inspected++;
    }
  }
  clear() {
    this.entries.clear();
    this.pruneIterator = null;
  }
}
const commandLimiter = new SlidingWindowLimiter({ windowMs: 10000, max: 12 });
module.exports = { SlidingWindowLimiter, commandLimiter };
