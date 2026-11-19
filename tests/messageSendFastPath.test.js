"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapApi, _test } = require("../core/message");

test("text-only replies stay on the short styled-message path", async () => {
  const sent = [];
  const api = {
    async sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId, type });
      return { message: null, attachment: [] };
    }
  };

  const wrapped = wrapApi(api, "fast-path-thread", 1, "fast-path-test");
  await wrapped.sendMessage({ msg: "Phản hồi chữ", recallAfterMs: 0 });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.msg, "Phản hồi chữ");
  assert.ok(sent[0].payload.styles.length > 0);
  assert.equal(sent[0].threadId, "fast-path-thread");
  assert.equal(sent[0].type, 1);
});

test("wrapped Zalo send records request start before API completion", async () => {
  const metrics = require("../core/metrics");
  const { performance } = require("node:perf_hooks");
  const event = {
    threadId: "first-send-start-wrapper",
    type: 1,
    data: { cliMsgId: "first-send-start-wrapper-1" }
  };
  const commandName = "first-send-probe";
  const beforeStart = metrics.getFirstResponseStartLatencyByCommandStats(100)
    .find(item => item.command === commandName)?.count || 0;
  const beforeComplete = metrics.getFirstResponseLatencyByCommandStats(100)
    .find(item => item.command === commandName)?.count || 0;
  metrics.trackIncomingMessage(event, performance.now());

  let resolveSend;
  const api = {
    sendMessage() {
      return new Promise(resolve => { resolveSend = resolve; });
    }
  };
  const wrapped = wrapApi(api, event.threadId, event.type, commandName, event);
  const pending = wrapped.sendMessage({ msg: "first response", recallAfterMs: 0 });

  const started = metrics.getFirstResponseStartLatencyByCommandStats(100)
    .find(item => item.command === commandName);
  assert.equal(started?.count, beforeStart + 1,
    "the first-send metric must be recorded when the Zalo API call starts");
  assert.equal(
    metrics.getFirstResponseLatencyByCommandStats(100)
      .find(item => item.command === commandName)?.count || 0,
    beforeComplete,
    "the completion metric must not be recorded while the API promise is pending"
  );

  resolveSend({ message: null, attachment: [] });
  await pending;
  assert.equal(
    metrics.getFirstResponseLatencyByCommandStats(100)
      .find(item => item.command === commandName)?.count,
    beforeComplete + 1
  );
});


test("image caption stays text below the Canvas in one styled message", async () => {
  const sent = [];
  const api = {
    async sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId, type });
      return { message: null, attachment: [] };
    }
  };
  const wrapped = wrapApi(api, "caption-fast-path-thread", 1, "caption-fast-path-test");
  const caption = "@Wuang\n🤖 Chào chủ nhân!\n👉 Dòng chữ nằm dưới card, không nằm trong ảnh.";
  const mention = { uid: "member-id", pos: 0, len: "@Wuang".length };

  await wrapped.sendMessage({
    msg: caption,
    attachments: ["/tmp/menu-card.png"],
    mentions: [mention],
    recallAfterMs: 0
  });

  assert.equal(sent.length, 1, "card and caption must remain one Zalo message");
  assert.equal(sent[0].payload.msg, caption, "caption remains text, not rasterized into the image");
  assert.deepEqual(sent[0].payload.attachments, ["/tmp/menu-card.png"]);
  assert.deepEqual(sent[0].payload.mentions, [mention]);
  assert.ok(sent[0].payload.styles.some(style => style.start >= caption.indexOf("🤖")),
    "caption text below the card receives style spans");
  assert.ok(sent[0].payload.styles.every(style => style.start >= mention.len || style.start + style.len <= 0),
    "color spans do not collide with Zalo's live mention range");
  assert.equal(sent[0].threadId, "caption-fast-path-thread");
  assert.equal(sent[0].type, 1);
});
