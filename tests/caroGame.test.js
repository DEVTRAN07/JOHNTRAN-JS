"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const engine = require("../core/games/caroEngine");
const game = require("../core/runtime/services/games/caroService");
const caroCommand = require("../plugins/commands/caro");

test("Caro engine creates a 16x16 board with 256 empty cells", () => {
  const board = engine.createBoard();
  assert.equal(board.length, 256);
  assert.ok(board.every(cell => cell === null));
});

test("five consecutive horizontal stones win", () => {
  const board = engine.createBoard();
  for (const cell of [1, 17, 2, 18, 3, 19, 4, 20]) {
    assert.equal(engine.placeMove(board, cell, cell < 17 ? "X" : "O").ok, true);
  }
  const result = engine.placeMove(board, 5, "X");
  assert.equal(result.won, true);
});

test("five stones cannot wrap from one row to the next", () => {
  const board = engine.createBoard();
  for (const cell of [15, 16, 17, 18]) {
    assert.equal(engine.placeMove(board, cell, "X").ok, true);
  }
  const result = engine.placeMove(board, 19, "X");
  assert.equal(result.won, false);
});

test("AI takes an immediate win before making a defensive move", () => {
  const winBoard = engine.createBoard();
  for (const cell of [34, 35, 36, 37]) engine.placeMove(winBoard, cell, "O");
  assert.equal(engine.chooseAiMove(winBoard, "O"), 38);

  const blockBoard = engine.createBoard();
  for (const cell of [50, 51, 52, 53]) engine.placeMove(blockBoard, cell, "X");
  assert.equal(engine.chooseAiMove(blockBoard, "O"), 54);
});

test("PvP room assigns X to the first turn even when the host chooses O", () => {
  const threadId = "caro-pvp-test";
  const created = game.startPvp(threadId, { uid: "host", name: "Host", symbol: "O" });
  assert.equal(created.ok, true);
  assert.equal(created.session.status, "waiting");

  const joined = game.join(threadId, "guest", "Guest");
  assert.equal(joined.ok, true);
  assert.equal(joined.session.turnSymbol, "X");
  assert.equal(joined.session.turnUid, "guest");

  assert.equal(game.move(threadId, "host", 1).code, "NOT_TURN");
  assert.equal(game.move(threadId, "guest", 1).ok, true);
  assert.equal(game.get(threadId).turnSymbol, "O");
  assert.equal(game.move(threadId, "host", 2).ok, true);
  game.finish(threadId);
});

test("solo mode supports the human choosing O and moving first", () => {
  const threadId = "caro-solo-test";
  const created = game.startSolo(threadId, {
    uid: "human",
    name: "Human",
    symbol: "O",
    humanFirst: true
  });
  assert.equal(created.ok, true);
  assert.equal(created.session.turnSymbol, "O");
  assert.equal(created.session.turnUid, "human");
  const move = game.move(threadId, "human", 136);
  assert.equal(move.ok, true);
  assert.equal(game.get(threadId).turnSymbol, "X");
  assert.equal(game.botMove(threadId).ok, true);
  assert.equal(game.get(threadId).turnUid, "human");
  game.finish(threadId);
});

test("Caro awards stars and keeps per-mode/month leaderboard counters", async () => {
  const users = new Map();
  const mockUsers = {
    async getData(uid) {
      return { data: users.get(String(uid)) || {} };
    },
    async setData(uid, data) {
      users.set(String(uid), data);
    },
    getAll() {
      return [...users.entries()].map(([userId, data]) => ({ userId, data }));
    }
  };

  const player = { uid: "score-user", name: "Score User", kind: "human" };
  const win = await caroCommand._test.updateCaroStats(mockUsers, player, "solo", "win");
  assert.equal(win.stars, 2);
  assert.equal(win.actualStarsDelta, 2);

  const loss = await caroCommand._test.updateCaroStats(mockUsers, player, "pvp", "loss");
  assert.equal(loss.stars, 1);
  assert.equal(loss.actualStarsDelta, -1);

  const data = users.get("score-user").caro;
  assert.equal(data.solo.wins, 1);
  assert.equal(data.pvp.losses, 1);
  const month = caroCommand._test.currentMonthKey();
  assert.equal(data.months[month].solo.points, 2);
  assert.equal(data.months[month].pvp.points, -1);

  const ranking = await caroCommand._test.leaderboard(mockUsers, "all");
  assert.equal(ranking[0].name, "Score User");
  assert.equal(ranking[0].rankingPoints, 1);
});
