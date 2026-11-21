"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/samEngine");

function card(rank, suit = "b") {
  return { rank, suit, id: String(rank) + suit };
}

function seededRandom() {
  let state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function runFixtures() {
  const deck = engine.createDeck();
  const sorted = engine.sortHand([card(7, "c"), card(3), card(7, "b"), card(4, "ch")]);
  const dealt = engine.dealCards(["A", "B", "C", "D"], seededRandom());
  const playHand = [
    card(3), card(4), card(5), card(6),
    card(7, "ch"), card(7, "r"),
    card(9), card(9, "c"), card(9, "r"),
    card(12), card(12, "r"), card(12, "c"), card(12, "ch")
  ];
  const pair = engine.analyzeCombo([card(3), card(3, "r")]);
  const straight = engine.analyzeCombo([card(3), card(4), card(5), card(6)]);
  const fourKind = engine.analyzeCombo([card(7), card(7, "ch"), card(7, "r"), card(7, "c")]);
  const two = engine.analyzeCombo([card(15, "c")]);
  const validated = engine.validatePlay(playHand, [card(3)], null, { mustContainThreeOfSpades: true });
  const invalidLead = engine.validatePlay(playHand, [card(4)], null, { mustContainThreeOfSpades: true });

  const longStraight = Array.from({ length: 10 }, (_, index) => card(index + 3));
  const fourTwos = [
    card(15, "b"), card(15, "ch"), card(15, "r"), card(15, "c"),
    card(3), card(4), card(5), card(6), card(7), card(8)
  ];
  const sameColor = [3, 5, 7, 9, 11, 13, 14, 4, 6, 8].map((rank, index) =>
    card(rank, index % 2 ? "ch" : "b")
  );
  const threeTriples = [
    card(3), card(3, "ch"), card(3, "r"),
    card(5), card(5, "ch"), card(5, "r"),
    card(7), card(7, "ch"), card(7, "r"), card(10)
  ];
  const fivePairs = [3, 4, 5, 6, 7].flatMap(rank => [card(rank), card(rank, "c")]);
  const handLow = [card(5)];
  const handHigh = [card(8)];

  return {
    deck,
    sorted,
    shuffle: engine.shuffleDeck(seededRandom()),
    dealt,
    normalize: engine.normalizeText("  ĐIỆN THOẠI! "),
    parsedCard: engine.parseCardCode("10CH"),
    invalidCard: engine.parseCardCode("16b"),
    playPair: engine.parsePlayText(playHand, "doi 7"),
    playTriple: engine.parsePlayText(playHand, "sam 9"),
    playQuad: engine.parsePlayText(playHand, "tuquy Q"),
    playStraight: engine.parsePlayText(playHand, "sanh 3456"),
    playSelection: engine.parsePlayText(playHand, "chon 1,2"),
    invalidPlay: engine.parsePlayText(playHand, "unknown"),
    pair,
    straight,
    fourKind,
    beatsTwo: engine.canBeat(fourKind, two),
    doesNotBeat: engine.canBeat(pair, two),
    validated,
    invalidLead,
    removed: engine.removeCards(playHand, [card(3)]),
    whiteHands: [
      engine.detectWhiteHand(longStraight),
      engine.detectWhiteHand(fourTwos),
      engine.detectWhiteHand(sameColor),
      engine.detectWhiteHand(threeTriples),
      engine.detectWhiteHand(fivePairs)
    ],
    comparePriority: engine.compareWhiteHands(longStraight, "longStraight", fivePairs, "fivePairs"),
    compareRankDifference: engine.compareWhiteHands(handLow, "sameColor", handHigh, "sameColor"),
    label: engine.cardLabel(card(12, "c")),
    formatted: engine.formatCards([card(12, "c"), card(3), card(4, "ch")])
  };
}

test("Sâm Rust addon exposes the migrated card-rule operations", t => {
  const diagnostics = engine.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native game-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "Sâm Rust functions are inactive");
});

test("Sâm Rust card rules preserve JavaScript outputs and card ordering", t => {
  if (!engine.getNativeDiagnostics().loaded) {
    t.skip("native game-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_SAM_ENGINE;
  try {
    process.env.JT_RUST_SAM_ENGINE = "0";
    const fallback = runFixtures();
    delete process.env.JT_RUST_SAM_ENGINE;
    const rust = runFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_SAM_ENGINE;
    else process.env.JT_RUST_SAM_ENGINE = previous;
  }
});
