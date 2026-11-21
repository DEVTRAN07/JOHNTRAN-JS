"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SlidingWindowLimiter } = require("../core/runtime/rateLimiter");
const rateLimiter = require("../core/runtime/rateLimiter");

function snapshot(limiter) {
  return {
    entries: [...limiter.entries.entries()].map(([key, entry]) => ({
      key,
      timestamps: entry.timestamps.slice(),
      cursor: entry.cursor,
      touchedAt: entry.touchedAt
    })),
    operations: limiter.operations,
    hasPruneIterator: Boolean(limiter.pruneIterator)
  };
}

function runFixtures() {
  const result = [];

  const basic = new SlidingWindowLimiter({ windowMs: 10000, max: 2, maxKeys: 20 });
  result.push([
    basic.allow(undefined, 1000),
    basic.allow(null, 1000),
    basic.allow("", 1000),
    basic.allow("u1", 1000),
    basic.allow("u1", 2000),
    basic.allow("u1", 3000),
    basic.allow("u1", 13000),
    basic.allow("u2", 13000)
  ]);
  result.push(snapshot(basic));

  const expiredCapacity = new SlidingWindowLimiter({ windowMs: 1000, max: 1, maxKeys: 2 });
  result.push([
    expiredCapacity.allow("old-a", 1000),
    expiredCapacity.allow("old-b", 1000),
    expiredCapacity.allow("new-live", 5000)
  ]);
  result.push(snapshot(expiredCapacity));

  const liveCapacity = new SlidingWindowLimiter({ windowMs: 1000, max: 1, maxKeys: 2 });
  result.push([
    liveCapacity.allow("a", 1000),
    liveCapacity.allow("b", 1000),
    liveCapacity.allow("c", 1001)
  ]);
  result.push(snapshot(liveCapacity));

  const rotating = new SlidingWindowLimiter({ windowMs: 1000, max: 1, maxKeys: 2000 });
  for (let index = 0; index < 700; index++) {
    rotating.allow("idle-" + index, 1000);
  }
  const rotatingSnapshots = [];
  for (let index = 0; index < 3; index++) {
    rotating.prune(2001);
    rotatingSnapshots.push(snapshot(rotating));
  }
  result.push(rotatingSnapshots);

  const clearing = new SlidingWindowLimiter({ windowMs: 1000, max: 1, maxKeys: 1000 });
  for (let index = 0; index < 400; index++) clearing.allow("cursor-" + index, 1000);
  clearing.prune(2001);
  const beforeClear = snapshot(clearing);
  clearing.clear();
  result.push({ beforeClear, afterClear: snapshot(clearing) });

  const automatic = new SlidingWindowLimiter({ windowMs: 10000, max: 1, maxKeys: 2000 });
  for (let index = 0; index < 1025; index++) automatic.allow("auto-" + index, 1000);
  result.push(snapshot(automatic));

  return result;
}

test("Rust rate-limiter remains opt-in because the N-API path is slower in the CI microbenchmark", t => {
  const diagnostics = rateLimiter.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_RATE_LIMITER;
  try {
    delete process.env.JT_RUST_RATE_LIMITER;
    assert.equal(rateLimiter.getNativeDiagnostics().active, false);
    assert.equal(new SlidingWindowLimiter()._native, null);
    process.env.JT_RUST_RATE_LIMITER = "1";
    assert.equal(rateLimiter.getNativeDiagnostics().active, true);
    assert.ok(new SlidingWindowLimiter()._native);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_RATE_LIMITER;
    else process.env.JT_RUST_RATE_LIMITER = previous;
  }
});

test("Rust sliding-window limiter preserves JS allow, capacity, prune, insertion-order and clear semantics", t => {
  if (!rateLimiter.getNativeDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_RATE_LIMITER;
  try {
    process.env.JT_RUST_RATE_LIMITER = "0";
    const fallback = runFixtures();
    process.env.JT_RUST_RATE_LIMITER = "1";
    const rust = runFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_RATE_LIMITER;
    else process.env.JT_RUST_RATE_LIMITER = previous;
  }
});

test("switching a native limiter to JS fallback resumes before the next prune key", t => {
  if (!rateLimiter.getNativeDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_RATE_LIMITER;
  try {
    process.env.JT_RUST_RATE_LIMITER = "1";
    const limiter = new SlidingWindowLimiter({ windowMs: 1000, max: 1, maxKeys: 2000 });
    for (let index = 0; index < 400; index++) limiter.allow("cursor-" + index, 1000);
    limiter.prune(2001);
    assert.equal(limiter.entries.size, 144);
    assert.ok(limiter.pruneIterator);

    // A non-number timestamp uses the compatibility JS implementation.
    assert.equal(limiter.allow("late", "2001"), true);
    limiter.prune(2001);
    assert.equal(limiter.entries.size, 1);
    assert.equal(limiter.entries.has("late"), true);
    assert.equal(limiter.pruneIterator, null);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_RATE_LIMITER;
    else process.env.JT_RUST_RATE_LIMITER = previous;
  }
});
