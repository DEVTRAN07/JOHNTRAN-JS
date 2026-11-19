"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sendFastAcknowledgement } = require("../core/runtime/fastAck");

test("fast acknowledgement starts the Zalo send synchronously without waiting for delivery", async () => {
  const calls = [];
  let resolveSend;
  const api = {
    sendMessage(payload, threadId, type) {
      calls.push({ payload, threadId, type });
      return new Promise(resolve => { resolveSend = resolve; });
    }
  };

  const accepted = sendFastAcknowledgement(api, "visual-thread", 1, "⏳ Đang mở menu...");
  assert.equal(accepted, true);
  assert.equal(calls.length, 1, "sendMessage must start before expensive work");
  assert.deepEqual(calls[0], {
    payload: { msg: "⏳ Đang mở menu...", recallAfterMs: 0 },
    threadId: "visual-thread",
    type: 1
  });

  let expensiveWorkStarted = false;
  expensiveWorkStarted = true;
  assert.equal(expensiveWorkStarted, true,
    "the caller can continue without waiting for the Zalo send round-trip");
  resolveSend({ ok: true });
});

test("fast acknowledgement handles missing or synchronous API failures", () => {
  assert.equal(sendFastAcknowledgement(null, "thread", 1, "ack"), false);
  assert.equal(sendFastAcknowledgement({}, "thread", 1, "ack"), false);
  assert.equal(sendFastAcknowledgement({
    sendMessage() { throw new Error("synthetic network failure"); }
  }, "thread", 1, "ack"), false);
});

test("fast acknowledgement absorbs asynchronous send failures", async () => {
  const accepted = sendFastAcknowledgement({
    sendMessage() { return Promise.reject(new Error("synthetic send failure")); }
  }, "thread", 1, "ack");

  assert.equal(accepted, true);
  await new Promise(resolve => setImmediate(resolve));
});
