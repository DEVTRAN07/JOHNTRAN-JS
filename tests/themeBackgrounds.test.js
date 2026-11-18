"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const themeBackgrounds = require("../core/canvas/themeBackgrounds");

test("photo wallpaper gallery exposes all three requested JPG sources", () => {
  const items = themeBackgrounds.getBackgrounds();
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(item => item.id), ["1", "2", "3"]);
  assert.match(items[0].url, /hinh-nen-gai-xinh-sexy-27\.jpg$/);
  assert.match(items[1].url, /hinh-nen-gai-xinh-sexy-18\.jpg$/);
  assert.match(items[2].url, /hinh-nen-gai-xinh-sexy-16\.jpg$/);
  assert.equal(path.basename(themeBackgrounds.THEME_DIR), "theme");
  assert.ok(fs.existsSync(path.join(themeBackgrounds.THEME_DIR, "README.md")));
});

test("photo theme selection accepts numbered, random, reset and next commands", () => {
  assert.equal(themeBackgrounds.normalizeSelection("1"), "1");
  assert.equal(themeBackgrounds.normalizeSelection("2"), "2");
  assert.equal(themeBackgrounds.normalizeSelection("3"), "3");
  assert.equal(themeBackgrounds.normalizeSelection("random"), "random");
  assert.equal(themeBackgrounds.normalizeSelection("reset"), "random");
  assert.equal(themeBackgrounds.normalizeSelection("next", "1"), "2");
  assert.equal(themeBackgrounds.normalizeSelection("next", "3"), "1");
  assert.equal(themeBackgrounds.normalizeSelection("invalid"), null);
});

test("legacy saved photo selections migrate to random mode", () => {
  assert.equal(themeBackgrounds.resolveStoredSelection({ selected: "2" }), "random");
  assert.equal(themeBackgrounds.resolveStoredSelection({ selected: "3", updatedAt: "old" }), "random");
});

test("random is the default mode while explicit numbered selections remain supported", () => {
  assert.equal(themeBackgrounds.resolveStoredSelection({ selected: "random", mode: "random" }), "random");
  assert.equal(themeBackgrounds.resolveStoredSelection({ selected: "2", mode: "manual" }), "2");
  assert.equal(themeBackgrounds.resolveStoredSelection({ selected: "invalid", mode: "manual" }), "random");
});
