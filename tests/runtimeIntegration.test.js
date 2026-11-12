"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const noitu = require("../core/runtime/services/games/noituService");
const { dispatchEvent } = require("../core/runtime/eventRegistry");
const { dispatchCommand } = require("../core/runtime/dispatcher");

test("Nối Từ service starts a round, joins players and advances turns", () => {
  const threadId = "noitu-test-" + Date.now();
  const started = noitu.start(threadId, "u-a", "Player A");
  assert.equal(started.ok, true);
  assert.equal(started.session.players.size, 1);

  try {
    const joined = noitu.join(threadId, "u-b", "Player B");
    assert.equal(joined.ok, true);
    const nextPhrase = started.session.currentPhrase.last + " thử";
    const played = noitu.play(threadId, "u-a", nextPhrase);
    assert.equal(played.ok, true);
    assert.equal(played.nextPlayer.uid, "u-b");
    assert.equal(noitu.get(threadId).moves, 1);
  } finally {
    noitu.stop(threadId);
  }
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
