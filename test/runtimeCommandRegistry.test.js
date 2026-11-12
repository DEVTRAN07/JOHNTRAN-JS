"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const registry = require("../core/runtime/commandRegistry");
test("direct names take precedence over aliases", () => {
  const aliasTarget = { config: { aliases: ["help"] } };
  const directTarget = { config: { aliases: [] } };
  const commands = new Map([["menu", aliasTarget], ["help", directTarget]]);
  assert.equal(registry.resolve(commands, "help"), directTarget);
});
test("invalidation refreshes aliases after hot reload", () => {
  const first = { config: { aliases: ["old"] } };
  const commands = new Map([["first", first]]);
  assert.equal(registry.resolve(commands, "old"), first);
  const second = { config: { aliases: ["new"] } };
  commands.set("first", second);
  registry.invalidate(commands);
  assert.equal(registry.resolve(commands, "new"), second);
  assert.equal(registry.resolve(commands, "old"), null);
});
test("unknown command returns null", () => assert.equal(registry.resolve(new Map(), "missing"), null));
