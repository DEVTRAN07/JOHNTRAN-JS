"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { LRUCache } = require("../core/cache/lru");

test("remember collapses concurrent cache misses into one loader", async () => {
  const cache = new LRUCache({ max: 10, ttl: 1000 });
  let calls = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = async () => { calls++; await gate; return { value: 42 }; };
  const first = cache.remember("profile:1", loader);
  const second = cache.remember("profile:1", loader);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, { value: 42 });
  assert.equal(a, b);
  assert.deepEqual(await cache.remember("profile:1", loader), { value: 42 });
  assert.equal(calls, 1);
});

test("remember clears in-flight marker after loader rejection and can retry", async () => {
  const cache = new LRUCache();
  await assert.rejects(cache.remember("retry", async () => { throw new Error("temporary"); }), /temporary/);
  assert.equal(await cache.remember("retry", async () => "recovered"), "recovered");
});

test("LRU cache still evicts oldest entry and respects TTL", async () => {
  const cache = new LRUCache({ max: 2, ttl: 10 });
  cache.set("a", 1); cache.set("b", 2); cache.get("a"); cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(cache.get("a"), undefined);
});
