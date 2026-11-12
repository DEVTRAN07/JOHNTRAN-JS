"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const converter = require("../core/stickerConvert");
const stickerCommand = require("../plugins/commands/stk");

function gifWithFrames(frameCount) {
  const parts = [Buffer.from("GIF89a"), Buffer.from([1, 0, 1, 0, 0, 0, 0])];
  for (let i = 0; i < frameCount; i++) {
    parts.push(Buffer.from([
      0x2c, // image descriptor
      0, 0, 0, 0, // left/top
      1, 0, 1, 0, // width/height
      0, // no local color table
      2, 1, 0, 0 // LZW minimum code size + one data sub-block + terminator
    ]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

test("ffmpeg resolution ignores a stale Render path and uses a valid packaged binary", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-ffmpeg-resolve-"));
  const staticBinary = path.join(dir, "ffmpeg");
  try {
    fs.writeFileSync(staticBinary, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(staticBinary, 0o755);
    assert.equal(
      converter.resolveFfmpegBinary({ envPath: "/missing/ffmpeg", staticPath: staticBinary }),
      staticBinary
    );
    assert.equal(
      converter.resolveFfmpegBinary({ envPath: "/missing/ffmpeg", staticPath: "/missing/static-ffmpeg" }),
      "ffmpeg"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GIF animation detection parses frame blocks instead of scanning compressed bytes", () => {
  assert.equal(converter.isAnimatedBuffer(gifWithFrames(1)), false);
  assert.equal(converter.isAnimatedBuffer(gifWithFrames(2)), true);
});

test("WebP animation detection checks the VP8X animation flag", () => {
  const webp = Buffer.concat([
    Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"),
    Buffer.from("VP8X"), Buffer.from([10, 0, 0, 0]),
    Buffer.from([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  ]);
  assert.equal(converter.isAnimatedBuffer(webp), true);
});

test("/stk source extension ignores URL query parameters", () => {
  assert.equal(stickerCommand._test.sourceExtension("https://cdn.example/image.gif?token=1"), ".gif");
  assert.equal(stickerCommand._test.sourceExtension("https://cdn.example/image?token=1"), ".bin");
});
