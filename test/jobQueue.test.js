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

test("job queue runs higher-priority pending jobs first", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const first = enqueue("test-priority", async () => {
    await gate;
    order.push("active");
  }, { concurrency: 1 });

  await new Promise((resolve) => setImmediate(resolve));
  const low = enqueue("test-priority", async () => { order.push("low"); }, { priority: -1 });
  const normal = enqueue("test-priority", async () => { order.push("normal"); });
  const high = enqueue("test-priority", async () => { order.push("high"); }, { priority: 10 });

  release();
  await Promise.all([first, low, normal, high]);
  assert.deepEqual(order, ["active", "high", "low", "normal"]);
});
