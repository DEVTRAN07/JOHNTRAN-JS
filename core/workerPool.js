const { Worker } = require("worker_threads");
const path = require("path");

const WORKERS_DIR = path.join(__dirname, "workers");
const DEFAULT_POOL_SIZE = 4;
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
    clearTaskTimer(task);
    record.task = null;
    record.busy = false;

    if (result && result.ok === false) {
      const error = new Error(result.error || `worker ${pool.scriptName} failed`);
      if (result.stack) error.stack = result.stack;
      settle(task, error);
    } else {
      let data = result == null || result.data === undefined ? result : result.data;
      if (data && typeof data === "object" && data.buffer &&
          typeof data.buffer === "object" && !Buffer.isBuffer(data.buffer)) {
        data.buffer = Buffer.from(data.buffer);
      }
      settle(task, null, data);
    }
    pump(pool);
  });

  worker.on("error", (error) => retireWorker(pool, record, error));
  worker.on("exit", (code) => {
    if (!record.dead) {
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

function retireWorker(pool, record, error) {
  if (record.dead) return;
  record.dead = true;
  record.busy = false;
  const task = record.task;
  record.task = null;
  if (task) settle(task, error || new Error(`worker ${pool.scriptName} stopped`));
  pump(pool);
}

function getOrCreatePool(scriptName, size) {
  let pool = pools.get(scriptName);
  if (!pool) {
    pool = { scriptName, size, workers: [], pending: [], pumping: false };
    pools.set(scriptName, pool);
  } else {
    pool.size = Math.max(pool.size, size);
  }
  return pool;
}

function ensureWorkers(pool) {
  if (shuttingDown) return;
  const alive = pool.workers.filter((record) => !record.dead).length;
  for (let i = alive; i < pool.size; i++) createWorker(pool, pool.scriptName);
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
        record.task = null;
        record.busy = false;
        retireWorker(pool, record, error);
        terminateWorker(record.worker);
        settle(task, error);
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

module.exports = { runInWorker, shutdown, poolSize };
