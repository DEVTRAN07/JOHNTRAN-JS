const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createCanvas, loadImage } = require("canvas");
const { test } = require("node:test");
const { withMacWindow } = require("../core/canvas/macWindow");
const theme = require("../core/canvas/theme");

test("card gets a macOS title bar with traffic-light controls", () => {
  const content = createCanvas(750, 300);
  const ctx = content.getContext("2d");
  ctx.fillStyle = "#123456";
  ctx.fillRect(0, 0, content.width, content.height);

  const card = withMacWindow(content, "Preview");
  const output = card.getContext("2d");
  const toolbarHeight = 44;
  const contentInset = 12;

  assert.equal(card.width, 750);
  assert.equal(card.height, 358);
  assert.deepEqual(
    Array.from(output.getImageData(21, 22, 1, 1).data).slice(0, 3),
    [255, 95, 87]
  );
  assert.deepEqual(
    Array.from(output.getImageData(41, 22, 1, 1).data).slice(0, 3),
    [254, 188, 46]
  );
  assert.deepEqual(
    Array.from(output.getImageData(61, 22, 1, 1).data).slice(0, 3),
    [40, 200, 64]
  );
  assert.deepEqual(
    Array.from(output.getImageData(300, toolbarHeight + contentInset + 19, 1, 1).data).slice(0, 3),
    [18, 52, 86]
  );
  assert.deepEqual(
    Array.from(output.getImageData(375, toolbarHeight + 10, 1, 1).data).slice(0, 3),
    [8, 9, 13]
  );
});

test("shared card image output includes the macOS window frame", async () => {
  const content = createCanvas(750, 300);
  const filePath = theme.save(content, "menu");

  try {
    const image = await loadImage(fs.readFileSync(filePath));
    assert.equal(image.width, 750);
    assert.equal(image.height, 358);
  } finally {
    fs.unlinkSync(filePath);
  }
});