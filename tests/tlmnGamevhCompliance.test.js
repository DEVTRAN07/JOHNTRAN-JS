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

test("GameVH TLMN stops immediately when the first player empties their hand; every other player loses", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  const groupId = "tlmn-gamevh-first-player-wins-only";
  const room = game.create(groupId, { uid: "a", name: "A" }).state;
  game.join(groupId, room.id, { uid: "b", name: "B" });
  game.join(groupId, room.id, { uid: "c", name: "C" });
  game.start(groupId, "a", () => 0.37);

  room.status = "playing";
  room.activeUids = ["a", "b", "c"];
  room.finishOrder = [];
  room.forfeitUids = [];
  room.threeSpadesFinisherUid = null;
  room.threeSpadesBlockedByUid = null;
  room.hands = {
    a: [{ rank: 3, suit: "c", id: "3c" }],
    b: [{ rank: 4, suit: "b", id: "4b" }, { rank: 7, suit: "b", id: "7b" }],
    c: [{ rank: 5, suit: "c", id: "5c" }, { rank: 8, suit: "c", id: "8c" }]
  };
  room.turnUid = "a";
  room.currentCombo = null;
  room.lastPlayerUid = null;
  room.passed = new Set();
  room.playedCount = 0;

  const result = game.play(groupId, "a", "3c");
  assert.equal(result.ok, true);
  assert.equal(result.finished, true);
  assert.equal(room.status, "finished");
  assert.equal(room.settlement.winnerUid, "a");
  assert.ok(room.settlement.transfers.some(item => item.from === "b" && item.to === "a"));
  assert.ok(room.settlement.transfers.some(item => item.from === "c" && item.to === "a"));
  assert.equal(room.activeUids.length, 0);
  game.removeRoom(groupId);
});

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
  game.join(groupId, room.id, { uid: "d", name: "D" });
  game.start(groupId, "a", () => 0.37);

  room.status = "playing";
  room.activeUids = ["a", "b", "c", "d"];
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
    c: [{ rank: 10, suit: "b", id: "10b" }],
    d: [{ rank: 11, suit: "b", id: "11b" }]
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

  // C passes after the block and therefore also participates in the final trick.
  assert.equal(game.pass(groupId, "c").ok, true);
  assert.ok(room.threeSpadesBlockEvents.some(event =>
    event.from === "a" && event.to === "c" && event.amount === 26 * room.bet
  ));
  // D has not yet acted in that final trick and must not receive a block payment.
  assert.equal(room.threeSpadesBlockEvents.some(event =>
    event.from === "a" && event.to === "d"
  ), false);
  game.removeRoom(groupId);
});


test("GameVH TLMN chop chain charges the last player whose hàng is cut with the accumulated amount", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  const groupId = "tlmn-chop-chain-settlement";
  const created = game.create(groupId, { uid: "a", name: "A" });
  game.join(groupId, created.room.id, { uid: "b", name: "B" });
  game.join(groupId, created.room.id, { uid: "c", name: "C" });
  const started = game.start(groupId, "a", () => 0.41);
  const room = started.state;

  const card = (rank, suit) => ({ rank, suit, id: String(rank) + suit });
  room.status = "playing";
  room.activeUids = ["a", "b", "c"];
  room.finishOrder = [];
  room.forfeitUids = [];
  room.hands = {
    a: [card(15, "b"), card(9, "b")],
    b: [
      card(3, "b"), card(3, "ch"), card(4, "b"), card(4, "ch"),
      card(5, "b"), card(5, "ch"), card(10, "b")
    ],
    c: [
      card(3, "c"), card(3, "r"), card(4, "c"), card(4, "r"),
      card(5, "c"), card(5, "r"), card(6, "c"), card(6, "r"),
      card(11, "b")
    ]
  };
  room.turnUid = "a";
  room.currentCombo = null;
  room.lastPlayerUid = null;
  room.lastPlay = null;
  room.playedCount = 0;
  room.passed = new Set();
  room.trickParticipants = [];
  room.chopEvents = [];
  room.chopChainUnits = 0;
  room.chopChainTwoUnits = 0;
  room.chopChainEventIndex = null;
  room.trickTwoUnits = 0;

  const two = game.play(groupId, "a", "2b");
  assert.equal(two.ok, true);
  const threePairRun = game.play(groupId, "b", "3b3ch4b4ch5b5ch");
  assert.equal(threePairRun.ok, true);
  const fourPairRun = game.play(groupId, "c", "3c3r4c4r5c5r6c6r");
  assert.equal(fourPairRun.ok, true);

  assert.equal(room.chopEvents.length, 1);
  assert.deepEqual(room.chopEvents[0], {
    from: "b", to: "c", amount: 12 * room.bet, reason: "chop-chain"
  });
  const settlement = game.calculateSettlement(room);
  assert.ok(settlement.transfers.some(item =>
    item.from === "b" && item.to === "c" && item.amount === 12 * room.bet
  ));
  assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0), 0);
  game.removeRoom(groupId);
});


test("GameVH TLMN six-pair tie break includes a pair of 2s", () => {
  const a = [
    { rank: 15, suit: "b", id: "15b" },
    { rank: 15, suit: "ch", id: "15ch" },
    { rank: 15, suit: "r", id: "15r" },
    ...pairRunHand([3, 4, 6, 8, 10])
  ];
  const b = [
    ...pairRunHand([3, 4, 6, 8, 10, 12]),
    { rank: 14, suit: "b", id: "14b" }
  ];
  assert.equal(a.length, 13);
  assert.equal(b.length, 13);
  assert.equal(engine.detectWhiteHand(a), "sixPairs");
  assert.equal(engine.detectWhiteHand(b), "sixPairs");
  assert.ok(
    engine.compareWhiteHands(a, "sixPairs", b, "sixPairs") < 0,
    "a six-pair hand containing a pair of 2s must compare that pair as its highest pair"
  );
});

test("GameVH TLMN leftover penalty recognizes a four-pair run using two cards from a triple", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  const card = (rank, suit) => ({ rank, suit, id: String(rank) + suit });
  const hand = [
    card(3, "b"), card(3, "ch"), card(3, "r"),
    card(4, "b"), card(4, "ch"),
    card(5, "b"), card(5, "ch"),
    card(6, "b"), card(6, "ch"),
    card(8, "b"), card(9, "b"), card(10, "b"), card(11, "b")
  ];
  assert.equal(hand.length, 13);
  assert.equal(game.calculateLeftoverPenalty(hand, 1000), 17000);
});

test("GameVH TLMN four 2s followed by three-pair and four-pair runs settle a 27-bet chop chain", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  const groupId = "tlmn-four-twos-27-chain";
  const created = game.create(groupId, { uid: "a", name: "A" }, { code: "83760", bet: 1000 });
  assert.equal(created.ok, true);
  game.join(groupId, created.room.id, { uid: "b", name: "B" });
  game.join(groupId, created.room.id, { uid: "c", name: "C" });

  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(groupId, "a", () => 0.41); }
  finally { engine.detectWhiteHand = originalDetector; }
  const room = started.state;
  const card = (rank, suit) => ({ rank, suit, id: String(rank) + suit });

  room.bet = 1000;
  room.activeUids = ["a", "b", "c"];
  room.finishOrder = [];
  room.forfeitUids = [];
  room.hands = {
    a: [card(15, "b"), card(15, "c"), card(9, "b")],
    b: [
      card(15, "ch"),
      card(3, "b"), card(3, "ch"),
      card(4, "b"), card(4, "ch"),
      card(5, "b"), card(5, "ch"), card(11, "b")
    ],
    c: [
      card(15, "r"),
      card(3, "r"), card(3, "c"),
      card(4, "r"), card(4, "c"),
      card(5, "r"), card(5, "c"),
      card(6, "r"), card(6, "c"), card(12, "c")
    ]
  };
  room.turnUid = "a";
  room.currentCombo = null;
  room.lastPlayerUid = null;
  room.lastPlay = null;
  room.passed = new Set();
  room.playedCount = 0;
  room.trickParticipants = [];
  room.chopEvents = [];
  room.chopChainUnits = 0;
  room.chopChainTwoUnits = 0;
  room.chopChainEventIndex = null;
  room.trickTwoUnits = 0;

  assert.equal(game.play(groupId, "a", "2b").ok, true);
  assert.equal(game.play(groupId, "b", "2ch").ok, true);
  assert.equal(game.play(groupId, "c", "2r").ok, true);
  assert.equal(game.play(groupId, "a", "2c").ok, true);
  assert.equal(game.play(groupId, "b", "doithong 345").ok, true);
  assert.equal(game.play(groupId, "c", "doithong 3456").ok, true);

  assert.deepEqual(room.chopEvents, [{
    from: "b", to: "c", amount: 27000, reason: "chop-chain"
  }]);
  const settlement = game.calculateSettlement(room);
  assert.ok(settlement.transfers.some(item =>
    item.from === "b" && item.to === "c" && item.amount === 27000 &&
    item.reason === "chop-chain"
  ));
  assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0), 0);
  game.removeRoom(groupId);
});

test("GameVH TLMN successful kết 3 bích pays 26 bets per opponent without leftover penalties", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  const room = {
    bet: 1000,
    players: [{ uid: "a" }, { uid: "b" }, { uid: "c" }],
    finishOrder: ["a", "b", "c"],
    threeSpadesFinisherUid: "a",
    threeSpadesBlockedByUid: null,
    hands: {
      a: [],
      b: [{ rank: 15, suit: "c", id: "15c" }],
      c: [{ rank: 15, suit: "b", id: "15b" }, { rank: 3, suit: "b", id: "3b" }]
    },
    chopEvents: [],
    threeSpadesBlockEvents: []
  };
  const settlement = game.calculateSettlement(room);
  assert.deepEqual(settlement.transfers, [
    { from: "b", to: "a", amount: 26000, reason: "ket-ba-bich", receivedAmount: 24700, fee: 1300 },
    { from: "c", to: "a", amount: 26000, reason: "ket-ba-bich", receivedAmount: 24700, fee: 1300 }
  ]);
  assert.deepEqual(settlement.net, { a: 49400, b: -26000, c: -26000 });
  assert.equal(settlement.houseFee, 2600);
  assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0),
    -settlement.houseFee);
});

test("GameVH TLMN blocked kết 3 bích charges only players who joined the final trick", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  const room = {
    bet: 1000,
    players: [{ uid: "a" }, { uid: "b" }, { uid: "c" }, { uid: "d" }],
    finishOrder: ["b", "c", "d", "a"],
    threeSpadesFinisherUid: null,
    threeSpadesBlockedByUid: "b",
    hands: {
      a: [],
      b: [],
      c: [{ rank: 3, suit: "b", id: "3b" }],
      d: [{ rank: 4, suit: "b", id: "4b" }]
    },
    chopEvents: [],
    threeSpadesBlockEvents: [
      { from: "a", to: "b", amount: 26000 },
      { from: "a", to: "c", amount: 26000 }
    ]
  };
  const settlement = game.calculateSettlement(room);
  assert.ok(settlement.transfers.some(item =>
    item.from === "a" && item.to === "b" && item.amount === 26000 &&
    item.reason === "chan-ket-ba-bich"
  ));
  assert.ok(settlement.transfers.some(item =>
    item.from === "a" && item.to === "c" && item.amount === 26000 &&
    item.reason === "chan-ket-ba-bich"
  ));
  assert.equal(settlement.transfers.some(item =>
    item.from === "a" && item.to === "d" && item.reason === "chan-ket-ba-bich"
  ), false);
});


test("GameVH TLMN allows four-pair run to cut after its player has passed", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  const groupId = "tlmn-four-pair-after-pass";
  const created = game.create(groupId, { uid: "a", name: "A" }, { code: "83761", bet: 1000 });
  assert.equal(created.ok, true);
  game.join(groupId, created.room.id, { uid: "b", name: "B" });
  game.join(groupId, created.room.id, { uid: "c", name: "C" });

  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(groupId, "a", () => 0.43); }
  finally { engine.detectWhiteHand = originalDetector; }
  const room = started.state;
  const card = (rank, suit) => ({ rank, suit, id: String(rank) + suit });

  room.activeUids = ["a", "b", "c"];
  room.finishOrder = [];
  room.forfeitUids = [];
  room.hands = {
    a: [
      card(15, "b"),
      card(3, "b"), card(3, "ch"),
      card(4, "b"), card(4, "ch"),
      card(5, "b"), card(5, "ch"), card(11, "b")
    ],
    b: [
      card(7, "b"), card(7, "ch"),
      card(8, "b"), card(8, "ch"),
      card(9, "b"), card(9, "ch"),
      card(10, "b"), card(10, "ch"), card(12, "b")
    ],
    c: [card(15, "ch"), card(13, "b")]
  };
  room.turnUid = "a";
  room.currentCombo = null;
  room.lastPlayerUid = null;
  room.lastPlay = null;
  room.passed = new Set();
  room.playedCount = 0;
  room.trickParticipants = [];
  room.chopEvents = [];
  room.chopChainUnits = 0;
  room.chopChainTwoUnits = 0;
  room.chopChainEventIndex = null;
  room.trickTwoUnits = 0;

  assert.equal(game.play(groupId, "a", "2b").ok, true);
  assert.equal(game.pass(groupId, "b").ok, true);
  assert.equal(room.passed.has("b"), true);
  assert.equal(game.play(groupId, "c", "2ch").ok, true);
  assert.equal(game.play(groupId, "a", "doithong 345").ok, true);

  const returnedAfterPass = game.play(groupId, "b", "doithong 78910");
  assert.equal(returnedAfterPass.ok, true);
  assert.equal(room.passed.has("b"), false);
  assert.equal(room.currentCombo.type, "pairRun");
  assert.equal(room.currentCombo.length, 4);
  game.removeRoom(groupId);
});

test("GameVH TLMN four-pair run can cut a pair of 2s, while three-pair run cannot", () => {
  const card = (rank, suit) => ({ rank, suit, id: String(rank) + suit });
  const pairOfTwos = engine.analyzeCombo([card(15, "b"), card(15, "c")]);
  const threePairs = engine.analyzeCombo(pairRunHand([3, 4, 5]));
  const fourPairs = engine.analyzeCombo(pairRunHand([3, 4, 5, 6]));
  assert.equal(engine.canBeat(threePairs, pairOfTwos), false);
  assert.equal(engine.canBeat(fourPairs, pairOfTwos), true);
});


test("GameVH TLMN white-hand priority and payouts match all eight official categories", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  assert.deepEqual(engine.WHITE_HAND_PRIORITY, [
    "dragonStraight", "sixPairRun", "fourTriples", "twoFourKinds",
    "twelveSameSuit", "fivePairRun", "fourTwos", "sixPairs"
  ]);

  const payouts = [
    ["dragonStraight", 9],
    ["sixPairRun", 8],
    ["fourTriples", 7],
    ["twoFourKinds", 6],
    ["twelveSameSuit", 5],
    ["fivePairRun", 4],
    ["fourTwos", 3],
    ["sixPairs", 2]
  ];
  for (const [type, multiplier] of payouts) {
    const room = {
      bet: 1000,
      whiteHand: { uid: "winner", type },
      players: [{ uid: "winner" }, { uid: "a" }, { uid: "b" }],
      finishOrder: ["winner", "a", "b"],
      hands: {
        winner: [],
        a: [{ rank: 15, suit: "c", id: "15c" }],
        b: [
          { rank: 15, suit: "b", id: "15b" },
          { rank: 3, suit: "b", id: "3b" }
        ]
      },
      chopEvents: [],
      threeSpadesBlockEvents: []
    };
    const settlement = game.calculateSettlement(room);
    assert.deepEqual(settlement.transfers, [
      {
        from: "a", to: "winner", amount: multiplier * 1000,
        reason: "white-hand-" + type
      },
      {
        from: "b", to: "winner", amount: multiplier * 1000,
        reason: "white-hand-" + type
      }
    ], type + " must pay its official white-hand multiplier only");
    assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0), 0);
  }
});


test("TLMN service rejects play and pass while cancellation is refunding escrow", () => {
  const game = require("../core/runtime/services/games/tlmnService");
  const groupId = "tlmn-cancel-pending-guards";
  const created = game.create(groupId, { uid: "a", name: "A" }, { code: "83762", bet: 1000 });
  assert.equal(created.ok, true);
  game.join(groupId, created.room.id, { uid: "b", name: "B" });
  const originalDetector = engine.detectWhiteHand;
  engine.detectWhiteHand = () => null;
  let started;
  try { started = game.start(groupId, "a", () => 0.51); }
  finally { engine.detectWhiteHand = originalDetector; }

  const room = started.state;
  const handBefore = JSON.stringify(room.hands);
  const turnBefore = room.turnUid;
  room.cancelPending = true;

  assert.equal(game.play(groupId, room.turnUid, "3b").code, "CANCEL_PENDING");
  assert.equal(game.pass(groupId, room.turnUid).code, "CANCEL_PENDING");
  assert.equal(JSON.stringify(room.hands), handBefore);
  assert.equal(room.turnUid, turnBefore);
  game.removeRoom(groupId);
});

test("TLMN non-player cannot trigger escrow refund by issuing leave", async () => {
  const rendererPath = require.resolve("../core/canvas/workerRender");
  require.cache[rendererPath] = {
    id: rendererPath, filename: rendererPath, loaded: true,
    exports: { renderCanvas: async () => "/tmp/tlmn-wallet-test.png" }
  };
  const command = require("../plugins/commands/tlmn");
  const game = require("../core/runtime/services/games/tlmnService");
  const groupId = "tlmn-outsider-leave-escrow";
  const created = game.create(groupId, { uid: "a", name: "A" }, { code: "83763", bet: 1000 });
  game.join(groupId, created.room.id, { uid: "b", name: "B" });

  const reserveId = "reserve:83763:waiting:a";
  created.state.lockTransactionId = "waiting";
  created.state.locked = {};
  created.state.lockPending = {
    a: { amount: 100000, transactionId: reserveId }
  };

  const records = new Map([
    ["a", { tlmn: { coins: 900000, games: 0, wins: 0, losses: 0, transactions: [reserveId] } }],
    ["b", { tlmn: { coins: 1000000, games: 0, wins: 0, losses: 0, transactions: [] } }]
  ]);
  const Users = {
    async getData(uid) { return { data: structuredClone(records.get(String(uid)) || {}) }; },
    async setDataAndWait(uid, data) { records.set(String(uid), structuredClone(data)); return true; }
  };
  const threads = new Map();
  const Threads = {
    async getData(id) { return { data: structuredClone(threads.get(String(id)) || {}) }; },
    async setDataAndWait(id, data) { threads.set(String(id), structuredClone(data)); return true; }
  };
  const api = { async sendMessage() { return true; } };

  await command._test.doLeave({
    api, Users, Threads,
    event: { threadId: groupId, type: 1, data: { uidFrom: "outsider", dName: "Người lạ" } }
  });

  assert.equal(records.get("a").tlmn.coins, 900000);
  assert.equal(records.get("b").tlmn.coins, 1000000);
  assert.ok(game.get(groupId));
  assert.deepEqual(game.get(groupId).lockPending, {
    a: { amount: 100000, transactionId: reserveId }
  });
  game.removeRoom(groupId);
});


test("TLMN settlement refuses to pay while any escrow reservation is still pending", async () => {
  const rendererPath = require.resolve("../core/canvas/workerRender");
  require.cache[rendererPath] = {
    id: rendererPath, filename: rendererPath, loaded: true,
    exports: { renderCanvas: async () => "/tmp/tlmn-wallet-test.png" }
  };
  const command = require("../plugins/commands/tlmn");
  const room = {
    id: "83764",
    gameToken: "tlmn-pending-settlement",
    bet: 1000,
    players: [{ uid: "a", name: "A" }, { uid: "b", name: "B" }],
    locked: { a: 100000, b: 100000 },
    lockPending: { a: { amount: 100000, transactionId: "reserve-pending" } },
    settlement: {
      winnerUid: "a",
      transfers: [],
      net: { a: 0, b: 0 }
    },
    settled: false
  };
  let writes = 0;
  const Users = {
    async getData() { writes += 1; return { data: { tlmn: { coins: 100000, transactions: [] } } }; },
    async setDataAndWait() { writes += 1; return true; }
  };

  await assert.rejects(
    command._test.settleRoomWallets(Users, room, []),
    /Còn khoản ký quỹ đang chờ xác minh/
  );
  assert.equal(writes, 0);
});
