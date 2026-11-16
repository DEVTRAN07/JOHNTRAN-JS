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
