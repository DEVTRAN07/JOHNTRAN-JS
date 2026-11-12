"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCipherReadyGate, requestOldMessagesThen } = require("../core/topchat/historyBootstrap");
const { EventEmitter } = require("node:events");
const { ThreadType } = require("zalo-client");

test("history requests wait until the WebSocket cipher key is ready", () => {
  const calls = [];
  const gate = createCipherReadyGate(generation => calls.push(generation));

  assert.equal(gate.cipherReady(), false, "cipher frames before connection are ignored");
  gate.connected();
  assert.equal(gate.waiting, true);
  assert.deepEqual(calls, [], "connected alone must not request encrypted history");

  assert.equal(gate.cipherReady(), true);
  assert.deepEqual(calls, [1]);
  assert.equal(gate.waiting, false);
  assert.equal(gate.cipherReady(), false, "one cipher key starts only one history sync");
});

test("reconnect requires a fresh cipher key before starting another history sync", () => {
  const calls = [];
  const gate = createCipherReadyGate(generation => calls.push(generation));

  gate.connected();
  gate.disconnected();
  assert.equal(gate.cipherReady(), false);
  assert.deepEqual(calls, []);

  gate.connected();
  assert.equal(gate.cipherReady(), true);
  assert.deepEqual(calls, [2]);
  gate.connected();
  assert.equal(gate.waiting, true);
  assert.equal(gate.cipherReady(), true);
  assert.deepEqual(calls, [2, 3]);
});

test("history requests are serialized: wait for DM old_messages before requesting groups", async () => {
  const listener = new EventEmitter();
  const requests = [];
  listener.requestOldMessages = type => requests.push(type);
  const flow = requestOldMessagesThen(listener, ThreadType.User, () => {
    listener.requestOldMessages(ThreadType.Group);
  }, 1000);

  assert.deepEqual(requests, [ThreadType.User]);
  listener.emit("old_messages", [], ThreadType.User);
  assert.equal(await flow.promise, "response");
  assert.deepEqual(requests, [ThreadType.User, ThreadType.Group]);
  assert.equal(listener.listenerCount("old_messages"), 0);
});

test("history serialization advances after DM timeout and can be cancelled on disconnect", async () => {
  const listener = new EventEmitter();
  const requests = [];
  listener.requestOldMessages = type => requests.push(type);
  let nextCalls = 0;
  const timed = requestOldMessagesThen(listener, ThreadType.User, () => { nextCalls++; }, 100);
  assert.equal(await timed.promise, "timeout");
  assert.equal(nextCalls, 1);
  assert.equal(listener.listenerCount("old_messages"), 0);

  const cancelled = requestOldMessagesThen(listener, ThreadType.User, () => { nextCalls++; }, 1000);
  assert.equal(cancelled.cancel(), true);
  assert.equal(await cancelled.promise, "cancelled");
  assert.equal(nextCalls, 1);
  assert.equal(listener.listenerCount("old_messages"), 0);
});
