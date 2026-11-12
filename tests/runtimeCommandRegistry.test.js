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

test("ambiguous aliases are not silently routed to the first command", () => {
  const first = { config: { name: "first", aliases: ["shared"] } };
  const second = { config: { name: "second", aliases: ["shared"] } };
  const commands = new Map([["first", first], ["second", second]]);

  assert.equal(registry.resolve(commands, "shared"), null);
  assert.deepEqual(registry.getAliasConflicts(commands), [
    { alias: "shared", commands: ["first", "second"] }
  ]);
});

test("unknown command returns null", () => {
  assert.equal(registry.resolve(new Map(), "missing"), null);
});
