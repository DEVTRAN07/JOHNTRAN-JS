"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const restart = require("../core/runtime/restartPolicy");

function runFixtures() {
  return [
    restart.getRestartPlan([], 1000),
    restart.getRestartPlan([1000], 1200),
    restart.getRestartPlan([1000, 1200], 1500),
    restart.getRestartPlan([100, 200, 300, 400, 500], 600, {
      windowMs: 10000,
      maxAttempts: 5
    }),
    restart.getRestartPlan([100, 950, 1200, NaN, Infinity, "900", null], 1000, {
      windowMs: 500
    }),
    restart.getRestartPlan("not-an-array", 2500, {
      windowMs: 1200,
      maxAttempts: 2,
      baseDelayMs: 80,
      maxDelayMs: 200
    }),
    restart.getRestartPlan([500, 500.1, 1000, 1001], 1000, {
      windowMs: 500,
      maxAttempts: 4,
      baseDelayMs: 0,
      maxDelayMs: 0
    }),
    restart.getRestartPlan([1000, 1100, 1200], 1300, {
      windowMs: 10000,
      maxAttempts: 2,
      baseDelayMs: 500,
      maxDelayMs: 100
    }),
    restart.getRestartPlan([1, 2, 3], NaN, {
      windowMs: 500,
      maxAttempts: 5
    })
  ];
}

test("restart-policy Rust addon exports the native planner", t => {
  const diagnostics = restart.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "Rust restart policy is inactive");
  assert.ok(
    diagnostics.exports.includes("restartPlan") ||
    diagnostics.exports.includes("restart_plan")
  );
});

test("restart-policy Rust algorithm preserves the JS window, ordering and backoff contract", t => {
  if (!restart.getNativeDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_RESTART_POLICY;
  try {
    process.env.JT_RUST_RESTART_POLICY = "0";
    const fallback = runFixtures();
    delete process.env.JT_RUST_RESTART_POLICY;
    const rust = runFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_RESTART_POLICY;
    else process.env.JT_RUST_RESTART_POLICY = previous;
  }
});
