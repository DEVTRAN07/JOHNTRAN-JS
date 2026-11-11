"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { typingIndicator, sendPhase, runPhases } = require("../plugins/commands/tutien")._test;

test("chat stages trigger the real Zalo typing endpoint before each message", async () => {
  const calls = [];
  const api = {
    async sendTypingEvent(threadId, type) {
      calls.push({ kind: "typing", threadId, type });
      return { status: 1 };
    },
    async sendMessage(payload, threadId, type) {
      calls.push({ kind: "message", text: payload.msg, threadId, type });
      return { message: null, attachment: [] };
    }
  };
  const event = { threadId: "group-123", type: 1 };

  await runPhases(api, event, [
    { message: "Pha 1", delay: 0 },
    { message: "Pha 2", delay: 0 },
    { message: "Pha 3", delay: 0 }
  ]);

  assert.deepEqual(calls.map((call) => call.kind), [
    "typing", "message", "typing", "message", "typing", "message"
  ]);
  assert.ok(calls.filter((call) => call.kind === "typing").every(
    (call) => call.threadId === "group-123" && call.type === 1
  ));
  assert.deepEqual(calls.filter((call) => call.kind === "message").map((call) => call.text), [
    "Pha 1", "Pha 2", "Pha 3"
  ]);
});

test("typing indicator returns false when the API method is unavailable", async () => {
  const result = await typingIndicator({}, { threadId: "group-1", type: 1 });
  assert.equal(result, false);
});

test("chat stage falls back to text when typing event is unavailable", async () => {
  const sent = [];
  const api = {
    async sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId, type });
    }
  };
  const event = { threadId: "user-123", type: 0 };

  await sendPhase(api, event, "Fallback text", 0);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.msg, "Fallback text");
  assert.equal(sent[0].threadId, "user-123");
  assert.equal(sent[0].type, 0);
});

test("chat stage still sends the phase if Zalo typing event fails", async () => {
  const sent = [];
  const api = {
    async sendTypingEvent() { throw new Error("typing endpoint unavailable"); },
    async sendMessage(payload) { sent.push(payload.msg); }
  };

  await sendPhase(api, { threadId: "group-9", type: 1 }, "Phase continues", 0);
  assert.deepEqual(sent, ["Phase continues"]);
});
