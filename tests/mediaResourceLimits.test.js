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
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "2" }), 2);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "4" }), 4);
});

test("FFmpeg thread override is bounded and rejects invalid values", () => {
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "0" }), 1);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "-1" }), 1);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "many" }), 1);
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "99" }), 4,
    "large positive values are clamped to the supported maximum");
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

test("heavy media concurrency leaves CPU capacity for the Zalo listener", () => {
  assert.equal(resolveHeavyMediaConcurrency(1), 1);
  assert.equal(resolveHeavyMediaConcurrency(2), 1);
  assert.equal(resolveHeavyMediaConcurrency(3), 2);
  assert.equal(resolveHeavyMediaConcurrency(4), 2);
  assert.ok(getAvailableCpuCount() >= 1);
});
