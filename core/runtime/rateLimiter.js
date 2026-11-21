"use strict";

const nativeCore = require("../../native");

const PRUNE_BATCH_SIZE = 256;
const CAPACITY_PRUNE_BATCH_SIZE = 1024;
const NATIVE_PRUNE_ITERATOR = Object.freeze({ native: true });

class SlidingWindowLimiter {
  constructor({ windowMs = 10000, max = 12, maxKeys = 20000 } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.maxKeys = maxKeys;
    this._native = null;
    this._entries = null;
    this._operations = 0;
    this._pruneIterator = null;

    const NativeLimiter = nativeCore.NativeSlidingWindowLimiter;
    if (
      process.env.JT_RUST_RATE_LIMITER === "1" &&
      typeof NativeLimiter === "function" &&
      typeof windowMs === "number" &&
      typeof max === "number" &&
      typeof maxKeys === "number"
    ) {
      try {
        this._native = new NativeLimiter(windowMs, max, maxKeys);
      } catch {
        // Keep the JavaScript implementation as a safe fallback on platforms
        // where the addon is unavailable or cannot instantiate this class.
      }
    }

    if (!this._native) {
      this._entries = new Map();
    }
  }

  get entries() {
    if (!this._native) return this._entries;
    const snapshot = this._native.snapshot();
    return new Map((snapshot.entries || []).map(entry => [
      entry.key,
      {
        timestamps: Array.isArray(entry.timestamps) ? entry.timestamps.slice() : [],
        cursor: Number(entry.cursor) || 0,
        touchedAt: entry.touchedAt ?? entry.touched_at
      }
    ]));
  }

  get operations() {
    return this._native ? this._native.operations : this._operations;
  }

  get pruneIterator() {
    if (!this._native) return this._pruneIterator;
    return (this._native.hasPruneCursor ?? this._native.has_prune_cursor)
      ? NATIVE_PRUNE_ITERATOR
      : null;
  }

  switchToJavaScript() {
    if (!this._native) return;
    const snapshot = this._native.snapshot();
    this._entries = new Map((snapshot.entries || []).map(entry => [
      entry.key,
      {
        timestamps: Array.isArray(entry.timestamps) ? entry.timestamps.slice() : [],
        cursor: Number(entry.cursor) || 0,
        touchedAt: entry.touchedAt ?? entry.touched_at
      }
    ]));
    this._operations = Number(snapshot.operations) || 0;
    this._pruneIterator = null;

    const hasCursor = snapshot.hasPruneCursor ?? snapshot.has_prune_cursor;
    if (hasCursor) {
      const iterator = this._entries.keys();
      const nextKey = snapshot.pruneCursorNextKey ?? snapshot.prune_cursor_next_key;
      if (nextKey === undefined || nextKey === null) {
        // The old Map iterator has consumed the current last key but has not
        // yet observed done because the previous pass hit its batch limit.
        while (!iterator.next().done) {}
      } else {
        // Position immediately before the next key; consuming the key here
        // would make the next JavaScript prune pass skip one live Map entry.
        const keys = [...this._entries.keys()];
        const targetIndex = keys.indexOf(nextKey);
        const steps = targetIndex < 0 ? keys.length : targetIndex;
        for (let index = 0; index < steps; index++) iterator.next();
        if (targetIndex < 0) {
          while (!iterator.next().done) {}
        }
      }
      this._pruneIterator = iterator;
    }
    this._native = null;
  }

  allow(key, now = Date.now()) {
    if (key === undefined || key === null || key === "") return false;
    const id = String(key);

    if (this._native && typeof now === "number") {
      return this._native.allow(id, now);
    }
    if (this._native) this.switchToJavaScript();

    let entry = this._entries.get(id);
    if (!entry) {
      if (this._entries.size >= this.maxKeys) {
        this.prune(now, true);
        if (this._entries.size >= this.maxKeys) {
          const oldestKey = this._entries.keys().next().value;
          if (oldestKey !== undefined) this._entries.delete(oldestKey);
        }
      }
      entry = { timestamps: [], cursor: 0, touchedAt: now };
      this._entries.set(id, entry);
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
    if ((++this._operations & 1023) === 0) this.prune(now);
    return true;
  }

  prune(now = Date.now(), force = false) {
    if (this._native && typeof now === "number") {
      this._native.prune(now, Boolean(force));
      return;
    }
    if (this._native) this.switchToJavaScript();

    // Scan a rotating, bounded slice instead of walking every tracked user
    // on one message. Capacity pressure gets a larger but still bounded pass.
    const batchSize = force ? CAPACITY_PRUNE_BATCH_SIZE : PRUNE_BATCH_SIZE;
    if (!this._pruneIterator) this._pruneIterator = this._entries.keys();

    let inspected = 0;
    while (inspected < batchSize) {
      const next = this._pruneIterator.next();
      if (next.done) {
        this._pruneIterator = null;
        break;
      }
      const key = next.value;
      const entry = this._entries.get(key);
      // All timestamps are at or before touchedAt. Once the last activity
      // is outside the window, the key is safe to discard without scanning
      // its timestamp array first.
      if (entry && now - entry.touchedAt > this.windowMs) {
        this._entries.delete(key);
      }
      inspected++;
    }
  }

  clear() {
    if (this._native) {
      this._native.clear();
      return;
    }
    this._entries.clear();
    this._pruneIterator = null;
  }
}

const commandLimiter = new SlidingWindowLimiter({ windowMs: 10000, max: 12 });

module.exports = {
  SlidingWindowLimiter,
  commandLimiter,
  getNativeDiagnostics: nativeCore.getRateLimiterDiagnostics,
  PRUNE_BATCH_SIZE,
  CAPACITY_PRUNE_BATCH_SIZE
};
