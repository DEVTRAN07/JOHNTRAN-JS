
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/dhbcEngine");

test("answers normalize Vietnamese accents and spacing", () => {
  assert.equal(engine.normalizeAnswer("  CÁ   NGỰA! "), "cangua");
  assert.equal(engine.normalizeAnswer("Đèn-Pin"), "denpin");
});

test("new session starts with its owner as the first player", () => {
  const session = engine.createSession("thread-1", "user-1", "Wuang", () => 0);
  assert.equal(session.ownerId, "user-1");
  assert.equal(session.players.size, 1);
  assert.equal(session.question.id, "ca-ngua");
});

test("players can join and leave a running game", () => {
  const session = engine.createSession("thread-1", "user-1", "Wuang", () => 0);
  assert.equal(engine.join(session, "user-2", "Guest").ok, true);
  assert.equal(engine.join(session, "user-2", "Guest").code, "ALREADY_JOINED");
  assert.equal(engine.leave(session, "user-2").ok, true);
  assert.equal(engine.leave(session, "user-2").code, "NOT_JOINED");
});

test("correct answers are accepted and wrong answers rejected", () => {
  const session = engine.createSession("thread-1", "user-1", "Wuang", () => 0);
  assert.equal(engine.checkAnswer(session, "ca ngua").correct, true);
  assert.equal(engine.checkAnswer(session, "con mèo").correct, false);
});

test("hint reveals a letter and next question clears revealed letters", () => {
  const session = engine.createSession("thread-1", "user-1", "Wuang", () => 0);
  assert.match(engine.hint(session), /C/);
  assert.equal(session.revealed.size, 1);
  engine.nextQuestion(session, () => 0);
  assert.equal(session.questionNumber, 2);
  assert.equal(session.revealed.size, 0);
});
