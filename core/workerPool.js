const { Worker } = require("worker_threads");
const path = require("path");

const WORKERS_DIR = path.join(__dirname, "workers");
const DEFAULT_POOL_SIZE = 4;

const pools = new Map();
let shuttingDown = false;

function createWorker(scriptName) {
  const scriptPath = path.join(WORKERS_DIR, `${scriptName}.js`);
  const worker = new Worker(scriptPath);
  worker.on("error", (err) => {
    worker._startupError = err;
  });
  return worker;
}

function getOrCreatePool(scriptName, size) {
  let pool = pools.get(scriptName);
  if (!pool) {
    pool = { workers: [], index: 0 };
    for (let i = 0; i < size; i++) {
      pool.workers.push(createWorker(scriptName));
    }
    pools.set(scriptName, pool);
  }
  return pool;
}

function terminateWorker(worker) {
  try {
    return worker.terminate();
  } catch {
    return undefined;
  }
}

function settleTermination(ret) {
  if (ret && typeof ret.then === "function") {
    return ret;
  }
  return undefined;
}

function runInWorker(scriptName, data, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (shuttingDown) {
        return reject(new Error("workerPool: shutting down"));
      }

      const size = Math.max(1, Number(options.size) || DEFAULT_POOL_SIZE);
      const pool = getOrCreatePool(scriptName, size);
      const worker = pool.workers[pool.index];
      pool.index = (pool.index + 1) % pool.workers.length;

      if (worker._startupError) {
        return reject(worker._startupError);
      }

      let timer = null;
      if (options.timeout && options.timeout > 0) {
        timer = setTimeout(() => {
          cleanup();
          terminateWorker(worker);
          reject(new Error(`workerPool: timeout (${options.timeout}ms) for ${scriptName}`));
        }, options.timeout);
      }

      function cleanup() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        worker.removeListener("message", onMessage);
        worker.removeListener("error", onError);
        worker.removeListener("exit", onExit);
      }

      function onMessage(result) {
        cleanup();
        if (result && result.ok === false) {
          const err = new Error(result.error || `worker ${scriptName} failed`);
          if (result.stack) err.stack = result.stack;
          reject(err);
        } else {
          let data = result == null || result.data === undefined ? result : result.data;
          if (
            data &&
            typeof data === "object" &&
            data.buffer &&
            typeof data.buffer === "object" &&
            !Buffer.isBuffer(data.buffer)
          ) {
            data.buffer = Buffer.from(data.buffer);
          }
          resolve(data);
        }
      }

      function onError(err) {
        cleanup();
        reject(err);
      }

      function onExit(code) {
        if (code !== 0) {
          cleanup();
          reject(new Error(`worker ${scriptName} exited with code ${code}`));
        }
      }

      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("exit", onExit);
      worker.postMessage(data);
    } catch (err) {
      reject(err);
    }
  });
}

async function shutdown() {
  shuttingDown = true;
  const jobs = [];
  for (const pool of pools.values()) {
    for (const worker of pool.workers) {
      jobs.push(settleTermination(terminateWorker(worker)));
    }
  }
  await Promise.all(jobs);
  pools.clear();
}

function poolSize(scriptName) {
  const pool = pools.get(scriptName);
  return pool ? pool.workers.length : 0;
}

module.exports = { runInWorker, shutdown, poolSize };
