"use strict";

const fs = require("fs");
const path = require("path");
const { db } = require("./runtime/adapters/database");

const METRICS_TABLE = "Metrics";
const AUDIT_FILE = path.join(__dirname, "..", "data", "audit.log");
const DEFAULT_FLUSH_DELAY_MS = 2000;
const MAX_CACHED_DAYS = 14;

function todayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function createEmptyStats(day) {
  return {
    day,
    commands: 0,
    errors: 0,
    musicSearch: 0,
    musicDownload: 0,
    aiRequests: 0,
    ttsRequests: 0,
    byCommand: {}
  };
}

/**
 * Metrics are hot-path counters. Keep increments in memory and persist them
 * in batches so a command does not trigger a database write of its own.
 * The injected backend also makes batching behavior independently testable.
 */
function createMetricsStore(backend, options = {}) {
  if (!backend || typeof backend.get !== "function" ||
      typeof backend.set !== "function" || typeof backend.all !== "function") {
    throw new TypeError("Metrics backend must provide get(), set() and all()");
  }

  const flushDelayMs = Number.isFinite(options.flushDelayMs) && options.flushDelayMs >= 0
    ? options.flushDelayMs
    : DEFAULT_FLUSH_DELAY_MS;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const cache = new Map();
  const dirtyDays = new Set();
  let flushTimer = null;

  function trimCache() {
    while (cache.size > MAX_CACHED_DAYS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      if (dirtyDays.has(oldest)) {
        // Never evict unpersisted counters.
        const value = cache.get(oldest);
        cache.delete(oldest);
        cache.set(oldest, value);
        if ([...dirtyDays].every((day) => !cache.has(day))) break;
        continue;
      }
      cache.delete(oldest);
    }
  }

  function getDayStats(day = todayKey(now())) {
    if (cache.has(day)) return cache.get(day);

    const record = backend.get(METRICS_TABLE, "day", day);
    const stats = record?.data || createEmptyStats(day);
    if (!stats.byCommand || typeof stats.byCommand !== "object") stats.byCommand = {};
    cache.set(day, stats);
    trimCache();
    return stats;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, flushDelayMs);
    flushTimer.unref?.();
  }

  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    let flushed = 0;
    let failed = false;
    for (const day of [...dirtyDays]) {
      const stats = cache.get(day);
      if (!stats) {
        dirtyDays.delete(day);
        continue;
      }
      try {
        backend.set(METRICS_TABLE, "day", day, stats);
        dirtyDays.delete(day);
        flushed++;
      } catch {
        failed = true;
      }
    }
    if (failed) scheduleFlush();
    return flushed;
  }

  function track(event, meta = {}) {
    try {
      const field = {
        command: "commands",
        error: "errors",
        musicSearch: "musicSearch",
        musicDownload: "musicDownload",
        aiRequest: "aiRequests",
        ttsRequest: "ttsRequests"
      }[event];
      if (!field) return;

      const stats = getDayStats();
      stats[field] = (stats[field] || 0) + 1;
      if (event === "command" && meta.command) {
        stats.byCommand[meta.command] = (stats.byCommand[meta.command] || 0) + 1;
      }
      dirtyDays.add(stats.day);
      scheduleFlush();
    } catch {
      // Metrics failures must never break command processing.
    }
  }

  function topCommands(day = todayKey(now()), limit = 5) {
    const stats = getDayStats(day);
    return Object.entries(stats.byCommand)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  function allDays() {
    return backend.all(METRICS_TABLE).map((row) => row.data);
  }

  function dispose() {
    return flush();
  }

  return { track, getDayStats, topCommands, allDays, flush, dispose };
}

const metricsStore = createMetricsStore(db, {
  flushDelayMs: Number(process.env.JT_METRICS_FLUSH_MS) >= 0
    ? Number(process.env.JT_METRICS_FLUSH_MS)
    : DEFAULT_FLUSH_DELAY_MS
});

process.once("beforeExit", () => {
  metricsStore.flush();
});

function audit(action, actor, detail = "") {
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    const line = `[${new Date().toISOString()}] ${action} | user:${actor || "system"} ${detail ? `| ${detail}` : ""}\n`;
    fs.appendFileSync(AUDIT_FILE, line, "utf8");
  } catch {
    // audit lỗi cũng không được làm hỏng bot
  }
}

function readAudit(limit = 50) {
  try {
    const content = fs.readFileSync(AUDIT_FILE, "utf8");
    return content.trim().split("\n").slice(-limit);
  } catch {
    return [];
  }
}

module.exports = {
  ...metricsStore,
  createMetricsStore,
  audit,
  readAudit
};
