"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const workerPool = require("../core/workerPool");

test("worker pool default is CPU-aware and explicit legacy sizes are capped", () => {
  assert.equal(
    workerPool.DEFAULT_POOL_SIZE,
    workerPool.resolveWorkerPoolSize(4, workerPool.AVAILABLE_CPUS)
  );
  assert.equal(workerPool.resolveWorkerPoolSize(4, 1), 1);
  assert.equal(workerPool.resolveWorkerPoolSize(4, 2), 1);
  assert.equal(workerPool.resolveWorkerPoolSize(2, 2), 1);
  assert.ok(workerPool.DEFAULT_POOL_SIZE <= Math.max(1, workerPool.AVAILABLE_CPUS - 1));
});
