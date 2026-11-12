"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapApi } = require("../core/message");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createWrapped() {
  const sent = [];
  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      return { message: { msgId: sent.length, cliMsgId: sent.length } };
    },
    async sendVoice(payload) {
      sent.push({ voice: payload });
      return { message: { msgId: sent.length, cliMsgId: sent.length } };
    }
  };
  const event = { threadId: "ack-group", type: 2, data: { msgId: 1, cliMsgId: 1 } };
  return { wrapped: wrapApi(api, event.threadId, event.type, "slowcmd", event), sent };
}

test("universal processing acknowledgement is disabled", async () => {
  const { wrapped, sent } = createWrapped();
  assert.equal(wrapped.__reply.scheduleAcknowledgement({ delayMs: 10 }), false);
  await delay(30);
  assert.equal(sent.length, 0);
  assert.equal(sent.some(item => /Đang xử lý lệnh/.test(item.msg || "")), false);
});

test("command sends only its own text result", async () => {
  const { wrapped, sent } = createWrapped();
  wrapped.__reply.scheduleAcknowledgement({ delayMs: 10 });
  await wrapped.sendMessage({ msg: "Kết quả lệnh" }, "ack-group", 2);
  await delay(30);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg, "Kết quả lệnh");
});

test("voice/media command output does not get a processing text message", async () => {
  const { wrapped, sent } = createWrapped();
  wrapped.__reply.scheduleAcknowledgement({ delayMs: 10 });
  await wrapped.sendVoice({ voiceUrl: "https://example.invalid/audio.aac" });
  await delay(30);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].voice);
});

test("slow outgoing text does not create a universal processing message", async () => {
  const sent = [];
  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      if (payload.msg === "Kết quả chậm") await delay(70);
      return { message: { msgId: sent.length, cliMsgId: sent.length } };
    }
  };
  const event = { threadId: "ack-slow-send", type: 2, data: { msgId: 1, cliMsgId: 1 } };
  const wrapped = wrapApi(api, event.threadId, event.type, "slowcmd", event);

  wrapped.__reply.scheduleAcknowledgement({ delayMs: 10 });
  await wrapped.sendMessage({ msg: "Kết quả chậm" });
  await delay(30);

  assert.equal(sent.length, 1);
  assert.equal(sent.some(item => /Đang xử lý lệnh/.test(item.msg || "")), false);
});

test("slow dispatcher handler does not send a universal processing message", async () => {
  const { dispatchCommand } = require("../core/runtime/dispatcher");
  const { wrapped, sent } = createWrapped();

  await dispatchCommand({
    command: { run: async () => delay(25) },
    commandName: "slowcmd",
    args: [],
    event: { data: { content: "/slowcmd" }, mentions: [] },
    api: wrapped,
    logger: { log() {} },
    metrics: { track() {} },
    Reactions: { PRAY: "working", OK: "ok", CRY: "cry" }
  });

  assert.equal(sent.length, 0);
});
