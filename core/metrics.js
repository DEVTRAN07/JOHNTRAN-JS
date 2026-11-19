"use strict";

const { performance } = require("node:perf_hooks");
const fs = require("fs");
const path = require("path");
const { db } = require("./runtime/adapters/database");
const { vietnamDateKey } = require("./topchat/stats");

const METRICS_TABLE = "Metrics";
const AUDIT_FILE = path.join(__dirname, "..", "data", "audit.log");
const DEFAULT_FLUSH_DELAY_MS = 2000;
const MAX_CACHED_DAYS = 14;

function todayKey(now = Date.now()) {
  return vietnamDateKey(now);
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
function normalizeZaloMessageTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric < 1e11) return numeric * 1000;       // seconds
  if (numeric < 1e14) return numeric;              // milliseconds
  if (numeric < 1e17) return numeric / 1000;       // microseconds
  return numeric / 1e6;                            // nanoseconds
}

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
  const recentLatencies = [];
  const commandLatencies = new Map();
  const commandExecutionLatencies = new Map();
  const listenerStageLatencies = new Map();
  const zaloApiLatencies = new Map();
  const zaloSdkPhaseLatencies = new Map();
  const firstResponseLatencies = new Map();
  const firstResponseStartLatencies = new Map();
  const firstResponseStartedMessages = new Set();
  const messageDeliveryAgeLatencies = new Map();
  const incomingMessageAt = new Map();
  const MAX_PENDING_FIRST_RESPONSES = 2048;
  const MAX_COMMAND_LATENCY_KEYS = 100;
  const MAX_COMMAND_LATENCY_SAMPLES = 100;
  let latencyCount = 0;
  let latencyTotalMs = 0;
  let latencyMaxMs = 0;
  let latencyLastMs = 0;
  let flushTimer = null;

  function trimCache(protectedDay) {
    while (cache.size > MAX_CACHED_DAYS) {
      // Never evict unpersisted counters or the record currently being updated.
      const oldestCleanDay = [...cache.keys()].find(
        (day) => day !== protectedDay && !dirtyDays.has(day)
      );
      if (oldestCleanDay === undefined) break;
      cache.delete(oldestCleanDay);
    }
  }

  function getDayStats(day = todayKey(now())) {
    if (cache.has(day)) return cache.get(day);

    const record = backend.get(METRICS_TABLE, "day", day);
    const stats = record?.data || createEmptyStats(day);
    stats.day = stats.day || day;
    if (!stats.byCommand || typeof stats.byCommand !== "object") stats.byCommand = {};
    cache.set(day, stats);
    trimCache(day);
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

  function trackLatency(durationMs) {
    const value = Number(durationMs);
    if (!Number.isFinite(value) || value < 0) return;
    latencyCount++;
    latencyTotalMs += value;
    latencyMaxMs = Math.max(latencyMaxMs, value);
    latencyLastMs = value;
    recentLatencies.push(value);
    if (recentLatencies.length > 200) recentLatencies.shift();
  }

  function getLatencyStats() {
    if (!recentLatencies.length) {
      return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, lastMs: 0 };
    }
    const sorted = [...recentLatencies].sort((a, b) => a - b);
    const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    return {
      count: latencyCount,
      avgMs: Number((latencyTotalMs / latencyCount).toFixed(2)),
      p50Ms: Number(percentile(0.5).toFixed(2)),
      p95Ms: Number(percentile(0.95).toFixed(2)),
      maxMs: Number(latencyMaxMs.toFixed(2)),
      lastMs: Number(latencyLastMs.toFixed(2))
    };
  }

  function recordCommandSamples(target, commandName, durationMs) {
    const name = String(commandName || "unknown").toLowerCase().slice(0, 64);
    const value = Number(durationMs);
    if (!Number.isFinite(value) || value < 0) return;
    if (!target.has(name)) {
      if (target.size >= MAX_COMMAND_LATENCY_KEYS) {
        const oldest = target.keys().next().value;
        if (oldest !== undefined) target.delete(oldest);
      }
      target.set(name, []);
    }
    const samples = target.get(name);
    samples.push(value);
    if (samples.length > MAX_COMMAND_LATENCY_SAMPLES) samples.shift();
  }

  function summarizeCommandSamples(source, limit = 5) {
    return [...source.entries()]
      .map(([command, samples]) => {
        if (!samples.length) return null;
        const sorted = [...samples].sort((a, b) => a - b);
        const percentile = ratio => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
        const avgMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        return {
          command,
          count: samples.length,
          avgMs: Number(avgMs.toFixed(2)),
          p50Ms: Number(percentile(0.5).toFixed(2)),
          p95Ms: Number(percentile(0.95).toFixed(2)),
          maxMs: Number(Math.max(...samples).toFixed(2))
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.p95Ms - a.p95Ms || b.avgMs - a.avgMs)
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  // End-to-end time: parsing, permissions, cooldown, data loading, handler and reply.
  function trackCommandLatency(commandName, durationMs) {
    recordCommandSamples(commandLatencies, commandName, durationMs);
  }

  // Handler-only time: the command plugin's run() and its awaited work.
  function trackCommandExecutionLatency(commandName, durationMs) {
    recordCommandSamples(commandExecutionLatencies, commandName, durationMs);
  }

  function getMessageLatencyKey(event) {
    const data = event?.data || {};
    const messageId = data.cliMsgId ?? data.msgId;
    if (messageId == null || messageId === "") return null;
    return `${String(event?.threadId ?? data.idTo ?? "")}:${String(messageId)}`;
  }

  function trackIncomingMessage(event, at = performance.now()) {
    const key = getMessageLatencyKey(event);
    if (!key) return false;

    // data.ts is generated by Zalo when the message is sent. Comparing it with
    // wall-clock receipt separates delayed WebSocket delivery from slow bot code.
    const messageTimestamp = normalizeZaloMessageTimestamp(
      event?.data?.ts ?? event?.data?.timestamp
    );
    if (messageTimestamp != null) {
      const ageMs = now() - messageTimestamp;
      // Ignore implausible timestamps and historical/replayed events. The
      // live listener only calls this for real-time websocket messages.
      if (ageMs >= -60_000 && ageMs <= 24 * 60 * 60 * 1000) {
        recordCommandSamples(messageDeliveryAgeLatencies, "zalo-server-to-bot", Math.max(0, ageMs));
      }
    }

    const timestamp = Number(at);
    incomingMessageAt.delete(key);
    firstResponseStartedMessages.delete(key);
    incomingMessageAt.set(key, Number.isFinite(timestamp) ? timestamp : performance.now());
    while (incomingMessageAt.size > MAX_PENDING_FIRST_RESPONSES) {
      const oldest = incomingMessageAt.keys().next().value;
      if (oldest === undefined) break;
      incomingMessageAt.delete(oldest);
      firstResponseStartedMessages.delete(oldest);
    }
    return true;
  }

  // Records the moment the bot starts its first outgoing Zalo request.
  // Keep the incoming timestamp until the send resolves so completion latency
  // remains a separate measurement.
  function trackFirstResponseStartLatency(event, at = performance.now(), commandName = null) {
    const key = getMessageLatencyKey(event);
    if (!key || !incomingMessageAt.has(key) || firstResponseStartedMessages.has(key)) return false;

    firstResponseStartedMessages.add(key);
    const startedAt = incomingMessageAt.get(key);
    const timestamp = Number(at);
    const elapsed = Math.max(0, (Number.isFinite(timestamp) ? timestamp : performance.now()) - startedAt);
    recordCommandSamples(firstResponseStartLatencies, "first_response_start", elapsed);
    const command = String(commandName || "").trim().toLowerCase();
    if (command) {
      recordCommandSamples(firstResponseStartLatencies, `first_response_start:${command}`, elapsed);
    }
    return true;
  }

  function trackFirstResponseLatency(event, at = performance.now(), commandName = null) {
    const key = getMessageLatencyKey(event);
    if (!key || !incomingMessageAt.has(key)) return false;
    const startedAt = incomingMessageAt.get(key);
    incomingMessageAt.delete(key);
    firstResponseStartedMessages.delete(key);
    const timestamp = Number(at);
    const elapsed = Math.max(0, (Number.isFinite(timestamp) ? timestamp : performance.now()) - startedAt);
    recordCommandSamples(firstResponseLatencies, "first_response", elapsed);
    const command = String(commandName || "").trim().toLowerCase();
    if (command) {
      recordCommandSamples(firstResponseLatencies, `first_response:${command}`, elapsed);
    }
    return true;
  }

  function trackListenerStageLatency(stage, durationMs) {
    recordCommandSamples(listenerStageLatencies, stage, durationMs);
  }

  function getListenerStageLatencyStats(limit = 5) {
    return summarizeCommandSamples(listenerStageLatencies, limit);
  }

  function trackZaloApiLatency(method, durationMs) {
    recordCommandSamples(zaloApiLatencies, method, durationMs);
  }

  function getZaloApiLatencyStats(limit = 5) {
    return summarizeCommandSamples(zaloApiLatencies, limit);
  }

  function trackZaloSdkPhaseLatency(phase, durationMs) {
    recordCommandSamples(zaloSdkPhaseLatencies, phase, durationMs);
  }

  function getZaloSdkPhaseLatencyStats(limit = 6) {
    return summarizeCommandSamples(zaloSdkPhaseLatencies, limit);
  }

  function getFirstResponseLatencyStats() {
    return summarizeCommandSamples(firstResponseLatencies, 1)[0] || null;
  }

  function getFirstResponseStartLatencyStats() {
    return summarizeCommandSamples(firstResponseStartLatencies, 1)[0] || null;
  }

  function getMessageDeliveryAgeStats() {
    return summarizeCommandSamples(messageDeliveryAgeLatencies, 1)[0] || null;
  }

  function getFirstResponseLatencyByCommandStats(limit = 10) {
    const prefix = "first_response:";
    return summarizeCommandSamples(firstResponseLatencies, MAX_COMMAND_LATENCY_KEYS)
      .filter(item => item.command.startsWith(prefix))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map(item => ({ ...item, command: item.command.slice(prefix.length) }));
  }

  function getFirstResponseStartLatencyByCommandStats(limit = 10) {
    const prefix = "first_response_start:";
    return summarizeCommandSamples(firstResponseStartLatencies, MAX_COMMAND_LATENCY_KEYS)
      .filter(item => item.command.startsWith(prefix))
      .slice(0, Math.max(0, Number(limit) || 0))
      .map(item => ({ ...item, command: item.command.slice(prefix.length) }));
  }

  function getCommandLatencyStats(limit = 5) {
    return summarizeCommandSamples(commandLatencies, limit);
  }

  function getCommandExecutionLatencyStats(limit = 5) {
    return summarizeCommandSamples(commandExecutionLatencies, limit);
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

  return {
    track, trackLatency, trackCommandLatency, trackCommandExecutionLatency,
    getCommandLatencyStats, getCommandExecutionLatencyStats, getLatencyStats,
    trackIncomingMessage, trackFirstResponseStartLatency, trackFirstResponseLatency,
    getFirstResponseStartLatencyStats, getFirstResponseStartLatencyByCommandStats,
    getFirstResponseLatencyStats, getFirstResponseLatencyByCommandStats,
    getMessageDeliveryAgeStats, trackListenerStageLatency, getListenerStageLatencyStats,
    trackZaloApiLatency, getZaloApiLatencyStats, trackZaloSdkPhaseLatency,
    getZaloSdkPhaseLatencyStats, getDayStats, topCommands, allDays, flush, dispose
  };
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
  normalizeZaloMessageTimestamp,
  todayKey,
  audit,
  readAudit
};
