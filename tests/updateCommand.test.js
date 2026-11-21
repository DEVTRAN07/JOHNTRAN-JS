"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const updateCommand = require("../plugins/commands/update");

test("update command accepts the single-bot supervisor IPC runtime", () => {
  assert.equal(updateCommand._test.isSupportedUpdateRuntime({
    JT_UPDATE_SUPERVISOR: "1"
  }, () => {}), true);
});

test("update command accepts Panel-managed child IPC runtime", () => {
  assert.equal(updateCommand._test.isSupportedUpdateRuntime({
    JT_PANEL_CHILD: "1"
  }, () => {}), true);
});

test("update command rejects direct process execution without a manager", () => {
  assert.equal(updateCommand._test.isSupportedUpdateRuntime({}, undefined), false);
  assert.equal(updateCommand._test.isSupportedUpdateRuntime({
    JT_UPDATE_SUPERVISOR: "0",
    JT_PANEL_CHILD: "0"
  }, () => {}), false);
});
