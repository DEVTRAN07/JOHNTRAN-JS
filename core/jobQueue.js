// Bounded in-process job queues for non-interactive work.
// Jobs are isolated by lane so FFmpeg cannot starve search or message handling.
const DEFAULT_LANES = {
  "sticker": { concurrency: 1, maxPending: 40 },
  "music-search": { concurrency: 3, maxPending: 80 },
  "music-audio": { concurrency: 1, maxPending: 20 },
  "canvas": { concurrency: 1, maxPending: 30 },
  "media": { concurrency: 2, maxPending: 40 }
};

const lanes = new Map();
let sequence = 0;

function getLane(name, options = {}) {
  let lane = lanes.get(name);
  if (!lane) {
    const defaults = DEFAULT_LANES[name] || { concurrency: 2, maxPending: 50 };
    lane = {
      concurrency: Math.max(1, Number(options.concurrency) || defaults.concurrency),
      maxPending: Math.max(1, Number(options.maxPending) || defaults.maxPending),
      active: 0,
      pending: [],
      inFlight: new Map()
    };
    lanes.set(name, lane);
  }
  return lane;
}

function drain(lane) {
  while (lane.active < lane.concurrency && lane.pending.length) {
    const job = lane.pending.shift();
    lane.active++;
    Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => {
        lane.active--;
        if (job.key) lane.inFlight.delete(job.key);
        drain(lane);
      });
  }
}

function enqueue(laneName, run, options = {}) {
  if (typeof run !== "function") return Promise.reject(new TypeError("job must be a function"));
  const lane = getLane(laneName, options);
  const key = options.key == null ? null : String(options.key);

  if (key && lane.inFlight.has(key)) return lane.inFlight.get(key);
  if (lane.pending.length >= lane.maxPending) {
    return Promise.reject(new Error("Hàng đợi đang quá tải, vui lòng thử lại sau."));
  }

  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const job = {
    run,
    resolve,
    reject,
    key,
    priority: Number(options.priority) || 0,
    sequence: sequence++
  };

  if (key) lane.inFlight.set(key, promise);
  if (job.priority > 0) {
    const index = lane.pending.findIndex((item) => item.priority < job.priority);
    if (index === -1) lane.pending.push(job);
    else lane.pending.splice(index, 0, job);
  } else {
    lane.pending.push(job);
  }
  drain(lane);
  return promise;
}

function stats() {
  return Object.fromEntries([...lanes.entries()].map(([name, lane]) => [name, {
    active: lane.active,
    pending: lane.pending.length,
    concurrency: lane.concurrency,
    maxPending: lane.maxPending
  }]));
}

module.exports = { enqueue, stats };
