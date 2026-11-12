"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCipherReadyGate } = require("../core/topchat/historyBootstrap");

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
