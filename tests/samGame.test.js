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
    assert.ok(dealt.hands[dealt.firstPlayerId].some(item => item.id === "3b"));
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
  const blocked = game.play(threadId, "b", "4b");
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

  const blocked = game.play(threadId, blocker.uid, "5b");
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
