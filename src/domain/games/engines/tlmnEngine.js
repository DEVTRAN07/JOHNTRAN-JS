"use strict";

const nativeCore = require("../../../../native");

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

function createDeckFallback() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ rank: rank.value, suit: suit.code, id: String(rank.value) + suit.code });
    }
  }
  return deck;
}

function normalizeTextFallback(value) {
  return String(value || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d")
    .toLocaleLowerCase("vi-VN").trim();
}

function cardCodeFallback(card) {
  const rank = RANK_LABEL[Number(card?.rank)] || String(card?.rank ?? "");
  return rank.toLowerCase() + String(card?.suit || "");
}

function parseCardCodeFallback(value) {
  const match = String(value || "").trim().match(CARD_CODE);
  if (!match) return null;
  const rawRank = match[1].toLowerCase();
  const rawSuit = match[2].toLowerCase();
  const rank = RANK_VALUE[rawRank] ?? (/^\d+$/.test(rawRank) ? Number(rawRank) : null);
  const suit = rawSuit === "t" || rawSuit === "dt" ? "ch" : rawSuit;
  if (!RANK_LABEL[rank] || SUIT_WEIGHT[suit] === undefined) return null;
  return { rank, suit, id: String(rank) + suit };
}

function compareCardsFallback(a, b) {
  return a.rank - b.rank || SUIT_WEIGHT[a.suit] - SUIT_WEIGHT[b.suit];
}

function sortHandFallback(cards) {
  return (Array.isArray(cards) ? cards : []).slice().sort(compareCardsFallback);
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
  const hands = Object.fromEntries(ids.map(uid => [uid, []]));
  for (let index = 0; index < dealtCount; index += 1) {
    hands[ids[index % ids.length]].push(deck[index]);
  }
  for (const uid of ids) hands[uid] = sortHand(hands[uid]);
  const firstPlayerId = ids[Math.max(0, Math.min(ids.length - 1, Math.floor(random() * ids.length)))];
  return {
    hands,
    firstPlayerId,
    remainingDeck: deck.slice(ids.length * 13)
  };
}

function parseRankFallback(value) {
  const raw = String(value || "").toLowerCase();
  if (RANK_VALUE[raw]) return RANK_VALUE[raw];
  const number = Number(raw);
  return RANK_LABEL[number] ? number : null;
}

function parseRankSequenceFallback(value) {
  const source = String(value || "").replace(/[\s,._-]+/g, "").toLowerCase();
  const result = [];
  const pattern = /(10|[3-9]|[jqka2])/g;
  let match;
  let consumed = "";
  while ((match = pattern.exec(source)) !== null) {
    if (match.index !== consumed.length) return [];
    const rank = parseRankFallback(match[1]);
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
    if (![3, 4].includes(ranks.length) || ranks.some((rank, index) => rank === 15 ||
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

function analyzeComboFallback(inputCards) {
  const cards = sortHandFallback(inputCards);
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
  } else if (cards.length >= 6 && cards.length <= 8 && cards.length % 2 === 0 &&
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
    // TLMN compares the suit of the highest card in the combo, not any lower card.
    highSuit: SUIT_WEIGHT[top.suit],
    cardCount: cards.length
  };
}

const COMBO_LABEL = Object.freeze({
  single: "Bài lẻ", pair: "Đôi", triple: "Sám cô",
  straight: "Sảnh", fourKind: "Tứ quý", pairRun: "Đôi thông"
});

function canBeatFallback(candidate, current) {
  if (!candidate || !current) return Boolean(candidate);
  if (candidate.type === current.type && candidate.length === current.length) {
    return candidate.mainRank > current.mainRank ||
      (candidate.mainRank === current.mainRank && candidate.highSuit > current.highSuit);
  }

  if (candidate.type === "fourKind" && current.type === "fourKind") {
    return candidate.mainRank > current.mainRank;
  }

  const targetIsTwo = current.type === "single" && current.mainRank === 15;
  const targetIsTwoPair = current.type === "pair" && current.mainRank === 15;
  if (candidate.type === "pairRun" && candidate.length === 3 &&
      (targetIsTwo || (current.type === "pairRun" && current.length === 3))) return true;
  if (candidate.type === "fourKind" && (targetIsTwo ||
      (current.type === "pairRun" && current.length === 3))) return true;
  if (candidate.type === "pairRun" && candidate.length >= 4 &&
      (targetIsTwo || targetIsTwoPair || current.type === "fourKind" ||
       (current.type === "pairRun" && current.length >= 3))) return true;
  return false;
}

function validatePlayFallback(hand, inputCards, currentCombo = null, options = {}) {
  const selected = sortHandFallback(inputCards);
  if (!selected.length) return { ok: false, code: "EMPTY_PLAY" };
  const ids = selected.map(card => card.id);
  if (new Set(ids).size !== ids.length) return { ok: false, code: "DUPLICATE_CARD" };
  const handIds = new Set((hand || []).map(card => card.id));
  if (ids.some(id => !handIds.has(id))) return { ok: false, code: "CARD_NOT_IN_HAND" };
  const combo = analyzeComboFallback(selected);
  if (!combo) return { ok: false, code: "INVALID_COMBINATION" };
  if (options.mustContainThreeOfSpades && !selected.some(card => card.id === "3b")) {
    return { ok: false, code: "MUST_PLAY_THREE_SPADES" };
  }
  if (currentCombo && !canBeatFallback(combo, currentCombo)) {
    return { ok: false, code: "CANNOT_BEAT", combo, currentCombo };
  }
  return { ok: true, combo };
}

function removeCardsFallback(hand, playedCards) {
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

function detectWhiteHandFallback(hand) {
  const cards = sortHandFallback(hand);
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

function whiteHandHighCardFallback(hand, type) {
  const cards = sortHandFallback(hand);
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

function whiteHandCompareCardsFallback(hand, type) {
  // GameVH compares same-type white hands by the highest card of the
  // qualifying pattern. For pair-based patterns this is the highest card
  // in the highest pair; lower pairs/sets are not additional tie-breakers.
  return [whiteHandHighCardFallback(hand, type)].filter(Boolean);
}

function compareWhiteHandsFallback(handA, typeA, handB, typeB) {
  const priority = WHITE_HAND_PRIORITY.indexOf(typeA) - WHITE_HAND_PRIORITY.indexOf(typeB);
  if (priority) return priority;
  const a = whiteHandCompareCardsFallback(handA, typeA);
  const b = whiteHandCompareCardsFallback(handB, typeB);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (!a[i]) return 1;
    if (!b[i]) return -1;
    const comparison = compareCardsFallback(b[i], a[i]);
    if (comparison) return comparison;
  }
  return 0;
}

function rankLabelFallback(rank) {
  return RANK_LABEL[rank] || String(rank);
}

function cardLabelFallback(card) {
  const suit = SUITS.find(item => item.code === card.suit);
  return rankLabelFallback(card.rank) + (suit?.symbol || card.suit);
}

function formatCardsFallback(cards) {
  return sortHandFallback(cards).map(cardLabelFallback).join("  ");
}


function callTlmnNative(operation, args = []) {
  return nativeCore.tryTlmnOperation(operation, args);
}

function toNativeCombo(combo) {
  if (!combo || typeof combo !== "object") return null;
  const comboType = combo.type || combo.comboType || combo.combo_type;
  const mainRank = combo.mainRank ?? combo.main_rank;
  const highSuit = combo.highSuit ?? combo.high_suit;
  const cardCount = combo.cardCount ?? combo.card_count;
  return {
    ...combo,
    comboType, combo_type: comboType,
    mainRank, main_rank: mainRank,
    highSuit, high_suit: highSuit,
    cardCount, card_count: cardCount
  };
}

function fromNativeCombo(combo) {
  if (!combo || typeof combo !== "object") return null;
  return {
    type: combo.type || combo.comboType || combo.combo_type,
    cards: combo.cards,
    length: combo.length,
    mainRank: combo.mainRank ?? combo.main_rank,
    highSuit: combo.highSuit ?? combo.high_suit,
    cardCount: combo.cardCount ?? combo.card_count
  };
}

function createDeck() {
  const result = callTlmnNative("tlmn_create_deck");
  return result.used && Array.isArray(result.value) ? result.value : createDeckFallback();
}

function normalizeText(value) {
  const result = callTlmnNative("tlmn_normalize_text", [String(value || "")]);
  return result.used && typeof result.value === "string" ? result.value : normalizeTextFallback(value);
}

function cardCode(card) {
  const result = callTlmnNative("tlmn_card_code", [card]);
  return result.used && typeof result.value === "string" ? result.value : cardCodeFallback(card);
}

function parseCardCode(value) {
  const result = callTlmnNative("tlmn_parse_card_code", [String(value || "")]);
  return result.used ? result.value : parseCardCodeFallback(value);
}

function compareCards(a, b) {
  const result = callTlmnNative("tlmn_compare_cards", [a, b]);
  return result.used && typeof result.value === "number" ? result.value : compareCardsFallback(a, b);
}

function sortHand(cards) {
  const result = callTlmnNative("tlmn_sort_hand", [Array.isArray(cards) ? cards : []]);
  return result.used && Array.isArray(result.value) ? result.value : sortHandFallback(cards);
}

function parseRank(value) {
  const result = callTlmnNative("tlmn_parse_rank", [String(value || "")]);
  return result.used ? (result.value == null ? null : Number(result.value)) : parseRankFallback(value);
}

function parseRankSequence(value) {
  const result = callTlmnNative("tlmn_parse_rank_sequence", [String(value || "")]);
  return result.used && Array.isArray(result.value)
    ? result.value.map(Number)
    : parseRankSequenceFallback(value);
}

function analyzeCombo(inputCards) {
  const result = callTlmnNative("tlmn_analyze_combo", [inputCards]);
  return result.used ? fromNativeCombo(result.value) : analyzeComboFallback(inputCards);
}

function canBeat(candidate, current) {
  const result = callTlmnNative("tlmn_can_beat", [toNativeCombo(candidate), toNativeCombo(current)]);
  return result.used ? Boolean(result.value) : canBeatFallback(candidate, current);
}

function validatePlay(hand, inputCards, currentCombo = null, options = {}) {
  const result = callTlmnNative("tlmn_validate_play", [
    hand,
    inputCards,
    toNativeCombo(currentCombo),
    Boolean(options && options.mustContainThreeOfSpades)
  ]);
  if (result.used && result.value && typeof result.value.ok === "boolean") {
    const value = result.value;
    if (value.ok) return { ok: true, combo: fromNativeCombo(value.combo) };
    if (value.code === "CANNOT_BEAT") {
      return {
        ok: false,
        code: value.code,
        combo: fromNativeCombo(value.combo),
        currentCombo: fromNativeCombo(value.currentCombo ?? value.current_combo)
      };
    }
    return { ok: false, code: value.code };
  }
  return validatePlayFallback(hand, inputCards, currentCombo, options);
}

function removeCards(hand, playedCards) {
  const result = callTlmnNative("tlmn_remove_cards", [hand, playedCards]);
  return result.used && Array.isArray(result.value) ? result.value : removeCardsFallback(hand, playedCards);
}

function detectWhiteHand(hand) {
  const result = callTlmnNative("tlmn_detect_white_hand", [hand]);
  return result.used ? result.value : detectWhiteHandFallback(hand);
}

function whiteHandHighCard(hand, type) {
  const result = callTlmnNative("tlmn_white_hand_high_card", [hand, type]);
  return result.used ? result.value : whiteHandHighCardFallback(hand, type);
}

function whiteHandCompareCards(hand, type) {
  const result = callTlmnNative("tlmn_white_hand_compare_cards", [hand, type]);
  return result.used && Array.isArray(result.value) ? result.value : whiteHandCompareCardsFallback(hand, type);
}

function compareWhiteHands(handA, typeA, handB, typeB) {
  const result = callTlmnNative("tlmn_compare_white_hands", [handA, typeA, handB, typeB]);
  return result.used && typeof result.value === "number"
    ? result.value
    : compareWhiteHandsFallback(handA, typeA, handB, typeB);
}

function rankLabel(rank) {
  const numeric = Number(rank);
  if (!Number.isFinite(numeric) || !RANK_LABEL[numeric]) return rankLabelFallback(rank);
  const result = callTlmnNative("tlmn_rank_label", [numeric]);
  return result.used && typeof result.value === "string" ? result.value : rankLabelFallback(rank);
}

function cardLabel(card) {
  const result = callTlmnNative("tlmn_card_label", [card]);
  return result.used && typeof result.value === "string" ? result.value : cardLabelFallback(card);
}

function formatCards(cards) {
  const result = callTlmnNative("tlmn_format_cards", [cards]);
  return result.used && typeof result.value === "string" ? result.value : formatCardsFallback(cards);
}

module.exports = {
  SUITS, RANKS, RANK_LABEL, SUIT_WEIGHT, createDeck, cardCode,
  parseCardCode, compareCards, sortHand, shuffleDeck, dealCards,
  normalizeText, parseRank, parseRankSequence, parsePlayText,
  analyzeCombo, COMBO_LABEL, canBeat, validatePlay, removeCards,
  WHITE_HAND_PRIORITY, WHITE_HAND_LABEL, detectWhiteHand, compareWhiteHands,
  rankLabel, cardLabel, formatCards,
  getNativeDiagnostics: nativeCore.getTlmnEngineDiagnostics,
  __test: { createDeckFallback, normalizeTextFallback, cardCodeFallback,
    parseCardCodeFallback, compareCardsFallback, sortHandFallback, parseRankFallback,
    parseRankSequenceFallback, analyzeComboFallback, canBeatFallback, validatePlayFallback,
    removeCardsFallback, detectWhiteHandFallback, whiteHandHighCardFallback,
    whiteHandCompareCardsFallback, compareWhiteHandsFallback, rankLabelFallback,
    cardLabelFallback, formatCardsFallback }
};
