"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const game = require("../core/runtime/services/games/ghepchuService");

afterEach(() => game.clear());

test("starts a Vietnamese word-scramble round with 90 seconds and a non-solved tile order", () => {
  const result = game.start("thread-1", "user-1", "Wuang", "https://example.com/avatar.png", {
    now: 1000,
    random: () => 0
  });

  assert.equal(result.ok, true);
  assert.equal(result.session.playerName, "Wuang");
  assert.equal(game.remainingSeconds(result.session, 1000), 90);
  assert.ok(result.session.puzzle.letters.length > 2);
  assert.notEqual(
    result.session.puzzle.letters.join(""),
    result.session.puzzle.answer.replace(/\s+/g, ""),
    "scrambled letters should not reveal the answer in its original order"
  );
});

test("accepts a correct answer, adds points and advances the puzzle", () => {
  const session = game.start("thread-1", "user-1", "Wuang", "", {
    now: 1000,
    random: () => 0
  }).session;
  const firstAnswer = session.puzzle.answer;

  const result = game.submit("thread-1", "user-1", firstAnswer, {
    now: 2000,
    random: () => 0
  });

  assert.equal(result.ok, true);
  assert.equal(result.completedAnswer, firstAnswer);
  assert.equal(session.score, 10);
  assert.equal(session.correct, 1);
  assert.equal(session.streak, 1);
  assert.equal(session.bestStreak, 1);
  assert.notEqual(session.puzzle.answer, firstAnswer);
});

test("rejects a wrong answer without awarding points", () => {
  const session = game.start("thread-1", "user-1", "Wuang", "", {
    now: 1000,
    random: () => 0
  }).session;

  const result = game.submit("thread-1", "user-1", "đáp án sai", { now: 2000 });

  assert.equal(result.ok, false);
  assert.equal(result.code, "WRONG");
  assert.equal(session.score, 0);
  assert.equal(session.correct, 0);
});

test("skip consumes five seconds and resets the active streak", () => {
  const session = game.start("thread-1", "user-1", "Wuang", "", {
    now: 1000,
    random: () => 0
  }).session;
  game.submit("thread-1", "user-1", session.puzzle.answer, { now: 2000, random: () => 0 });

  const before = game.remainingSeconds(session, 2000);
  const result = game.skip("thread-1", "user-1", { now: 2000, random: () => 0 });

  assert.equal(result.ok, true);
  assert.equal(result.code, "SKIPPED");
  assert.equal(session.skipped, 1);
  assert.equal(session.streak, 0);
  assert.equal(game.remainingSeconds(session, 2000), before - 5);
});

test("only the player who opened the round can submit or skip", () => {
  game.start("thread-1", "owner", "Wuang", "", { now: 1000, random: () => 0 });

  assert.equal(game.submit("thread-1", "other", "trí tuệ", { now: 2000 }).code, "NOT_PLAYER");
  assert.equal(game.skip("thread-1", "other", { now: 2000 }).code, "NOT_PLAYER");
});

test("round automatically becomes finished after its deadline", () => {
  const session = game.start("thread-1", "user-1", "Wuang", "", {
    now: 1000,
    random: () => 0
  }).session;

  const result = game.submit("thread-1", "user-1", session.puzzle.answer, { now: 91001 });

  assert.equal(result.ok, false);
  assert.equal(result.code, "TIME_UP");
  assert.equal(session.status, "finished");
  assert.equal(game.remainingSeconds(session, 91001), 0);
});
