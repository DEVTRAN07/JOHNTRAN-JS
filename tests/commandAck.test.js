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

test("slow commands receive one early acknowledgement when no reply has started", async () => {
  const { wrapped, sent } = createWrapped();
  wrapped.__reply.scheduleAcknowledgement({
    delayMs: 15,
    message: "⏳ Đang xử lý lệnh /slowcmd..."
  });
  await delay(35);
  assert.equal(sent.length, 1);
  assert.match(sent[0].msg, /Đang xử lý lệnh \/slowcmd/);
});

test("a command's own first text reply cancels the universal acknowledgement", async () => {
  const { wrapped, sent } = createWrapped();
  wrapped.__reply.scheduleAcknowledgement({ delayMs: 25 });
  await wrapped.sendMessage({ msg: "Kết quả lệnh" }, "ack-group", 2);
  await delay(40);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg, "Kết quả lệnh");
});

test("voice/media output also cancels the pending acknowledgement", async () => {
  const { wrapped, sent } = createWrapped();
  wrapped.__reply.scheduleAcknowledgement({ delayMs: 25 });
  await wrapped.sendVoice({ voiceUrl: "https://example.invalid/audio.aac" });
  await delay(40);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].voice);
});

test("a slow outgoing media/text upload does not suppress the early acknowledgement", async () => {
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

  wrapped.__reply.scheduleAcknowledgement({ delayMs: 15 });
  const pendingSend = wrapped.sendMessage({ msg: "Kết quả chậm" });
  await delay(35);

  assert.ok(sent.some(item => /Đang xử lý lệnh/.test(item.msg || "")));
  await pendingSend;
});

test("dispatcher keeps an early acknowledgement alive for a slow command handler", async () => {
  const { dispatchCommand } = require("../core/runtime/dispatcher");
  const { wrapped, sent } = createWrapped();
  wrapped.__reply.scheduleAcknowledgement({ delayMs: 10 });

  await dispatchCommand({
    command: { run: async () => delay(35) },
    commandName: "slowcmd",
    args: [],
    event: { data: { content: "/slowcmd" }, mentions: [] },
    api: wrapped,
    logger: { log() {} },
    metrics: { track() {} },
    Reactions: { PRAY: "working", OK: "ok", CRY: "cry" }
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0].msg, /Đang xử lý lệnh/);
});

test("finishing a command before the acknowledgement timer fires leaves the original output unchanged", async () => {
  const { wrapped, sent } = createWrapped();
  wrapped.__reply.scheduleAcknowledgement({ delayMs: 25 });
  wrapped.__reply.finishCommand();
  await delay(40);
  assert.equal(sent.length, 0);
});
