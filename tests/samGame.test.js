"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const rendererPath = require.resolve("../core/canvas/workerRender");
const canvasCalls = [];
require.cache[rendererPath] = {
  id: rendererPath,
  filename: rendererPath,
  loaded: true,
  exports: {
    renderCanvas: async (...args) => {
      canvasCalls.push(args);
      return "/tmp/sam-test-canvas.png";
    }
  }
};

const engine = require("../core/games/samEngine");
const game = require("../core/runtime/services/games/samService");
const command = require("../plugins/commands/sam");

function card(rank, suit = "b") {
  return { rank, suit, id: String(rank) + suit };
}

test("Sâm engine builds a standard 52-card deck and deals ten cards each", () => {
  const deck = engine.createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(item => item.id)).size, 52);

  for (const count of [2, 3, 4]) {
    const ids = Array.from({ length: count }, (_, index) => "p" + index);
    const dealt = engine.dealCards(ids, () => 0.42);
    for (const uid of ids) assert.equal(dealt.hands[uid].length, 10);
    assert.ok(ids.includes(dealt.firstPlayerId));
    assert.equal(dealt.remainingDeck.length, 52 - count * 10);
  }
});

test("Sâm parses singles, pairs, triples, quads, straights and numbered selection", () => {
  const hand = [
    card(3), card(4), card(5), card(6),
    card(7, "ch"), card(7, "r"),
    card(9), card(9, "c"), card(9, "r"),
    card(12), card(12, "r"), card(12, "c"), card(12, "ch")
  ];
  assert.equal(engine.parsePlayText(hand, "3b").cards[0].id, "3b");
  assert.equal(engine.parsePlayText(hand, "doi 7").cards.length, 2);
  assert.equal(engine.parsePlayText(hand, "sam 9").cards.length, 3);
  assert.equal(engine.parsePlayText(hand, "tuquy Q").cards.length, 4);
  assert.equal(engine.parsePlayText(hand, "sanh 3456").cards.length, 4);
  assert.deepEqual(
    engine.parsePlayText(hand, "chon 1,2").cards.map(item => item.id),
    ["3b", "4b"]
  );
});

test("Sâm only allows higher same-size combinations, with four-kind cutting one 2", () => {
  const three = engine.analyzeCombo([card(3)]);
  const four = engine.analyzeCombo([card(4)]);
  assert.equal(engine.canBeat(four, three), true);
  assert.equal(engine.canBeat(three, four), false);

  const pair3 = engine.analyzeCombo([card(3), card(3, "r")]);
  const pair4 = engine.analyzeCombo([card(4), card(4, "r")]);
  assert.equal(engine.canBeat(pair4, pair3), true);
  // Same rank with different suits is not a stronger Sâm combination.
  const pair4LowSuit = engine.analyzeCombo([card(4, "b"), card(4, "ch")]);
  const pair4HighSuit = engine.analyzeCombo([card(4, "r"), card(4, "c")]);
  assert.equal(engine.canBeat(pair4HighSuit, pair4LowSuit), false);
  assert.equal(engine.canBeat(pair4LowSuit, pair4HighSuit), false);
  assert.equal(engine.canBeat(pair4, engine.analyzeCombo([card(15)])), false);

  const quad = engine.analyzeCombo([card(7), card(7, "ch"), card(7, "r"), card(7, "c")]);
  assert.equal(engine.canBeat(quad, engine.analyzeCombo([card(15, "c")])), true);
  assert.equal(engine.canBeat(quad, pair3), false);
});

test("Sâm detects its five common instant-win hand types in priority order", () => {
  const longStraight = [3,4,5,6,7,8,9,10,11,12].map(rank => card(rank));
  assert.equal(engine.detectWhiteHand(longStraight), "longStraight");

  const fourTwos = [card(15,"b"),card(15,"ch"),card(15,"r"),card(15,"c"),
    card(3),card(4),card(5),card(6),card(7),card(8)];
  assert.equal(engine.detectWhiteHand(fourTwos), "fourTwos");

  const sameColor = [3,5,7,9,11,13,14,4,6,8].map((rank,index) =>
    card(rank, index % 2 ? "ch" : "b"));
  assert.equal(engine.detectWhiteHand(sameColor), "sameColor");

  const threeTriples = [
    card(3),card(3,"ch"),card(3,"r"),
    card(5),card(5,"ch"),card(5,"r"),
    card(7),card(7,"ch"),card(7,"r"),card(10)
  ];
  assert.equal(engine.detectWhiteHand(threeTriples), "threeTriples");

  const fivePairs = [3,4,5,6,7].flatMap(rank => [card(rank),card(rank,"c")]);
  assert.equal(engine.detectWhiteHand(fivePairs), "fivePairs");

  assert.equal(engine.detectWhiteHand([card(3),card(4)]), null);
});

test("Sâm start ends immediately for an ăn trắng hand", () => {
  const threadId = "sam-white-hand-test";
  const created = game.create(threadId, { uid: "host", name: "Host" }, { id: "81521" });
  assert.equal(created.ok, true);
  game.join(threadId, "81521", { uid: "guest", name: "Guest" });
  const originalDetect = engine.detectWhiteHand;
  engine.detectWhiteHand = hand => hand.some(item => item.id === "3b") ? "fivePairs" : null;
  try {
    const started = game.start(threadId, "host", () => 0.31);
    assert.equal(started.ok, true);
    assert.equal(started.finished, true);
    assert.equal(started.state.status, "finished");
    assert.equal(started.state.whiteHand.type, "fivePairs");
    assert.equal(started.state.winnerUid, started.state.whiteHand.uid);
  } finally {
    engine.detectWhiteHand = originalDetect;
    game.removeRoom(threadId);
  }
});

test("Sâm marks a failed Báo Sâm as lủng when another player beats the caller", () => {
  const threadId = "sam-lung-test";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81522" });
  assert.equal(created.ok, true);
  game.join(threadId, "81522", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try {
    started = game.start(threadId, "a", () => 0.12);
  } finally {
    engine.detectWhiteHand = originalDetector;
  }
  assert.equal(started.ok, true);

  const room = started.state;
  room.hands = { a: [card(3), card(6)], b: [card(4), card(5)] };
  room.firstPlayerUid = "a";
  room.turnUid = "a";
  room.playedCount = 0;
  room.currentCombo = null;
  room.lastPlayerUid = null;
  assert.equal(game.callSam(threadId, "a").ok, true);
  assert.equal(game.play(threadId, "a", "3b").ok, true);
  const blocked = game.play(threadId, "b", "5b");
  assert.equal(blocked.ok, true);
  assert.equal(blocked.samLung, true);
  assert.equal(blocked.state.samStatus, "failed");
  assert.equal(blocked.state.samBlockedByUid, "b");
  game.removeRoom(threadId);
});

test("Sâm marks an uninterrupted Báo Sâm as successful", () => {
  const threadId = "sam-success-test";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81523" });
  assert.equal(created.ok, true);
  game.join(threadId, "81523", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try {
    started = game.start(threadId, "a", () => 0.15);
  } finally {
    engine.detectWhiteHand = originalDetector;
  }
  assert.equal(started.ok, true);

  const room = started.state;
  room.hands = { a: [card(3)], b: [card(4), card(5)] };
  room.firstPlayerUid = "a";
  room.turnUid = "a";
  room.playedCount = 0;
  assert.equal(game.callSam(threadId, "a").ok, true);
  const result = game.play(threadId, "a", "3b");
  assert.equal(result.ok, true);
  assert.equal(result.finished, true);
  assert.equal(result.state.samStatus, "success");
  game.removeRoom(threadId);
});

test("Sâm caller takes the opening lead and may open without the 3♠", () => {
  const threadId = "sam-call-turn-test";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81525" });
  assert.equal(created.ok, true);
  game.join(threadId, "81525", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try {
    started = game.start(threadId, "a", () => 0.19);
  } finally {
    engine.detectWhiteHand = originalDetector;
  }
  assert.equal(started.ok, true);

  const room = started.state;
  const caller = room.players.find(item => item.uid !== room.firstPlayerUid);
  const blocker = room.players.find(item => item.uid !== caller.uid);
  room.hands[caller.uid] = [card(4), card(7)];
  room.hands[blocker.uid] = [card(5), card(8)];
  room.turnUid = room.firstPlayerUid;
  assert.equal(game.callSam(threadId, caller.uid).ok, true);
  assert.equal(room.turnUid, caller.uid);
  assert.equal(room.samStatus, "called");
  assert.equal(room.samCallerHasPlayed, false);

  const opening = game.play(threadId, caller.uid, "4b");
  assert.equal(opening.ok, true);
  assert.equal(opening.samLung, false);
  assert.equal(opening.state.samCallerHasPlayed, true);
  assert.equal(opening.state.turnUid, blocker.uid);

  const blocked = game.play(threadId, blocker.uid, "8b");
  assert.equal(blocked.ok, true);
  assert.equal(blocked.samLung, true);
  assert.equal(blocked.state.samStatus, "failed");
  assert.equal(blocked.state.samBlockedByUid, blocker.uid);
  game.removeRoom(threadId);
});


test("Sâm serializes and restores a live room with pass state", () => {
  const threadId = "sam-restore-test";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81524" });
  assert.equal(created.ok, true);
  game.join(threadId, "81524", { uid: "b", name: "B" });
  game.start(threadId, "a", () => 0.28);
  const saved = game.serialize(threadId);
  game.removeRoom(threadId);
  const restored = game.restore(saved);
  assert.ok(restored);
  assert.equal(game.get(threadId).status, "playing");
  assert.equal(game.get(threadId).players.length, 2);
  game.removeRoom(threadId);
});

test("Sâm private hand sends a canvas to My Documents and replaces the previous card", async () => {
  const previousUsers = global.users;
  const sent = [];
  const undos = [];
  let id = 0;
  const api = {
    getOwnId() { return "bot-account"; },
    getContext() { return { loginInfo: { send2me_id: "my-documents" } }; },
    async sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId: String(threadId), type });
      id += 1;
      return {
        message: { msgId: "sam-" + id, cliMsgId: "sam-client-" + id },
        attachment: []
      };
    },
    async undo(target, threadId, type) {
      undos.push({ target, threadId: String(threadId), type });
      return true;
    }
  };
  const room = {
    id: "81526", threadId: "sam-preview-group",
    players: [
      { uid: "bot-account", name: "Admin" },
      { uid: "other-player", name: "Người chơi" }
    ]
  };
  const hand = Array.from({ length: 10 }, (_, index) => card(index + 3));
  try {
    const first = await command._test.sendPrivateHand(
      api, room, { uid: "bot-account", name: "Admin" }, hand, true
    );
    assert.equal(first, true);
    assert.equal(sent[0].threadId, "my-documents");
    assert.equal(sent[0].payload.attachments[0], "/tmp/sam-test-canvas.png");
    assert.equal(canvasCalls[0][0], "sam");
    assert.equal(canvasCalls[0][1].view, "hand");
    assert.equal(canvasCalls[0][1].hand.length, 10);
    assert.equal(canvasCalls[0][1].isTurn, true);

    const second = await command._test.sendPrivateHand(
      api, room, { uid: "bot-account", name: "Admin" }, hand, false
    );
    assert.equal(second, true);
    assert.equal(undos.length, 1);
    assert.equal(undos[0].threadId, "my-documents");

    const other = await command._test.sendPrivateHand(
      api, room, { uid: "other-player", name: "Người chơi" }, hand, false
    );
    assert.equal(other, true);
    assert.equal(sent[2].threadId, "other-player");

    const recalled = await command._test.recallRoomCards(api, room);
    assert.equal(recalled, 0);
    assert.equal(undos.length, 3);
    assert.ok(undos.some(item => item.threadId === "my-documents"));
    assert.ok(undos.some(item => item.threadId === "other-player"));
  } finally {
    global.users = previousUsers;
  }
});

test("Sâm group board automatically warns when a player is down to one card", () => {
  const caption = command._test.roomCaption({
    id: "81527",
    status: "playing",
    turnUid: "p2",
    players: [
      { uid: "p1", name: "Người A", handCount: 4, place: 0 },
      { uid: "p2", name: "Người B", handCount: 1, place: 0 }
    ]
  });
  assert.match(caption, /BÁO 1 LÁ/);
  assert.match(caption, /Người B chỉ còn 1 lá/);
});

test("Sâm help documents rules and My Documents destination is reserved for the bot owner", () => {
  assert.match(command._test.help("!"), /BÁO SÂM/i);
  assert.match(command._test.help("!"), /LỦNG SÂM/i);
  const api = {
    getOwnId() { return "bot-uid"; },
    getContext() { return { loginInfo: { send2me_id: "my-docs-id" } }; }
  };
  assert.deepEqual(command._test.privateDestination(api, "bot-uid"), {
    threadId: "my-docs-id", type: 0, myDocuments: true
  });
  assert.deepEqual(command._test.privateDestination(api, "other-uid"), {
    threadId: "other-uid", type: 0, myDocuments: false
  });
});


test("Sâm tứ quý chặt được tứ quý nhỏ hơn theo thứ hạng", () => {
  const lower = engine.analyzeCombo([card(8), card(8, "ch"), card(8, "r"), card(8, "c")]);
  const higher = engine.analyzeCombo([card(9), card(9, "ch"), card(9, "r"), card(9, "c")]);
  assert.equal(engine.canBeat(higher, lower), true);
  assert.equal(engine.canBeat(lower, higher), false);
});

test("Sâm does not allow finishing the hand with a 2", () => {
  const threadId = "sam-no-finish-two";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81601" });
  assert.equal(created.ok, true);
  game.join(threadId, "81601", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.22); }
  finally { engine.detectWhiteHand = originalDetector; }
  const room = started.state;
  room.hands = { a: [card(15)], b: [card(3)] };
  room.turnUid = "a";
  room.playedCount = 1;
  const result = game.play(threadId, "a", "2b");
  assert.equal(result.ok, false);
  assert.equal(result.code, "CANNOT_FINISH_WITH_TWO");
  assert.equal(room.hands.a.length, 1);
  game.removeRoom(threadId);
});

test("Sâm computes card-left, thối heo and cóng charges in the shared stake unit", () => {
  const room = {
    stake: 5000,
    winnerUid: "a",
    players: [{ uid: "a", name: "A" }, { uid: "b", name: "B" }],
    hands: { a: [], b: [card(3), card(15)] },
    playedByUid: { a: 1, b: 1 }
  };
  const settlement = game.calculateSettlement(room);
  assert.equal(settlement.net.a, 80000);
  assert.equal(settlement.net.b, -80000);
  assert.deepEqual(settlement.transfers[0], {
    from: "b", to: "a", amount: 80000, reason: "leftover-heo-quad-cong"
  });
});


test("Sâm báo một forces opponents to include their highest card", () => {
  const threadId = "sam-bao-one-highest";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81602", stake: 5000 });
  game.join(threadId, "81602", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.24); }
  finally { engine.detectWhiteHand = originalDetector; }
  const room = started.state;
  room.hands = { a: [card(4), card(9)], b: [card(7)] };
  room.turnUid = "a";
  room.playedCount = 1;
  const lowerMove = game.play(threadId, "a", "4b");
  assert.equal(lowerMove.ok, true);
  assert.equal(room.baoOneViolations.length, 1);
  assert.equal(room.baoOneViolations[0].from, "a");
  assert.equal(room.baoOneViolations[0].to, "b");
  assert.equal(room.baoOneViolations[0].amount, 15000);
  game.removeRoom(threadId);
});

test("Sâm Báo 1 accepts any card of the highest rank even when suits differ", () => {
  const threadId = "sam-bao-one-equal-rank";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81620", stake: 1000 });
  game.join(threadId, "81620", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.26); }
  finally { engine.detectWhiteHand = originalDetector; }

  const room = started.state;
  room.hands = {
    a: [card(8), card(15, "b"), card(15, "c")],
    b: [card(7)]
  };
  room.turnUid = "a";
  room.playedCount = 1;
  room.playedByUid = {};
  room.baoOneViolations = [];

  const result = game.play(threadId, "a", "2b");
  assert.equal(result.ok, true);
  assert.equal(room.baoOneViolations.length, 0,
    "Sâm compares only rank; either suit of the highest rank satisfies Báo 1");
  game.removeRoom(threadId);
});

test("Sâm ends immediately when the first player empties their hand; everyone else loses", () => {
  const threadId = "sam-first-finish-wins-only";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81621", stake: 1000 });
  game.join(threadId, "81621", { uid: "b", name: "B" });
  game.join(threadId, "81621", { uid: "c", name: "C" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.28); }
  finally { engine.detectWhiteHand = originalDetector; }

  const room = started.state;
  room.hands = { a: [card(3)], b: [card(4), card(5)], c: [card(6), card(7)] };
  room.turnUid = "a";
  room.currentCombo = null;
  room.lastPlayerUid = null;
  room.playedCount = 0;
  room.finishOrder = [];

  const result = game.play(threadId, "a", "3b");
  assert.equal(result.ok, true);
  assert.equal(result.finished, true);
  assert.equal(room.status, "finished");
  assert.equal(room.winnerUid, "a");
  assert.equal(room.results.filter(row => row.uid !== "a").length, 2);
  assert.equal(room.turnUid, null);
  game.removeRoom(threadId);
});

test("Sâm records a 15-stake transfer when a four-of-a-kind chops a two", () => {
  const threadId = "sam-chop-money";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81603", stake: 5000 });
  game.join(threadId, "81603", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.27); }
  finally { engine.detectWhiteHand = originalDetector; }
  const room = started.state;
  room.hands = {
    a: [card(8), card(8, "ch"), card(8, "r"), card(8, "c")],
    b: [card(15), card(3)]
  };
  room.playedByUid = { b: 1 };
  room.turnUid = "a";
  room.playedCount = 1;
  room.currentCombo = engine.analyzeCombo([card(15)]);
  room.lastPlayerUid = "b";
  const result = game.play(threadId, "a", "tuquy 8");
  assert.equal(result.ok, true);
  assert.equal(result.finished, true);
  assert.deepEqual(room.chopEvents[0], {
    from: "b", to: "a", amount: 75000, reason: "chop-two"
  });
  assert.ok(room.settlement.transfers.some(item =>
    item.from === "b" && item.to === "a" && item.amount === 75000 && item.reason === "chop-two"
  ));
  game.removeRoom(threadId);
});


test("Sâm cóng is 15 stakes plus heo and hàng, not ordinary rác cards", () => {
  const room = {
    stake: 1000,
    winnerUid: "a",
    players: [{ uid: "a" }, { uid: "b" }],
    hands: { a: [], b: [card(3), card(4), card(15), card(15, "c")] },
    playedByUid: { a: 1 }
  };
  const settlement = game.calculateSettlement(room);
  assert.equal(settlement.net.b, -45000);
  assert.equal(settlement.net.a, 45000);
});

test("Sâm failed call pays 20 stakes times opponents to the blocker", () => {
  const room = {
    stake: 1000,
    winnerUid: "c",
    samStatus: "failed",
    samCallerUid: "a",
    samBlockedByUid: "b",
    players: [{ uid: "a" }, { uid: "b" }, { uid: "c" }],
    hands: { a: [card(3)], b: [], c: [] },
    playedByUid: { a: 1, b: 1, c: 1 }
  };
  const settlement = game.calculateSettlement(room);
  assert.equal(settlement.net.a, -41000);
  assert.equal(settlement.net.b, 40000);
  assert.equal(settlement.net.c, 1000);
  assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0), 0);
});

test("Sâm white hand pays 20 stakes from each opponent", () => {
  const room = {
    stake: 1000,
    winnerUid: "a",
    whiteHand: { uid: "a", type: "longStraight" },
    players: [{ uid: "a" }, { uid: "b" }, { uid: "c" }],
    hands: { a: [], b: [], c: [] }
  };
  const settlement = game.calculateSettlement(room);
  assert.deepEqual(settlement.net, { a: 40000, b: -20000, c: -20000 });
});


test("Sâm multi-chop chain pays the accumulated 15-stake amount to the final cutter", () => {
  const threadId = "sam-chop-chain-final-cutter";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81604", stake: 1000 });
  game.join(threadId, "81604", { uid: "b", name: "B" });
  game.join(threadId, "81604", { uid: "c", name: "C" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.29); }
  finally { engine.detectWhiteHand = originalDetector; }

  const room = started.state;
  room.hands = {
    a: [card(15), card(9)],
    b: [card(7), card(7, "ch"), card(7, "r"), card(7, "c"), card(6)],
    c: [card(8), card(8, "ch"), card(8, "r"), card(8, "c"), card(6, "r")]
  };
  room.turnUid = "a";
  room.currentCombo = null;
  room.lastPlayerUid = null;
  room.lastPlay = null;
  room.passed = new Set();
  room.playedCount = 0;
  room.chopEvents = [];
  room.activeChopChain = null;
  room.playedByUid = {};

  assert.equal(game.play(threadId, "a", "2b").ok, true);
  assert.equal(game.play(threadId, "b", "tuquy 7").ok, true);

  const saved = game.serialize(threadId);
  game.removeRoom(threadId);
  const restored = game.restore(saved);
  assert.ok(restored);
  assert.equal(restored.activeChopChain.count, 1);
  assert.equal(game.play(threadId, "c", "tuquy 8").ok, true);

  const finalRoom = game.get(threadId);
  assert.equal(finalRoom.chopEvents.length, 1);
  assert.deepEqual(finalRoom.chopEvents[0], {
    from: "b", to: "c", amount: 30000, reason: "chop-chain"
  });
  const settlement = game.calculateSettlement(finalRoom);
  assert.ok(settlement.transfers.some(item =>
    item.from === "b" && item.to === "c" && item.amount === 30000 && item.reason === "chop-chain"
  ));
  assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0), 0);
  game.removeRoom(threadId);
});

test("Sâm Báo 1 with multiple one-card players charges only the one-card winner", () => {
  const threadId = "sam-bao-one-multiple-targets";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81605", stake: 1000 });
  game.join(threadId, "81605", { uid: "b", name: "B" });
  game.join(threadId, "81605", { uid: "c", name: "C" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.33); }
  finally { engine.detectWhiteHand = originalDetector; }

  const room = started.state;
  room.hands = { a: [card(3), card(9)], b: [card(4)], c: [card(5)] };
  room.turnUid = "a";
  room.playedCount = 0;
  room.playedByUid = {};
  room.baoOneViolations = [];
  assert.equal(game.play(threadId, "a", "3b").ok, true);
  assert.equal(room.baoOneViolations.length, 2);
  assert.equal(room.baoOneViolations[0].amount, 4000);
  assert.equal(game.play(threadId, "b", "4b").finished, true);

  const settlement = room.settlement;
  assert.ok(settlement.transfers.some(item =>
    item.from === "a" && item.to === "b" && item.amount === 4000 && item.reason === "bao-one-penalty"
  ));
  assert.equal(settlement.transfers.some(item =>
    item.from === "a" && item.to === "c" && item.reason === "bao-one-penalty"
  ), false);
  assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0), 0);
  game.removeRoom(threadId);
});


test("Sâm failed-call settlement scales to 2, 3 and 4 players and pays the actual blocker", () => {
  for (const count of [2, 3, 4]) {
    const players = Array.from({ length: count }, (_, index) => ({ uid: String.fromCharCode(97 + index) }));
    const winnerUid = players[count - 1].uid;
    const blockerUid = players[1].uid;
    const room = {
      stake: 1000,
      winnerUid,
      samStatus: "failed",
      samCallerUid: "a",
      samBlockedByUid: blockerUid,
      players,
      hands: Object.fromEntries(players.map(player => [player.uid, []])),
      playedByUid: Object.fromEntries(players.map(player => [player.uid, 1]))
    };
    const settlement = game.calculateSettlement(room);
    const penalty = settlement.transfers.find(item => item.reason === "den-sam-20x-per-opponent");
    assert.deepEqual(penalty, {
      from: "a", to: blockerUid, amount: 20000 * (count - 1),
      reason: "den-sam-20x-per-opponent"
    });
    assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0), 0);
    if (blockerUid !== winnerUid) assert.notEqual(penalty.to, winnerUid);
  }
});

test("Sâm successful call pays each opponent exactly 20 stakes at 2, 3 and 4 players", () => {
  for (const count of [2, 3, 4]) {
    const players = Array.from({ length: count }, (_, index) => ({ uid: String.fromCharCode(97 + index) }));
    const room = {
      stake: 1000,
      winnerUid: "a",
      samStatus: "success",
      samCallerUid: "a",
      samCallerHasPlayed: true,
      players,
      hands: Object.fromEntries(players.map(player => [player.uid, []])),
      playedByUid: Object.fromEntries(players.map(player => [player.uid, 1]))
    };
    const settlement = game.calculateSettlement(room);
    assert.equal(settlement.transfers.filter(item => item.reason === "bao-sam-success-20x").length, count - 1);
    for (const player of players.filter(item => item.uid !== "a")) {
      assert.ok(settlement.transfers.some(item =>
        item.from === player.uid && item.to === "a" && item.amount === 20000
      ));
    }
    assert.equal(settlement.net.a, 20000 * (count - 1));
    assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0), 0);
  }
});

test("Sâm cóng with four 2s adds cóng, four individual heo penalties and one hàng penalty", () => {
  const room = {
    stake: 1000,
    winnerUid: "a",
    players: [{ uid: "a" }, { uid: "b" }],
    hands: {
      a: [],
      b: [card(15, "b"), card(15, "ch"), card(15, "r"), card(15, "c")]
    },
    playedByUid: { a: 1, b: 0 }
  };
  const settlement = game.calculateSettlement(room);
  assert.equal(settlement.net.b, -90000);
  assert.equal(settlement.net.a, 90000);
  assert.equal(settlement.transfers[0].amount, 90000);
});


test("Sâm compares simultaneous white hands of the same type by their highest qualifying card", () => {
  const pairHand = ranks => ranks.flatMap(rank => [card(rank, "b"), card(rank, "r")]);
  const lowPairs = pairHand([3, 4, 5, 6, 11]);
  const highPairs = pairHand([3, 4, 5, 6, 12]);
  assert.equal(engine.detectWhiteHand(lowPairs), "fivePairs");
  assert.equal(engine.detectWhiteHand(highPairs), "fivePairs");
  assert.ok(engine.compareWhiteHands(highPairs, "fivePairs", lowPairs, "fivePairs") < 0);

  const triples = (topRank) => [
    card(3), card(3, "ch"), card(3, "r"),
    card(5), card(5, "ch"), card(5, "r"),
    card(topRank), card(topRank, "ch"), card(topRank, "r"),
    card(10)
  ];
  assert.ok(engine.compareWhiteHands(
    triples(8), "threeTriples", triples(7), "threeTriples"
  ) < 0);

  const lowColor = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13]
    .map((rank, index) => card(rank, index % 2 ? "ch" : "b"));
  const highColor = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14]
    .map((rank, index) => card(rank, index % 2 ? "ch" : "b"));
  assert.equal(engine.detectWhiteHand(lowColor), "sameColor");
  assert.equal(engine.detectWhiteHand(highColor), "sameColor");
  assert.ok(engine.compareWhiteHands(highColor, "sameColor", lowColor, "sameColor") < 0);
});

test("Sâm resolves multiple white hands once, choosing the higher five-pair hand and paying only that winner", () => {
  const threadId = "sam-white-hand-same-type";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81606", stake: 1000 });
  assert.equal(created.ok, true);
  game.join(threadId, "81606", { uid: "b", name: "B" });
  game.join(threadId, "81606", { uid: "c", name: "C" });

  const pairHand = (ranks, suits) => ranks.flatMap(rank =>
    suits.map(suit => card(rank, suit))
  );
  const hands = {
    a: pairHand([3, 4, 5, 6, 11], ["b", "r"]),
    b: pairHand([3, 4, 5, 6, 12], ["ch", "c"]),
    c: [
      card(7, "b"), card(7, "r"), card(8, "b"), card(8, "ch"),
      card(9, "r"), card(9, "c"), card(10, "b"),
      card(13, "c"), card(14, "r"), card(15, "b")
    ]
  };

  const originalDeal = engine.dealCards;
  engine.dealCards = () => ({ hands, firstPlayerId: "a", remainingDeck: [] });
  try {
    const started = game.start(threadId, "a");
    assert.equal(started.ok, true);
    assert.equal(started.finished, true);
    assert.deepEqual(started.state.whiteHand, { uid: "b", type: "fivePairs" });
    assert.equal(started.state.winnerUid, "b");

    const payouts = started.state.settlement.transfers.filter(item =>
      item.reason === "white-hand-20x"
    );
    assert.deepEqual(payouts, [
      { from: "a", to: "b", amount: 20000, reason: "white-hand-20x" },
      { from: "c", to: "b", amount: 20000, reason: "white-hand-20x" }
    ]);
    assert.deepEqual(started.state.settlement.net, {
      a: -20000, b: 40000, c: -20000
    });
  } finally {
    engine.dealCards = originalDeal;
    game.removeRoom(threadId);
  }
});


test("Sâm uses white-hand type priority before comparing same-type high cards", () => {
  const threadId = "sam-white-hand-priority";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81607", stake: 1000 });
  assert.equal(created.ok, true);
  game.join(threadId, "81607", { uid: "b", name: "B" });

  const longStraight = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    .map(rank => card(rank, "b"));
  const fourTwos = [
    card(15, "b"), card(15, "ch"), card(15, "r"), card(15, "c"),
    card(3, "r"), card(4, "r"), card(5, "r"),
    card(6, "r"), card(7, "r"), card(8, "r")
  ];
  assert.equal(engine.detectWhiteHand(longStraight), "longStraight");
  assert.equal(engine.detectWhiteHand(fourTwos), "fourTwos");

  const originalDeal = engine.dealCards;
  engine.dealCards = () => ({
    hands: { a: longStraight, b: fourTwos },
    firstPlayerId: "a",
    remainingDeck: []
  });
  try {
    const started = game.start(threadId, "a");
    assert.equal(started.ok, true);
    assert.equal(started.finished, true);
    assert.deepEqual(started.state.whiteHand, { uid: "a", type: "longStraight" });
    assert.deepEqual(started.state.settlement.net, { a: 20000, b: -20000 });
  } finally {
    engine.dealCards = originalDeal;
    game.removeRoom(threadId);
  }
});


function makeMemoryUsers(initialBalances = {}) {
  const records = new Map(Object.entries(initialBalances).map(([uid, coins]) => [uid, {
    tlmn: {
      coins, games: 0, wins: 0, losses: 0,
      transactions: [], pendingTransfers: []
    }
  }]));
  return {
    records,
    async getData(uid) {
      return { data: structuredClone(records.get(String(uid)) || {}) };
    },
    async setDataAndWait(uid, data) {
      records.set(String(uid), structuredClone(data));
      return true;
    }
  };
}

function makeMemoryThreads() {
  const records = new Map();
  return {
    records,
    async getData(threadId) {
      return { data: structuredClone(records.get(String(threadId)) || {}) };
    },
    async setDataAndWait(threadId, data) {
      records.set(String(threadId), structuredClone(data));
      return true;
    },
    getAll() {
      return [...records.entries()].map(([threadId, data]) => ({
        threadId, data: structuredClone(data)
      }));
    }
  };
}

test("Sâm creates a stable game token and preserves it through room restore", () => {
  const threadId = "sam-stable-game-token";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81608" });
  assert.equal(created.ok, true);
  assert.match(created.state.gameToken, /^[0-9a-f-]{36}$/i);
  const token = created.state.gameToken;
  const saved = game.serialize(threadId);
  game.removeRoom(threadId);
  const restored = game.restore(saved);
  assert.ok(restored);
  assert.equal(restored.gameToken, token);
  game.removeRoom(threadId);
});

test("Sâm refunds a reservation that is still only in lockPending after a crash", async () => {
  const threadId = "sam-pending-only-refund";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81609", stake: 100 });
  game.join(threadId, "81609", { uid: "b", name: "B" });
  const reserveId = "reserve:81609:pending-only:a";
  const room = created.state;
  room.lockTransactionId = "pending-only";
  room.locked = {};
  room.lockPending = { a: { amount: 25000, transactionId: reserveId } };

  const Users = makeMemoryUsers({ a: 75000, b: 100000 });
  const a = Users.records.get("a");
  a.tlmn.transactions.push(reserveId);
  Users.records.set("a", a);
  const Threads = makeMemoryThreads();

  const refunded = await command._test.refundSamWallets(Users, room, Threads);
  assert.equal(refunded, true);
  assert.equal(Users.records.get("a").tlmn.coins, 100000);
  assert.deepEqual(room.locked, {});
  assert.deepEqual(room.lockPending, {});
  assert.equal(room.lockTransactionId, null);
  game.removeRoom(threadId);
});

test("Sâm non-owner stop cannot refund or unlock the players' escrow", async () => {
  const threadId = "sam-stop-authorization";
  const created = game.create(threadId, { uid: "owner", name: "Chủ bàn" }, { id: "81610", stake: 100 });
  game.join(threadId, "81610", { uid: "guest", name: "Khách" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "owner", () => 0.21); }
  finally { engine.detectWhiteHand = originalDetector; }

  const room = started.state;
  room.lockTransactionId = "active-escrow";
  room.locked = { owner: 25000, guest: 25000 };
  room.lockPending = {};
  const Users = makeMemoryUsers({ owner: 75000, guest: 75000 });
  const Threads = makeMemoryThreads();
  const sent = [];
  const api = {
    async sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId, type });
      return true;
    }
  };

  await command._test.runCommand({
    args: ["stop"], api, Users, Threads,
    event: {
      threadId, type: 1,
      data: { uidFrom: "intruder", dName: "Người lạ" }
    }
  });

  assert.equal(Users.records.get("owner").tlmn.coins, 75000);
  assert.equal(Users.records.get("guest").tlmn.coins, 75000);
  assert.equal(game.get(threadId).status, "playing");
  assert.deepEqual(game.get(threadId).locked, { owner: 25000, guest: 25000 });
  game.removeRoom(threadId);
});

test("Sâm owner leaving a waiting room recovers an interrupted pending reservation", async () => {
  const threadId = "sam-owner-leave-pending";
  const created = game.create(threadId, { uid: "owner", name: "Chủ bàn" }, { id: "81611", stake: 100 });
  game.join(threadId, "81611", { uid: "guest", name: "Khách" });
  const room = created.state;
  room.lockTransactionId = "leave-pending";
  const reserveId = "reserve:81611:leave-pending:owner";
  room.locked = {};
  room.lockPending = { owner: { amount: 25000, transactionId: reserveId } };

  const Users = makeMemoryUsers({ owner: 75000, guest: 100000 });
  const owner = Users.records.get("owner");
  owner.tlmn.transactions.push(reserveId);
  Users.records.set("owner", owner);
  const Threads = makeMemoryThreads();
  const api = { async sendMessage() { return true; } };

  await command._test.runCommand({
    args: ["leave"], api, Users, Threads,
    event: { threadId, type: 1, data: { uidFrom: "owner", dName: "Chủ bàn" } }
  });

  assert.equal(Users.records.get("owner").tlmn.coins, 100000);
  assert.equal(game.get(threadId), null);
  assert.equal(Threads.records.get(threadId)?.sam_room, undefined);
});

test("Sâm settlement retry after restart reuses the same transaction IDs", async () => {
  const threadId = "sam-settlement-retry-token";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81612", stake: 100 });
  game.join(threadId, "81612", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.29); }
  finally { engine.detectWhiteHand = originalDetector; }
  const room = started.state;
  const stableToken = room.gameToken;
  room.locked = { a: 25000, b: 25000 };
  room.lockPending = {};
  game.finish(room, "a");

  const Users = makeMemoryUsers({ a: 75000, b: 75000 });
  const Threads = makeMemoryThreads();
  let failBOnce = true;
  const originalSet = Users.setDataAndWait.bind(Users);
  Users.setDataAndWait = async (uid, data) => {
    if (uid === "b" && failBOnce) {
      failBOnce = false;
      throw new Error("simulated database write failure");
    }
    return originalSet(uid, data);
  };

  const partial = await command._test.settleSamWallets(Users, room, Threads);
  assert.deepEqual(partial, { ok: false, code: "WALLET_CREDIT_FAILED", uid: "b" });
  assert.equal(Users.records.get("a").tlmn.coins, 100000 + Number(room.settlement.net.a));
  assert.equal(room.settled, false);

  const saved = Threads.records.get(threadId)?.sam_room;
  assert.ok(saved);
  game.removeRoom(threadId);
  const restored = game.restore(saved);
  assert.ok(restored);
  assert.equal(restored.gameToken, stableToken);

  Users.setDataAndWait = originalSet;
  const retry = await command._test.settleSamWallets(Users, restored, Threads);
  assert.equal(retry.ok, true);
  assert.equal(restored.settled, true);
  assert.equal(Users.records.get("a").tlmn.coins, 100000 + Number(restored.settlement.net.a));
  assert.equal(Users.records.get("a").tlmn.games, 1);
  assert.equal(Users.records.get("b").tlmn.games, 1);
  game.removeRoom(threadId);
});


test("Sâm startup recovers a pending escrow from a waiting room before scheduling lobby cleanup", async () => {
  const threadId = "sam-onload-waiting-escrow";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81613", stake: 100 });
  game.join(threadId, "81613", { uid: "b", name: "B" });
  const room = created.state;
  room.lockTransactionId = "startup-waiting";
  const reserveId = "reserve:81613:startup-waiting:a";
  room.locked = {};
  room.lockPending = { a: { amount: 25000, transactionId: reserveId } };

  const Users = makeMemoryUsers({ a: 75000, b: 100000 });
  const record = Users.records.get("a");
  record.tlmn.transactions.push(reserveId);
  Users.records.set("a", record);
  const Threads = makeMemoryThreads();
  Threads.records.set(threadId, { sam_room: game.serialize(room) });
  game.removeRoom(threadId);

  const api = { async sendMessage() { return true; } };
  await command.onLoad({ api, Users, Threads });

  const restored = game.get(threadId);
  assert.ok(restored);
  assert.equal(restored.status, "waiting");
  assert.equal(Users.records.get("a").tlmn.coins, 100000);
  assert.deepEqual(restored.locked, {});
  assert.deepEqual(restored.lockPending, {});
  assert.equal(game.timers.has(threadId), true);
  game.removeRoom(threadId);
});

test("Sâm startup restores a valid playing room, re-sends private hands and resumes its turn timer", async () => {
  const threadId = "sam-onload-playing-room";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81614", stake: 100 });
  game.join(threadId, "81614", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.32); }
  finally { engine.detectWhiteHand = originalDetector; }

  const room = started.state;
  room.lockTransactionId = room.gameToken;
  room.locked = { a: 25000, b: 25000 };
  room.lockPending = {};
  const Threads = makeMemoryThreads();
  Threads.records.set(threadId, { sam_room: game.serialize(room) });
  game.removeRoom(threadId);

  const Users = makeMemoryUsers({ a: 75000, b: 75000 });
  let sent = 0;
  const api = {
    getOwnId() { return "bot-uid"; },
    getContext() { return { loginInfo: { send2me_id: "my-documents" } }; },
    async sendMessage() {
      sent += 1;
      return {
        message: { msgId: "restore-" + sent, cliMsgId: "restore-client-" + sent },
        attachment: []
      };
    },
    async undo() { return true; }
  };

  await command.onLoad({ api, Users, Threads });

  const restored = game.get(threadId);
  assert.ok(restored);
  assert.equal(restored.status, "playing");
  assert.equal(restored.locked.a, 25000);
  assert.equal(restored.locked.b, 25000);
  assert.equal(game.timers.has(threadId), true);
  assert.ok(sent >= 3, "both private hands and the group board should be re-sent");
  game.removeRoom(threadId);
});


test("Sâm service rejects play, pass and Báo Sâm while cancellation is refunding escrow", () => {
  const threadId = "sam-cancel-pending-guards";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81615" });
  game.join(threadId, "81615", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.36); }
  finally { engine.detectWhiteHand = originalDetector; }

  const room = started.state;
  const handBefore = JSON.stringify(room.hands);
  const turnBefore = room.turnUid;
  room.cancelPending = true;

  assert.equal(game.play(threadId, room.turnUid, "3b").code, "CANCEL_PENDING");
  assert.equal(game.pass(threadId, room.turnUid).code, "CANCEL_PENDING");
  assert.equal(game.callSam(threadId, room.turnUid).code, "CANCEL_PENDING");
  assert.equal(JSON.stringify(room.hands), handBefore);
  assert.equal(room.turnUid, turnBefore);
  game.removeRoom(threadId);
});

test("Sâm startup completes a saved cancelPending refund instead of resuming the game", async () => {
  const threadId = "sam-onload-cancel-pending";
  const created = game.create(threadId, { uid: "a", name: "A" }, { id: "81616", stake: 100 });
  game.join(threadId, "81616", { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(threadId, "a", () => 0.38); }
  finally { engine.detectWhiteHand = originalDetector; }

  const room = started.state;
  const reserveId = "reserve:81616:cancel-pending:a";
  room.lockTransactionId = "cancel-pending";
  room.locked = {};
  room.lockPending = { a: { amount: 25000, transactionId: reserveId } };
  room.cancelPending = true;

  const Users = makeMemoryUsers({ a: 75000, b: 75000 });
  const owner = Users.records.get("a");
  owner.tlmn.transactions.push(reserveId);
  Users.records.set("a", owner);
  const Threads = makeMemoryThreads();
  Threads.records.set(threadId, { sam_room: game.serialize(room) });
  game.removeRoom(threadId);
  const api = { async sendMessage() { return true; }, async undo() { return true; } };

  await command.onLoad({ api, Users, Threads });

  assert.equal(Users.records.get("a").tlmn.coins, 100000);
  assert.equal(game.get(threadId), null);
  assert.equal(Threads.records.get(threadId)?.sam_room, undefined);
});


test("Sâm settlement rejects pending or malformed escrow ledger before wallet writes", async () => {
  const Users = makeMemoryUsers({ a: 75000, b: 75000 });
  const Threads = makeMemoryThreads();
  const base = {
    id: "81617",
    gameToken: "sam-escrow-guard",
    stake: 100,
    players: [{ uid: "a", name: "A" }, { uid: "b", name: "B" }],
    locked: { a: 25000, b: 25000 },
    lockPending: { a: { amount: 25000, transactionId: "pending" } },
    settlement: {
      winnerUid: "a",
      transfers: [],
      net: { a: 0, b: 0 }
    },
    winnerUid: "a",
    settled: false
  };

  const pending = await command._test.settleSamWallets(Users, base, Threads);
  assert.deepEqual(pending, { ok: false, code: "PENDING_ESCROW_RESERVATION" });

  const malformed = {
    ...base,
    lockPending: {},
    settlement: { winnerUid: "a", transfers: [], net: { a: 0 } }
  };
  const invalid = await command._test.settleSamWallets(Users, malformed, Threads);
  assert.deepEqual(invalid, { ok: false, code: "INVALID_SETTLEMENT_LEDGER" });
  assert.equal(Users.records.get("a").tlmn.coins, 75000);
  assert.equal(Users.records.get("b").tlmn.coins, 75000);
});
