"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAvailableCpuCount,
  resolveFfmpegThreads,
  resolveHeavyMediaConcurrency
} = require("../core/mediaResourceLimits");

test("FFmpeg defaults to one thread so media work cannot saturate a small bot host", () => {
  assert.equal(resolveFfmpegThreads({}), 1);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "2" }, 8), 2);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "4" }, 8), 4);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "4" }, 2), 1,
    "a legacy thread override must not consume both CPUs on a two-core host");
});

test("FFmpeg thread override is bounded and rejects invalid values", () => {
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "0" }), 1);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "-1" }), 1);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "many" }), 1);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "99" }, 8), 4,
    "large positive values are clamped to the supported maximum");
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "99" }, 3), 2,
    "CPU headroom takes precedence over an old oversized .env value");
});

test("global media queue ceiling leaves one CPU available for chat processing", () => {
  const { resolveGlobalJobConcurrency } = require("../core/mediaResourceLimits");
  assert.equal(resolveGlobalJobConcurrency(1), 1);
  assert.equal(resolveGlobalJobConcurrency(2), 1);
  assert.equal(resolveGlobalJobConcurrency(3), 2);
  assert.equal(resolveGlobalJobConcurrency(4), 3);
  assert.equal(resolveGlobalJobConcurrency(5), 4);
  assert.equal(resolveGlobalJobConcurrency(16), 4);
});

test("worker pool sizes are capped even when legacy callsites request multiple workers", () => {
  const { resolveWorkerPoolSize } = require("../core/mediaResourceLimits");
  assert.equal(resolveWorkerPoolSize(4, 1), 1);
  assert.equal(resolveWorkerPoolSize(4, 2), 1);
  assert.equal(resolveWorkerPoolSize(2, 2), 1);
  assert.equal(resolveWorkerPoolSize(2, 4), 2);
  assert.equal(resolveWorkerPoolSize(8, 8), 4);
});

test("heavy media concurrency leaves CPU capacity for the Zalo listener", () => {
  assert.equal(resolveHeavyMediaConcurrency(1), 1);
  assert.equal(resolveHeavyMediaConcurrency(2), 1);
  assert.equal(resolveHeavyMediaConcurrency(3), 2);
  assert.equal(resolveHeavyMediaConcurrency(4), 2);
  assert.ok(getAvailableCpuCount() >= 1);
});
