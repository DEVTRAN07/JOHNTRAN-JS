"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const command = require("../plugins/commands/noitu");

test("Nối Từ is reachable through the short nt alias", () => {
  assert.equal(command.config.name, "noitu");
  assert.ok(command.config.aliases.includes("nt"));
});

test("bare nt guide contains the requested game modes and utilities", () => {
  const guide = command._test.help("!");
  for (const expected of [
    "@Wuang 📖 NỐI TỪ TIẾNG VIỆT",
    "!nt go",
    "!nt q",
    "!nt gc",
    "!nt room",
    "!nt bxh",
    "!nt check",
    "!nt words",
    "!nt on / off",
    "!nt reset"
  ]) {
    assert.ok(guide.includes(expected), "guide should include: " + expected);
  }
});


const gameService = require("../core/runtime/services/games/noituService");
const noituEngine = require("../core/games/noituEngine");

test("nt go answers plain text without a prefix", async () => {
  const session = noituEngine.createSession("test-group", "player-1", "Wuang", () => 0);
  gameService.sessions.set("test-group", session);
  const sent = [];
  const consumed = await command._test.handleNoiTuText({
    api: { async sendMessage(payload) { sent.push(payload); } },
    event: {
      threadId: "test-group",
      type: 2,
      data: { uidFrom: "player-1", content: "sinh viên" }
    },
    eventType: "message"
  });
  assert.equal(consumed, true);
  assert.equal(session.moves, 1);
  assert.match(sent[0].msg, /sinh viên/);
  gameService.sessions.clear();
});

test("nt go accepts self-listen answers only when allow_self_command is enabled", async () => {
  const previousConfig = global.config;
  global.config = { allow_self_command: true, prefix: "/" };
  const session = noituEngine.createSession("self-group", "bot-owner", "Wuang", () => 0);
  gameService.sessions.set("self-group", session);
  const sent = [];

  try {
    const consumed = await command._test.handleNoiTuText({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: {
        threadId: "self-group",
        type: 2,
        isSelf: true,
        data: { uidFrom: "bot-owner", content: "sinh viên" }
      },
      eventType: "message",
      isSelf: true
    });
    assert.equal(consumed, true);
    assert.equal(session.moves, 1);
    assert.match(sent[0].msg, /sinh viên/);
  } finally {
    gameService.sessions.clear();
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});
