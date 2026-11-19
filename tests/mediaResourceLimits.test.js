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
  assert.equal(resolveFfmpegThreads({ JT_FFMPEG_THREADS: "99" }), 1);
});

test("heavy media concurrency leaves CPU capacity for the Zalo listener", () => {
  assert.equal(resolveHeavyMediaConcurrency(1), 1);
  assert.equal(resolveHeavyMediaConcurrency(2), 1);
  assert.equal(resolveHeavyMediaConcurrency(3), 2);
  assert.equal(resolveHeavyMediaConcurrency(4), 2);
  assert.ok(getAvailableCpuCount() >= 1);
});
