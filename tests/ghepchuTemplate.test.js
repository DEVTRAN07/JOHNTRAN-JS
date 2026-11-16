"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadImage } = require("canvas");
const { TEMPLATE_PATH } = require("../core/canvas/ghepchu");

test("ghép chữ uses the supplied 1280x780 match screenshot as its template", async () => {
  const image = await loadImage(TEMPLATE_PATH);
  assert.equal(image.width, 1280, "template width should match the supplied image");
  assert.equal(image.height, 780, "template height should match the supplied image");
});
