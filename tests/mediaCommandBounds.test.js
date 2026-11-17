"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vdgirl = require("../plugins/commands/vdgirl");
const girl = require("../plugins/commands/girl");

test("/vdgirl bounds external video source attempts", () => {
  assert.equal(vdgirl._test.MAX_SOURCE_ATTEMPTS, 3);
  assert.ok(vdgirl._test.SOURCE_TIMEOUT_MS <= 15000);
});

test("/girl bounds external image source attempts", () => {
  assert.equal(girl._test.MAX_SOURCE_ATTEMPTS, 4);
  assert.ok(girl._test.SOURCE_TIMEOUT_MS <= 10000);
});
