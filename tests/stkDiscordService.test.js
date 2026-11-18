"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createCanvas } = require("canvas");
const service = require("../core/stkDiscordService");
const stickerService = require("../core/stickerService");

const FFMPEG = stickerService.resolveFfmpegBinary();
const ffmpegAvailable = spawnSync(FFMPEG, ["-version"], { stdio: "ignore" }).status === 0;
const encoderProbe = ffmpegAvailable
  ? spawnSync(FFMPEG, ["-hide_banner", "-encoders"], { encoding: "utf8" })
  : null;
const webpAvailable = Boolean(encoderProbe) &&
  /\blibwebp\b/.test(String(encoderProbe.stdout || "") + String(encoderProbe.stderr || ""));

test("Discord STK compositor produces a transparent 288px WebP with a circular avatar", {
  skip: !ffmpegAvailable || !webpAvailable
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-stk-discord-render-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sourcePath = path.join(dir, "avatar.png");
  const sourceCanvas = createCanvas(180, 120);
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.fillStyle = "#ef4b42";
  sourceCtx.fillRect(0, 0, 180, 120);
  const sourceBuffer = sourceCanvas.toBuffer("image/png");
  fs.writeFileSync(sourcePath, sourceBuffer);

  const framePath = path.join(dir, "frame.png");
  const frameCanvas = createCanvas(288, 288);
  const frameCtx = frameCanvas.getContext("2d");
  frameCtx.clearRect(0, 0, 288, 288);
  assert.equal(frameCtx.getImageData(0, 0, 1, 1).data[3], 0,
    "fixture Discord frame starts with transparent corners");
  frameCtx.strokeStyle = "#7e57ff";
  frameCtx.lineWidth = 10;
  frameCtx.strokeRect(14, 14, 260, 260);
  fs.writeFileSync(framePath, frameCanvas.toBuffer("image/png"));

  const output = await service.createWebp(sourcePath, sourceBuffer, ".png", framePath);
  assert.equal(output.width, 288);
  assert.equal(output.height, 288);
  assert.equal(output.animated, false);
  assert.ok(output.size > 100);
  assert.ok(output.size <= service.MAX_OUTPUT_BYTES);
  assert.ok(fs.existsSync(output.path));

  const decoded = spawnSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-i", output.path,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
  ], { encoding: null, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(decoded.status, 0, String(decoded.stderr || ""));
  const pixelAlpha = (x, y) => decoded.stdout[(y * 288 + x) * 4 + 3];
  assert.equal(pixelAlpha(0, 0), 0, "canvas corner remains transparent");
  assert.equal(pixelAlpha(144, 144), 255, "avatar centre remains opaque");
  assert.equal(pixelAlpha(24, 144), 0, "avatar left edge begins at x=24");
  assert.ok(pixelAlpha(36, 144) > 0, "avatar is placed at the Python offset");
  fs.rmSync(output.path, { force: true });
});
