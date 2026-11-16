"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const quick = require("../core/runtime/services/games/noituQuickService");
const command = require("../plugins/commands/noitu");

test("quick Nối Từ starts with a 60-second clock and awards one point plus one second", () => {
  const started = quick.start("quick-service-1", "p1", "Player", { random: () => 0, now: 1000 });
  assert.equal(started.ok, true);
  assert.equal(started.session.game.currentPhrase.display, "học sinh");
  assert.equal(quick.remainingMs(quick.get("quick-service-1"), 1000), 60000);

  const result = quick.submit("quick-service-1", "p1", "sinh viên", 2000);
  assert.equal(result.ok, true);
  assert.equal(result.score, 1);
  assert.equal(result.remainingMs, 61000);
  assert.equal(result.session.game.currentPhrase.display, "sinh viên");
  quick.finish("quick-service-1");
});

test("quick Nối Từ deducts five seconds for a wrong answer", () => {
  quick.start("quick-service-2", "p1", "Player", { random: () => 0, now: 1000 });
  const result = quick.submit("quick-service-2", "p1", "bàn ghế", 2000);
  assert.equal(result.ok, false);
  assert.equal(result.code, "WRONG_LINK");
  assert.equal(result.expected, "sinh");
  assert.equal(result.remainingMs, 55000);
  quick.finish("quick-service-2");
});

test("quick Nối Từ expires and removes the active session", () => {
  quick.start("quick-service-3", "p1", "Player", { random: () => 0, now: 1000 });
  const result = quick.submit("quick-service-3", "p1", "sinh viên", 62000);
  assert.equal(result.code, "TIME_UP");
  assert.equal(result.session.status, "finished");
  assert.equal(quick.get("quick-service-3"), null);
});

test("quick plain-text handler only consumes answers from the active player", async () => {
  const previousConfig = global.config;
  global.config = { prefix: "/", allow_self_command: false };
  quick.start("quick-handler-1", "p1", "Player", { random: () => 0 });
  const sent = [];
  const api = { async sendMessage(payload) { sent.push(payload); } };
  try {
    const stranger = await command._test.handleQuickNoituText({
      api,
      event: { threadId: "quick-handler-1", type: 2, data: { uidFrom: "p2", content: "sinh viên" } },
      eventType: "message"
    });
    assert.equal(stranger, false);
    assert.equal(sent.length, 0);

    const player = await command._test.handleQuickNoituText({
      api,
      event: { threadId: "quick-handler-1", type: 2, data: { uidFrom: "p1", content: "sinh viên" } },
      eventType: "message"
    });
    assert.equal(player, true);
    assert.match(sent[0].msg, /sinh viên/);
    assert.match(sent[0].msg, /\+1 điểm/);
  } finally {
    quick.finish("quick-handler-1");
    for (const timer of []) clearTimeout(timer);
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});
