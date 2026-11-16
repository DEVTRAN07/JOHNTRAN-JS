"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const command = require("../plugins/commands/noitu");

test("Nối Từ is reachable through the short nt alias", () => {
  assert.equal(command.config.name, "noitu");
  assert.ok(command.config.aliases.includes("nt"));
});

test("bare nt guide contains the requested game modes and utilities", () => {
  const guide = command._test.help("!");
  for (const expected of [
    "@Wuang 📖 NỐI TỪ TIẾNG VIỆT",
    "!nt go",
    "!nt q",
    "!nt gc",
    "!nt room",
    "!nt bxh",
    "!nt check",
    "!nt words",
    "!nt on / off",
    "!nt reset"
  ]) {
    assert.ok(guide.includes(expected), "guide should include: " + expected);
  }
});
