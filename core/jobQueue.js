// Bounded in-process queues. A global worker ceiling prevents several
// independent lanes from collectively exhausting CPU/RAM.
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
let globalActive = 0;
let sequence = 0;

function positiveEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
function getLane(name, options = {}) {
  let lane = lanes.get(name);
  if (!lane) {
    const defaults = DEFAULT_LANES[name] || { concurrency: 1, maxPending: 20, maxInFlight: 21 };
    lane = {
      concurrency: positiveInt(options.concurrency, defaults.concurrency),
      maxPending: positiveInt(options.maxPending, defaults.maxPending),
      maxInFlight: positiveInt(options.maxInFlight, defaults.maxInFlight),
      active: 0, pending: [], inFlight: new Map(),
      completed: 0, failed: 0, rejected: 0
    };
    lanes.set(name, lane);
  }
  return lane;
}
function insertByPriority(lane, job) {
  const index = lane.pending.findIndex((item) => item.priority < job.priority);
  if (index === -1) lane.pending.push(job);
  else lane.pending.splice(index, 0, job);
}
function drain(lane) {
  while (globalActive < GLOBAL_CONCURRENCY && lane.active < lane.concurrency && lane.pending.length) {
    const job = lane.pending.shift();
    lane.active++;
    globalActive++;
    job.startedAt = Date.now();
    Promise.resolve().then(job.run).then(
      (value) => { lane.completed++; job.resolve(value); },
      (error) => { lane.failed++; job.reject(error); }
    ).finally(() => {
      lane.active--;
      globalActive--;
      if (job.key && lane.inFlight.get(job.key) === job.promise) lane.inFlight.delete(job.key);
      drainAll();
    });
  }
}
function drainAll() {
  // Round-robin start point avoids permanently favoring the first registered lane.
  const entries = [...lanes.values()];
  if (!entries.length) return;
  const offset = sequence++ % entries.length;
  for (let i = 0; i < entries.length && globalActive < GLOBAL_CONCURRENCY; i++) {
    drain(entries[(offset + i) % entries.length]);
  }
}
function enqueue(laneName, run, options = {}) {
  if (typeof run !== "function") return Promise.reject(new TypeError("job must be a function"));
  const lane = getLane(String(laneName), options);
  const key = options.key == null ? null : String(options.key);
  if (key && lane.inFlight.has(key)) return lane.inFlight.get(key);
  if (lane.pending.length >= lane.maxPending) {
    lane.rejected++;
    return Promise.reject(new Error("Hàng đợi đang quá tải, vui lòng thử lại sau."));
  }
  if (lane.active + lane.pending.length >= lane.maxInFlight) {
    lane.rejected++;
    return Promise.reject(new Error("Hệ thống đang xử lý quá nhiều tác vụ, vui lòng thử lại sau."));
  }
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const job = {
    run, resolve, reject, promise, key,
    priority: Number.isFinite(Number(options.priority)) ? Number(options.priority) : 0,
    sequence: sequence++, queuedAt: Date.now()
  };
  if (key) lane.inFlight.set(key, promise);
  insertByPriority(lane, job);
  drainAll();
  return promise;
}
function stats() {
  const snapshot = Object.fromEntries([...lanes.entries()].map(([name, lane]) => [name, {
    active: lane.active, pending: lane.pending.length, concurrency: lane.concurrency,
    maxPending: lane.maxPending, maxInFlight: lane.maxInFlight,
    completed: lane.completed, failed: lane.failed, rejected: lane.rejected,
    oldestPendingMs: lane.pending.length
      ? Math.max(0, Date.now() - Math.min(...lane.pending.map((job) => job.queuedAt))) : 0
  }]));
  // Keep stats()[laneName] intact for existing monitoring integrations.
  snapshot.global = { active: globalActive, concurrency: GLOBAL_CONCURRENCY };
  return snapshot;
}
module.exports = { enqueue, stats, DEFAULT_LANES, GLOBAL_CONCURRENCY };
