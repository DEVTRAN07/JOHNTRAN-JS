"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/tlmnEngine");

function card(rank, suit = "b") {
  return { rank, suit, id: String(rank) + suit };
}

function seededRandom(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function runFixtures() {
  const deck = engine.createDeck();
  const unsorted = [card(9, "c"), card(3), card(7, "ch"), card(7, "b"), card(15, "r")];
  const sorted = engine.sortHand(unsorted);
  const shuffle = engine.shuffleDeck(seededRandom(13));
  const dealt = engine.dealCards(["A", "B", "C", "D"], seededRandom(23));

  const playHand = [
    ...[3, 4, 5, 6, 7, 8].flatMap(rank => [card(rank, "b"), card(rank, "c")]),
    card(3, "ch"),
    card(9, "b"), card(10, "b"), card(11, "b"), card(12, "b"), card(13, "b"),
    card(14, "b"), card(15, "b"), card(15, "c")
  ];

  const single = engine.analyzeCombo([card(3)]);
  const pair = engine.analyzeCombo([card(4), card(4, "c")]);
  const triple = engine.analyzeCombo([card(5), card(5, "ch"), card(5, "r")]);
  const fourKind = engine.analyzeCombo([card(6), card(6, "ch"), card(6, "r"), card(6, "c")]);
  const straight = engine.analyzeCombo([card(7), card(8), card(9)]);
  const pairRun3 = engine.analyzeCombo([3, 4, 5].flatMap(rank => [card(rank), card(rank, "c")]));
  const pairRun4 = engine.analyzeCombo([4, 5, 6, 7].flatMap(rank => [card(rank), card(rank, "c")]));
  const two = engine.analyzeCombo([card(15, "b")]);
  const pairOfTwos = engine.analyzeCombo([card(15, "b"), card(15, "c")]);

  const dragon = [...Array.from({ length: 12 }, (_, i) => card(i + 3)), card(15, "c")];
  const sixPairRun = [...Array.from({ length: 6 }, (_, i) => [card(i + 3), card(i + 3, "c")]).flat(), card(9)];
  const fourTriples = [
    ...[3, 4, 5, 6].flatMap(rank => [card(rank), card(rank, "ch"), card(rank, "r")]),
    card(7)
  ];
  const twoFourKinds = [
    ...[3, 4].flatMap(rank => [card(rank), card(rank, "ch"), card(rank, "r"), card(rank, "c")]),
    ...[5, 6, 7, 8, 9].map(rank => card(rank))
  ];
  const twelveSameSuit = [
    ...Array.from({ length: 12 }, (_, i) => i + 3).filter(rank => rank !== 8).map(rank => card(rank, "b")),
    card(15, "b"), card(8, "c")
  ];
  const fivePairRun = [
    ...[4, 5, 6, 7, 8].flatMap(rank => [card(rank), card(rank, "c")]),
    card(3), card(9), card(10)
  ];
  const fourTwos = [
    ...["b", "ch", "r", "c"].map(suit => card(15, suit)),
    ...[3, 4, 5, 6, 7, 8, 9, 10, 11].map(rank => card(rank))
  ];
  const sixPairs = [
    ...[3, 4, 5, 6, 7, 8].flatMap(rank => [card(rank), card(rank, "c")]),
    card(9)
  ];
  const whiteHands = { dragon, sixPairRun, fourTriples, twoFourKinds, twelveSameSuit, fivePairRun, fourTwos, sixPairs };

  const singleBeatsSingle = engine.canBeat(
    engine.analyzeCombo([card(9, "c")]),
    engine.analyzeCombo([card(9, "b")])
  );
  const pairRun3CutsTwo = engine.canBeat(pairRun3, two);
  const pairRun4CutsPairTwo = engine.canBeat(pairRun4, pairOfTwos);
  const pairRun4CutsFourKind = engine.canBeat(pairRun4, fourKind);
  const fourKindCutsPairRun3 = engine.canBeat(fourKind,
    engine.analyzeCombo([3, 4, 5].flatMap(rank => [card(rank), card(rank, "c")]))
  );

  const directPlay = engine.parsePlayText(playHand, "3b 4b");
  const pairPlay = engine.parsePlayText(playHand, "doi 7");
  const triplePlay = engine.parsePlayText(playHand, "sam 3");
  const pairRunThreePlay = engine.parsePlayText(playHand, "3dt");
  const pairRunFourPlay = engine.parsePlayText(playHand, "4dt");
  const namedPairRun = engine.parsePlayText(playHand, "doi thong 345");
  const straightPlay = engine.parsePlayText(playHand, "sanh 345");
  const selectedPlay = engine.parsePlayText(playHand, "chon 1,2");
  const singlePlay = engine.parsePlayText(playHand, "le 3b");
  const invalidPlay = engine.parsePlayText(playHand, "sanh 3 5 7");
  const duplicatePlay = engine.parsePlayText(playHand, "3b 3b");

  const validateValid = engine.validatePlay(playHand, [card(3)], null, { mustContainThreeOfSpades: true });
  const validateMissingThree = engine.validatePlay(playHand, [card(4)], null, { mustContainThreeOfSpades: true });
  const validateCannotBeat = engine.validatePlay(
    playHand, [card(3)], engine.analyzeCombo([card(15, "c")])
  );

  const whiteHandResults = Object.fromEntries(Object.entries(whiteHands).map(([name, hand]) => [
    name,
    {
      type: engine.detectWhiteHand(hand),
      high: engine.whiteHandHighCard(hand, engine.detectWhiteHand(hand)),
      compareCards: engine.whiteHandCompareCards(hand, engine.detectWhiteHand(hand))
    }
  ]));

  return {
    deck,
    cardCodes: [engine.cardCode(card(11, "ch")), engine.cardCode(card(15, "c"))],
    parsedCards: ["10dt", "At", "3b", "16b", "4x"].map(value => engine.parseCardCode(value)),
    sorted,
    shuffle,
    dealt,
    normalized: engine.normalizeText("  ĐIỆN THOẠI! "),
    ranks: ["3", "10", "J", "Q", "K", "A", "2", "16", ""].map(value => engine.parseRank(value)),
    rankSequences: ["345", "10JQKA", "3,4,5", "345x", "2 3 4", ""].map(value => engine.parseRankSequence(value)),
    combos: { single, pair, triple, fourKind, straight, pairRun3, pairRun4, invalid: engine.analyzeCombo([card(3), card(5), card(7)]) },
    beating: { singleBeatsSingle, pairRun3CutsTwo, pairRun4CutsPairTwo, pairRun4CutsFourKind, fourKindCutsPairRun3 },
    plays: { directPlay, pairPlay, triplePlay, pairRunThreePlay, pairRunFourPlay, namedPairRun, straightPlay, selectedPlay, singlePlay, invalidPlay, duplicatePlay },
    validation: { validateValid, validateMissingThree, validateCannotBeat },
    removed: engine.removeCards(playHand, [card(3), card(4)]),
    whiteHandResults,
    comparisons: {
      priority: engine.compareWhiteHands(dragon, "dragonStraight", sixPairs, "sixPairs"),
      sameType: engine.compareWhiteHands(fivePairRun, "fivePairRun", sixPairRun, "fivePairRun")
    },
    labels: {
      ranks: [3, 10, 11, 12, 13, 14, 15].map(rank => engine.rankLabel(rank)),
      cards: [card(3), card(10, "ch"), card(15, "c")].map(item => engine.cardLabel(item)),
      formatted: engine.formatCards([card(15, "c"), card(3), card(10, "ch")])
    }
  };
}

test("Tiến Lên Rust addon exports the migrated rules", t => {
  const diagnostics = engine.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native game-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "Tiến Lên Rust functions are inactive");
});

test("Tiến Lên Rust rules preserve JS outputs for dealing, combinations, chops and white hands", t => {
  if (!engine.getNativeDiagnostics().loaded) {
    t.skip("native game-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_TLMN_ENGINE;
  try {
    process.env.JT_RUST_TLMN_ENGINE = "0";
    const fallback = runFixtures();
    delete process.env.JT_RUST_TLMN_ENGINE;
    const rust = runFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_TLMN_ENGINE;
    else process.env.JT_RUST_TLMN_ENGINE = previous;
  }
});
