"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapApi, _test } = require("../core/message");

test("text-only replies bypass the Canvas caption module", async () => {
  const captionModulePath = require.resolve("../core/canvas/attachmentCaption");
  delete require.cache[captionModulePath];

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
  assert.equal(sent[0].threadId, "fast-path-thread");
  assert.equal(sent[0].type, 1);
  assert.equal(
    require.cache[captionModulePath],
    undefined,
    "a text-only reply must not load node-canvas caption code"
  );
});

test("only eligible single-image captions enter the Canvas path", () => {
  assert.equal(_test.shouldPrepareImageCaption({
    msg: "Caption của card",
    attachments: ["/tmp/card.png"]
  }), true);

  assert.equal(_test.shouldPrepareImageCaption({ msg: "Tin nhắn chữ" }), false);
  assert.equal(_test.shouldPrepareImageCaption({
    msg: "Ảnh kèm caption",
    attachments: ["/tmp/one.png", "/tmp/two.png"]
  }), false);
  assert.equal(_test.shouldPrepareImageCaption({
    msg: "Caption có quote",
    attachments: ["/tmp/card.png"],
    quote: { msgId: "quoted-message" }
  }), false);
  assert.equal(_test.shouldPrepareImageCaption({
    msg: "   ",
    attachments: ["/tmp/card.png"]
  }), false);
  assert.equal(_test.shouldPrepareImageCaption({
    msg: "@. xin chào",
    mentions: [{ uid: "member-id" }],
    attachments: ["/tmp/card.png"]
  }), false);
});
