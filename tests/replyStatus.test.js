"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapApi } = require("../core/message");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createWrapped() {
  const reactions = [];
  const sent = [];
  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      return { message: { msgId: String(sent.length), cliMsgId: String(sent.length) } };
    },
    async addReaction(reaction, destination) {
      reactions.push({ reaction, destination });
      return true;
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

  const startedAt = Date.now();
  await wrapped.__reply.working({ delayMs: 10 });

  assert.ok(Date.now() - startedAt < 10, "working() must not wait for Zalo");
  assert.equal(reactions.length, 0, "the progress reaction should be delayed");
  await delay(30);
  assert.equal(reactions.length, 1);
});

test("first outgoing response cancels the pending working reaction", async () => {
  const { wrapped, reactions, sent } = createWrapped();

  await wrapped.__reply.working({ delayMs: 10 });
  await wrapped.sendMessage({ msg: "Kết quả lệnh" });
  await delay(30);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg, "Kết quả lệnh");
  assert.equal(reactions.length, 0);
});

test("done and failed dispatch reactions without awaiting the Zalo API", async () => {
  let reactionCalls = 0;
  const api = {
    async sendMessage() {
      return { message: { msgId: "1", cliMsgId: "1" } };
    },
    addReaction() {
      reactionCalls++;
      return new Promise(() => {});
    }
  };
  const event = {
    threadId: "reply-status-nonblocking",
    type: 2,
    data: { msgId: "incoming", cliMsgId: "incoming-client" }
  };
  const wrapped = wrapApi(api, event.threadId, event.type, "test", event);

  await wrapped.__reply.done();
  await wrapped.__reply.failed();
  assert.equal(reactionCalls, 0, "status reactions must not run inline");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reactionCalls, 2, "both decorative reactions are dispatched later");
});

test("working does not schedule a duplicate after its acknowledgement was sent", async () => {
  const { wrapped, reactions } = createWrapped();

  await wrapped.__reply.working({ delayMs: 5 });
  await delay(20);
  await wrapped.__reply.working({ delayMs: 5 });
  await delay(20);

  assert.equal(reactions.length, 1);
});

test("Canvas sentence colors cycle through the palette without hash collisions", () => {
  const { createCanvas } = require("canvas");
  const theme = require("../core/canvas/theme");
  const ctx = createCanvas(1000, 120).getContext("2d");
  const colors = [];
  const original = ctx.fillText.bind(ctx);
  ctx.fillText = (value, x, y) => {
    if (/[\\p{L}\\p{N}]/u.test(String(value))) colors.push(ctx.fillStyle);
    return original(value, x, y);
  };

  theme.drawMulticolorText(ctx, "JOHNTRAN nhiều màu sắc tiếng Việt", 20, 58, {
    size: 28,
    color: theme.PALETTE.ink,
    multicolor: true,
    colorSeed: "fixed-test-seed"
  });

  assert.equal(new Set(colors).size, 6);
  assert.ok(colors.every((color, index) => index === 0 || color !== colors[index - 1]));
});
