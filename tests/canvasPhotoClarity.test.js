"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sharpenPhotoImageData } = require("../core/canvas/theme");

test("photo sharpening increases local edge contrast and preserves alpha", () => {
  const width = 3;
  const height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 100;
    data[i + 1] = 100;
    data[i + 2] = 100;
    data[i + 3] = 255;
  }
  const center = (1 * width + 1) * 4;
  data[center] = 180;
  data[center + 1] = 180;
  data[center + 2] = 180;

  const imageData = { width, height, data };
  const result = sharpenPhotoImageData(imageData, 0.5);

  assert.equal(result, imageData);
  assert.ok(result.data[center] > 180);
  assert.ok(result.data[center + 1] > 180);
  assert.ok(result.data[center + 2] > 180);
  assert.equal(result.data[center + 3], 255);
});

test("photo sharpening clamps its strength and leaves transparent alpha untouched", () => {
  const data = new Uint8ClampedArray(4 * 4 * 4).fill(128);
  for (let i = 3; i < data.length; i += 4) data[i] = 77;
  const imageData = { width: 4, height: 4, data };

  assert.equal(sharpenPhotoImageData(imageData, 0), imageData);
  assert.throws(() => sharpenPhotoImageData({ width: 2, height: 2 }), /ImageData/);
  assert.ok(Array.from(data).filter((_, index) => index % 4 === 3).every(value => value === 77));
});
