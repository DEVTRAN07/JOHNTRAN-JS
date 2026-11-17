"use strict";

const SUITS = Object.freeze([
  { code: "b", name: "Bích", symbol: "♠", weight: 0 },
  { code: "ch", name: "Chuồn", symbol: "♣", weight: 1 },
  { code: "r", name: "Rô", symbol: "♦", weight: 2 },
  { code: "c", name: "Cơ", symbol: "♥", weight: 3 }
]);
const SUIT_WEIGHT = Object.freeze({ b: 0, ch: 1, t: 1, r: 2, c: 3 });
const RANKS = Object.freeze([
  { value: 3, label: "3" }, { value: 4, label: "4" },
  { value: 5, label: "5" }, { value: 6, label: "6" },
  { value: 7, label: "7" }, { value: 8, label: "8" },
  { value: 9, label: "9" }, { value: 10, label: "10" },
  { value: 11, label: "J" }, { value: 12, label: "Q" },
  { value: 13, label: "K" }, { value: 14, label: "A" },
  { value: 15, label: "2" }
]);
const RANK_LABEL = Object.freeze(Object.fromEntries(RANKS.map(item => [item.value, item.label])));
const RANK_VALUE = Object.freeze({ j: 11, q: 12, k: 13, a: 14, "2": 15 });
const CARD_CODE = /^(10|[3-9]|[jqka2])(ch|dt|b|r|c|t)$/i;

function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ rank: rank.value, suit: suit.code, id: String(rank.value) + suit.code });
    }
  }
  return deck;
}

function normalizeText(value) {
  return String(value || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d")
    .toLocaleLowerCase("vi-VN").trim();
}

function cardCode(card) {
  const rank = RANK_LABEL[Number(card?.rank)] || String(card?.rank ?? "");
  return rank.toLowerCase() + String(card?.suit || "");
}

function parseCardCode(value) {
  const match = String(value || "").trim().match(CARD_CODE);
  if (!match) return null;
  const rawRank = match[1].toLowerCase();
  const rawSuit = match[2].toLowerCase();
  const rank = RANK_VALUE[rawRank] ?? (/^\d+$/.test(rawRank) ? Number(rawRank) : null);
  const suit = rawSuit === "t" || rawSuit === "dt" ? "ch" : rawSuit;
  if (!RANK_LABEL[rank] || SUIT_WEIGHT[suit] === undefined) return null;
  return { rank, suit, id: String(rank) + suit };
}

function compareCards(a, b) {
  return a.rank - b.rank || SUIT_WEIGHT[a.suit] - SUIT_WEIGHT[b.suit];
}

function sortHand(cards) {
  return (Array.isArray(cards) ? cards : []).slice().sort(compareCards);
}

function shuffleDeck(random = Math.random) {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.max(0, Math.min(i, Math.floor(random() * (i + 1))));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealCards(playerIds, random = Math.random) {
  const ids = Array.isArray(playerIds) ? playerIds.map(String) : [];
  if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) {
    throw new RangeError("Tiến Lên cần từ 2 đến 4 người chơi riêng biệt.");
  }
  const deck = shuffleDeck(random);
  const dealtCount = ids.length * 13;
  // In a 2-player game only half the deck is dealt. Guarantee that 3♠ is
  // inside the dealt portion; otherwise turnUid would be undefined and no
  // player could legally open the game.
  const threeOfSpadesIndex = deck.findIndex(card => card.id === "3b");
  if (threeOfSpadesIndex >= dealtCount) {
    [deck[0], deck[threeOfSpadesIndex]] = [deck[threeOfSpadesIndex], deck[0]];
  }
  const hands = Object.fromEntries(ids.map(uid => [uid, []]));
  for (let index = 0; index < dealtCount; index += 1) {
    hands[ids[index % ids.length]].push(deck[index]);
  }
  for (const uid of ids) hands[uid] = sortHand(hands[uid]);
  const firstPlayerId = ids.find(uid => hands[uid].some(card => card.id === "3b"));
  return {
    hands,
    firstPlayerId,
    remainingDeck: deck.slice(ids.length * 13)
  };
}

function parseRank(value) {
  const raw = String(value || "").toLowerCase();
  if (RANK_VALUE[raw]) return RANK_VALUE[raw];
  const number = Number(raw);
  return RANK_LABEL[number] ? number : null;
}

function parseRankSequence(value) {
  const source = String(value || "").replace(/[\s,._-]+/g, "").toLowerCase();
  const result = [];
  const pattern = /(10|[3-9]|[jqka2])/g;
  let match;
  let consumed = "";
  while ((match = pattern.exec(source)) !== null) {
    if (match.index !== consumed.length) return [];
    const rank = parseRank(match[1]);
    if (!rank) return [];
    result.push(rank);
    consumed += match[0];
  }
  if (consumed !== source) return [];
  return result;
}

function selectByRank(hand, rank, count) {
  return sortHand(hand).filter(card => card.rank === rank).slice(-count);
}

function parsePlayText(hand, input) {
  const cards = Array.isArray(hand) ? hand : [];
  const source = normalizeText(input).replace(/^(danh|play)\s+/, "").trim();
  if (!source) return { ok: false, code: "EMPTY_PLAY" };

  // Pick cards by the numbered order shown on the private hand canvas.
  // Example: "chon 1,2" selects the first two visible cards from left to right.
  let match = source.match(/^(chon|select|vi\s*tri|vitri)\s+(.+)$/);
  if (match) {
    const tokens = match[2].split(/[\s,;]+/).filter(Boolean);
    const indexes = tokens.map(token => Number(token));
    if (!indexes.length || indexes.some(index => !Number.isInteger(index) || index < 1 || index > cards.length) ||
        new Set(indexes).size !== indexes.length) {
      return { ok: false, code: "INVALID_SELECTION" };
    }
    return {
      ok: true,
      cards: sortHand(indexes.map(index => cards[index - 1]))
    };
  }

  match = source.match(/^(doi|pair|double)\\s*(10|[3-9]|[jqka2])$/);
  if (match) {
    const rank = parseRank(match[2]);
    const selected = selectByRank(cards, rank, 2);
    return selected.length === 2
      ? { ok: true, cards: selected }
      : { ok: false, code: "NOT_ENOUGH_CARDS" };
  }

  match = source.match(/^(sam(?:\s*co)?|triple)\s*(10|[3-9]|[jqka2])$/);
  if (match) {
    const rank = parseRank(match[2]);
    const selected = sortHand(cards).filter(card => card.rank === rank);
    return selected.length >= 3
      ? { ok: true, cards: selected.slice(-3) }
      : { ok: false, code: "NOT_ENOUGH_CARDS" };
  }

  // 3dt / 4dt = three/four consecutive pairs, not a card suit alias.
  match = source.match(/^([34])dt$/);
  if (match) {
    const pairCount = Number(match[1]);
    const pairRanks = [...new Set(sortHand(cards)
      .filter(card => card.rank !== 15)
      .map(card => card.rank))]
      .filter(rank => selectByRank(cards, rank, 2).length === 2)
      .sort((a, b) => a - b);
    const runs = [];
    for (let index = 0; index <= pairRanks.length - pairCount; index += 1) {
      const run = pairRanks.slice(index, index + pairCount);
      if (run.every((rank, offset) => offset === 0 || rank === run[offset - 1] + 1)) runs.push(run);
    }
    if (!runs.length) return { ok: false, code: "NOT_ENOUGH_CARDS" };
    runs.sort((a, b) => b[b.length - 1] - a[a.length - 1]);
    return { ok: true, cards: runs[0].flatMap(rank => selectByRank(cards, rank, 2)) };
  }

  match = source.match(/^(tu\s*quy|tuquy|four)\s*(10|[3-9]|[jqka2])$/);
  if (match) {
    const rank = parseRank(match[2]);
    const selected = sortHand(cards).filter(card => card.rank === rank);
    return selected.length === 4
      ? { ok: true, cards: selected }
      : { ok: false, code: "NOT_ENOUGH_CARDS" };
  }

  match = source.match(/^(doi\s*thong|doithong)\s+(.+)$/);
  if (match) {
    const ranks = parseRankSequence(match[2]);
    if (ranks.length < 3 || ranks.some((rank, index) => rank === 15 ||
        (index > 0 && rank !== ranks[index - 1] + 1))) {
      return { ok: false, code: "INVALID_PAIR_RUN" };
    }
    const selected = [];
    for (const rank of ranks) {
      const pair = selectByRank(cards, rank, 2);
      if (pair.length !== 2) return { ok: false, code: "NOT_ENOUGH_CARDS" };
      selected.push(...pair);
    }
    return { ok: true, cards: selected };
  }

  match = source.match(/^(sanh|straight)\s+(.+)$/);
  if (match) {
    const ranks = parseRankSequence(match[2]);
    if (ranks.length < 3 || ranks.some((rank, index) => rank === 15 ||
        (index > 0 && rank !== ranks[index - 1] + 1))) {
      return { ok: false, code: "INVALID_STRAIGHT" };
    }
    const selected = [];
    for (const rank of ranks) {
      const card = sortHand(cards).filter(item => item.rank === rank).slice(-1)[0];
      if (!card) return { ok: false, code: "NOT_ENOUGH_CARDS" };
      selected.push(card);
    }
    return { ok: true, cards: selected };
  }

  match = source.match(/^(le|single)\s*(10|[3-9]|[jqka2])(ch|b|r|c|t)$/);
  if (match) {
    const card = parseCardCode(match[2] + match[3]);
    if (!card || !cards.some(item => item.id === card.id)) {
      return { ok: false, code: "CARD_NOT_IN_HAND" };
    }
    return { ok: true, cards: [card] };
  }

  const matches = [...source.matchAll(/(10|[3-9]|[jqka2])(ch|dt|b|r|c|t)/g)];
  if (!matches.length) return { ok: false, code: "UNRECOGNIZED_PLAY" };
  const residue = source.replace(/(10|[3-9]|[jqka2])(ch|dt|b|r|c|t)/g, "")
    .replace(/[\s,;.+/|]+/g, "");
  if (residue) return { ok: false, code: "UNRECOGNIZED_PLAY" };

  const selected = matches.map(item => parseCardCode(item[0]));
  if (selected.some(card => !card)) return { ok: false, code: "INVALID_CARD" };
  const ids = selected.map(card => card.id);
  if (new Set(ids).size !== ids.length) return { ok: false, code: "DUPLICATE_CARD" };
  if (ids.some(id => !cards.some(card => card.id === id))) {
    return { ok: false, code: "CARD_NOT_IN_HAND" };
  }
  return { ok: true, cards: sortHand(selected) };
}

function analyzeCombo(inputCards) {
  const cards = sortHand(inputCards);
  if (!cards.length || cards.some(card => !card || !RANK_LABEL[card.rank] ||
      SUIT_WEIGHT[card.suit] === undefined)) return null;
  const ranks = cards.map(card => card.rank);
  const uniqueRanks = [...new Set(ranks)];
  const top = cards[cards.length - 1];
  const rankCounts = new Map();
  for (const rank of ranks) rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
  const counts = [...rankCounts.values()].sort((a, b) => a - b);
  let type = null;
  let mainRank = top.rank;
  let length = cards.length;

  if (cards.length === 1) type = "single";
  else if (cards.length === 2 && counts.length === 1 && counts[0] === 2) type = "pair";
  else if (cards.length === 3 && counts.length === 1 && counts[0] === 3) type = "triple";
  else if (cards.length === 4 && counts.length === 1 && counts[0] === 4) type = "fourKind";
  else if (cards.length >= 3 && uniqueRanks.length === cards.length &&
      !uniqueRanks.includes(15) &&
      uniqueRanks.every((rank, index) => index === 0 || rank === uniqueRanks[index - 1] + 1)) {
    type = "straight";
    mainRank = Math.max(...uniqueRanks);
  } else if (cards.length >= 6 && cards.length % 2 === 0 &&
      uniqueRanks.length === cards.length / 2 && counts.every(count => count === 2) &&
      uniqueRanks.every((rank, index) => rank !== 15 &&
        (index === 0 || rank === uniqueRanks[index - 1] + 1))) {
    type = "pairRun";
    mainRank = Math.max(...uniqueRanks);
    length = uniqueRanks.length;
  }
  if (!type) return null;

  return {
    type,
    cards,
    length,
    mainRank,
    highSuit: Math.max(...cards.map(card => SUIT_WEIGHT[card.suit])),
    cardCount: cards.length
  };
}

const COMBO_LABEL = Object.freeze({
  single: "Bài lẻ", pair: "Đôi", triple: "Sám cô",
  straight: "Sảnh", fourKind: "Tứ quý", pairRun: "Đôi thông"
});

function canBeat(candidate, current) {
  if (!candidate || !current) return Boolean(candidate);
  if (candidate.type === current.type && candidate.length === current.length) {
    return candidate.mainRank > current.mainRank ||
      (candidate.mainRank === current.mainRank && candidate.highSuit > current.highSuit);
  }

  if (candidate.type === "fourKind" && current.type === "fourKind") {
    return candidate.mainRank > current.mainRank;
  }

  const targetIsTwo = current.type === "single" && current.mainRank === 15;
  if (candidate.type === "pairRun" && candidate.length === 3 &&
      (targetIsTwo || (current.type === "pairRun" && current.length === 3))) return true;
  if (candidate.type === "fourKind" && (targetIsTwo ||
      (current.type === "pairRun" && current.length === 3))) return true;
  if (candidate.type === "pairRun" && candidate.length >= 4 &&
      (targetIsTwo || current.type === "fourKind" ||
       (current.type === "pairRun" && current.length >= 3))) return true;
  return false;
}

function validatePlay(hand, inputCards, currentCombo = null, options = {}) {
  const selected = sortHand(inputCards);
  if (!selected.length) return { ok: false, code: "EMPTY_PLAY" };
  const ids = selected.map(card => card.id);
  if (new Set(ids).size !== ids.length) return { ok: false, code: "DUPLICATE_CARD" };
  const handIds = new Set((hand || []).map(card => card.id));
  if (ids.some(id => !handIds.has(id))) return { ok: false, code: "CARD_NOT_IN_HAND" };
  const combo = analyzeCombo(selected);
  if (!combo) return { ok: false, code: "INVALID_COMBINATION" };
  if (options.mustContainThreeOfSpades && !selected.some(card => card.id === "3b")) {
    return { ok: false, code: "MUST_PLAY_THREE_SPADES" };
  }
  if (currentCombo && !canBeat(combo, currentCombo)) {
    return { ok: false, code: "CANNOT_BEAT", combo, currentCombo };
  }
  return { ok: true, combo };
}

function removeCards(hand, playedCards) {
  const ids = new Set((playedCards || []).map(card => card.id));
  return (hand || []).filter(card => !ids.has(card.id));
}

const WHITE_HAND_PRIORITY = Object.freeze([
  "dragonStraight", "sixPairRun", "fourTriples", "twoFourKinds",
  "twelveSameSuit", "fivePairRun", "fourTwos", "sixPairs"
]);
const WHITE_HAND_LABEL = Object.freeze({
  dragonStraight: "SẢNH RỒNG 3 ĐẾN A",
  sixPairRun: "6 ĐÔI THÔNG",
  fourTriples: "4 BỘ BA",
  twoFourKinds: "2 TỨ QUÝ",
  twelveSameSuit: "12 LÁ ĐỒNG CHẤT",
  fivePairRun: "5 ĐÔI THÔNG",
  fourTwos: "TỨ QUÝ 2",
  sixPairs: "6 ĐÔI"
});

function detectWhiteHand(hand) {
  const cards = sortHand(hand);
  if (cards.length !== 13) return null;
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const priorities = [];
  const hasRun = length => {
    const paired = ranks.filter(rank => rank !== 15 && (counts.get(rank) || 0) >= 2);
    for (let i = 0; i <= paired.length - length; i += 1) {
      const run = paired.slice(i, i + length);
      if (run.every((rank, index) => index === 0 || rank === run[index - 1] + 1)) return true;
    }
    return false;
  };
  const hasDragon = Array.from({ length: 12 }, (_, index) => index + 3)
    .every(rank => counts.has(rank));
  if (hasDragon) priorities.push("dragonStraight");
  if (hasRun(6)) priorities.push("sixPairRun");
  if ([...counts.values()].filter(count => count >= 3).length >= 4) priorities.push("fourTriples");
  if ([...counts.values()].filter(count => count === 4).length >= 2) priorities.push("twoFourKinds");
  if (["b", "ch", "r", "c"].some(suit =>
    cards.filter(card => card.suit === suit).length >= 12)) {
    priorities.push("twelveSameSuit");
  }
  if (hasRun(5)) priorities.push("fivePairRun");
  if ((counts.get(15) || 0) === 4) priorities.push("fourTwos");
  const pairUnits = [...counts.values()].reduce((sum, count) => sum + Math.floor(count / 2), 0);
  if (pairUnits >= 6) priorities.push("sixPairs");
  return WHITE_HAND_PRIORITY.find(type => priorities.includes(type)) || null;
}

function whiteHandHighCard(hand, type) {
  const cards = sortHand(hand);
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  if (type === "dragonStraight") return cards.filter(card => card.rank === 14).slice(-1)[0] || null;
  if (type === "fourTwos") return cards.filter(card => card.rank === 15).slice(-1)[0] || null;
  if (type === "twelveSameSuit") {
    const suit = ["b", "ch", "r", "c"].find(code =>
      cards.filter(card => card.suit === code).length >= 12);
    return cards.filter(card => card.suit === suit).slice(-1)[0] || null;
  }
  if (type === "fourTriples" || type === "twoFourKinds") {
    const minimum = type === "fourTriples" ? 3 : 4;
    const rank = [...counts.entries()].filter(([, count]) => count >= minimum)
      .map(([value]) => value).sort((a, b) => b - a)[0];
    return rank == null ? null : cards.filter(card => card.rank === rank).slice(-1)[0] || null;
  }
  if (type === "sixPairs") {
    const rank = [...counts.entries()].filter(([, count]) => count >= 2)
      .map(([value]) => value).sort((a, b) => b - a)[0];
    return rank == null ? null : cards.filter(card => card.rank === rank).slice(-1)[0] || null;
  }
  if (type === "sixPairRun" || type === "fivePairRun") {
    const length = type === "sixPairRun" ? 6 : 5;
    const paired = [...counts.entries()].filter(([rank, count]) => rank !== 15 && count >= 2)
      .map(([rank]) => rank).sort((a, b) => a - b);
    let highest = null;
    for (let i = 0; i <= paired.length - length; i += 1) {
      const run = paired.slice(i, i + length);
      if (run.every((rank, index) => index === 0 || rank === run[index - 1] + 1)) {
        highest = Math.max(highest || 0, run[run.length - 1]);
      }
    }
    if (highest) return cards.filter(card => card.rank === highest).slice(-1)[0] || null;
  }
  return cards[cards.length - 1] || null;
}

function compareWhiteHands(handA, typeA, handB, typeB) {
  const priority = WHITE_HAND_PRIORITY.indexOf(typeA) - WHITE_HAND_PRIORITY.indexOf(typeB);
  if (priority) return priority;
  const a = whiteHandHighCard(handA, typeA);
  const b = whiteHandHighCard(handB, typeB);
  if (!a || !b) return 0;
  return compareCards(b, a);
}

function rankLabel(rank) {
  return RANK_LABEL[rank] || String(rank);
}

function cardLabel(card) {
  const suit = SUITS.find(item => item.code === card.suit);
  return rankLabel(card.rank) + (suit?.symbol || card.suit);
}

function formatCards(cards) {
  return sortHand(cards).map(cardLabel).join("  ");
}

module.exports = {
  SUITS, RANKS, RANK_LABEL, SUIT_WEIGHT, createDeck, cardCode,
  parseCardCode, compareCards, sortHand, shuffleDeck, dealCards,
  normalizeText, parseRank, parseRankSequence, parsePlayText,
  analyzeCombo, COMBO_LABEL, canBeat, validatePlay, removeCards,
  WHITE_HAND_PRIORITY, WHITE_HAND_LABEL, detectWhiteHand, compareWhiteHands,
  rankLabel, cardLabel, formatCards
};
