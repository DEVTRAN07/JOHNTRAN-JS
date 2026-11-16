"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const workerPool = require("../core/workerPool");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test("worker pool backs off after crashes and opens a bounded circuit", async () => {
  const options = {
    size: 1,
    maxPending: 4,
    maxRestartsInWindow: 1,
    restartWindowMs: 1000,
    restartDelayMs: 5,
    restartMaxDelayMs: 10,
    circuitCooldownMs: 50
  };

  try {
    const results = await Promise.allSettled([
      workerPool.runInWorker("recoveryCrashFixture", {}, options),
      workerPool.runInWorker("recoveryCrashFixture", {}, options)
    ]);
    assert.equal(results.length, 2);
    assert.ok(results.every(result => result.status === "rejected"));

    const deadline = Date.now() + 1000;
    let report = workerPool.stats().recoveryCrashFixture;
    while (!report?.circuitOpen && Date.now() < deadline) {
      await sleep(5);
      report = workerPool.stats().recoveryCrashFixture;
    }

    assert.equal(report.circuitOpen, true, "repeated worker crashes must open the circuit");
    assert.ok(report.restartCount >= 2);
    assert.ok(report.circuitOpenUntil > Date.now());

    await assert.rejects(
      workerPool.runInWorker("recoveryCrashFixture", {}, options),
      /tạm nghỉ sau nhiều lần worker crash/
    );
  } finally {
    await workerPool.shutdown();
  }
});
