"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getRestartPlan } = require("../core/runtime/restartPolicy");

test("restart policy applies bounded exponential backoff", () => {
  const first = getRestartPlan([], 1000);
  const second = getRestartPlan(first.timestamps, 1200);
  const third = getRestartPlan(second.timestamps, 1500);

  assert.deepEqual([first.attempts, first.delayMs, first.cooldown], [1, 1000, false]);
  assert.deepEqual([second.attempts, second.delayMs, second.cooldown], [2, 2000, false]);
  assert.deepEqual([third.attempts, third.delayMs, third.cooldown], [3, 4000, false]);
});

test("restart policy pauses until the oldest failure leaves the rolling window", () => {
  const plan = getRestartPlan([100, 200, 300, 400, 500], 600, {
    windowMs: 10000,
    maxAttempts: 5
  });

  assert.equal(plan.attempts, 6);
  assert.equal(plan.cooldown, true);
  assert.equal(plan.delayMs, 9501);
});

test("restart policy discards expired and future timestamps", () => {
  const plan = getRestartPlan([100, 950, 1200], 1000, {
    windowMs: 500,
    maxAttempts: 5
  });

  assert.deepEqual(plan.timestamps, [950, 1000]);
  assert.equal(plan.attempts, 2);
  assert.equal(plan.cooldown, false);
});
