const { Worker } = require("worker_threads");
const path = require("path");

const WORKERS_DIR = path.join(__dirname, "workers");
const DEFAULT_POOL_SIZE = 4;
const DEFAULT_MAX_PENDING = Math.max(1, Number(process.env.JT_WORKER_MAX_PENDING) || 32);
const DEFAULT_RESTART_WINDOW_MS = Math.max(1000, Number(process.env.JT_WORKER_RESTART_WINDOW_MS) || 10 * 60 * 1000);
const DEFAULT_MAX_RESTARTS = Math.max(1, Number(process.env.JT_WORKER_MAX_RESTARTS) || 5);
const DEFAULT_RESTART_DELAY_MS = Math.max(10, Number(process.env.JT_WORKER_RESTART_DELAY_MS) || 1000);
const DEFAULT_RESTART_MAX_DELAY_MS = Math.max(DEFAULT_RESTART_DELAY_MS, Number(process.env.JT_WORKER_RESTART_MAX_DELAY_MS) || 30000);
const DEFAULT_CIRCUIT_COOLDOWN_MS = Math.max(1000, Number(process.env.JT_WORKER_CIRCUIT_COOLDOWN_MS) || 60000);
const pools = new Map();
let shuttingDown = false;

function terminateWorker(worker) {
  try { return worker.terminate(); } catch { return undefined; }
}

function createWorker(pool, scriptName) {
  const worker = new Worker(path.join(WORKERS_DIR, `${scriptName}.js`));
  const record = { worker, busy: false, dead: false, task: null };
  pool.workers.push(record);

  worker.on("message", (result) => {
    const task = record.task;
    if (!task || task.settled) return;
    pool.restartAttempt = 0;
    pool.lastWorkerHealthyAt = Date.now();
    clearTaskTimer(task);
    record.task = null;
    record.busy = false;

    if (result && result.ok === false) {
      const error = new Error(result.error || `worker ${pool.scriptName} failed`);
      if (result.stack) error.stack = result.stack;
      settle(task, error);
      pool.failed++;
    } else {
      let data = result == null || result.data === undefined ? result : result.data;
      if (data && typeof data === "object" && data.buffer &&
          typeof data.buffer === "object" && !Buffer.isBuffer(data.buffer)) {
        data.buffer = Buffer.from(data.buffer);
      }
      settle(task, null, data);
      pool.completed++;
    }
    pump(pool);
  });

  worker.on("error", (error) => { pool.failed++; retireWorker(pool, record, error); });
  worker.on("exit", (code) => {
    if (!record.dead) {
      pool.failed++;
      retireWorker(pool, record, new Error(
        `worker ${pool.scriptName} exited before responding (code ${code})`
      ));
    }
  });
  return record;
}

function clearTaskTimer(task) {
  if (task.timer) {
    clearTimeout(task.timer);
    task.timer = null;
  }
}

function settle(task, error, value) {
  if (task.settled) return;
  task.settled = true;
  clearTaskTimer(task);
  if (error) task.reject(error);
  else task.resolve(value);
}

function pruneWorkerFailures(pool, now = Date.now()) {
  const cutoff = now - pool.restartWindowMs;
  pool.restartHistory = pool.restartHistory.filter(timestamp => timestamp > cutoff);
  return pool.restartHistory.length;
}

function schedulePoolWakeup(pool, waitMs) {
  if (pool.restartTimer || shuttingDown) return;
  const timer = setTimeout(() => {
    if (pool.restartTimer !== timer) return;
    pool.restartTimer = null;
    pump(pool);
  }, Math.max(1, Number(waitMs) || 1));
  timer.unref?.();
  pool.restartTimer = timer;
}

function retireWorker(pool, record, error) {
  if (record.dead) return;
  record.dead = true;
  record.busy = false;
  const task = record.task;
  record.task = null;
  if (task) settle(task, error || new Error(`worker ${pool.scriptName} stopped`));

  const now = Date.now();
  pool.restartHistory.push(now);
  const recentFailures = pruneWorkerFailures(pool, now);
  pool.lastWorkerFailureAt = now;
  pool.restartAttempt = Math.min(10, (pool.restartAttempt || 0) + 1);

  if (recentFailures > pool.maxRestartsInWindow) {
    const oldest = pool.restartHistory[0] || now;
    pool.circuitOpenUntil = Math.max(now + pool.circuitCooldownMs, oldest + pool.restartWindowMs + 1);
    pool.nextRestartAt = pool.circuitOpenUntil;
    const circuitError = new Error(`Worker pool ${pool.scriptName} tạm nghỉ sau ${recentFailures} worker crash trong cửa sổ giới hạn.`);
    for (const queued of pool.pending.splice(0)) {
      pool.rejected++;
      settle(queued, circuitError);
    }
    try {
      require("../utils/logger").log(circuitError.message, "warn", {
        source: "worker-circuit-breaker",
        eventName: pool.scriptName
      });
    } catch { /* Diagnostics must never affect worker recovery. */ }
  } else {
    const delay = Math.min(pool.restartDelayMs * (2 ** Math.max(0, pool.restartAttempt - 1)), pool.restartMaxDelayMs);
    pool.nextRestartAt = now + delay;
  }
  pump(pool);
}

function getOrCreatePool(scriptName, size) {
  let pool = pools.get(scriptName);
  if (!pool) {
    pool = {
      scriptName, size, maxPending: DEFAULT_MAX_PENDING,
      workers: [], pending: [], pumping: false,
      completed: 0, failed: 0, rejected: 0,
      restartHistory: [], restartAttempt: 0,
      restartWindowMs: DEFAULT_RESTART_WINDOW_MS,
      maxRestartsInWindow: DEFAULT_MAX_RESTARTS,
      restartDelayMs: DEFAULT_RESTART_DELAY_MS,
      restartMaxDelayMs: DEFAULT_RESTART_MAX_DELAY_MS,
      circuitCooldownMs: DEFAULT_CIRCUIT_COOLDOWN_MS,
      circuitOpenUntil: 0, nextRestartAt: 0,
      restartTimer: null, lastWorkerFailureAt: 0,
      lastWorkerHealthyAt: 0
    };
    pools.set(scriptName, pool);
  } else {
    pool.size = Math.max(pool.size, size);
  }
  return pool;
}

function ensureWorkers(pool) {
  if (shuttingDown) return;
  const aliveRecords = pool.workers.filter((record) => !record.dead);
  const busy = aliveRecords.filter((record) => record.busy).length;
  const idle = aliveRecords.length - busy;
  const required = busy + Math.min(pool.size - busy, Math.max(0, pool.pending.length - idle));
  if (aliveRecords.length >= required) return;

  const now = Date.now();
  const recentFailures = pruneWorkerFailures(pool, now);
  if (recentFailures > pool.maxRestartsInWindow) {
    const oldest = pool.restartHistory[0] || now;
    pool.circuitOpenUntil = Math.max(pool.circuitOpenUntil || 0, now + pool.circuitCooldownMs, oldest + pool.restartWindowMs + 1);
  }

  const waitUntil = Math.max(pool.nextRestartAt || 0, pool.circuitOpenUntil || 0);
  if (waitUntil > now) {
    schedulePoolWakeup(pool, waitUntil - now);
    return;
  }

  for (let i = aliveRecords.length; i < required; i++) createWorker(pool, pool.scriptName);
}

function pump(pool) {
  if (pool.pumping || shuttingDown) return;
  pool.pumping = true;
  try {
    ensureWorkers(pool);
    while (pool.pending.length) {
      const record = pool.workers.find((item) => !item.dead && !item.busy);
      if (!record) break;

      const task = pool.pending.shift();
      record.busy = true;
      record.task = task;
      if (task.timeout > 0) {
        task.timer = setTimeout(() => {
          if (task.settled) return;
          const error = new Error(
            `workerPool: timeout (${task.timeout}ms) for ${pool.scriptName}`
          );
          pool.failed++;
          record.task = null;
          record.busy = false;
          retireWorker(pool, record, error);
          terminateWorker(record.worker);
          settle(task, error);
          pump(pool);
        }, task.timeout);
      }

      try {
        record.worker.postMessage(task.data);
      } catch (error) {
        pool.failed++;
        record.task = null;
        record.busy = false;
        retireWorker(pool, record, error);
        terminateWorker(record.worker);
        settle(task, error);
        ensureWorkers(pool);
      }
    }
  } finally {
    pool.pumping = false;
  }
}

function runInWorker(scriptName, data, options = {}) {
  if (shuttingDown) return Promise.reject(new Error("workerPool: shutting down"));
  const size = Math.max(1, Number(options.size) || DEFAULT_POOL_SIZE);
  const pool = getOrCreatePool(scriptName, size);
  if (Number.isFinite(Number(options.maxRestartsInWindow))) pool.maxRestartsInWindow = Math.max(1, Number(options.maxRestartsInWindow));
  if (Number.isFinite(Number(options.restartWindowMs))) pool.restartWindowMs = Math.max(100, Number(options.restartWindowMs));
  if (Number.isFinite(Number(options.restartDelayMs))) pool.restartDelayMs = Math.max(1, Number(options.restartDelayMs));
  if (Number.isFinite(Number(options.restartMaxDelayMs))) pool.restartMaxDelayMs = Math.max(pool.restartDelayMs, Number(options.restartMaxDelayMs));
  if (Number.isFinite(Number(options.circuitCooldownMs))) pool.circuitCooldownMs = Math.max(10, Number(options.circuitCooldownMs));
  const now = Date.now();
  if (pool.circuitOpenUntil > now) {
    pool.rejected++;
    return Promise.reject(new Error(`Worker pool ${scriptName} đang tạm nghỉ sau nhiều lần worker crash.`));
  }
  const maxPending = Math.max(1, Number(options.maxPending) || pool.maxPending);
  pool.maxPending = Math.min(pool.maxPending, maxPending);
  if (pool.pending.length >= pool.maxPending) {
    pool.rejected++;
    return Promise.reject(new Error(`Hàng đợi worker ${scriptName} đang quá tải. Vui lòng thử lại sau.`));
  }

  return new Promise((resolve, reject) => {
    pool.pending.push({
      data,
      resolve,
      reject,
      timeout: Math.max(0, Number(options.timeout) || 0),
      settled: false,
      timer: null
    });
    pump(pool);
  });
}

async function shutdown() {
  shuttingDown = true;
  const terminations = [];
  for (const pool of pools.values()) {
    if (pool.restartTimer) clearTimeout(pool.restartTimer);
    pool.restartTimer = null;
    for (const task of pool.pending.splice(0)) {
      settle(task, new Error("workerPool: shutting down"));
    }
    for (const record of pool.workers) {
      if (record.task) {
        settle(record.task, new Error("workerPool: shutting down"));
        record.task = null;
      }
      if (!record.dead) terminations.push(terminateWorker(record.worker));
      record.dead = true;
      record.busy = false;
    }
  }
  await Promise.all(terminations);
  pools.clear();
}

function poolSize(scriptName) {
  const pool = pools.get(scriptName);
  return pool ? pool.workers.filter((record) => !record.dead).length : 0;
}

function stats() {
  return Object.fromEntries([...pools.entries()].map(([name, pool]) => [name, {
    workers: pool.workers.filter(record => !record.dead).length,
    busy: pool.workers.filter(record => !record.dead && record.busy).length,
    pending: pool.pending.length,
    maxPending: pool.maxPending,
    completed: pool.completed,
    failed: pool.failed,
    rejected: pool.rejected,
    restartCount: pruneWorkerFailures(pool),
    restartAttempt: pool.restartAttempt,
    lastWorkerFailureAt: pool.lastWorkerFailureAt || null,
    nextRestartAt: pool.nextRestartAt || null,
    circuitOpenUntil: pool.circuitOpenUntil || null,
    circuitOpen: Boolean(pool.circuitOpenUntil && pool.circuitOpenUntil > Date.now())
  }]));
}

module.exports = { runInWorker, shutdown, poolSize, stats, DEFAULT_MAX_PENDING };
