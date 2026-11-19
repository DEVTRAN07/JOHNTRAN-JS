"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dispatchEvent,
  getEventRegistry,
  invalidateEventRegistry
} = require("../core/runtime/eventRegistry");

function eventPlugin(name, config = {}, calls = []) {
  return {
    config: { name, event_type: ["message"], ...config },
    async run() { calls.push(name); }
  };
}

function commandPlugin(name, config = {}, calls = []) {
  return {
    config: { name, event_type: ["message"], ...config },
    async handleEvent() { calls.push(name); }
  };
}

function dispatch(sources, dispatchOptions = {}) {
  const calls = [];
  const result = dispatchEvent({
    ...sources,
    eventType: "message",
    dispatchOptions,
    onEventModule: async (module, name) => module.run(name),
    onCommandModule: async (module, name) => module.handleEvent(name)
  });
  return { result, calls };
}

test("command messages only reach Guard, Anti and explicit opt-in subscribers", async () => {
  const calls = [];
  const events = new Map([
    ["guard", eventPlugin("guard", {}, calls)],
    ["rank", eventPlugin("rank", {}, calls)],
    ["topchatcounter", eventPlugin("topchatcounter", {}, calls)],
    ["custom", eventPlugin("custom", { allowCommandMessages: true }, calls)]
  ]);
  const commands = new Map([
    ["anti", commandPlugin("anti", {}, calls)],
    ["menu", commandPlugin("menu", {}, calls)],
    ["noitu", commandPlugin("noitu", { allowCommandMessages: true }, calls)],
    ["custom", commandPlugin("custom", { allowCommandMessages: true }, calls)]
  ]);
  const sources = { events, commands };
  const cachedRegistry = getEventRegistry(events, commands);

  const result = dispatchEvent({
    ...sources,
    eventType: "message",
    dispatchOptions: {
      isCommandMessage: true,
      skipGameConsumers: true,
      skipTopchatCounter: true
    },
    onEventModule: async (module, name) => module.run(name),
    onCommandModule: async (module, name) => module.handleEvent(name)
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result, { eventModules: 2, commandModules: 2 });
  assert.deepEqual(calls.sort(), ["anti", "custom", "custom", "guard"]);
  assert.strictEqual(getEventRegistry(events, commands), cachedRegistry,
    "command dispatch must reuse the same cached registry");
});

test("ordinary messages preserve normal subscribers while skipping duplicate game and Top Chat consumers", async () => {
  const calls = [];
  const events = new Map([
    ["guard", eventPlugin("guard", {}, calls)],
    ["rank", eventPlugin("rank", {}, calls)],
    ["topchatcounter", eventPlugin("topchatcounter", {}, calls)],
    ["noitu", eventPlugin("noitu", {}, calls)],
    ["tlmn", eventPlugin("tlmn", {}, calls)]
  ]);
  const commands = new Map([
    ["anti", commandPlugin("anti", {}, calls)],
    ["noitu", commandPlugin("noitu", {}, calls)],
    ["tlmn", commandPlugin("tlmn", {}, calls)],
    ["music", commandPlugin("music", {}, calls)]
  ]);

  const result = dispatchEvent({
    events,
    commands,
    eventType: "message",
    dispatchOptions: {
      skipGameConsumers: true,
      skipTopchatCounter: true
    },
    onEventModule: async (module, name) => module.run(name),
    onCommandModule: async (module, name) => module.handleEvent(name)
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result, { eventModules: 2, commandModules: 2 });
  assert.deepEqual(calls.sort(), ["anti", "guard", "music", "rank"]);
});

test("ignoreCommandMessages overrides explicit command-message opt-in", async () => {
  const calls = [];
  const events = new Map([
    ["ignored-event", eventPlugin("ignored-event", {
      allowCommandMessages: true,
      ignoreCommandMessages: true
    }, calls)]
  ]);
  const commands = new Map([
    ["ignored-command", commandPlugin("ignored-command", {
      allowCommandMessages: true,
      ignoreCommandMessages: true
    }, calls)]
  ]);

  const result = dispatchEvent({
    events,
    commands,
    eventType: "message",
    dispatchOptions: { isCommandMessage: true },
    onEventModule: async (module, name) => module.run(name),
    onCommandModule: async (module, name) => module.handleEvent(name)
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result, { eventModules: 0, commandModules: 0 });
  assert.deepEqual(calls, []);
});

test("invalidating plugin maps rebuilds the cached registry only after invalidation", () => {
  const events = new Map([["guard", eventPlugin("guard")]]);
  const commands = new Map([["anti", commandPlugin("anti")]]);
  const first = getEventRegistry(events, commands);
  assert.strictEqual(getEventRegistry(events, commands), first);
  invalidateEventRegistry(events);
  assert.notStrictEqual(getEventRegistry(events, commands), first);
});
