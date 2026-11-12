"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/noituEngine");

test("Nối Từ normalizes Vietnamese accents and punctuation", () => {
  assert.equal(engine.normalizePhrase("  VIÊN   CHỨC! "), "vien chuc");
  assert.equal(engine.parsePhrase("ĐIỆN-thoại").normalized, "dien thoai");
});

test("a new game starts with an owner, starter phrase and first turn", () => {
  const session = engine.createSession("group-1", "user-1", "Wuang", () => 0, 100);
  assert.equal(session.ownerId, "user-1");
  assert.equal(session.turnUid, "user-1");
  assert.equal(session.currentPhrase.display, "học sinh");
  assert.equal(session.startedAt, 100);
});

test("players join, play in turn and rotate fairly", () => {
  const session = engine.createSession("group-1", "user-1", "A", () => 0, 100);
  engine.join(session, "user-2", "B");
  const first = engine.play(session, "user-1", "sinh viên", 101);
  assert.equal(first.ok, true);
  assert.equal(first.nextPlayer.uid, "user-2");
  const second = engine.play(session, "user-2", "viên chức", 102);
  assert.equal(second.ok, true);
  assert.equal(second.nextPlayer.uid, "user-1");
  assert.equal(session.moves, 2);
});

test("wrong links, malformed phrases and out-of-turn messages are rejected", () => {
  const session = engine.createSession("group-1", "user-1", "A", () => 0);
  engine.join(session, "user-2", "B");
  assert.equal(engine.play(session, "user-1", "bàn ghế").code, "WRONG_LINK");
  assert.equal(engine.play(session, "user-1", "sinh").code, "INVALID_PHRASE");
  assert.equal(engine.play(session, "user-2", "sinh viên").code, "NOT_TURN");
  assert.equal(session.moves, 0);
});

test("duplicate phrases and pass/leave actions are handled", () => {
  const session = engine.createSession("group-1", "user-1", "A", () => 0);
  engine.join(session, "user-2", "B");
  assert.equal(engine.play(session, "user-1", "sinh viên").ok, true);
  session.used.add("vien chuc");
  assert.equal(engine.play(session, "user-2", "viên chức").code, "DUPLICATE");
  assert.equal(engine.pass(session, "user-2").ok, true);
  const leave = engine.leave(session, "user-2");
  assert.equal(leave.ok, true);
  assert.equal(session.players.has("user-2"), false);
});
