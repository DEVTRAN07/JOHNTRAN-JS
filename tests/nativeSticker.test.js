"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

let addon = null;
try {
  addon = require(path.join("..", "native", "sticker-rs", "sticker_rs.node"));
} catch {
  // Local development without a Rust toolchain uses the Canvas/FFmpeg fallback.
}

test("Rust static sticker compositor returns a valid WebP off the event loop", {
  skip: !addon || typeof addon.composeStaticSticker !== "function"
}, async () => {
  const { createCanvas } = require("canvas");

  const avatar = createCanvas(64, 64);
  const avatarContext = avatar.getContext("2d");
  avatarContext.fillStyle = "#e84b4b";
  avatarContext.fillRect(0, 0, 64, 64);

  const overlay = createCanvas(64, 64);
  const overlayContext = overlay.getContext("2d");
  overlayContext.strokeStyle = "#30c8ff";
  overlayContext.lineWidth = 5;
  overlayContext.beginPath();
  overlayContext.arc(32, 32, 29, 0, Math.PI * 2);
  overlayContext.stroke();

  const result = await addon.composeStaticSticker({
    source: avatar.toBuffer("image/png"),
    overlay: overlay.toBuffer("image/png"),
    size: 64,
    avatarSize: 52,
    offset: 6,
    quality: 68
  });

  assert.equal(result.format, "webp");
  assert.equal(result.width, 64);
  assert.equal(result.height, 64);
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.buffer.subarray(0, 4).toString(), "RIFF");
  assert.equal(result.buffer.subarray(8, 12).toString(), "WEBP");

  assert.ok(result.buffer.length > 32);
  assert.ok(result.buffer.length < 512 * 1024);
});
