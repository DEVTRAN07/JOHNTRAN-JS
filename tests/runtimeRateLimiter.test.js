"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SlidingWindowLimiter } = require("../core/runtime/rateLimiter");
test("allows max requests and blocks the next request", () => {
  const limiter = new SlidingWindowLimiter({ windowMs: 10000, max: 2 });
  assert.equal(limiter.allow("u1", 1000), true);
  assert.equal(limiter.allow("u1", 2000), true);
  assert.equal(limiter.allow("u1", 3000), false);
});
test("expired requests leave the active window", () => {
  const limiter = new SlidingWindowLimiter({ windowMs: 10000, max: 1 });
  assert.equal(limiter.allow("u1", 1000), true);
  assert.equal(limiter.allow("u1", 11001), true);
});
test("users are isolated and missing IDs rejected", () => {
  const limiter = new SlidingWindowLimiter({ max: 1 });
  assert.equal(limiter.allow(null, 1000), false);
  assert.equal(limiter.allow("a", 1000), true);
  assert.equal(limiter.allow("b", 1000), true);
});

test("key storage stays within configured capacity", () => {
  const limiter = new SlidingWindowLimiter({ max: 1, maxKeys: 2 });
  limiter.allow("a", 1000);
  limiter.allow("b", 1000);
  limiter.allow("c", 1000);
  assert.equal(limiter.entries.size, 2);
});


test("prune removes stale keys in bounded rotating batches", () => {
  const limiter = new SlidingWindowLimiter({ windowMs: 1000, max: 1, maxKeys: 2000 });
  for (let index = 0; index < 700; index++) {
    assert.equal(limiter.allow("idle-" + index, 1000), true);
  }
  assert.equal(limiter.entries.size, 700);

  limiter.prune(2001);
  assert.equal(limiter.entries.size, 444, "one prune pass must inspect no more than 256 keys");
  limiter.prune(2001);
  assert.equal(limiter.entries.size, 188, "the next pass resumes where the previous one stopped");
  limiter.prune(2001);
  assert.equal(limiter.entries.size, 0, "all expired entries are eventually released");
});

test("capacity cleanup removes expired users before evicting a live key", () => {
  const limiter = new SlidingWindowLimiter({ windowMs: 1000, max: 1, maxKeys: 2 });
  limiter.allow("old-a", 1000);
  limiter.allow("old-b", 1000);
  assert.equal(limiter.allow("new-live", 5000), true);

  assert.equal(limiter.entries.has("old-a"), false);
  assert.equal(limiter.entries.has("old-b"), false);
  assert.equal(limiter.entries.has("new-live"), true);
  assert.equal(limiter.entries.size, 1);
});

test("clear resets the rotating prune cursor", () => {
  const limiter = new SlidingWindowLimiter({ windowMs: 1000, max: 1 });
  for (let index = 0; index < 400; index++) limiter.allow("cursor-" + index, 1000);
  limiter.prune(2001);
  assert.ok(limiter.pruneIterator, "a partial sweep keeps its iterator");
  limiter.clear();
  assert.equal(limiter.entries.size, 0);
  assert.equal(limiter.pruneIterator, null);
});
