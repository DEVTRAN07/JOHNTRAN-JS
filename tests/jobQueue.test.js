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
