"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCanvas, loadImage } = require("canvas");
const frames = require("../core/stickerFrames");

test("Discord frame presets are numbered, unique, and have a default", () => {
  const list = frames.frameList();
  assert.equal(list.length, 5);
  assert.deepEqual(list.map(item => item.id), [1, 2, 3, 4, 5]);
  assert.equal(frames.normalizeFrameId(undefined), 1);
  assert.equal(frames.normalizeFrameId("5"), 5);
  assert.equal(frames.normalizeFrameId("6"), null);
  assert.equal(frames.getFrame(1).name, "Discord Classic");
});

test("Discord frame PNG is 512x512 with a transparent centre and visible border", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-discord-frame-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "frame.png");
  frames.renderFrame(1, output);
  const image = await loadImage(output);
  assert.equal(image.width, 512);
  assert.equal(image.height, 512);

  const canvas = createCanvas(512, 512);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, 512, 512).data;
  const alphaAt = (x, y) => pixels[(y * 512 + x) * 4 + 3];
  assert.equal(alphaAt(256, 256), 0, "the middle must remain transparent");
  assert.ok(alphaAt(24, 256) > 0, "the frame border should be visible");
  assert.ok(alphaAt(256, 472) > 0, "the Discord label plate should be visible");
});

test("Discord sample preview renders with the chosen frame overlay", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-discord-preview-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = await frames.renderSamplePreview(3, path.join(dir, "preview.png"));
  const image = await loadImage(output);
  assert.equal(image.width, 512);
  assert.equal(image.height, 512);
});
