"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createZaloAdapter } = require("../core/runtime/adapters/zalo");

test("Zalo adapter delegates thread wrapping without changing arguments", () => {
  const calls = [];
  const wrapped = { __reply: { text() {} } };
  const adapter = createZaloAdapter({
    wrapApi: (...args) => { calls.push(args); return wrapped; },
    Reply: class Reply {},
    DEFAULT_AUTO_RECALL_MS: 60000
  });
  const api = { sendMessage() {} };
  const event = { threadId: "g1", type: 2 };
  assert.equal(adapter.wrapForThread(api, "g1", 2, "menu", event), wrapped);
  assert.deepEqual(calls[0], [api, "g1", 2, "menu", event]);
});

test("Zalo adapter derives event routing fields and accepts explicit thread type", () => {
  const calls = [];
  const adapter = createZaloAdapter({
    wrapApi: (...args) => { calls.push(args); return args; }
  });
  const api = {};
  const event = { threadId: "g2", type: 1 };
  assert.deepEqual(adapter.wrapForEvent(api, event, "group_event"), [
    api, "g2", 1, "group_event", event
  ]);
  assert.deepEqual(adapter.wrapForEvent(api, event, "group_event", 2), [
    api, "g2", 2, "group_event", event
  ]);
  assert.throws(() => createZaloAdapter({}), /wrapApi\(\)/);
});

test("Zalo adapter exposes legacy Reply metadata without wrapping API methods itself", () => {
  class Reply {}
  const adapter = createZaloAdapter({ wrapApi() {}, Reply, DEFAULT_AUTO_RECALL_MS: 1234 });
  assert.equal(adapter.Reply, Reply);
  assert.equal(adapter.DEFAULT_AUTO_RECALL_MS, 1234);
});
