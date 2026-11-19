"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRegistry,
  getEventRegistry,
  invalidateEventRegistry,
  dispatchEvent
} = require("../core/runtime/eventRegistry");

test("event registry indexes event subscriptions and command event handlers", () => {
  const events = new Map([
    ["join", { config: { event_type: ["group_event", "message"] }, run() {} }],
    ["broken", { config: {}, run() {} }],
    ["no-run", { config: { event_type: ["message"] } }]
  ]);
  const commands = new Map([
    ["anti", { handleEvent() {} }],
    ["normal", { run() {} }]
  ]);
  const registry = buildRegistry(events, commands);
  assert.deepEqual(registry.eventHandlers.get("message").map(x => x.name), ["join"]);
  assert.deepEqual(registry.eventHandlers.get("group_event").map(x => x.name), ["join"]);
  assert.deepEqual(registry.commandHandlers.map(x => x.name), ["anti"]);
});

test("dispatch keeps event plugins before command handleEvent modules", async () => {
  const order = [];
  const events = new Map([
    ["first", { config: { event_type: ["reaction"] }, run() {} }],
    ["second", { config: { event_type: ["message"] }, run() {} }]
  ]);
  const commands = new Map([
    ["command-a", { handleEvent() {} }],
    ["command-b", { handleEvent() {} }]
  ]);

  const counts = dispatchEvent({
    events, commands, eventType: "reaction",
    onEventModule: async (_module, name) => { order.push(name); },
    onCommandModule: async (_module, name) => { order.push(name); },
    onError: (error) => { throw error; }
  });
  assert.deepEqual(counts, { eventModules: 1, commandModules: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ["first", "command-a", "command-b"]);
});

test("registry cache can be invalidated after hot reload", () => {
  const events = new Map([["old", { config: { event_type: ["message"] }, run() {} }]]);
  const commands = new Map();
  const before = getEventRegistry(events, commands);
  events.set("new", { config: { event_type: ["reaction"] }, run() {} });
  assert.equal(getEventRegistry(events, commands), before);
  invalidateEventRegistry(events);
  const after = getEventRegistry(events, commands);
  assert.notEqual(after, before);
  assert.equal(after.eventHandlers.get("reaction")[0].name, "new");
});


test("listener registration can be claimed only once per API instance", () => {
  const { claimListenerRegistration } = require("../core/listen");
  const api = {};
  assert.equal(claimListenerRegistration(api), true);
  assert.equal(claimListenerRegistration(api), false);
  assert.equal(claimListenerRegistration({}), true);
  assert.equal(claimListenerRegistration(null), false);
});


test("command event handlers run only for their declared event types", async () => {
  const called = [];
  const events = new Map();
  const commands = new Map([
    ["anti", { config: { event_type: ["message", "reaction", "undo", "group_event"] }, handleEvent() {} }],
    ["autodown", { config: { event_type: ["message"] }, handleEvent() {} }],
    ["autokick", { config: { event_type: ["message"] }, handleEvent() {} }],
    ["legacy", { handleEvent() {} }]
  ]);

  const reaction = dispatchEvent({
    events, commands, eventType: "reaction",
    onCommandModule: async (_module, name) => { called.push(name); }
  });
  assert.equal(reaction.commandModules, 2, "Anti and untyped legacy handlers match reaction");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(called, ["anti", "legacy"]);

  called.length = 0;
  const message = dispatchEvent({
    events, commands, eventType: "message",
    onCommandModule: async (_module, name) => { called.push(name); }
  });
  assert.equal(message.commandModules, 4);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(called, ["anti", "autodown", "autokick", "legacy"]);
});

test("dispatch can skip Guard only when the listener confirmed its switch is OFF", async () => {
  const calls = [];
  const events = new Map([
    ["guard", {
      config: { name: "guard", event_type: ["message"], allowCommandMessages: true },
      run() {}
    }],
    ["custom", {
      config: { name: "custom", event_type: ["message"], allowCommandMessages: true },
      run() {}
    }]
  ]);
  const commands = new Map([
    ["anti", {
      config: { name: "anti", event_type: ["message"], allowCommandMessages: true },
      handleEvent() {}
    }]
  ]);

  const skipped = dispatchEvent({
    events,
    commands,
    eventType: "message",
    dispatchOptions: { isCommandMessage: true, skipGuard: true, skipAnti: true },
    onEventModule: async (_module, name) => calls.push(name),
    onCommandModule: async (_module, name) => calls.push(name)
  });
  assert.deepEqual(skipped, { eventModules: 1, commandModules: 0 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["custom"]);

  calls.length = 0;
  const active = dispatchEvent({
    events,
    commands,
    eventType: "message",
    dispatchOptions: { isCommandMessage: true },
    onEventModule: async (_module, name) => calls.push(name),
    onCommandModule: async (_module, name) => calls.push(name)
  });
  assert.deepEqual(active, { eventModules: 2, commandModules: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["guard", "custom", "anti"]);
});
