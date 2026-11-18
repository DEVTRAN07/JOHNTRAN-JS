"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const metrics = require("../core/metrics");
const timing = require("../core/runtime/messageTiming");
const { wrapApi } = require("../core/message");

test("first-response latency separates local processing from Zalo send RTT", async () => {
  const event = {
    threadId: "message-timing-test",
    type: 1,
    data: { msgId: "incoming-1", cliMsgId: "incoming-client-1" }
  };
  const beforeFirst = metrics.getFirstResponseLatencyStats(100)
    .find(item => item.command === "latency-test")?.count || 0;
  const beforeSendSuccess = metrics.getZaloSendLatencyStats().success;

  timing.markReceived(event);
  await new Promise(resolve => setTimeout(resolve, 8));
  timing.markCommand(event, "latency-test");

  const api = {
    async sendMessage() {
      await new Promise(resolve => setTimeout(resolve, 12));
      return { message: { msgId: "reply-1", cliMsgId: "reply-client-1" }, attachment: [] };
    }
  };
  const wrapped = wrapApi(api, event.threadId, event.type, "latency-test", event);
  await wrapped.sendMessage({ msg: "first response", recallAfterMs: 0 });

  const first = metrics.getFirstResponseLatencyStats(100)
    .find(item => item.command === "latency-test");
  const send = metrics.getZaloSendLatencyStats();

  assert.ok(first);
  assert.equal(first.count, beforeFirst + 1);
  assert.ok(first.avgMs >= 5, "first response should include the intentional local delay");
  assert.equal(send.success, beforeSendSuccess + 1);
  assert.ok(send.lastMs >= 8, "Zalo RTT should include the mocked network delay");
});

test("only the first send per incoming event counts as first response", async () => {
  const event = {
    threadId: "message-timing-test",
    type: 1,
    data: { msgId: "incoming-2", cliMsgId: "incoming-client-2" }
  };
  const before = metrics.getFirstResponseLatencyStats(100)
    .find(item => item.command === "latency-multi-send")?.count || 0;
  timing.markReceived(event);
  timing.markCommand(event, "latency-multi-send");

  const api = { async sendMessage() { return { message: { msgId: 1, cliMsgId: "1" }, attachment: [] }; } };
  const wrapped = wrapApi(api, event.threadId, event.type, "latency-multi-send", event);
  await wrapped.sendMessage({ msg: "one", recallAfterMs: 0 });
  await wrapped.sendMessage({ msg: "two", recallAfterMs: 0 });

  const after = metrics.getFirstResponseLatencyStats(100)
    .find(item => item.command === "latency-multi-send");
  assert.equal(after.count, before + 1);
});
