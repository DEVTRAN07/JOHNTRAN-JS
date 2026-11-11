"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const tuTien = require("../core/runtime/services/games/tuTienService");
const pvp = require("../core/runtime/services/games/pvpService");
const leaderboard = require("../core/runtime/services/games/leaderboardService");
const { dispatchEvent } = require("../core/runtime/eventRegistry");
const { dispatchCommand } = require("../core/runtime/dispatcher");

test("integrated game flow creates players, starts PvP, settles a turn and ranks players", () => {
  const now = Date.now();
  const a = tuTien.createPlayer(now, { displayName: "Đạo hữu A" });
  const b = tuTien.createPlayer(now, { displayName: "Đạo hữu B" });
  a.attack = b.attack = 25;
  a.defense = b.defense = 10;
  const challenge = pvp.createChallenge("u-a", "u-b", a, b, now);
  assert.equal(challenge.ok, true);
  const started = pvp.startBattle(challenge.challenge, now + 1);
  assert.equal(started.ok, true);
  const battle = started.battle;
  const turn = pvp.takeTurn(battle, "u-a", "normal", 0.5);
  assert.equal(turn.ok, true);
  assert.equal(battle.log.length, 1);
  const rows = leaderboard.leaderboard([
    { userId: "u-a", data: { tuTien: { ...a, displayName: "Đạo hữu A", arena: { rating: 1100, wins: 2 } } } },
    { userId: "u-b", data: { tuTien: { ...b, displayName: "Đạo hữu B", arena: { rating: 900, wins: 1 } } } }
  ], "rating", 10);
  assert.equal(rows[0].uid, "u-a");
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
