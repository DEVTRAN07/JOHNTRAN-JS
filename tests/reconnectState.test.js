"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createReconnectFailureTracker } = require("../core/topchat/reconnectState");

test("opening a socket does not reset consecutive handshake failures", () => {
  const tracker = createReconnectFailureTracker(3);
  assert.deepEqual(tracker.closed(), { count: 1, exhausted: false });
  // A socket-open event has no reset operation; another close increments it.
  assert.deepEqual(tracker.closed(), { count: 2, exhausted: false });
  assert.deepEqual(tracker.closed(), { count: 3, exhausted: true });
});

test("a completed cipher handshake resets the failure streak", () => {
  const tracker = createReconnectFailureTracker(3);
  tracker.closed();
  tracker.closed();
  tracker.markStable();
  assert.equal(tracker.count, 0);
  assert.deepEqual(tracker.closed(), { count: 1, exhausted: false });
});
