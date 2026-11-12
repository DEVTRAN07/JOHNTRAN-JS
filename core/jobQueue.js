"use strict";

// Bounded in-process queues. A global worker ceiling prevents independent
// lanes from collectively exhausting CPU/RAM. Pending work is bounded too.
const DEFAULT_LANES = {
  sticker: { concurrency: 1, maxPending: 30, maxInFlight: 31 },
  image: { concurrency: 1, maxPending: 20, maxInFlight: 21 },
  gif: { concurrency: 1, maxPending: 12, maxInFlight: 13 },
  video: { concurrency: 1, maxPending: 8, maxInFlight: 9 },
  download: { concurrency: 2, maxPending: 24, maxInFlight: 26 },
  "music-search": { concurrency: 2, maxPending: 40, maxInFlight: 42 },
  "music-audio": { concurrency: 1, maxPending: 12, maxInFlight: 13 },
  canvas: { concurrency: 1, maxPending: 16, maxInFlight: 17 },
  media: { concurrency: 1, maxPending: 20, maxInFlight: 21 }
};

const lanes = new Map();
const GLOBAL_CONCURRENCY = positiveEnv("JT_JOB_GLOBAL_CONCURRENCY", 4);
const GLOBAL_MAX_PENDING = positiveEnv("JT_JOB_GLOBAL_MAX_PENDING", 80);
let globalActive = 0;
let globalPending = 0;
let sequence = 0;

function positiveEnv(name, fallback) {
  const number = Number(process.env[name]);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
function nonNegativeInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getLane(name, options = {}) {
  let lane = lanes.get(name);
  if (!lane) {
    const defaults = DEFAULT_LANES[name] || { concurrency: 1, maxPending: 20, maxInFlight: 21 };
    lane = {
      concurrency: positiveInt(options.concurrency, defaults.concurrency),
      maxPending: positiveInt(options.maxPending, defaults.maxPending),
      maxInFlight: positiveInt(options.maxInFlight, defaults.maxInFlight),
      active: 0,
      pending: [],
      inFlight: new Map(),
      running: new Map(),
      completed: 0,
      failed: 0,
      rejected: 0,
      retried: 0
    };
    lanes.set(name, lane);
  }
  return lane;
}

function insertByPriority(lane, job) {
  const index = lane.pending.findIndex(item => item.priority < job.priority);
  if (index === -1) lane.pending.push(job);
  else lane.pending.splice(index, 0, job);
}

async function runWithRetry(job, lane) {
  let attempt = 0;
  while (true) {
    try {
      return await job.run();
    } catch (error) {
      if (attempt >= job.retries) throw error;
      if (job.retryOn && !job.retryOn(error, attempt + 1)) throw error;
      const wait = Math.min(job.retryDelayMs * (2 ** attempt), 10000);
      attempt++;
      lane.retried++;
      await delay(wait);
    }
  }
}

function drain(lane, laneName) {
  while (globalActive < GLOBAL_CONCURRENCY && lane.active < lane.concurrency && lane.pending.length) {
    const job = lane.pending.shift();
    globalPending = Math.max(0, globalPending - 1);
    lane.active++;
    globalActive++;
    job.startedAt = Date.now();
    lane.running.set(job.id, job);

    runWithRetry(job, lane).then(
      value => {
        lane.completed++;
        job.resolve(value);
      },
      error => {
        lane.failed++;
        job.reject(error);
      }
    ).finally(() => {
      lane.active--;
      globalActive--;
      lane.running.delete(job.id);
      if (job.key && lane.inFlight.get(job.key) === job.promise) lane.inFlight.delete(job.key);
      drainAll();
    });
  }
}

function drainAll() {
  // Round-robin start point avoids permanently favoring the first lane.
  const entries = [...lanes.entries()];
  if (!entries.length) return;
  const offset = sequence++ % entries.length;
  for (let index = 0; index < entries.length && globalActive < GLOBAL_CONCURRENCY; index++) {
    const [name, lane] = entries[(offset + index) % entries.length];
    drain(lane, name);
  }
}

function enqueue(laneName, run, options = {}) {
  if (typeof run !== "function") return Promise.reject(new TypeError("job must be a function"));
  const name = String(laneName);
  const lane = getLane(name, options);
  const key = options.key == null ? null : String(options.key);

  // Coalesce duplicate work while it is queued or running.
  if (key && lane.inFlight.has(key)) return lane.inFlight.get(key);

  if (globalPending >= GLOBAL_MAX_PENDING) {
    lane.rejected++;
    return Promise.reject(new Error("Hệ thống đang có quá nhiều tác vụ chờ. Vui lòng thử lại sau."));
  }
  if (lane.pending.length >= lane.maxPending) {
    lane.rejected++;
    return Promise.reject(new Error("Hàng đợi đang quá tải, vui lòng thử lại sau."));
  }
  if (lane.active + lane.pending.length >= lane.maxInFlight) {
    lane.rejected++;
    return Promise.reject(new Error("Hệ thống đang xử lý quá nhiều tác vụ, vui lòng thử lại sau."));
  }

  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const job = {
    id: ++sequence,
    run,
    resolve,
    reject,
    promise,
    key,
    label: String(options.label || name).slice(0, 64),
    priority: Number.isFinite(Number(options.priority)) ? Number(options.priority) : 0,
    retries: nonNegativeInt(options.retries, 0),
    retryDelayMs: Math.min(positiveInt(options.retryDelayMs, 350), 10000),
    retryOn: typeof options.retryOn === "function" ? options.retryOn : null,
    queuedAt: Date.now(),
    startedAt: null
  };

  if (key) lane.inFlight.set(key, promise);
  globalPending++;
  insertByPriority(lane, job);
  drainAll();
  return promise;
}

function stats() {
  const snapshot = Object.fromEntries([...lanes.entries()].map(([name, lane]) => [name, {
    active: lane.active,
    pending: lane.pending.length,
    concurrency: lane.concurrency,
    maxPending: lane.maxPending,
    maxInFlight: lane.maxInFlight,
    completed: lane.completed,
    failed: lane.failed,
    rejected: lane.rejected,
    retried: lane.retried,
    oldestPendingMs: lane.pending.length
      ? Math.max(0, Date.now() - lane.pending[0].queuedAt) : 0,
    runningJobs: [...lane.running.values()].map(job => ({
      label: job.label,
      runningForMs: job.startedAt ? Math.max(0, Date.now() - job.startedAt) : 0,
      retries: job.retries
    }))
  }]));
  // Preserve the existing stats()[laneName] shape and add global pressure.
  snapshot.global = {
    active: globalActive,
    pending: globalPending,
    concurrency: GLOBAL_CONCURRENCY,
    maxPending: GLOBAL_MAX_PENDING
  };
  return snapshot;
}

module.exports = {
  enqueue,
  stats,
  DEFAULT_LANES,
  GLOBAL_CONCURRENCY,
  GLOBAL_MAX_PENDING
};
