"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../core/runtime/services/games/tlmnService");
const engine = require("../core/games/tlmnEngine");
const command = require("../plugins/commands/tlmn");

function addPracticeBots(threadId, room) {
  for (let index = 1; index <= 3; index += 1) {
    const joined = game.join(threadId, room.id, {
      uid: "tlmn-ai:" + room.id + ":" + index,
      name: "AI " + index,
      ai: true
    });
    assert.equal(joined.ok, true);
  }
}

test("TLMN practice room persists its practice flag and AI seat metadata", () => {
  const groupId = "tlmn-ai-restore-test";
  const created = game.create(groupId, { uid: "human", name: "Admin" }, {
    practice: true,
    practiceWinnerUid: "human"
  });
  assert.equal(created.ok, true);
  addPracticeBots(groupId, created.room);

  const saved = game.serialize(game.get(groupId));
  assert.equal(saved.practice, true);
  assert.equal(saved.practiceWinnerUid, "human");
  assert.equal(saved.players.filter(player => player.ai).length, 3);

  game.removeRoom(groupId);
  const restored = game.restore(saved);
  assert.ok(restored);
  assert.equal(restored.practice, true);
  assert.equal(restored.practiceWinnerUid, "human");
  assert.equal(restored.players.filter(player => player.ai).length, 3);
  game.removeRoom(groupId);
});

test("TLMN AI opening selection is legal and contains 3 of spades", () => {
  const groupId = "tlmn-ai-opening-test";
  const created = game.create(groupId, { uid: "human", name: "Admin" }, {
    practice: true
  });
  addPracticeBots(groupId, created.room);
  const started = game.start(groupId, "human", () => 0.37);
  assert.equal(started.ok, true);

  const room = game.get(groupId);
  const aiWithThreeSpades = room.players.find(player =>
    player.ai && room.hands[player.uid].some(card => card.id === "3b")
  );
  // The 3♠ holder may be the human; the AI helper is still checked against a
  // valid opening hand by using a deterministic synthetic hand for the AI.
  const uid = aiWithThreeSpades?.uid || room.players.find(player => player.ai).uid;
  const hand = room.hands[uid];
  const hasThreeSpades = hand.some(card => card.id === "3b");
  const syntheticRoom = {
    ...room,
    playedCount: 0,
    currentCombo: null,
    hands: {
      ...room.hands,
      [uid]: hasThreeSpades ? hand : [
        ...hand.slice(0, 12),
        { rank: 3, suit: "b", id: "3b" }
      ]
    }
  };
  const move = command._test.chooseAiMove(syntheticRoom, uid);
  assert.ok(move);
  assert.ok(move.cards.some(card => card.id === "3b"));
  const parsed = engine.parsePlayText(syntheticRoom.hands[uid], move.input);
  assert.equal(parsed.ok, true);
  assert.equal(engine.validatePlay(syntheticRoom.hands[uid], parsed.cards, null, {
    mustContainThreeOfSpades: true
  }).ok, true);
  game.removeRoom(groupId);
});

test("TLMN AI answers a single with the lowest legal higher card", () => {
  const hand = [
    { rank: 3, suit: "b", id: "3b" },
    { rank: 11, suit: "r", id: "11r" },
    { rank: 15, suit: "c", id: "15c" }
  ];
  const room = {
    playedCount: 1,
    currentCombo: {
      type: "single",
      length: 1,
      mainRank: 10,
      cards: [{ rank: 10, suit: "b", id: "10b" }]
    },
    hands: { cpu: hand }
  };
  const move = command._test.chooseAiMove(room, "cpu");
  assert.ok(move);
  assert.equal(move.cards.length, 1);
  assert.equal(move.cards[0].rank, 11);
  assert.equal(engine.validatePlay(hand, move.cards, room.currentCombo).ok, true);
});

test("TLMN AI passes when it cannot beat the current single", () => {
  const room = {
    playedCount: 1,
    currentCombo: {
      type: "single",
      length: 1,
      mainRank: 15,
      cards: [{ rank: 15, suit: "b", id: "15b" }]
    },
    hands: {
      cpu: [
        { rank: 3, suit: "b", id: "3b" },
        { rank: 4, suit: "r", id: "4r" },
        { rank: 8, suit: "c", id: "8c" }
      ]
    }
  };
  assert.equal(command._test.chooseAiMove(room, "cpu"), null);
});

test("TLMN admin practice guarantees the Admin opens and AI yields every Admin-led trick", () => {
  const groupId = "tlmn-ai-admin-guaranteed-win";
  const created = game.create(groupId, { uid: "admin", name: "Admin" }, {
    practice: true,
    practiceWinnerUid: "admin"
  });
  assert.equal(created.ok, true);
  addPracticeBots(groupId, created.room);
  const started = game.start(groupId, "admin", () => 0.73);
  assert.equal(started.ok, true);

  const room = game.get(groupId);
  assert.equal(room.turnUid, "admin");
  assert.ok(room.hands.admin.some(card => card.id === "3b"));
  assert.equal(room.hands.admin.filter(card => card.rank === 15).length, 4);
  assert.equal(room.hands.admin.filter(card => card.rank === 14).length, 4);
  assert.equal(room.hands.admin.filter(card => card.rank === 13).length, 4);
  for (const player of room.players.filter(item => item.ai)) {
    assert.equal(room.hands[player.uid].length, 13);
    assert.equal(room.hands[player.uid].some(card => card.rank >= 13), false);
  }

  // Admin can clear the whole hand one card at a time. Each AI must legally
  // pass the Admin-led trick; this mode is only for a private practice room.
  let safety = 20;
  while (room.hands.admin.length && safety-- > 0) {
    const card = room.hands.admin[0];
    const played = game.play(groupId, "admin", engine.cardCode(card));
    assert.equal(played.ok, true, "Admin card must be playable: " + card.id);

    for (let passIndex = 0; passIndex < 3 && room.status === "playing"; passIndex += 1) {
      const aiUid = room.turnUid;
      assert.ok(String(aiUid).startsWith("tlmn-ai:"));
      assert.equal(command._test.chooseAiMove(room, aiUid), null);
      const passed = game.pass(groupId, aiUid);
      assert.equal(passed.ok, true);
    }
    if (room.finishOrder.includes("admin")) break;
  }

  assert.ok(safety > -1, "practice game loop should finish without exceeding guard");
  assert.equal(room.finishOrder[0], "admin");
  game.removeRoom(groupId);
});

test("TLMN quick play finds the largest legal play and respects the 3♠ opener", () => {
  const groupId = "tlmn-ai-quick-play";
  const created = game.create(groupId, { uid: "human", name: "Admin" }, {
    practice: true,
    practiceWinnerUid: "human"
  });
  addPracticeBots(groupId, created.room);
  game.start(groupId, "human", () => 0.21);
  const room = game.get(groupId);
  const move = command._test.chooseQuickMove(room, "human");
  assert.ok(move);
  assert.ok(move.cards.some(card => card.id === "3b"));
  assert.equal(engine.validatePlay(room.hands.human, move.cards, null, {
    mustContainThreeOfSpades: true
  }).ok, true);
  game.removeRoom(groupId);
});
