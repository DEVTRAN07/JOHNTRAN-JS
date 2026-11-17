"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const getvoice = require("../plugins/commands/getvoice");

test("/getvoice prefers FFMPEG_PATH, then system FFmpeg, then packaged ffmpeg-static", () => {
  const available = new Set([
    "/opt/custom/ffmpeg",
    "/usr/bin/ffmpeg",
    "/app/node_modules/ffmpeg-static/ffmpeg"
  ]);
  const isExecutableFile = candidate => available.has(candidate);

  assert.equal(getvoice._test.resolveAudioFfmpegPath({
    envPath: "/opt/custom/ffmpeg",
    systemPaths: ["/usr/bin/ffmpeg"],
    staticPath: "/app/node_modules/ffmpeg-static/ffmpeg",
    isExecutableFile
  }), "/opt/custom/ffmpeg");

  assert.equal(getvoice._test.resolveAudioFfmpegPath({
    envPath: null,
    systemPaths: ["/usr/bin/ffmpeg"],
    staticPath: "/app/node_modules/ffmpeg-static/ffmpeg",
    isExecutableFile
  }), "/usr/bin/ffmpeg");

  assert.equal(getvoice._test.resolveAudioFfmpegPath({
    envPath: null,
    systemPaths: ["/missing/ffmpeg"],
    staticPath: "/app/node_modules/ffmpeg-static/ffmpeg",
    isExecutableFile
  }), "/app/node_modules/ffmpeg-static/ffmpeg");
});

test("/getvoice reports an unavailable FFmpeg binary instead of passing null to spawn", () => {
  assert.equal(getvoice._test.resolveAudioFfmpegPath({
    envPath: null,
    systemPaths: ["/missing/ffmpeg"],
    staticPath: null,
    isExecutableFile: () => false
  }), null);
});

test("/getvoice uses a real resolved binary for fluent-ffmpeg at startup when available", () => {
  if (getvoice._test.ffmpegBin) {
    assert.equal(typeof getvoice._test.ffmpegBin, "string");
    assert.ok(getvoice._test.ffmpegBin.length > 0);
  }
});
