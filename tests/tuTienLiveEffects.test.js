"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTuTienEffects, normalizeDelay, progressBar } = require("../core/games/tuTienEffects");

test("every phase calls the real Zalo typing endpoint before sending a live chat message", async () => {
  const calls = [];
  const api = {
    async sendTypingEvent(threadId, type) {
      calls.push({ kind: "typing", threadId, type });
      return { status: 1 };
    },
    async sendMessage(payload, threadId, type) {
      calls.push({ kind: "message", text: payload.msg, threadId, type });
      return { sent: true };
    }
  };
  const reactionCalls = [];
  const reply = {
    async working() { reactionCalls.push("working"); },
    async done() { reactionCalls.push("done"); },
    async failed() { reactionCalls.push("failed"); }
  };
  const effects = createTuTienEffects({
    api,
    event: { threadId: "group-1", type: 1 },
    reply,
    delayScale: 0
  });

  await effects.sequence([
    { message: "🧘 NHẬP ĐỊNH", delay: 0 },
    { message: "🌫️ TỤ KHÍ", delay: 0 },
    { message: "🌀 VẬN CHU THIÊN", delay: 0 }
  ]);
  await effects.result("✨ TU LUYỆN THÀNH CÔNG");

  assert.deepEqual(calls.map((item) => item.kind), [
    "typing", "message", "typing", "message", "typing", "message", "message"
  ]);
  assert.deepEqual(calls.filter((item) => item.kind === "typing").map((item) => [item.threadId, item.type]), [
    ["group-1", 1], ["group-1", 1], ["group-1", 1]
  ]);
  assert.deepEqual(calls.filter((item) => item.kind === "message").map((item) => item.text), [
    "🧘 NHẬP ĐỊNH", "🌫️ TỤ KHÍ", "🌀 VẬN CHU THIÊN", "✨ TU LUYỆN THÀNH CÔNG"
  ]);
  assert.deepEqual(reactionCalls, ["working"]);
  assert.equal(effects.state.started, true);
  assert.equal(effects.state.finished, true);
});

test("a missing typing endpoint still sends every stage as a real message", async () => {
  const messages = [];
  const effects = createTuTienEffects({
    api: { async sendMessage(payload) { messages.push(payload.msg); } },
    event: { threadId: "group-2", type: 1 },
    delayScale: 0
  });

  await effects.sequence([{ message: "Pha 1", delay: 0 }, { message: "Pha 2", delay: 0 }]);
  await effects.finish();
  assert.deepEqual(messages, ["Pha 1", "Pha 2"]);
  assert.equal(effects.state.typingSupported, false);
});

test("a failed typing endpoint is disabled after its first error and does not block later stages", async () => {
  const calls = [];
  const api = {
    async sendTypingEvent() { calls.push("typing"); throw new Error("typing unavailable"); },
    async sendMessage(payload) { calls.push(payload.msg); }
  };
  const effects = createTuTienEffects({
    api,
    event: { threadId: "group-3", type: 1 },
    delayScale: 0
  });

  await effects.sequence([{ message: "Pha A", delay: 0 }, { message: "Pha B", delay: 0 }]);
  assert.deepEqual(calls, ["typing", "Pha A", "Pha B"]);
  assert.equal(effects.state.typingSupported, false);
});

test("result sends one actual Zalo message and closes the effect session", async () => {
  const calls = [];
  const effects = createTuTienEffects({
    api: {
      async sendTypingEvent() { calls.push("typing"); return { status: 1 }; },
      async sendMessage(payload) { calls.push(payload.msg); return "message-id"; }
    },
    event: { threadId: "user-1", type: 0 },
    delayScale: 0
  });

  const response = await effects.result("Kết quả");
  assert.equal(response, "message-id");
  assert.deepEqual(calls, ["Kết quả"]);
  assert.equal(effects.state.finished, true);
});

test("effect input helpers clamp delay and render the real text progress bar", () => {
  assert.equal(normalizeDelay(-100), 0);
  assert.equal(normalizeDelay(999999), 2200);
  assert.equal(progressBar(50, 100, 10), "█████░░░░░");
  assert.equal(progressBar(100, 100, 10), "██████████");
});
