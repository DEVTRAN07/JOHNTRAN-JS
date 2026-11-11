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
