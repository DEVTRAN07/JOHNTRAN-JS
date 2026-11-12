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
