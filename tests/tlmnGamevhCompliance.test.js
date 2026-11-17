"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/tlmnEngine");

function pairRunHand(ranks) {
  return ranks.flatMap(rank => [
    { rank, suit: "b", id: String(rank) + "b" },
    { rank, suit: "ch", id: String(rank) + "ch" }
  ]);
}

test("GameVH TLMN only accepts three-pair and four-pair runs as playable combos", () => {
  const threePairs = pairRunHand([3, 4, 5]);
  const fourPairs = pairRunHand([3, 4, 5, 6]);
  const fivePairs = pairRunHand([3, 4, 5, 6, 7]);

  assert.equal(engine.analyzeCombo(threePairs)?.type, "pairRun");
  assert.equal(engine.analyzeCombo(threePairs)?.length, 3);
  assert.equal(engine.analyzeCombo(fourPairs)?.type, "pairRun");
  assert.equal(engine.analyzeCombo(fourPairs)?.length, 4);
  assert.equal(engine.analyzeCombo(fivePairs), null);

  assert.equal(engine.parsePlayText(threePairs, "doithong 345").ok, true);
  assert.equal(engine.parsePlayText(fourPairs, "doithong 3456").ok, true);
  assert.equal(engine.parsePlayText(fivePairs, "doithong 34567").code, "INVALID_PAIR_RUN");
});

test("GameVH TLMN five-pair-run white hand remains a separate instant-win pattern", () => {
  const hand = [
    ...pairRunHand([3, 4, 5, 6, 7]),
    { rank: 9, suit: "b", id: "9b" },
    { rank: 11, suit: "b", id: "11b" },
    { rank: 13, suit: "b", id: "13b" }
  ];
  assert.equal(hand.length, 13);
  assert.equal(engine.detectWhiteHand(hand), "fivePairRun");
});


test("GameVH TLMN compares straights by the suit of their highest card only", () => {
  const lowerHighSuit = [
    { rank: 3, suit: "c", id: "3c" },
    { rank: 4, suit: "b", id: "4b" },
    { rank: 5, suit: "ch", id: "5ch" }
  ];
  const higherTopCard = [
    { rank: 3, suit: "b", id: "3b" },
    { rank: 4, suit: "b", id: "4b" },
    { rank: 5, suit: "r", id: "5r" }
  ];
  assert.equal(engine.analyzeCombo(lowerHighSuit).highSuit, 1);
  assert.equal(engine.analyzeCombo(higherTopCard).highSuit, 2);
  assert.equal(engine.canBeat(engine.analyzeCombo(higherTopCard), engine.analyzeCombo(lowerHighSuit)), true);

  const lowerTopCard = [
    { rank: 3, suit: "c", id: "3c" },
    { rank: 4, suit: "b", id: "4b" },
    { rank: 5, suit: "ch", id: "5ch" }
  ];
  const higherLowerCardOnly = [
    { rank: 3, suit: "c", id: "3c" },
    { rank: 4, suit: "r", id: "4r" },
    { rank: 5, suit: "b", id: "5b" }
  ];
  assert.equal(engine.canBeat(
    engine.analyzeCombo(higherLowerCardOnly),
    engine.analyzeCombo(lowerTopCard)
  ), false, "a high suit on a lower card must not beat the higher top card");

  const currentPairRun = [
    { rank: 3, suit: "b", id: "3b" }, { rank: 3, suit: "c", id: "3c" },
    { rank: 4, suit: "b", id: "4b" }, { rank: 4, suit: "ch", id: "4ch" },
    { rank: 5, suit: "b", id: "5b" }, { rank: 5, suit: "ch", id: "5ch" }
  ];
  const strongerPairRun = [
    { rank: 3, suit: "b", id: "3b" }, { rank: 3, suit: "ch", id: "3ch" },
    { rank: 4, suit: "b", id: "4b" }, { rank: 4, suit: "ch", id: "4ch" },
    { rank: 5, suit: "b", id: "5b" }, { rank: 5, suit: "r", id: "5r" }
  ];
  assert.equal(engine.analyzeCombo(currentPairRun).highSuit, 1);
  assert.equal(engine.analyzeCombo(strongerPairRun).highSuit, 2);
  assert.equal(engine.canBeat(
    engine.analyzeCombo(strongerPairRun),
    engine.analyzeCombo(currentPairRun)
  ), true, "pair runs also compare the suit of their highest-rank pair");
});


test("GameVH TLMN: a higher straight can block a kết 3 bích played inside a straight", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  const groupId = "tlmn-block-three-spades-in-straight";
  const room = game.create(groupId, { uid: "a", name: "A" }).state;
  game.join(groupId, room.id, { uid: "b", name: "B" });
  game.join(groupId, room.id, { uid: "c", name: "C" });
  game.start(groupId, "a", () => 0.37);

  room.status = "playing";
  room.activeUids = ["a", "b", "c"];
  room.finishOrder = [];
  room.forfeitUids = [];
  room.hands = {
    a: [
      { rank: 3, suit: "b", id: "3b" },
      { rank: 4, suit: "b", id: "4b" },
      { rank: 5, suit: "b", id: "5b" }
    ],
    b: [
      { rank: 4, suit: "c", id: "4c" },
      { rank: 5, suit: "c", id: "5c" },
      { rank: 6, suit: "c", id: "6c" },
      { rank: 9, suit: "b", id: "9b" }
    ],
    c: [{ rank: 10, suit: "b", id: "10b" }]
  };
  room.turnUid = "a";
  room.currentCombo = null;
  room.lastPlayerUid = null;
  room.lastPlay = null;
  room.playedCount = 0;
  room.trickParticipants = [];
  room.threeSpadesFinisherUid = null;
  room.threeSpadesBlockedByUid = null;
  room.threeSpadesAttemptUid = null;
  room.threeSpadesBlockEvents = [];

  const finishAttempt = game.play(groupId, "a", "3b4b5b");
  assert.equal(finishAttempt.ok, true);
  assert.equal(room.threeSpadesFinisherUid, "a");
  assert.equal(room.turnUid, "b");

  const blocked = game.play(groupId, "b", "4c5c6c");
  assert.equal(blocked.ok, true);
  assert.equal(room.threeSpadesBlockedByUid, "b");
  assert.equal(room.threeSpadesFinisherUid, null);
  assert.ok(room.forfeitUids.includes("a"));
  assert.ok(room.threeSpadesBlockEvents.some(event =>
    event.from === "a" && event.to === "b" && event.amount === 26 * room.bet
  ));
  game.removeRoom(groupId);
});
