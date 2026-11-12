"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const dhbc = require("../core/runtime/services/games/dhbcService");
const { dispatchEvent } = require("../core/runtime/eventRegistry");
const { dispatchCommand } = require("../core/runtime/dispatcher");

test("DHBC service starts a round, accepts a correct answer and advances", () => {
  const threadId = `dhbc-test-${Date.now()}`;
  const started = dhbc.start(threadId, "u-a", "Player A");
  assert.equal(started.ok, true);
  assert.equal(started.session.players.size, 1);
  const answer = started.session.question.answer;
  const result = dhbc.answer(threadId, answer);
  assert.equal(result.correct, true);
  assert.equal(result.session.questionNumber, 2);
  dhbc.stop(threadId);
});

test("legacy command and event plugin contracts remain callable through runtime dispatchers", async () => {
  const calls = [];
  const event = { data: { content: "hello", uidFrom: "u1" }, mentions: [] };
  const api = { __reply: { reacted: true, react: async () => {}, error: async () => {} } };
  await dispatchCommand({
    commandName: "legacy",
    command: { run: async (ctx) => { calls.push(ctx); } },
    args: ["x"], event, api, Users: {}, Threads: {}, logger: { log() {} },
    metrics: { track() {} }, Reactions: { LIKE: "like", OK: "ok", CRY: "cry" }
  });
  assert.deepEqual(calls[0].args, ["x"]);
  assert.equal(calls[0].reply, api.__reply);
  let eventPayload;
  dispatchEvent({
    events: new Map([["legacy-event", { config: { event_type: ["message"] }, run: async (ctx) => { eventPayload = ctx; } }]]),
    commands: new Map(),
    eventType: "message",
    onEventModule: (module, name) => module.run({ name }),
    onCommandModule() {}
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(eventPayload, { name: "legacy-event" });
});
