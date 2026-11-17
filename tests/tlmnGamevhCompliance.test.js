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
