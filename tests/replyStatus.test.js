"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapApi } = require("../core/message");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createWrapped(options = {}) {
  const reactions = [];
  const sent = [];
  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      return { message: { msgId: String(sent.length), cliMsgId: String(sent.length) } };
    },
    addReaction(reaction, destination) {
      reactions.push({ reaction, destination });
      if (typeof options.onReaction === "function") return options.onReaction(reaction, destination);
      return Promise.resolve(true);
    }
  };
  const event = {
    threadId: "reply-status-test",
    type: 2,
    data: { msgId: "incoming-message", cliMsgId: "incoming-client-message" }
  };
  return {
    wrapped: wrapApi(api, event.threadId, event.type, "test", event),
    reactions,
    sent
  };
}

test("Reply.working schedules progress asynchronously instead of calling Zalo inline", async () => {
  const { wrapped, reactions } = createWrapped();

  await wrapped.__reply.working({ delayMs: 15 });
  assert.equal(reactions.length, 0, "progress should not be sent inline");
  await delay(40);
  assert.equal(reactions.length, 1);
});

test("first outgoing response cancels the pending working reaction", async () => {
  const { wrapped, reactions, sent } = createWrapped();

  await wrapped.__reply.working({ delayMs: 15 });
  await wrapped.sendMessage({ msg: "Kết quả lệnh", recallAfterMs: 0 });
  await delay(40);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg, "Kết quả lệnh");
  assert.equal(reactions.length, 0);
});

test("done and failed dispatch reactions without awaiting the Zalo API", async () => {
  let reactionCalls = 0;
  const { wrapped } = createWrapped({
    onReaction: () => {
      reactionCalls++;
      return new Promise(resolve => setTimeout(resolve, 40));
    }
  });

  await wrapped.__reply.done();
  await wrapped.__reply.failed();
  assert.equal(reactionCalls, 0, "status reactions must not run inline");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reactionCalls, 2, "both decorative reactions are dispatched later");
  await delay(50);
});

test("working does not schedule a duplicate after its acknowledgement was sent", async () => {
  const { wrapped, reactions } = createWrapped();

  await wrapped.__reply.working({ delayMs: 5 });
  await delay(25);
  await wrapped.__reply.working({ delayMs: 5 });
  await delay(25);

  assert.equal(reactions.length, 1);
});
