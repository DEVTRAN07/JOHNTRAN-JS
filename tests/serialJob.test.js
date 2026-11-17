"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startSerialJob, stopSerialJob } = require("../core/serialJob");

test("serial jobs never overlap asynchronous sends and stop at the exact count", async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = [];
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false, unref() {} };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = timer => { if (timer) timer.cleared = true; };

  const running = new Map();
  const job = { count: 0, times: 2, timer: null };
  let active = 0;
  let maxActive = 0;
  let completed = 0;
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let calls = 0;

  try {
    assert.equal(startSerialJob({
      threadId: "group-1",
      running,
      job,
      delayMs: 300,
      async run() {
        active++;
        maxActive = Math.max(maxActive, active);
        calls++;
        if (calls === 1) await firstGate;
        active--;
      },
      onComplete() { completed++; }
    }), true);

    const firstTimer = timers[0];
    const firstRun = firstTimer.callback();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(timers.length, 1, "next send is not scheduled while the first send is pending");

    releaseFirst();
    await firstRun;
    assert.equal(job.count, 1);
    assert.equal(timers.length, 2);

    await timers[1].callback();
    assert.equal(job.count, 2);
    assert.equal(timers.length, 3);

    await timers[2].callback();
    assert.equal(completed, 1);
    assert.equal(running.has("group-1"), false);
    assert.equal(maxActive, 1);
  } finally {
    stopSerialJob("group-1", running);
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("stopping a serial job during an in-flight send prevents future sends", async () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = [];
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false, unref() {} };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = timer => { if (timer) timer.cleared = true; };

  const running = new Map();
  const job = { count: 0, times: 0 };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;

  try {
    startSerialJob({
      threadId: "group-2",
      running,
      job,
      delayMs: 100,
      async run() {
        calls++;
        await gate;
      }
    });
    const inFlight = timers[0].callback();
    await Promise.resolve();
    assert.equal(calls, 1);

    stopSerialJob("group-2", running);
    release();
    await inFlight;

    assert.equal(running.has("group-2"), false);
    assert.equal(job.count, 1, "a send that completed successfully before stop is counted");
    assert.equal(timers.length, 1, "no future send should be scheduled");
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("stopSerialJob is safe for an inactive group", () => {
  assert.equal(stopSerialJob("missing", new Map()), null);
});
