"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { collectDeviceMetrics } = require("../core/runtime/deviceMetrics");

test("device metrics returns a cached system snapshot without a 400ms sampling delay", () => {
  const started = performance.now();
  const metrics = collectDeviceMetrics();
  const elapsed = performance.now() - started;

  assert.ok(elapsed < 100, `expected cached snapshot under 100ms, got ${elapsed.toFixed(2)}ms`);
  assert.equal(typeof metrics.cpuCores, "number");
  assert.equal(typeof metrics.cpuPercent, "number");
  assert.equal(typeof metrics.ramTotal, "number");
  assert.equal(typeof metrics.ramUsed, "number");
  assert.equal(typeof metrics.processRam, "number");
  assert.equal(typeof metrics.sampledAt, "number");
});
