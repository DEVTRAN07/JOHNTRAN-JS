"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapApi } = require("../core/message");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createWrapped(options = {}) {
  const sent = [];
  const reactions = [];
  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      return { message: { msgId: sent.length, cliMsgId: sent.length } };
    },
    async sendVoice(payload) {
      sent.push({ voice: payload });
      return { message: { msgId: sent.length, cliMsgId: sent.length } };
    },
    async addReaction(reaction, destination) {
      reactions.push({ reaction, destination });
      if (typeof options.onReaction === "function") return options.onReaction(reaction, destination);
      return true;
    }
  };
  const event = { threadId: "ack-group", type: 2, data: { msgId: 1, cliMsgId: 1 } };
  return { wrapped: wrapApi(api, event.threadId, event.type, "slowcmd", event), sent, reactions };
}

// Status is a delayed reaction only; it must never add another message to the chat.
test("delayed acknowledgement is a reaction callback, never a processing text message", async () => {
  const { wrapped, sent } = createWrapped();
  const statuses = [];
  assert.equal(wrapped.__reply.scheduleAcknowledgement(() => statuses.push("working"), 10), true);
  await delay(30);
  assert.deepEqual(statuses, ["working"]);
  assert.equal(sent.length, 0);
  assert.equal(sent.some(item => /Đang xử lý lệnh/.test(item.msg || "")), false);
});

test("the first text reply cancels a pending acknowledgement", async () => {
  const { wrapped, sent } = createWrapped();
  const statuses = [];
  wrapped.__reply.scheduleAcknowledgement(() => statuses.push("working"), 10);
  await wrapped.sendMessage({ msg: "Kết quả lệnh" }, "ack-group", 2);
  await delay(30);
  assert.deepEqual(statuses, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg, "Kết quả lệnh");
});

test("voice/media output cancels the pending acknowledgement", async () => {
  const { wrapped, sent } = createWrapped();
  const statuses = [];
  wrapped.__reply.scheduleAcknowledgement(() => statuses.push("working"), 10);
  await wrapped.sendVoice({ voiceUrl: "https://example.invalid/audio.aac" });
  await delay(30);
  assert.deepEqual(statuses, []);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].voice);
});

test("starting a slow outgoing send cancels the duplicate acknowledgement request", async () => {
  const sent = [], statuses = [];
  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      if (payload.msg === "Kết quả chậm") await delay(70);
      return { message: { msgId: sent.length, cliMsgId: sent.length } };
    }
  };
  const event = { threadId: "ack-slow-send", type: 2, data: { msgId: 1, cliMsgId: 1 } };
  const wrapped = wrapApi(api, event.threadId, event.type, "slowcmd", event);

  wrapped.__reply.scheduleAcknowledgement(() => statuses.push("working"), 10);
  await wrapped.sendMessage({ msg: "Kết quả chậm" });
  await delay(30);

  assert.deepEqual(statuses, []);
  assert.equal(sent.length, 1);
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


test("background command dispatcher does not mark a sticker complete before its job finishes", async () => {
  const { dispatchCommand } = require("../core/runtime/dispatcher");
  const reactions = [];
  let finished = false;
  const reply = {
    reacted: false,
    _responseStarted: false,
    _commandCompleted: false,
    _ackTimer: null,
    scheduleAcknowledgement(callback, delayMs = 600) {
      this._ackTimer = setTimeout(() => {
        this._ackTimer = null;
        if (!this._responseStarted && !this._commandCompleted) {
          reactions.push("working");
          this.reacted = true;
          callback();
        }
      }, delayMs);
      this._ackTimer.unref?.();
      return true;
    },
    cancelAcknowledgement() {
      if (this._ackTimer) clearTimeout(this._ackTimer);
      this._ackTimer = null;
    },
    finishCommand() {
      this._commandCompleted = true;
      this.cancelAcknowledgement();
    },
    react(icon) {
      reactions.push(icon);
      this.reacted = true;
      return Promise.resolve(true);
    }
  };

  await dispatchCommand({
    command: {
      config: { backgroundExecution: true, ackDelayMs: 5 },
      run: async () => { await delay(25); finished = true; }
    },
    commandName: "stk",
    args: ["12"],
    event: { data: { content: "/stk 12" }, mentions: [] },
    api: { __reply: reply },
    logger: { log() {} },
    metrics: { track() {} },
    Reactions: { PRAY: "working", OK: "ok", CRY: "cry" }
  });

  assert.equal(finished, true);
  assert.deepEqual(reactions, ["working"]);
});

test("Reply.working defers its Zalo reaction and never holds the caller", async () => {
  const { wrapped, reactions } = createWrapped();
  const startedAt = Date.now();
  await wrapped.__reply.working({ delayMs: 10 });
  assert.ok(Date.now() - startedAt < 10);
  assert.equal(reactions.length, 0);
  await delay(30);
  assert.equal(reactions.length, 1);
});

test("Reply.working is cancelled when the first command response starts", async () => {
  const { wrapped, reactions, sent } = createWrapped();
  await wrapped.__reply.working({ delayMs: 10 });
  await wrapped.sendMessage({ msg: "Kết quả" });
  await delay(30);
  assert.equal(sent.length, 1);
  assert.equal(reactions.length, 0);
});

test("Reply.done and Reply.failed do not await the Zalo reaction API", async () => {
  let reactionCalls = 0;
  const { wrapped } = createWrapped({
    onReaction: () => {
      reactionCalls++;
      return new Promise(() => {});
    }
  });

  await wrapped.__reply.done();
  await wrapped.__reply.failed();
  assert.equal(reactionCalls, 0, "cosmetic status reactions must not run inline");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reactionCalls, 2, "status reactions are dispatched outside the command response path");
});

test("Reply.working does not schedule duplicate reactions after acknowledgement", async () => {
  const { wrapped, reactions } = createWrapped();
  await wrapped.__reply.working({ delayMs: 5 });
  await delay(20);
  await wrapped.__reply.working({ delayMs: 5 });
  await delay(20);
  assert.equal(reactions.length, 1);
});
