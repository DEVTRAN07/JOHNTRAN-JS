"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const engine = require("../core/games/caroEngine");
const game = require("../core/runtime/services/games/caroService");
const caroCommand = require("../plugins/commands/caro");
const workerRender = require("../core/canvas/workerRender");

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

test("Caro sends a replacement board before recalling the previous image", async () => {
  const threadId = "caro-send-before-recall";
  const calls = [];
  caroCommand._test.rememberBoardResponse(threadId, {
    attachment: [{ msgId: 501, cliMsgId: "old-board" }]
  });

  const api = {
    async undo(payload) {
      calls.push("undo:" + payload.cliMsgId);
    }
  };
  const response = await caroCommand._test.sendBoardReplacement(api, threadId, 1, async () => {
    calls.push("send:new-board");
    return {
      message: { msgId: 502, cliMsgId: "new-caption" },
      attachment: [{ msgId: 503, cliMsgId: "new-board" }]
    };
  });

  assert.deepEqual(calls, ["send:new-board", "undo:old-board"]);
  assert.equal(response.attachment[0].cliMsgId, "new-board");

  await caroCommand._test.recallPreviousBoard(api, threadId, 1);
  assert.deepEqual(calls, [
    "send:new-board",
    "undo:old-board",
    "undo:new-caption",
    "undo:new-board"
  ], "the next update must recall the newly sent board, not the already recalled one");
});

test("Caro keeps the previous image when sending a replacement fails", async () => {
  const threadId = "caro-send-failure-keeps-old";
  const calls = [];
  caroCommand._test.rememberBoardResponse(threadId, {
    attachment: [{ msgId: 511, cliMsgId: "still-visible-board" }]
  });

  const api = {
    async undo(payload) {
      calls.push("undo:" + payload.cliMsgId);
    }
  };
  await assert.rejects(
    caroCommand._test.sendBoardReplacement(api, threadId, 1, async () => {
      calls.push("send:failed");
      throw new Error("Zalo send failed");
    }),
    /Zalo send failed/
  );

  assert.deepEqual(calls, ["send:failed"]);
  assert.equal(await caroCommand._test.recallPreviousBoard(api, threadId, 1), true);
  assert.deepEqual(calls, ["send:failed", "undo:still-visible-board"]);
});

test("Caro does not recall the previous image when Zalo returns no IDs for the new board", async () => {
  const threadId = "caro-send-no-ids-keeps-old";
  const calls = [];
  caroCommand._test.rememberBoardResponse(threadId, {
    attachment: [{ msgId: 521, cliMsgId: "tracked-old-board" }]
  });

  const response = await caroCommand._test.sendBoardReplacement({
    async undo(payload) { calls.push("undo:" + payload.cliMsgId); }
  }, threadId, 1, async () => {
    calls.push("send:new-without-ids");
    return { message: null, attachment: [] };
  });

  assert.deepEqual(response, { message: null, attachment: [] });
  assert.deepEqual(calls, ["send:new-without-ids"]);
  assert.equal(await caroCommand._test.recallPreviousBoard({
    async undo(payload) { calls.push("undo:" + payload.cliMsgId); }
  }, threadId, 1), true);
  assert.deepEqual(calls, ["send:new-without-ids", "undo:tracked-old-board"]);
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

  const nextBoard = { msgId: 405, cliMsgId: "caro-image-next" };
  caroCommand._test.rememberBoardResponse(threadId, { attachment: [nextBoard] });
  const successfulApi = {
    async undo(payload) {
      assert.ok(
        [target, nextBoard].some(item => item.msgId === payload.msgId && item.cliMsgId === payload.cliMsgId),
        "retry should include both the failed old card and the current card"
      );
      attempts += 1;
    }
  };
  assert.equal(await caroCommand._test.recallPreviousBoard(successfulApi, threadId, 1), true);
  assert.equal(attempts, 3);
});


test("Caro lifecycle distinguishes occupied and active groups", () => {
  const threadId = "caro-lifecycle-" + Date.now();
  const waiting = game.startPvp(threadId, { uid: "host", name: "Host" });
  assert.equal(waiting.ok, true);
  assert.equal(game.isBusy(threadId), true, "waiting lobby reserves the group");
  assert.equal(game.isPlaying(threadId), false, "waiting lobby is not accepting board moves");

  game.stop(threadId);
  assert.equal(game.isBusy(threadId), false, "ended sessions must not block other games");
  assert.equal(game.isPlaying(threadId), false);

  const restarted = game.startSolo(threadId, { uid: "human", name: "Human" });
  assert.equal(restarted.ok, true, "a new game can replace an ended session");
  assert.equal(game.isBusy(threadId), true);
  assert.equal(game.isPlaying(threadId), true);
  game.finish(threadId);
  assert.equal(game.isBusy(threadId), false);
});


test("a cleared Caro turn timer cannot remove the replacement timer", () => {
  const threadId = "caro-stale-turn-timer";
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false, unref() {} };
    scheduled.push(timer);
    return timer;
  };
  global.clearTimeout = timer => { if (timer) timer.cleared = true; };
  let expired = 0;

  try {
    game.startPvp(threadId, { uid: "host", name: "Host" });
    game.join(threadId, "guest", "Guest");
    assert.equal(game.watchTurn(threadId, () => { expired++; }), true);
    const oldTimer = scheduled.at(-1);

    assert.equal(game.move(threadId, "host", 136).ok, true);
    assert.equal(game.watchTurn(threadId, () => { expired++; }), true);
    const newTimer = scheduled.at(-1);

    oldTimer.callback();

    assert.equal(game.timers.get(threadId), newTimer,
      "an old callback must not delete the current turn timer");
    assert.equal(newTimer.cleared, false);
    assert.equal(expired, 0);
  } finally {
    game.finish(threadId);
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});


test("Caro score persistence converts storage failures into a recoverable result", async () => {
  const threadId = "caro-score-store-down";
  const created = game.startSolo(threadId, { uid: "player", name: "Player", humanFirst: true });
  assert.equal(created.ok, true);
  const score = await caroCommand._test.updateCaroStats({
    async getData() { throw new Error("database offline"); },
    async setData() { throw new Error("should not write"); }
  }, created.session.players.X, "solo", "win");
  assert.equal(score, null, "a temporary DB failure must not escape the score helper");
  game.finish(threadId);
});


test("Caro bare command opens a mode menu and a plain 1 starts Solo", async () => {
  const threadId = "caro-menu-select-" + Date.now();
  const uid = "caro-menu-player";
  const originalConfig = global.config;
  const originalRender = workerRender.renderCanvas;
  const sent = [];
  let messageId = 0;
  workerRender.renderCanvas = async () => "/tmp/caro-menu-test-preview.png";
  global.config = { ...(originalConfig || {}), prefix: "/", allow_self_command: false };

  const api = {
    async sendMessage(payload, targetThreadId, type) {
      sent.push({ payload, threadId: targetThreadId, type });
      const id = ++messageId;
      return { message: { msgId: id, cliMsgId: "caro-menu-" + id }, attachment: [] };
    },
    async undo() { return { success: true }; }
  };
  const event = {
    threadId,
    type: 2,
    data: { uidFrom: uid, dName: "Caro Menu Player", content: "" }
  };
  const Threads = {
    getCachedData() { return { data: {} }; },
    async getData() { return { data: {} }; }
  };

  try {
    await caroCommand.run({ args: [], api, event, Users: {}, Threads });
    assert.match(sent[0].payload.msg, /1️⃣ ĐẤU VỚI AI/);
    assert.match(sent[0].payload.msg, /2️⃣ ĐẤU PvP/);
    assert.equal(caroCommand._test.hasPendingModeSelection(threadId, uid), true);

    await caroCommand.handleIncoming({
      api,
      event: { ...event, data: { ...event.data, content: "1" } },
      isSelf: false,
      Users: {},
      Threads
    });

    const session = game.get(threadId);
    assert.ok(session, "choosing 1 should create the solo session");
    assert.equal(session.mode, "solo");
    assert.equal(session.players.X.uid, uid);
    assert.equal(session.moves, 0);
    assert.equal(caroCommand._test.hasPendingModeSelection(threadId, uid), false);
    assert.ok(sent.length >= 2, "the selected mode should send the initial board");
    assert.match(sent.at(-1).payload.msg, /BẮT ĐẦU CARO SOLO/);
  } finally {
    game.finish(threadId);
    caroCommand._test.clearModeSelection(threadId, uid);
    workerRender.renderCanvas = originalRender;
    if (originalConfig === undefined) delete global.config;
    else global.config = originalConfig;
  }
});

test("Caro accepts the bot account's own cell input when allow_self_command is enabled", async () => {
  const threadId = "caro-self-cell-" + Date.now();
  const uid = "same-bot-test-account";
  const originalConfig = global.config;
  const originalRender = workerRender.renderCanvas;
  const sent = [];
  let messageId = 0;
  workerRender.renderCanvas = async () => "/tmp/caro-self-cell-preview.png";
  global.config = { ...(originalConfig || {}), prefix: "/", allow_self_command: true };
  game.startSolo(threadId, { uid, name: "Bot/Test Account", symbol: "X", humanFirst: true });

  const api = {
    async sendMessage(payload, targetThreadId, type) {
      sent.push({ payload, threadId: targetThreadId, type });
      const id = ++messageId;
      return { message: { msgId: id, cliMsgId: "caro-self-" + id }, attachment: [] };
    },
    async undo() { return { success: true }; }
  };
  const Threads = {
    getCachedData() { return { data: {} }; },
    async getData() { return { data: {} }; }
  };

  try {
    await caroCommand.handleIncoming({
      api,
      event: {
        threadId,
        type: 2,
        isSelf: true,
        data: { uidFrom: uid, dName: "Bot/Test Account", content: "1" }
      },
      isSelf: true,
      Users: {},
      Threads
    });

    const session = game.get(threadId);
    assert.equal(session.board[0], "X", "cell 1 must be placed by the human");
    assert.equal(session.moves, 2, "AI should answer immediately after the human move");
    assert.equal(session.turnUid, uid, "the turn should return to the human after the AI reply");
    assert.ok(sent.some(item => /CẬP NHẬT BÀN CỜ CARO/.test(item.payload.msg)));
  } finally {
    game.finish(threadId);
    workerRender.renderCanvas = originalRender;
    if (originalConfig === undefined) delete global.config;
    else global.config = originalConfig;
  }
});

test("Caro recalls an old card only when Zalo confirms undo succeeded", async () => {
  const threadId = "caro-recall-false-result";
  const target = { msgId: 7001, cliMsgId: "caro-undo-rejected" };
  caroCommand._test.rememberBoardResponse(threadId, { attachment: [target] });

  assert.equal(await caroCommand._test.recallPreviousBoard({
    async undo() { return { success: false }; }
  }, threadId, 2), false, "a false Zalo result must remain pending for retry");

  let attempts = 0;
  assert.equal(await caroCommand._test.recallPreviousBoard({
    async undo() { attempts += 1; return { success: true }; }
  }, threadId, 2), true);
  assert.equal(attempts, 1);
});


test("Caro stop replaces and recalls the old board card", async () => {
  const threadId = "caro-stop-recall-" + Date.now();
  const uid = "caro-stop-owner";
  const originalRender = workerRender.renderCanvas;
  const sent = [];
  const undone = [];
  let nextId = 8000;
  workerRender.renderCanvas = async () => "/tmp/caro-stop-recall.png";
  const created = game.startSolo(threadId, { uid, name: "Owner", humanFirst: true });
  assert.equal(created.ok, true);
  caroCommand._test.rememberBoardResponse(threadId, {
    attachment: [{ msgId: 7999, cliMsgId: "old-caro-live-board" }]
  });

  const api = {
    async sendMessage(payload, targetThreadId, type) {
      sent.push({ payload, threadId: targetThreadId, type });
      const id = ++nextId;
      return { message: { msgId: id, cliMsgId: "caro-stop-" + id }, attachment: [] };
    },
    async undo(payload, targetThreadId, type) {
      undone.push({ payload, threadId: targetThreadId, type });
      return { success: true };
    }
  };

  try {
    await caroCommand.handleIncoming({
      api,
      event: { threadId, type: 2, data: { uidFrom: uid, content: "stop" } },
      isSelf: false,
      Users: {}
    });

    assert.equal(game.get(threadId), null, "the cancelled room should be removed");
    assert.equal(sent.length, 1, "the cancellation should replace the old board with one final card");
    assert.match(sent[0].payload.msg, /CARO ĐÃ HỦY/);
    assert.match(sent[0].payload.msg, /Không cộng\/trừ sao/);
    assert.deepEqual(undone, [{
      payload: { msgId: 7999, cliMsgId: "old-caro-live-board" },
      threadId,
      type: 2
    }]);
  } finally {
    game.finish(threadId);
    workerRender.renderCanvas = originalRender;
  }
});

test("Caro leaving a waiting PvP lobby replaces the old board card", async () => {
  const threadId = "caro-leave-lobby-recall-" + Date.now();
  const uid = "caro-lobby-owner";
  const originalRender = workerRender.renderCanvas;
  const sent = [];
  const undone = [];
  let nextId = 8100;
  workerRender.renderCanvas = async () => "/tmp/caro-lobby-leave.png";
  const created = game.startPvp(threadId, { uid, name: "Lobby Owner" });
  assert.equal(created.ok, true);
  caroCommand._test.rememberBoardResponse(threadId, {
    attachment: [{ msgId: 8099, cliMsgId: "old-caro-lobby-board" }]
  });

  const api = {
    async sendMessage(payload, targetThreadId, type) {
      sent.push({ payload, threadId: targetThreadId, type });
      const id = ++nextId;
      return { message: { msgId: id, cliMsgId: "caro-lobby-end-" + id }, attachment: [] };
    },
    async undo(payload, targetThreadId, type) {
      undone.push({ payload, threadId: targetThreadId, type });
      return { success: true };
    }
  };

  try {
    await caroCommand.handleIncoming({
      api,
      event: { threadId, type: 2, data: { uidFrom: uid, content: "leave" } },
      isSelf: false,
      Users: {}
    });

    assert.equal(game.get(threadId), null);
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.msg, /PHÒNG CARO ĐÃ HỦY/);
    assert.deepEqual(undone.map(item => item.payload), [
      { msgId: 8099, cliMsgId: "old-caro-lobby-board" }
    ]);
  } finally {
    game.finish(threadId);
    workerRender.renderCanvas = originalRender;
  }
});


test("Caro stop replaces the old live board with a final cancelled card", async () => {
  const threadId = "caro-stop-recall-" + Date.now();
  const uid = "caro-stop-owner";
  const originalRender = workerRender.renderCanvas;
  const sent = [];
  const undone = [];
  let nextId = 8000;
  workerRender.renderCanvas = async () => "/tmp/caro-stop-recall.png";
  const created = game.startSolo(threadId, { uid, name: "Owner", humanFirst: true });
  assert.equal(created.ok, true);
  caroCommand._test.rememberBoardResponse(threadId, {
    attachment: [{ msgId: 7999, cliMsgId: "old-caro-live-board" }]
  });

  const api = {
    async sendMessage(payload, targetThreadId, type) {
      sent.push({ payload, threadId: targetThreadId, type });
      const id = ++nextId;
      return { message: { msgId: id, cliMsgId: "caro-stop-" + id }, attachment: [] };
    },
    async undo(payload, targetThreadId, type) {
      undone.push({ payload, threadId: targetThreadId, type });
      return { success: true };
    }
  };

  try {
    await caroCommand.handleIncoming({
      api,
      event: { threadId, type: 2, data: { uidFrom: uid, content: "stop" } },
      isSelf: false,
      Users: {}
    });

    assert.equal(game.get(threadId), null, "the cancelled room should be removed");
    assert.equal(sent.length, 1, "the cancellation should replace the old board with one final card");
    assert.match(sent[0].payload.msg, /CARO ĐÃ HỦY/);
    assert.match(sent[0].payload.msg, /Không cộng\/trừ sao/);
    assert.deepEqual(undone, [{
      payload: { msgId: 7999, cliMsgId: "old-caro-live-board" },
      threadId,
      type: 2
    }]);
  } finally {
    game.finish(threadId);
    workerRender.renderCanvas = originalRender;
  }
});

test("Caro leaving a waiting PvP lobby replaces the old board card", async () => {
  const threadId = "caro-leave-lobby-recall-" + Date.now();
  const uid = "caro-lobby-owner";
  const originalRender = workerRender.renderCanvas;
  const sent = [];
  const undone = [];
  let nextId = 8100;
  workerRender.renderCanvas = async () => "/tmp/caro-lobby-leave.png";
  const created = game.startPvp(threadId, { uid, name: "Lobby Owner" });
  assert.equal(created.ok, true);
  caroCommand._test.rememberBoardResponse(threadId, {
    attachment: [{ msgId: 8099, cliMsgId: "old-caro-lobby-board" }]
  });

  const api = {
    async sendMessage(payload, targetThreadId, type) {
      sent.push({ payload, threadId: targetThreadId, type });
      const id = ++nextId;
      return { message: { msgId: id, cliMsgId: "caro-lobby-end-" + id }, attachment: [] };
    },
    async undo(payload, targetThreadId, type) {
      undone.push({ payload, threadId: targetThreadId, type });
      return { success: true };
    }
  };

  try {
    await caroCommand.handleIncoming({
      api,
      event: { threadId, type: 2, data: { uidFrom: uid, content: "leave" } },
      isSelf: false,
      Users: {}
    });

    assert.equal(game.get(threadId), null);
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.msg, /PHÒNG CARO ĐÃ HỦY/);
    assert.deepEqual(undone.map(item => item.payload), [
      { msgId: 8099, cliMsgId: "old-caro-lobby-board" }
    ]);
  } finally {
    game.finish(threadId);
    workerRender.renderCanvas = originalRender;
  }
});
