"use strict";

const nativeCore = require("../../../../native");

const SUITS = Object.freeze([
  { code: "b", symbol: "♠", color: "black", weight: 0 },
  { code: "ch", symbol: "♣", color: "black", weight: 1 },
  { code: "r", symbol: "♦", color: "red", weight: 2 },
  { code: "c", symbol: "♥", color: "red", weight: 3 }
]);
const SUIT_WEIGHT = Object.freeze({ b: 0, ch: 1, r: 2, c: 3 });
const RANK_LABEL = Object.freeze({
  3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
  10: "10", 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2"
});
const RANK_VALUE = Object.freeze({ j: 11, q: 12, k: 13, a: 14, "2": 15 });
const CARD_CODE = /^(10|[3-9]|[jqka2])(ch|b|r|c|t)$/i;
const WHITE_HAND_PRIORITY = Object.freeze([
  "longStraight", "fourTwos", "sameColor", "threeTriples", "fivePairs"
]);
const WHITE_HAND_LABEL = Object.freeze({
  longStraight: "SẢNH RỒNG 10 LÁ",
  fourTwos: "TỨ QUÝ 2",
  sameColor: "10 LÁ CÙNG MÀU",
  threeTriples: "3 SÁM CÔ",
  fivePairs: "5 ĐÔI"
});

function createDeckFallback() {
  return Object.entries(RANK_LABEL).flatMap(([rank, label]) =>
    SUITS.map(suit => ({
      rank: Number(rank), suit: suit.code, id: String(rank) + suit.code
    }))
  );
}

function sortHandFallback(cards) {
  return (Array.isArray(cards) ? cards : []).slice().sort((a, b) =>
    Number(a.rank) - Number(b.rank) ||
    (SUIT_WEIGHT[a.suit] ?? -1) - (SUIT_WEIGHT[b.suit] ?? -1)
  );
}

function shuffleDeck(random = Math.random) {
  const deck = createDeck();
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const next = Math.max(0, Math.min(index, Math.floor(random() * (index + 1))));
    [deck[index], deck[next]] = [deck[next], deck[index]];
  }
  return deck;
}

function dealCards(playerIds, random = Math.random) {
  const ids = Array.isArray(playerIds) ? playerIds.map(String) : [];
  if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) {
    throw new RangeError("Sâm cần từ 2 đến 4 người chơi riêng biệt.");
  }
  const deck = shuffleDeck(random);
  const dealtCount = ids.length * 10;
  const hands = Object.fromEntries(ids.map(uid => [uid, []]));
  for (let index = 0; index < dealtCount; index += 1) {
    hands[ids[index % ids.length]].push(deck[index]);
  }
  for (const uid of ids) hands[uid] = sortHand(hands[uid]);
  return {
    hands,
    firstPlayerId: ids[Math.max(0, Math.min(ids.length - 1, Math.floor(random() * ids.length)))],
    remainingDeck: deck.slice(dealtCount)
  };
}

function normalizeTextFallback(value) {
  return String(value || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d")
    .toLocaleLowerCase("vi-VN").trim();
}

function parseCardCodeFallback(value) {
  const match = String(value || "").trim().match(CARD_CODE);
  if (!match) return null;
  const rawRank = match[1].toLowerCase();
  const rank = RANK_VALUE[rawRank] ?? (/^\d+$/.test(rawRank) ? Number(rawRank) : null);
  const rawSuit = match[2].toLowerCase();
  const suit = rawSuit === "t" ? "ch" : rawSuit;
  if (!RANK_LABEL[rank] || SUIT_WEIGHT[suit] === undefined) return null;
  return { rank, suit, id: String(rank) + suit };
}

function parsePlayText(hand, input) {
  const source = normalizeText(input).replace(/^(danh|play)\s+/, "").trim();
  if (!source) return { ok: false, code: "EMPTY_PLAY" };

  let match = source.match(/^(chon|select|vitri|vi\s*tri)\s+(.+)$/);
  if (match) {
    const indexes = match[2].split(/[\s,;]+/).filter(Boolean).map(Number);
    if (!indexes.length || indexes.some(index => !Number.isInteger(index) || index < 1 || index > hand.length) ||
        new Set(indexes).size !== indexes.length) return { ok: false, code: "INVALID_SELECTION" };
    return { ok: true, cards: sortHand(indexes.map(index => hand[index - 1])) };
  }

  match = source.match(/^(doi|pair)\s*(10|[3-9]|[jqka2])$/);
  if (match) {
    const rank = RANK_VALUE[match[2]] ?? Number(match[2]);
    const cards = sortHand(hand).filter(card => card.rank === rank).slice(-2);
    return cards.length === 2 ? { ok: true, cards } : { ok: false, code: "NOT_ENOUGH_CARDS" };
  }

  match = source.match(/^(sam|samco|sam\s*co|triple)\s*(10|[3-9]|[jqka2])$/);
  if (match) {
    const rank = RANK_VALUE[match[2]] ?? Number(match[2]);
    const cards = sortHand(hand).filter(card => card.rank === rank);
    return cards.length >= 3 ? { ok: true, cards: cards.slice(-3) } : { ok: false, code: "NOT_ENOUGH_CARDS" };
  }

  match = source.match(/^(tuquy|tu\s*quy|four)\s*(10|[3-9]|[jqka2])$/);
  if (match) {
    const rank = RANK_VALUE[match[2]] ?? Number(match[2]);
    const cards = sortHand(hand).filter(card => card.rank === rank);
    return cards.length === 4 ? { ok: true, cards } : { ok: false, code: "NOT_ENOUGH_CARDS" };
  }

  match = source.match(/^(sanh|straight)\s+(.+)$/);
  if (match) {
    const sequenceSource = match[2].replace(/[\s,._-]+/g, "").toLowerCase();
    const sequence = [];
    const tokenPattern = /(10|[3-9]|[jqka2])/g;
    let token;
    let consumed = "";
    while ((token = tokenPattern.exec(sequenceSource)) !== null) {
      if (token.index !== consumed.length) return { ok: false, code: "INVALID_STRAIGHT" };
      const rank = RANK_VALUE[token[1]] ?? (/^\d+$/.test(token[1]) ? Number(token[1]) : null);
      if (!RANK_LABEL[rank]) return { ok: false, code: "INVALID_STRAIGHT" };
      sequence.push(rank);
      consumed += token[0];
    }
    if (consumed !== sequenceSource || sequence.length < 3 ||
        sequence.includes(15) || new Set(sequence).size !== sequence.length ||
        sequence.some((rank, index) => index > 0 && rank !== sequence[index - 1] + 1)) {
      return { ok: false, code: "INVALID_STRAIGHT" };
    }
    const sortedHand = sortHand(hand);
    const cards = sequence.map(rank => sortedHand.filter(card => card.rank === rank).slice(-1)[0]);
    if (cards.some(card => !card)) return { ok: false, code: "NOT_ENOUGH_CARDS" };
    return { ok: true, cards: sortHand(cards) };
  }

  const matches = [...source.matchAll(/(10|[3-9]|[jqka2])(ch|b|r|c|t)/g)];
  if (!matches.length) return { ok: false, code: "UNRECOGNIZED_PLAY" };
  const residue = source.replace(/(10|[3-9]|[jqka2])(ch|b|r|c|t)/g, "")
    .replace(/[\s,;.+/|]+/g, "");
  if (residue) return { ok: false, code: "UNRECOGNIZED_PLAY" };
  const cards = matches.map(match => parseCardCode(match[0]));
  if (cards.some(card => !card)) return { ok: false, code: "INVALID_CARD" };
  const ids = cards.map(card => card.id);
  if (new Set(ids).size !== ids.length) return { ok: false, code: "DUPLICATE_CARD" };
  if (ids.some(id => !hand.some(card => card.id === id))) return { ok: false, code: "CARD_NOT_IN_HAND" };
  return { ok: true, cards: sortHand(cards) };
}

function analyzeComboFallback(inputCards) {
  const cards = sortHandFallback(inputCards);
  if (!cards.length || cards.some(card => !RANK_LABEL[card.rank] || SUIT_WEIGHT[card.suit] === undefined)) return null;
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const maxCard = cards[cards.length - 1];
  let type = null;
  let mainRank = maxCard.rank;
  if (cards.length === 1) type = "single";
  else if (cards.length === 2 && counts.size === 1) type = "pair";
  else if (cards.length === 3 && counts.size === 1) type = "triple";
  else if (cards.length === 4 && counts.size === 1) type = "fourKind";
  else if (cards.length >= 3 && counts.size === cards.length &&
      !ranks.includes(15) && ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1)) {
    type = "straight";
    mainRank = ranks[ranks.length - 1];
  }
  if (!type) return null;
  return {
    type, cards, length: cards.length, mainRank,
    highSuit: Math.max(...cards.map(card => SUIT_WEIGHT[card.suit])),
    cardCount: cards.length
  };
}

function canBeatFallback(candidate, current) {
  if (!candidate || !current) return Boolean(candidate);
  if (candidate.type === "fourKind" && current.type === "single" && current.mainRank === 15) return true;
  if (candidate.type === "fourKind" && current.type === "fourKind") {
    return candidate.mainRank > current.mainRank;
  }
  if (candidate.type !== current.type || candidate.length !== current.length) return false;
  // Sâm so rank, không dùng chất để phân định khi cùng hạng.
  return candidate.mainRank > current.mainRank;
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
  if (options.mustContainThreeOfSpades && !ids.includes("3b")) {
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

function detectWhiteHandFallback(hand) {
  const cards = sortHandFallback(hand);
  if (cards.length !== 10) return null;
  const counts = new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  const priorities = [];

  const ranks = [...counts.keys()].sort((a, b) => a - b);
  if (ranks.length === 10 && !ranks.includes(15) &&
      ranks.every((rank, index) => index === 0 || rank === ranks[index - 1] + 1)) {
    priorities.push("longStraight");
  }
  if ((counts.get(15) || 0) === 4) priorities.push("fourTwos");
  const colors = new Set(cards.map(card =>
    (card.suit === "b" || card.suit === "ch") ? "black" : "red"
  ));
  if (colors.size === 1) priorities.push("sameColor");
  if ([...counts.values()].filter(count => count === 3).length >= 3) priorities.push("threeTriples");
  const pairUnits = [...counts.values()].reduce((sum, count) => sum + Math.floor(count / 2), 0);
  if (pairUnits >= 5) priorities.push("fivePairs");
  return WHITE_HAND_PRIORITY.find(type => priorities.includes(type)) || null;
}

function compareWhiteHandsFallback(handA, typeA, handB, typeB) {
  const priority = WHITE_HAND_PRIORITY.indexOf(typeA) - WHITE_HAND_PRIORITY.indexOf(typeB);
  if (priority) return priority;
  const score = (hand, type) => {
    const cards = sortHandFallback(hand);
    const qualifying = cards.filter(card => {
      const count = cards.filter(other => other.rank === card.rank).length;
      if (type === "threeTriples") return count === 3;
      if (type === "fivePairs") return count >= 2;
      return true;
    });
    return qualifying.length ? Math.max(...qualifying.map(card => card.rank)) : 0;
  };
  return score(handB, typeB) - score(handA, typeA);
}

function cardLabelFallback(card) {
  const suit = SUITS.find(item => item.code === card.suit);
  return (RANK_LABEL[card.rank] || card.rank) + (suit?.symbol || card.suit);
}

function formatCardsFallback(cards) {
  return sortHandFallback(cards).map(cardLabelFallback).join("  ");
}


function callSamNative(operation, args) {
  return nativeCore.trySamOperation(operation, args);
}

function toNativeCombo(combo) {
  if (!combo || typeof combo !== "object") return null;
  const comboType = combo.type || combo.comboType || combo.combo_type;
  const mainRank = combo.mainRank ?? combo.main_rank;
  const highSuit = combo.highSuit ?? combo.high_suit;
  const cardCount = combo.cardCount ?? combo.card_count;
  return {
    ...combo,
    comboType,
    combo_type: comboType,
    mainRank,
    main_rank: mainRank,
    highSuit,
    high_suit: highSuit,
    cardCount,
    card_count: cardCount
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
  const result = callSamNative("sam_create_deck", []);
  return result.used && Array.isArray(result.value) ? result.value : createDeckFallback();
}

function sortHand(cards) {
  const result = callSamNative("sam_sort_hand", [cards]);
  return result.used && Array.isArray(result.value) ? result.value : sortHandFallback(cards);
}

function normalizeText(value) {
  const result = callSamNative("sam_normalize_text", [String(value || "")]);
  return result.used && typeof result.value === "string" ? result.value : normalizeTextFallback(value);
}

function parseCardCode(value) {
  const result = callSamNative("sam_parse_card_code", [String(value || "")]);
  return result.used ? result.value : parseCardCodeFallback(value);
}

function analyzeCombo(inputCards) {
  const result = callSamNative("sam_analyze_combo", [inputCards]);
  return result.used ? fromNativeCombo(result.value) : analyzeComboFallback(inputCards);
}

function canBeat(candidate, current) {
  const result = callSamNative("sam_can_beat", [toNativeCombo(candidate), toNativeCombo(current)]);
  return result.used ? Boolean(result.value) : canBeatFallback(candidate, current);
}

function validatePlay(hand, inputCards, currentCombo = null, options = {}) {
  const result = callSamNative("sam_validate_play", [
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
  const result = callSamNative("sam_remove_cards", [hand, playedCards]);
  return result.used && Array.isArray(result.value) ? result.value : removeCardsFallback(hand, playedCards);
}

function detectWhiteHand(hand) {
  const result = callSamNative("sam_detect_white_hand", [hand]);
  return result.used ? result.value : detectWhiteHandFallback(hand);
}

function compareWhiteHands(handA, typeA, handB, typeB) {
  const result = callSamNative("sam_compare_white_hands", [handA, typeA, handB, typeB]);
  return result.used && typeof result.value === "number"
    ? result.value
    : compareWhiteHandsFallback(handA, typeA, handB, typeB);
}

function cardLabel(card) {
  const result = callSamNative("sam_card_label", [card]);
  return result.used && typeof result.value === "string" ? result.value : cardLabelFallback(card);
}

function formatCards(cards) {
  const result = callSamNative("sam_format_cards", [cards]);
  return result.used && typeof result.value === "string" ? result.value : formatCardsFallback(cards);
}

module.exports = {
  SUITS, SUIT_WEIGHT, RANK_LABEL, WHITE_HAND_PRIORITY, WHITE_HAND_LABEL,
  createDeck, sortHand, shuffleDeck, dealCards, normalizeText, parseCardCode,
  parsePlayText, analyzeCombo, canBeat, validatePlay, removeCards,
  detectWhiteHand, compareWhiteHands, cardLabel, formatCards,
  getNativeDiagnostics: nativeCore.getSamEngineDiagnostics,
  __test: { createDeckFallback, sortHandFallback, normalizeTextFallback, parseCardCodeFallback,
    analyzeComboFallback, canBeatFallback, validatePlayFallback, removeCardsFallback,
    detectWhiteHandFallback, compareWhiteHandsFallback, cardLabelFallback, formatCardsFallback }
};
