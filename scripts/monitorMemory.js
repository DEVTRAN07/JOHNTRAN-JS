/**
 * monitorMemory.js
 *
 * Memory + cache monitor for the John Tran bot.
 * - Logs memory usage (RSS, heap used, heap total, external) every 30s
 * - Logs cache stats (threadCache, userCache, music caches)
 * - Triggers GC if heap used > 200MB
 * - Can run standalone (`node scripts/monitorMemory.js`) or be imported
 */

const path = require("path");
const ROOT = path.join(__dirname, "..");

const INTERVAL_MS = 30 * 1000;
const GC_HEAP_USED_THRESHOLD = 200 * 1024 * 1024; // 200MB

let timer = null;
let running = false;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "N/A";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return value.toFixed(2) + " " + units[unitIndex];
}

function memoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  };
}

function maybeGC(heapUsed) {
  if (heapUsed > GC_HEAP_USED_THRESHOLD && typeof global.gc === "function") {
    try {
      global.gc();
      return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function collectCacheStats() {
  try {
    const cache = require(path.join(ROOT, "core/cache"));
    if (typeof cache.allStats === "function") {
      return cache.allStats();
    }
    return null;
  } catch {
    return null;
  }
}

function snapshot() {
  const mem = memoryUsage();
  const caches = collectCacheStats();
  return { timestamp: Date.now(), mem, caches };
}

function logSnapshot(snap) {
  const m = snap.mem;
  const lines = [];
  lines.push("[monitorMemory] Memory: RSS=" + formatBytes(m.rss) +
    " heapUsed=" + formatBytes(m.heapUsed) +
    " heapTotal=" + formatBytes(m.heapTotal) +
    " external=" + formatBytes(m.external) +
    " arrayBuffers=" + formatBytes(m.arrayBuffers));

  if (snap.caches) {
    const cacheLines = Object.entries(snap.caches).map(([name, s]) => {
      return name + "(size=" + s.size + "/" + s.max + ", hits=" + s.hits + ", misses=" + s.misses + ")";
    });
    lines.push("[monitorMemory] Caches: " + cacheLines.join(" | "));
  }

  const gcTriggered = maybeGC(m.heapUsed);
  if (gcTriggered) {
    lines.push("[monitorMemory] GC triggered (heapUsed > 200MB)");
  }

  console.log(lines.join("\n"));
  return snap;
}

function tick() {
  const snap = snapshot();
  logSnapshot(snap);
}

function start(options = {}) {
  if (running) return;
  const interval = options.intervalMs || INTERVAL_MS;
  running = true;
  // immediate first snapshot
  tick();
  timer = setInterval(tick, interval);
  return timer;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
}

function isRunning() {
  return running;
}

// Standalone mode
if (require.main === module) {
  const logger = require(path.join(ROOT, "utils/logger"));
  logger.log("monitorMemory started (interval=" + INTERVAL_MS / 1000 + "s, GC threshold=" + formatBytes(GC_HEAP_USED_THRESHOLD) + ")", "info");

  start();

  // graceful shutdown
  const shutdown = (signal) => {
    logger.log("monitorMemory stopping (" + signal + ")", "info");
    stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = {
  start,
  stop,
  isRunning,
  snapshot,
  logSnapshot,
  memoryUsage,
  formatBytes,
  INTERVAL_MS,
  GC_HEAP_USED_THRESHOLD
};
