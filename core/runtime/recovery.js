"use strict";

const os = require("os");
const fs = require("fs");
const { monitorEventLoopDelay } = require("node:perf_hooks");

const LOOP_RESOLUTION_MS = Math.max(10, Number(process.env.JT_RECOVERY_LOOP_RESOLUTION_MS) || 20);
const LOOP_WARN_MS = Math.max(50, Number(process.env.JT_RECOVERY_LOOP_WARN_MS) || 250);
const LOOP_CRITICAL_MS = Math.max(LOOP_WARN_MS, Number(process.env.JT_RECOVERY_LOOP_CRITICAL_MS) || 1000);
const RSS_WARN_RATIO = clamp(Number(process.env.JT_RECOVERY_RSS_WARN_RATIO) || 0.8, 0.1, 0.99);
const RSS_CRITICAL_RATIO = clamp(Number(process.env.JT_RECOVERY_RSS_CRITICAL_RATIO) || 0.92, RSS_WARN_RATIO, 0.999);
const QUEUE_WARN_RATIO = clamp(Number(process.env.JT_RECOVERY_QUEUE_WARN_RATIO) || 0.75, 0.1, 0.99);
const CPU_WARN_PERCENT = clamp(Number(process.env.JT_RECOVERY_CPU_WARN_PERCENT) || 85, 10, 100);
const COMPONENT_TTL_MS = 5 * 60 * 1000;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function safeRequire(path, fallback) {
  try { return require(path); } catch { return fallback; }
}

function readCgroupMemory() {
  const candidates = [
    ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"],
    ["/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]
  ];
  for (const [limitPath, usedPath] of candidates) {
    try {
      const rawLimit = fs.readFileSync(limitPath, "utf8").trim();
      const rawUsed = fs.readFileSync(usedPath, "utf8").trim();
      if (rawLimit === "max") continue;
      const limit = Number(rawLimit);
      const used = Number(rawUsed);
      if (Number.isFinite(limit) && limit > 0 && limit < 1e15 && Number.isFinite(used) && used >= 0) {
        return { limitBytes: limit, usedBytes: used, source: "cgroup" };
      }
    } catch {
      // Try the next cgroup layout or fall back to host memory.
    }
  }
  const total = os.totalmem();
  return { limitBytes: total, usedBytes: total - os.freemem(), source: "host" };
}

const eventLoop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
try { eventLoop.enable(); } catch {}

let previousCpu = process.cpuUsage();
let previousCpuAt = process.hrtime.bigint();
let memorySnapshot = readCgroupMemory();
let memoryCheckedAt = Date.now();
const componentStates = new Map();

function reportComponent(name, state = {}) {
  const key = String(name || "").trim().slice(0, 64);
  if (!key) return null;
  const record = {
    name: key,
    status: ["healthy", "connecting", "recovering", "degraded", "critical", "unknown"].includes(state.status)
      ? state.status : "unknown",
    updatedAt: Date.now(),
    ...state
  };
  delete record.name;
  componentStates.set(key, record);
  while (componentStates.size > 32) {
    const oldest = componentStates.keys().next().value;
    if (!oldest) break;
    componentStates.delete(oldest);
  }
  return { name: key, ...record };
}

function getComponentStates(now = Date.now()) {
  const output = [];
  for (const [name, state] of componentStates) {
    if (now - state.updatedAt > COMPONENT_TTL_MS) {
      componentStates.delete(name);
      continue;
    }
    output.push({ name, ...state });
  }
  return output;
}

function sampleCpu() {
  const now = process.hrtime.bigint();
  const elapsedMicros = Number(now - previousCpuAt) / 1000;
  const usage = process.cpuUsage(previousCpu);
  previousCpu = process.cpuUsage();
  previousCpuAt = now;
  const usedMicros = Math.max(0, Number(usage.user) + Number(usage.system));
  const cores = Math.max(1, os.cpus().length);
  const percent = elapsedMicros > 0
    ? clamp((usedMicros / elapsedMicros / cores) * 100, 0, 100)
    : 0;
  return Number(percent.toFixed(1));
}

function collectRecoverySnapshot(options = {}) {
  const now = typeof options.now === "function" ? options.now() : Date.now();
  if (now - memoryCheckedAt >= 30000) {
    memorySnapshot = readCgroupMemory();
    memoryCheckedAt = now;
  }

  const memory = process.memoryUsage();
  const cpuPercent = sampleCpu();
  const rssRatio = memorySnapshot.limitBytes > 0 ? memory.rss / memorySnapshot.limitBytes : 0;
  const eventLoopP95Ms = Number.isFinite(eventLoop.percentile(95))
    ? Number((eventLoop.percentile(95) / 1e6).toFixed(1)) : 0;
  const eventLoopMaxMs = Number.isFinite(eventLoop.max)
    ? Number((eventLoop.max / 1e6).toFixed(1)) : 0;
  eventLoop.reset();

  const jobs = safeRequire("../jobQueue", { stats: () => ({ global: { active: 0, pending: 0, maxPending: 0 } }) }).stats();
  const workers = safeRequire("../workerPool", { stats: () => ({}) }).stats();
  const databaseModule = safeRequire("./adapters/database", null);
  const database = options.databaseStatus ||
    databaseModule?.db?.getStatus?.() ||
    databaseModule?.getStatus?.() ||
    null;

  const alerts = [];
  const components = getComponentStates(now);
  const pending = Number(jobs?.global?.pending) || 0;
  const maxPending = Number(jobs?.global?.maxPending) || 0;
  const workerPools = Object.entries(workers || {});
  const workerPending = workerPools.reduce((sum, [, pool]) => sum + (Number(pool.pending) || 0), 0);
  const workerCircuits = workerPools.filter(([, pool]) => pool.circuitOpen === true);
  const workerBacklogs = workerPools.filter(([, pool]) =>
    Number(pool.maxPending) > 0 && Number(pool.pending) >= Number(pool.maxPending) * QUEUE_WARN_RATIO
  );

  if (cpuPercent >= CPU_WARN_PERCENT) {
    alerts.push({ severity: "warning", code: "cpu-high", message: "CPU tiến trình đang sử dụng cao; theo dõi thời gian kéo dài trước khi can thiệp." });
  }
  if (rssRatio >= RSS_CRITICAL_RATIO) {
    alerts.push({ severity: "critical", code: "memory-critical", message: "RAM tiến trình gần chạm giới hạn bộ nhớ container." });
  } else if (rssRatio >= RSS_WARN_RATIO) {
    alerts.push({ severity: "warning", code: "memory-high", message: "RAM tiến trình đang sử dụng cao so với giới hạn container." });
  }

  if (eventLoopP95Ms >= LOOP_CRITICAL_MS) {
    alerts.push({ severity: "critical", code: "event-loop-critical", message: "Event loop bị nghẽn nghiêm trọng." });
  } else if (eventLoopP95Ms >= LOOP_WARN_MS) {
    alerts.push({ severity: "warning", code: "event-loop-slow", message: "Event loop đang có độ trễ cao." });
  }

  if (maxPending > 0 && pending >= maxPending * QUEUE_WARN_RATIO) {
    alerts.push({ severity: "warning", code: "job-queue-backlog", message: "Hàng đợi tác vụ gần chạm giới hạn; hệ thống đang áp dụng backpressure." });
  }
  if (workerBacklogs.length) {
    alerts.push({
      severity: "warning",
      code: "worker-queue-backlog",
      message: "Một hoặc nhiều worker queue gần chạm giới hạn.",
      pools: workerBacklogs.map(([name]) => name)
    });
  }
  if (workerCircuits.length) {
    alerts.push({
      severity: "warning",
      code: "worker-circuit-open",
      message: "Một số worker pool đang tạm nghỉ để tránh vòng lặp crash.",
      pools: workerCircuits.map(([name]) => name)
    });
  }
  if (workerPending > 0) {
    alerts.push({ severity: "info", code: "worker-queue-pending", message: "Có tác vụ đang chờ worker.", pending: workerPending });
  }

  if (database?.driver === "supabase") {
    if (!database.ok && database.classified === "config") {
      alerts.push({ severity: "critical", code: "database-config", message: database.syncError || "Supabase cần kiểm tra cấu hình hoặc schema." });
    } else if (!database.ok) {
      alerts.push({ severity: "warning", code: "database-degraded", message: database.syncError || "Supabase đang lỗi kết nối; retry theo backoff." });
    }
    if ((Number(database.retryQueueSize) || 0) > 0) {
      alerts.push({
        severity: "warning",
        code: "database-pending-writes",
        message: "Có bản ghi đang chờ đồng bộ lại; dữ liệu local chưa được xác nhận từ Supabase.",
        pending: Number(database.retryQueueSize) || 0
      });
    }
  } else if (database && database.ok === false) {
    alerts.push({ severity: "critical", code: "database-unhealthy", message: database.lastFlushError || database.syncError || database.error || "Database không sẵn sàng." });
  }

  for (const component of components) {
    if (component.status === "critical") {
      alerts.push({ severity: "critical", code: "component-" + component.name, message: component.message || (component.name + " đang lỗi nghiêm trọng.") });
    } else if (component.status === "degraded" || component.status === "recovering") {
      alerts.push({ severity: "warning", code: "component-" + component.name, message: component.message || (component.name + " đang phục hồi.") });
    }
  }

  const status = alerts.some(item => item.severity === "critical")
    ? "critical"
    : alerts.some(item => item.severity === "warning")
      ? "degraded" : "healthy";

  return {
    status,
    checkedAt: new Date(now).toISOString(),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      cpuPercent,
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        limitBytes: memorySnapshot.limitBytes,
        usedBytes: memorySnapshot.usedBytes,
        rssRatio: Number((rssRatio * 100).toFixed(1)),
        source: memorySnapshot.source
      },
      eventLoop: { p95Ms: eventLoopP95Ms, maxMs: eventLoopMaxMs }
    },
    database: database ? {
      driver: database.driver || "unknown",
      ok: database.ok === true,
      consecutiveFailures: Number(database.consecutiveFailures) || 0,
      nextSyncDelayMs: Number(database.nextSyncDelayMs) || null,
      retryQueueSize: Number(database.retryQueueSize) || 0,
      lastSyncAgeMs: Number(database.lastSyncAgeMs) || null,
      classified: database.classified || null
    } : null,
    queues: { jobs: jobs || {}, workers: workers || {}, workerPending },
    components,
    alerts,
    policy: {
      automaticActions: "safe-retry-only",
      destructiveActions: false,
      groupBotStateChanges: false,
      processRestartByResourcePressure: false
    }
  };
}

module.exports = {
  collectRecoverySnapshot,
  reportComponent,
  getComponentStates,
  readCgroupMemory,
  LOOP_WARN_MS,
  LOOP_CRITICAL_MS,
  RSS_WARN_RATIO,
  RSS_CRITICAL_RATIO,
  QUEUE_WARN_RATIO,
  CPU_WARN_PERCENT
};
