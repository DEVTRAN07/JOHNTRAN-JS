"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { ThreadType } = require("zalo-client");
const handleEvent = require("../core/handle/handleEvent");
const command = require("../plugins/commands/noitu");
const noitu = require("../core/runtime/services/games/noituService");
const engine = require("../core/games/noituEngine");
const ghepChu = require("../core/runtime/services/games/ghepchuService");

afterEach(() => {
  noitu.sessions.clear();
  ghepChu.clear();
  delete global.client;
});

test("an enrolled word-game answer is consumed before normal message event plugins", async () => {
  const session = engine.createSession("group-1", "player-1", "Wuang", () => 0);
  noitu.sessions.set("group-1", session);
  let normalEventCalls = 0;
  const api = {
    async sendMessage() { return { ok: true }; }
  };
  global.client = {
    commands: new Map([["noitu", command]]),
    events: new Map([["normal-message", {
      config: { event_type: ["message"] },
      async run() { normalEventCalls++; }
    }]])
  };

  const result = await handleEvent("message", {
    threadId: "group-1",
    type: ThreadType.User,
    data: { uidFrom: "player-1", content: "sinh viên" }
  }, api, false);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.consumed, true);
  assert.equal(session.moves, 1);
  assert.equal(normalEventCalls, 0);
});

test("a non-player message continues to normal event plugins during an active game", async () => {
  const session = engine.createSession("group-1", "player-1", "Wuang", () => 0);
  noitu.sessions.set("group-1", session);
  let normalEventCalls = 0;
  const api = {
    async sendMessage() { return { ok: true }; }
  };
  global.client = {
    commands: new Map([["noitu", command]]),
    events: new Map([["normal-message", {
      config: { event_type: ["message"] },
      async run() { normalEventCalls++; }
    }]])
  };

  const result = await handleEvent("message", {
    threadId: "group-1",
    type: ThreadType.User,
    data: { uidFrom: "other-user", content: "Xin chào mọi người" }
  }, api, false);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.consumed, undefined);
  assert.equal(session.moves, 0);
  assert.equal(normalEventCalls, 1);
});
