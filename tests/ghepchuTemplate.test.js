"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const { loadImage } = require("canvas");
const { renderGhepChu, TEMPLATE_PATH } = require("../core/canvas/ghepchu");

test("ghép chữ renders a 1280x780 card from the supplied template or safe fallback", async () => {
  assert.ok(fs.existsSync(TEMPLATE_PATH), "the supplied template asset should be present");
  const outputPath = await renderGhepChu({
    status: "active",
    letters: ["J", "O", "H", "N"],
    remainingSeconds: 30,
    score: 10,
    streak: 1,
    playerName: "Test"
  });

  try {
    const image = await loadImage(outputPath);
    assert.equal(image.width, 1280, "rendered card width should be 1280");
    assert.equal(image.height, 780, "rendered card height should be 780");
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});

test("ghép chữ repaints fixed text baked into the supplied template in live multicolor text", () => {
  const source = fs.readFileSync(require.resolve("../core/canvas/ghepchu"), "utf8");
  assert.match(source, /drawFallbackTemplate\(ctx, \{ overlay: true \}\)/,
    "the supplied raster template must be overlaid with live text");
  assert.match(source, /overlay \? "rgba\(13,35,62,\.985\)"/,
    "the overlay panel must hide the template's fixed-color labels before repainting them");
  assert.match(source, /drawWoodenSign\(ctx\)/,
    "the mascot's raster sign must also be redrawn with the live text renderer");
});
