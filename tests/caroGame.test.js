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

test("AI takes an immediate win and blocks an open four", () => {
  const winBoard = engine.createBoard();
  for (const cell of [34, 35, 36, 37]) engine.placeMove(winBoard, cell, "O");
  const winningCell = engine.chooseAiMove(winBoard, "O");
  assert.ok(winningCell >= 1 && winningCell <= 256);
  assert.equal(engine.placeMove(winBoard, winningCell, "O").won, true);

  const blockBoard = engine.createBoard();
  for (const cell of [50, 51, 52, 53]) engine.placeMove(blockBoard, cell, "X");
  const blockingCell = engine.chooseAiMove(blockBoard, "O");
  assert.ok([49, 54].includes(blockingCell));
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


test("Caro board replacement recalls the previous canvas card for that group", async () => {
  const threadId = "caro-recall-group";
  const otherThreadId = "caro-recall-other-group";
  const calls = [];
  const api = {
    async undo(payload, targetThreadId, type) {
      calls.push({ payload, threadId: targetThreadId, type });
      return { status: 1 };
    }
  };

  caroCommand._test.rememberBoardResponse(threadId, {
    message: null,
    attachment: [
      { msgId: 101, cliMsgId: "caro-image-101" }
    ]
  });
  caroCommand._test.rememberBoardResponse(otherThreadId, {
    message: null,
    attachment: [
      { msgId: 202, cliMsgId: "caro-image-202" }
    ]
  });

  assert.equal(await caroCommand._test.recallPreviousBoard(api, threadId, 1), true);
  assert.deepEqual(calls, [{
    payload: { msgId: 101, cliMsgId: "caro-image-101" },
    threadId,
    type: 1
  }]);

  assert.equal(await caroCommand._test.recallPreviousBoard(api, threadId, 1), true);
  assert.equal(calls.length, 1, "a recalled card must not be recalled twice");
  assert.equal(await caroCommand._test.recallPreviousBoard(api, otherThreadId, 1), true);
  assert.equal(calls.length, 2, "recalling one group must not affect another group");
});

test("Caro card recall handles captions and all attachment message IDs", async () => {
  const threadId = "caro-recall-multiple";
  const seen = [];
  const response = {
    message: { msgId: 1, cliMsgId: "caption-1" },
    attachment: [
      { msgId: 2, cliMsgId: "image-2" },
      { msgId: 3, cliMsgId: "image-3" },
      { msgId: 2, cliMsgId: "image-2" }
    ]
  };
  const targets = caroCommand._test.getBoardRecallTargets(response);
  assert.deepEqual(targets, [
    { msgId: 1, cliMsgId: "caption-1" },
    { msgId: 2, cliMsgId: "image-2" },
    { msgId: 3, cliMsgId: "image-3" }
  ]);

  const api = {
    async undo(payload, targetThreadId, type) {
      seen.push({ payload, threadId: targetThreadId, type });
    }
  };
  const result = await caroCommand._test.recallBoardMessages(api, threadId, 1, targets);
  assert.equal(result.recalled, 3);
  assert.equal(result.failed.length, 0);
  assert.equal(seen.length, 3);
});

test("Caro board recall keeps failed IDs so the next update can retry", async () => {
  const threadId = "caro-recall-retry";
  const target = { msgId: 404, cliMsgId: "caro-image-retry" };
  caroCommand._test.rememberBoardResponse(threadId, { attachment: [target] });

  let attempts = 0;
  const failingApi = {
    async undo() {
      attempts += 1;
      throw new Error("temporary Zalo error");
    }
  };
  assert.equal(await caroCommand._test.recallPreviousBoard(failingApi, threadId, 1), false);
  assert.equal(attempts, 1);

  const successfulApi = {
    async undo(payload) {
      assert.deepEqual(payload, target);
      attempts += 1;
    }
  };
  assert.equal(await caroCommand._test.recallPreviousBoard(successfulApi, threadId, 1), true);
  assert.equal(attempts, 2);
});
