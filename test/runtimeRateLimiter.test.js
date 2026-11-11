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
