"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createCanvas } = require("canvas");
const workerPool = require("../core/workerPool");

test("QR worker decodes image pixels outside the main thread", async () => {
  const canvas = createCanvas(16, 16);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 16, 16);
  const buffer = canvas.toBuffer("image/png");

  const result = await workerPool.runInWorker("qrWorker", { buffer }, {
    timeout: 10000,
    size: 1,
    maxPending: 4
  });

  assert.equal(result, null, "a valid image without a QR code should decode to null");
  assert.equal(workerPool.poolSize("qrWorker"), 1);
});

test.after(async () => {
  await workerPool.shutdown();
});
