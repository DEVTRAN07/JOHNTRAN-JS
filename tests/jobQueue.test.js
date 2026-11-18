const test = require("node:test");
const assert = require("node:assert/strict");
const { enqueue, stats } = require("../core/jobQueue");

test("job queue deduplicates identical in-flight work", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const run = () => enqueue("test-dedupe", async () => {
    calls++;
    await gate;
    return "ok";
  }, { key: "same" });
  const first = run();
  const second = run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), ["ok", "ok"]);
});

test("job queue enforces concurrency and drains pending work", async () => {
  let active = 0;
  let peak = 0;
  const jobs = Array.from({ length: 5 }, (_, i) => enqueue("test-limit", async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return i;
  }, { concurrency: 2, maxPending: 10 }));
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.equal(stats()["test-limit"].active, 0);
});

test("job queue rejects work when its pending limit is reached", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = enqueue("test-backpressure", async () => {
    await gate;
    return "active";
  }, { concurrency: 1, maxPending: 1 });
  await new Promise((resolve) => setImmediate(resolve));

  const second = enqueue("test-backpressure", async () => "pending");
  await assert.rejects(
    enqueue("test-backpressure", async () => "overflow"),
    /Hàng đợi đang quá tải/
  );

  release();
  assert.deepEqual(await Promise.all([first, second]), ["active", "pending"]);
  assert.equal(stats()["test-backpressure"].pending, 0);
});

test("job queue runs higher-priority pending jobs first and preserves FIFO ties", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const first = enqueue("test-priority", async () => {
    await gate;
    order.push("active");
  }, { concurrency: 1 });

  await new Promise((resolve) => setImmediate(resolve));
  const low = enqueue("test-priority", async () => { order.push("low"); }, { priority: -1 });
  const normalA = enqueue("test-priority", async () => { order.push("normal-a"); });
  const high = enqueue("test-priority", async () => { order.push("high"); }, { priority: 10 });
  const normalB = enqueue("test-priority", async () => { order.push("normal-b"); });

  release();
  await Promise.all([first, low, normalA, high, normalB]);
  assert.deepEqual(order, ["active", "high", "normal-a", "normal-b", "low"]);
});

test("job queue can enforce a total in-flight cap", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = enqueue("test-total-cap", async () => gate, {
    concurrency: 1, maxPending: 10, maxInFlight: 2
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = enqueue("test-total-cap", async () => "queued");
  await assert.rejects(
    enqueue("test-total-cap", async () => "overflow"),
    /đang xử lý quá nhiều tác vụ/
  );
  release("done");
  assert.deepEqual(await Promise.all([first, second]), ["done", "queued"]);
  assert.equal(stats()["test-total-cap"].completed, 2);
  assert.equal(stats()["test-total-cap"].rejected, 1);
});


test("global worker ceiling is shared across independent lanes", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let active = 0, peak = 0;
  const jobs = Array.from({ length: 8 }, (_, i) => enqueue(`global-lane-${i}`, async () => {
    active++;
    peak = Math.max(peak, active);
    await gate;
    active--;
  }, { concurrency: 4, maxPending: 2, maxInFlight: 6 }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(peak <= require("../core/jobQueue").GLOBAL_CONCURRENCY);
  release();
  await Promise.all(jobs);
  assert.equal(stats().global.active, 0);
});


test("job queue retries only when the retry policy allows it", async () => {
  let attempts = 0;
  const result = await enqueue("test-retry", async () => {
    attempts++;
    if (attempts === 1) throw new Error("temporary worker failure");
    return "recovered";
  }, {
    retries: 1,
    retryDelayMs: 1,
    retryOn: error => /temporary/.test(error.message)
  });

  assert.equal(result, "recovered");
  assert.equal(attempts, 2);
  assert.equal(stats()["test-retry"].retried, 1);
});

test("job queue does not retry permanent errors", async () => {
  let attempts = 0;
  await assert.rejects(
    enqueue("test-permanent-error", async () => {
      attempts++;
      throw new Error("invalid input");
    }, {
      retries: 3,
      retryDelayMs: 1,
      retryOn: error => /temporary/.test(error.message)
    }),
    /invalid input/
  );
  assert.equal(attempts, 1);
  assert.equal(stats()["test-permanent-error"].failed, 1);
});


test("job queue releases global slots while retry backoff is pending", async () => {
  const attempts = [0, 0, 0, 0];
  const retryJobs = attempts.map((_, index) => enqueue("test-retry-yield-" + index, async () => {
    attempts[index]++;
    if (attempts[index] === 1) throw new Error("temporary network failure");
    return "retried";
  }, {
    retries: 1,
    retryDelayMs: 180,
    retryOn: error => /temporary/.test(error.message)
  }));

  const deadline = Date.now() + 100;
  while (stats().global.active > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.equal(stats().global.active, 0, "retry delay must not hold worker slots");
  assert.equal(stats().global.pending, 4, "delayed retries count toward backpressure");

  const started = Date.now();
  const urgent = await enqueue("test-retry-yield-urgent", async () => "urgent");
  assert.equal(urgent, "urgent");
  assert.ok(Date.now() - started < 120, "unrelated lane should run before delayed retries");
  assert.deepEqual(await Promise.all(retryJobs), ["retried", "retried", "retried", "retried"]);
});


test("retry timer keeps the job counted while it waits in the runnable queue", async () => {
  function heldTask() {
    let release;
    let started;
    const gate = new Promise(resolve => { release = resolve; });
    const startedPromise = new Promise(resolve => { started = resolve; });
    return {
      started: startedPromise,
      release,
      run: async () => { started(); await gate; }
    };
  }

  const held = Array.from({ length: 3 }, () => heldTask());
  const heldPromises = held.map(task => enqueue("test-retry-hold", task.run, {
    concurrency: 4, maxPending: 10, maxInFlight: 10
  }));
  await Promise.all(held.map(task => task.started));

  let attempts = 0;
  const retryPromise = enqueue("test-retry-backpressure", async () => {
    attempts++;
    if (attempts === 1) throw new Error("temporary retry");
    return "ok";
  }, {
    retries: 1,
    retryDelayMs: 80,
    retryOn: error => /temporary/.test(error.message)
  });

  const retryDeadline = Date.now() + 1000;
  while (
    !(stats().global.active === 3 &&
      stats().global.pending === 1 &&
      stats()["test-retry-backpressure"]?.retrying === 1) &&
    Date.now() < retryDeadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.equal(stats().global.active, 3);
  assert.equal(stats().global.pending, 1);

  const fourth = heldTask();
  const fourthPromise = enqueue("test-retry-hold", fourth.run, {
    concurrency: 4, maxPending: 10, maxInFlight: 10
  });
  await fourth.started;
  await new Promise(resolve => setTimeout(resolve, 110));

  assert.equal(stats().global.active, 4);
  assert.equal(stats().global.pending, 1, "retrying -> pending must not decrement the global count");
  assert.equal(stats()["test-retry-backpressure"].pending, 1);
  assert.equal(stats()["test-retry-backpressure"].retrying, 0);

  for (const task of [...held, fourth]) task.release();
  assert.deepEqual(await Promise.all([...heldPromises, fourthPromise]), [undefined, undefined, undefined, undefined]);
  assert.equal(await retryPromise, "ok");
  assert.equal(attempts, 2);
});


test("STK worker lane defaults to two concurrent jobs", () => {
  const { DEFAULT_LANES, STICKER_CONCURRENCY } = require("../core/jobQueue");
  assert.equal(STICKER_CONCURRENCY, 2);
  assert.equal(DEFAULT_LANES.sticker.concurrency, 2);
});


test("job queue reports average queue wait and execution time", async () => {
  const before = stats()["test-queue-timing"] || { waitCount: 0, runCount: 0 };
  await enqueue("test-queue-timing", async () => "done", { concurrency: 1 });
  const after = stats()["test-queue-timing"];
  assert.equal(after.waitCount, before.waitCount + 1);
  assert.equal(after.runCount, before.runCount + 1);
  assert.ok(after.avgWaitMs >= 0);
  assert.ok(after.avgRunMs >= 0);
});


test("reserved HTTP control-plane requests run while every media slot is occupied", async () => {
  const { GLOBAL_CONCURRENCY, DEFAULT_LANES } = require("../core/jobQueue");
  assert.equal(DEFAULT_LANES.http.controlPlane, true);
  assert.equal(DEFAULT_LANES["music-search"].controlPlane, true);
  assert.equal(DEFAULT_LANES["music-resolve"].controlPlane, true);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const startedResolvers = [];
  const started = Array.from({ length: GLOBAL_CONCURRENCY }, () => new Promise(resolve => startedResolvers.push(resolve)));
  let startedCount = 0;
  const mediaJobs = Array.from({ length: GLOBAL_CONCURRENCY }, (_, index) => enqueue(
    "test-media-saturation", async () => {
      startedCount++;
      startedResolvers[index]();
      await gate;
      return index;
    }, { concurrency: GLOBAL_CONCURRENCY, maxPending: GLOBAL_CONCURRENCY + 1 }
  ));
  try {
    await Promise.all(started);
    assert.equal(startedCount, GLOBAL_CONCURRENCY);
    assert.equal(stats().global.active, GLOBAL_CONCURRENCY);
    assert.equal(await enqueue("http", async () => "control-ready"), "control-ready");
    assert.equal(stats().global.active, GLOBAL_CONCURRENCY);
    assert.equal(stats().global.controlActive, 0);
  } finally {
    release();
  }
  await Promise.all(mediaJobs);
});


test("control-plane pending capacity is isolated from a saturated media queue", async () => {
  const { GLOBAL_MAX_PENDING, CONTROL_MAX_PENDING } = require("../core/jobQueue");
  let release;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const mediaJobs = [];
  mediaJobs.push(enqueue("test-media-pending-isolation", async () => {
    signalStarted();
    await gate;
    return "active";
  }, {
    concurrency: 1,
    maxPending: GLOBAL_MAX_PENDING,
    maxInFlight: GLOBAL_MAX_PENDING + 1
  }));
  await started;
  for (let index = 0; index < GLOBAL_MAX_PENDING; index++) {
    mediaJobs.push(enqueue("test-media-pending-isolation", async () => index));
  }
  assert.equal(stats().global.mediaPending, GLOBAL_MAX_PENDING);
  assert.equal(stats().global.controlPending, 0);

  try {
    assert.equal(await enqueue("http", async () => "control-work"), "control-work");
    assert.equal(stats().global.mediaPending, GLOBAL_MAX_PENDING,
      "a control-plane request must not consume media pending capacity");
    assert.equal(stats().global.controlPending, 0);
    assert.equal(CONTROL_MAX_PENDING, 48);
  } finally {
    release();
  }
  const values = await Promise.all(mediaJobs);
  assert.equal(values.length, GLOBAL_MAX_PENDING + 1);
  assert.equal(stats().global.mediaPending, 0);
});
