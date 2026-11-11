// Bounded in-process queues. Each lane is isolated so expensive media work
// cannot starve interactive commands or unrelated engines.
const DEFAULT_LANES = {
  sticker: { concurrency: 1, maxPending: 40 },
  "music-search": { concurrency: 3, maxPending: 80 },
  "music-audio": { concurrency: 1, maxPending: 20 },
  canvas: { concurrency: 1, maxPending: 30 },
  media: { concurrency: 2, maxPending: 40 }
};

const lanes = new Map();
let sequence = 0;

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function getLane(name, options = {}) {
  let lane = lanes.get(name);
  if (!lane) {
    const defaults = DEFAULT_LANES[name] || { concurrency: 2, maxPending: 50 };
    lane = {
      concurrency: positiveInt(options.concurrency, defaults.concurrency),
      maxPending: positiveInt(options.maxPending, defaults.maxPending),
      // Optional hard cap for active + queued jobs. maxPending remains the
      // backwards-compatible cap for waiting jobs only.
      maxInFlight: positiveInt(options.maxInFlight, Infinity),
      active: 0,
      pending: [],
      inFlight: new Map(),
      completed: 0,
      failed: 0,
      rejected: 0
    };
    lanes.set(name, lane);
  }
  return lane;
}

function insertByPriority(lane, job) {
  // Stable priority ordering: equal-priority jobs retain FIFO order.
  const index = lane.pending.findIndex((item) => item.priority < job.priority);
  if (index === -1) lane.pending.push(job);
  else lane.pending.splice(index, 0, job);
}

function drain(lane) {
  while (lane.active < lane.concurrency && lane.pending.length) {
    const job = lane.pending.shift();
    lane.active++;
    job.startedAt = Date.now();

    Promise.resolve()
      .then(job.run)
      .then(
        (value) => { lane.completed++; job.resolve(value); },
        (error) => { lane.failed++; job.reject(error); }
      )
      .finally(() => {
        lane.active--;
        if (job.key && lane.inFlight.get(job.key) === job.promise) {
          lane.inFlight.delete(job.key);
        }
        drain(lane);
      });
  }
}

function enqueue(laneName, run, options = {}) {
  if (typeof run !== "function") {
    return Promise.reject(new TypeError("job must be a function"));
  }

  const lane = getLane(laneName, options);
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

  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const job = {
    run, resolve, reject, promise, key,
    priority: Number.isFinite(Number(options.priority)) ? Number(options.priority) : 0,
    sequence: sequence++,
    queuedAt: Date.now()
  };

  if (key) lane.inFlight.set(key, promise);
  insertByPriority(lane, job);
  drain(lane);
  return promise;
}

function stats() {
  return Object.fromEntries([...lanes.entries()].map(([name, lane]) => [name, {
    active: lane.active,
    pending: lane.pending.length,
    concurrency: lane.concurrency,
    maxPending: lane.maxPending,
    maxInFlight: Number.isFinite(lane.maxInFlight) ? lane.maxInFlight : null,
    completed: lane.completed,
    failed: lane.failed,
    rejected: lane.rejected,
    oldestPendingMs: lane.pending.length
      ? Math.max(0, Date.now() - lane.pending[0].queuedAt)
      : 0
  }]));
}

module.exports = { enqueue, stats };
