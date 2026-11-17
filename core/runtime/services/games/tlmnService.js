"use strict";

const crypto = require("node:crypto");
const engine = require("../../../games/tlmnEngine");

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const LOBBY_TIMEOUT_MS = 60 * 1000;
const MOVE_TIMEOUT_MS = 60 * 1000;
const roomsByGroup = new Map();
const roomsByCode = new Map();
const timers = new Map();
const previousWinners = new Map();

function makeCode() {
  let code;
  do { code = String(crypto.randomInt(10000, 100000)); }
  while (roomsByCode.has(code));
  return code;
}

function get(threadId) {
  return roomsByGroup.get(String(threadId)) || null;
}

function getByCode(code) {
  return roomsByCode.get(String(code || "").trim()) || null;
}

function isBusy(threadId) {
  const room = get(threadId);
  return Boolean(room && room.status !== "finished");
}

function snapshot(room) {
  if (!room) return null;
  return {
    id: room.id,
    threadId: room.threadId,
    ownerId: room.ownerId,
    ownerName: room.ownerName,
    bet: room.bet,
    mode: room.mode,
    practice: Boolean(room.practice),
    whiteHand: room.whiteHand ? { ...room.whiteHand } : null,
    status: room.status,
    players: room.players.map(player => ({
      uid: player.uid,
      name: player.name,
      ai: Boolean(player.ai),
      handCount: room.hands?.[player.uid]?.length ?? (room.status === "waiting" ? null : 13),
      place: room.finishOrder.findIndex(uid => uid === player.uid) + 1
    })),
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    turnUid: room.turnUid,
    currentCombo: room.currentCombo ? {
      type: room.currentCombo.type,
      length: room.currentCombo.length,
      mainRank: room.currentCombo.mainRank,
      cards: room.currentCombo.cards.map(card => ({ ...card }))
    } : null,
    lastPlayerUid: room.lastPlayerUid,
    lastPlay: room.lastPlay ? {
      uid: room.lastPlay.uid,
      name: room.lastPlay.name,
      cards: room.lastPlay.cards.map(card => ({ ...card }))
    } : null,
    playedCount: room.playedCount,
    threeSpadesFinisherUid: room.threeSpadesFinisherUid || null,
    threeSpadesBlockedByUid: room.threeSpadesBlockedByUid || null,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    results: room.results ? room.results.map(row => ({ ...row })) : null
  };
}

function create(threadId, owner, options = {}) {
  const groupId = String(threadId || "");
  if (!groupId || !owner?.uid) return { ok: false, code: "INVALID_INPUT" };
  if (isBusy(groupId)) return { ok: false, code: "ROOM_EXISTS", room: snapshot(get(groupId)) };
  const bet = Math.max(1000, Math.floor(Number(options.bet) || 5000));
  const code = String(options.code || makeCode()).trim();
  if (!/^\d{5}$/.test(code) || roomsByCode.has(code)) return { ok: false, code: "CODE_COLLISION" };
  const room = {
    id: code,
    gameToken: String(options.gameToken || crypto.randomUUID()),
    threadId: groupId,
    ownerId: String(owner.uid),
    ownerName: String(owner.name || "Chủ phòng").slice(0, 40),
    previousWinnerUid: String(options.previousWinnerUid || previousWinners.get(groupId) || ""),
    bet,
    mode: options.mode === "demla" ? "demla" : "nhatnhi",
    practice: Boolean(options.practice),
    practiceWinnerUid: options.practice ? String(owner.uid) : null,
    status: "waiting",
    players: [{ uid: String(owner.uid), name: String(owner.name || "Chủ phòng").slice(0, 40) }],
    hands: null,
    deckLeft: 0,
    activeUids: [],
    finishOrder: [],
    forfeitUids: [],
    turnUid: null,
    lastPlayerUid: null,
    currentCombo: null,
    lastPlay: null,
    passed: new Set(),
    playedCount: 0,
    trickParticipants: [],
    threeSpadesFinisherUid: null,
    threeSpadesBlockedByUid: null,
    threeSpadesBlockEvents: [],
    chopEvents: [],
    settlement: null,
    reservePerPlayer: 0,
    createdAt: Number(options.now) || Date.now(),
    startedAt: null,
    finishedAt: null,
    results: null,
    whiteHand: null,
    locked: {},
    lockPending: {},
    lockTransactionId: null,
    messageCards: { group: [], private: {} },
    settled: false,
    settlementError: null
  };
  roomsByGroup.set(groupId, room);
  roomsByCode.set(room.id, room);
  return { ok: true, room: snapshot(room), state: room };
}

function join(threadId, code, player) {
  const room = getByCode(code);
  if (!room) return { ok: false, code: "ROOM_NOT_FOUND" };
  if (room.threadId !== String(threadId)) return { ok: false, code: "WRONG_GROUP" };
  if (room.status !== "waiting") return { ok: false, code: "NOT_WAITING" };
  const uid = String(player?.uid || "");
  if (!uid) return { ok: false, code: "INVALID_INPUT" };
  if (room.players.some(item => item.uid === uid)) {
    return { ok: true, alreadyJoined: true, player: room.players.find(item => item.uid === uid), room: snapshot(room), state: room };
  }
  if (room.players.length >= MAX_PLAYERS) return { ok: false, code: "FULL" };
  const item = {
    uid,
    name: String(player.name || "Người chơi").slice(0, 40),
    ai: Boolean(player.ai)
  };
  room.players.push(item);
  return { ok: true, player: item, room: snapshot(room), state: room };
}

function joinWaiting(threadId, player) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  return join(threadId, room.id, player);
}

function updateBet(threadId, uid, value) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  if (room.status !== "waiting") return { ok: false, code: "ALREADY_STARTED" };
  if (room.ownerId !== String(uid)) return { ok: false, code: "NOT_OWNER" };
  const bet = Math.floor(Number(value));
  if (!Number.isSafeInteger(bet) || bet < 1000 || bet > 10000000) return { ok: false, code: "INVALID_BET" };
  room.bet = bet;
  return { ok: true, room: snapshot(room) };
}

function updateMode(threadId, uid, mode) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  if (room.status !== "waiting") return { ok: false, code: "ALREADY_STARTED" };
  if (room.ownerId !== String(uid)) return { ok: false, code: "NOT_OWNER" };
  const normalized = String(mode || "").toLowerCase();
  if (!["nhatnhi", "demla"].includes(normalized)) return { ok: false, code: "INVALID_MODE" };
  room.mode = normalized;
  return { ok: true, room: snapshot(room) };
}

function clearTimer(threadId) {
  const key = String(threadId);
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

function watchLobby(threadId, callback) {
  const key = String(threadId);
  clearTimer(key);
  const room = get(key);
  if (!room || room.status !== "waiting") return false;
  const remainingMs = Math.max(0, LOBBY_TIMEOUT_MS - (Date.now() - room.createdAt));
  const timer = setTimeout(() => {
    if (timers.get(key) !== timer) return;
    timers.delete(key);
    if (get(key) !== room || room.status !== "waiting") return;
    Promise.resolve(callback?.({ room: snapshot(room), state: room }))
      .catch(() => {});
  }, remainingMs);
  timer.unref?.();
  timers.set(key, timer);
  return true;
}

function watchTurn(threadId, callback) {
  const key = String(threadId);
  clearTimer(key);
  const room = get(key);
  if (!room || room.status !== "playing" || !room.turnUid) return false;
  const expectedUid = String(room.turnUid);
  const expectedPlayedCount = room.playedCount;
  const timer = setTimeout(() => {
    if (timers.get(key) !== timer) return;
    timers.delete(key);
    const current = get(key);
    if (current !== room || current.status !== "playing" ||
        current.turnUid !== expectedUid ||
        current.playedCount !== expectedPlayedCount) return;
    Promise.resolve(callback?.({
      room: current, snapshot: snapshot(current), uid: expectedUid,
      player: player(current, expectedUid), playedCount: expectedPlayedCount
    })).catch(() => {});
  }, MOVE_TIMEOUT_MS);
  timer.unref?.();
  timers.set(key, timer);
  return true;
}

function resetToWaiting(threadId) {
  const room = get(threadId);
  if (!room || (room.status !== "playing" &&
      !(room.status === "finished" && room.whiteHand && !room.settled))) return false;
  clearTimer(threadId);
  room.status = "waiting";
  room.hands = null;
  room.deckLeft = 0;
  room.activeUids = [];
  room.finishOrder = [];
  room.forfeitUids = [];
  room.turnUid = null;
  room.lastPlayerUid = null;
  room.currentCombo = null;
  room.lastPlay = null;
  room.passed = new Set();
  room.playedCount = 0;
  room.startedAt = null;
  room.finishedAt = null;
  room.results = null;
  room.whiteHand = null;
  room.settled = false;
  return true;
}

function removeRoom(threadId) {
  const room = get(threadId);
  if (!room) return null;
  clearTimer(threadId);
  room.status = "finished";
  roomsByGroup.delete(String(threadId));
  roomsByCode.delete(room.id);
  return room;
}

function resolveWhiteHand(room) {
  if (!room || room.status !== "playing" || !room.hands) return null;
  const whiteHands = room.players.map(item => ({
    uid: item.uid,
    type: engine.detectWhiteHand(room.hands[item.uid])
  })).filter(item => item.type);
  if (!whiteHands.length) return null;

  whiteHands.sort((a, b) =>
    engine.compareWhiteHands(
      room.hands[a.uid], a.type, room.hands[b.uid], b.type
    ) ||
    room.players.findIndex(item => item.uid === a.uid) -
      room.players.findIndex(item => item.uid === b.uid)
  );
  room.whiteHand = { ...whiteHands[0] };
  room.finishOrder = [room.whiteHand.uid];
  finishRoom(room);
  return { ...room.whiteHand };
}

function start(threadId, uid, random = Math.random) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  if (room.status !== "waiting") return { ok: false, code: "ALREADY_STARTED" };
  if (room.ownerId !== String(uid)) return { ok: false, code: "NOT_OWNER" };
  if (room.players.length < MIN_PLAYERS) return { ok: false, code: "NEED_TWO_PLAYERS" };
  if (room.players.length > MAX_PLAYERS) return { ok: false, code: "FULL" };

  const dealt = engine.dealCards(room.players.map(player => player.uid), random);
  const previousWinner = String(room.previousWinnerUid || previousWinners.get(String(threadId)) || "");
  if (previousWinner && room.players.some(item => item.uid === previousWinner)) {
    dealt.firstPlayerId = previousWinner;
  }
  room.previousWinnerUid = previousWinner && room.players.some(item => item.uid === previousWinner)
    ? previousWinner : null;

  // Only the explicitly requested, no-coin Admin practice room receives a
  // curated training hand. Every human table always keeps the fair shuffled deal.
  if (room.practice && room.practiceWinnerUid &&
      room.players.length >= MIN_PLAYERS && dealt.hands[room.practiceWinnerUid]) {
    const winnerUid = String(room.practiceWinnerUid);
    const deck = engine.createDeck();
    const takeHighest = (rank, count) =>
      engine.sortHand(deck.filter(card => card.rank === rank)).slice(-count);
    const practiceHand = engine.sortHand([
      { rank: 3, suit: "b", id: "3b" },
      ...takeHighest(15, 3),
      ...takeHighest(14, 3),
      ...takeHighest(13, 2),
      ...takeHighest(12, 2),
      ...takeHighest(11, 2)
    ]);
    const usedIds = new Set(practiceHand.map(card => card.id));
    const remaining = engine.shuffleDeck(random).filter(card => !usedIds.has(card.id));
    const opponents = room.players.map(item => String(item.uid)).filter(id => id !== winnerUid);
    const hands = { [winnerUid]: practiceHand };
    for (const opponentUid of opponents) hands[opponentUid] = [];
    const opponentDealCount = opponents.length * 13;
    remaining.slice(0, opponentDealCount).forEach((card, index) => {
      hands[opponents[index % opponents.length]].push(card);
    });
    for (const opponentUid of opponents) hands[opponentUid] = engine.sortHand(hands[opponentUid]);
    dealt.hands = hands;
    dealt.remainingDeck = remaining.slice(opponentDealCount);
    dealt.firstPlayerId = winnerUid;
  }


  room.hands = dealt.hands;
  room.deckLeft = dealt.remainingDeck.length;
  room.activeUids = room.players.map(player => player.uid);
  room.finishOrder = [];
  room.turnUid = dealt.firstPlayerId;
  room.lastPlayerUid = null;
  room.currentCombo = null;
  room.lastPlay = null;
  room.passed = new Set();
  room.playedCount = 0;
  room.startedAt = Date.now();
  room.status = "playing";
  room.whiteHand = null;
  clearTimer(threadId);

  const whiteHand = resolveWhiteHand(room);
  if (whiteHand) {
    return {
      ok: true, finished: true, whiteHand,
      room: snapshot(room), state: room, firstPlayerId: dealt.firstPlayerId
    };
  }
  return { ok: true, finished: false, room: snapshot(room), state: room, firstPlayerId: dealt.firstPlayerId };
}

function player(room, uid) {
  return room.players.find(item => item.uid === String(uid)) || null;
}

function nextActive(room, uid) {
  const players = room.players;
  const start = players.findIndex(item => item.uid === String(uid));
  for (let step = 1; step <= players.length; step += 1) {
    const candidate = players[(Math.max(0, start) + step) % players.length];
    if (room.activeUids.includes(candidate.uid)) return candidate.uid;
  }
  return null;
}

function calculateLeftoverPenalty(hand, bet) {
  const cards = engine.sortHand(hand || []);
  const used = new Set();
  let amount = 0;
  const twos = cards.filter(card => card.rank === 15);
  const black = twos.filter(card => card.suit === "b" || card.suit === "ch");
  const red = twos.filter(card => card.suit === "r" || card.suit === "c");
  let blackPairs = Math.floor(black.length / 2);
  let redPairs = Math.floor(red.length / 2);
  const mixedPairs = Math.min(black.length % 2, red.length % 2);
  amount += blackPairs * 4 * bet + redPairs * 8 * bet + mixedPairs * 6 * bet;
  if ((black.length % 2) + (red.length % 2) - 2 * mixedPairs) {
    amount += (black.length % 2 ? 2 : 4) * bet;
  }
  for (const card of twos) used.add(card.id);

  const counts = new Map();
  for (const card of cards.filter(item => !used.has(item.id))) {
    counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  }
  for (const [rank, count] of counts) {
    if (count === 4) {
      amount += 8 * bet;
      for (const card of cards.filter(item => item.rank === rank)) used.add(card.id);
    }
  }

  const pairRanks = [...counts.entries()].filter(([rank, count]) => rank !== 15 && count === 2)
    .map(([rank]) => rank).sort((a, b) => a - b);
  const runs = [];
  for (const rank of pairRanks) {
    const current = runs[runs.length - 1];
    if (!current || rank !== current[current.length - 1] + 1) runs.push([rank]);
    else current.push(rank);
  }
  for (const run of runs) {
    let offset = 0;
    while (run.length - offset >= 4) {
      const selected = run.slice(offset, offset + 4);
      amount += 12 * bet;
      for (const rank of selected) {
        for (const card of cards.filter(item => item.rank === rank)) used.add(card.id);
      }
      offset += 4;
    }
    if (run.length - offset >= 3) {
      const selected = run.slice(offset, offset + 3);
      amount += 6 * bet;
      for (const rank of selected) {
        for (const card of cards.filter(item => item.rank === rank)) used.add(card.id);
      }
    }
  }
  amount += cards.filter(card => !used.has(card.id)).length * bet;
  return amount;
}

function calculateSettlement(room) {
  const players = room.players || [];
  const bet = Math.max(1, Math.floor(Number(room.bet) || 5000));
  const winnerUid = String(room.whiteHand?.uid ||
    (room.threeSpadesFinisherUid && !room.threeSpadesBlockedByUid
      ? room.threeSpadesFinisherUid : room.finishOrder?.[0] || ""));
  const transfers = [];
  const add = (from, to, amount, reason) => {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (from && to && from !== to && value) transfers.push({ from, to, amount: value, reason });
  };
  if (room.whiteHand) {
    const multiplier = {
      dragonStraight: 9, sixPairRun: 8, fourTriples: 7, twoFourKinds: 6,
      twelveSameSuit: 5, fivePairRun: 4, fourTwos: 3, sixPairs: 2
    }[room.whiteHand.type] || 0;
    for (const item of players) if (item.uid !== winnerUid) {
      add(item.uid, winnerUid, multiplier * bet, "white-hand-" + room.whiteHand.type);
    }
  } else if (room.threeSpadesFinisherUid && !room.threeSpadesBlockedByUid) {
    for (const item of players) if (item.uid !== winnerUid) {
      add(item.uid, winnerUid, 26 * bet, "ket-ba-bich");
    }
  } else {
    for (const item of players) {
      if (item.uid === winnerUid) continue;
      add(item.uid, winnerUid, calculateLeftoverPenalty(room.hands?.[item.uid] || [], bet), "thoi-bai");
    }
  }
  for (const event of room.chopEvents || []) add(event.from, event.to, event.amount, event.reason);
  for (const event of room.threeSpadesBlockEvents || []) {
    add(event.from, event.to, event.amount, "chan-ket-ba-bich");
  }
  const net = Object.fromEntries(players.map(item => [String(item.uid), 0]));
  for (const transfer of transfers) {
    net[transfer.from] -= transfer.amount;
    net[transfer.to] += transfer.amount;
  }
  return { bet, winnerUid, transfers, net, calculatedAt: Date.now() };
}

function finishRoom(room) {
  if (room.status === "finished") return room.results || [];
  const left = room.activeUids.slice().sort((a, b) =>
    (room.hands[a]?.length ?? 0) - (room.hands[b]?.length ?? 0) ||
    room.players.findIndex(item => item.uid === a) - room.players.findIndex(item => item.uid === b)
  );
  for (const uid of left) {
    if (!room.finishOrder.includes(uid)) room.finishOrder.push(uid);
  }
  for (const uid of room.forfeitUids || []) {
    if (!room.finishOrder.includes(uid)) room.finishOrder.push(uid);
  }
  room.activeUids = [];
  room.turnUid = null;
  room.status = "finished";
  room.finishedAt = Date.now();
  room.results = room.finishOrder.map((uid, index) => {
    const item = player(room, uid);
    return { uid, name: item?.name || uid, place: index + 1, cardsLeft: room.hands?.[uid]?.length || 0 };
  });
  room.settlement = calculateSettlement(room);
  if (room.settlement?.winnerUid) previousWinners.set(String(room.threadId), room.settlement.winnerUid);
  clearTimer(room.threadId);
  return room.results;
}

function advanceAfterMove(room, uid) {
  room.lastPlayerUid = uid;
  room.passed.clear();
  room.turnUid = nextActive(room, uid);
}

function play(threadId, uid, input) {
  const room = get(threadId);
  if (!room || room.status !== "playing") return { ok: false, code: "NO_GAME" };
  const actor = String(uid);
  if (!room.activeUids.includes(actor)) return { ok: false, code: "NOT_PLAYER" };
  if (room.turnUid !== actor) return { ok: false, code: "NOT_TURN", currentUid: room.turnUid };
  const hand = room.hands[actor] || [];
  const parsed = engine.parsePlayText(hand, input);
  if (!parsed.ok) return parsed;
  const validation = engine.validatePlay(hand, parsed.cards, room.currentCombo);
  if (!validation.ok) return validation;

  const previousCombo = room.currentCombo;
  const previousLeader = room.lastPlayerUid;
  if (!room.currentCombo) room.trickParticipants = [];
  if (!room.trickParticipants.includes(actor)) room.trickParticipants.push(actor);

  const combo = validation.combo;
  const chops = previousCombo && previousLeader && (
    (previousCombo.type === "single" && previousCombo.mainRank === 15 &&
      (combo.type === "pairRun" && combo.length >= 3 || combo.type === "fourKind")) ||
    (previousCombo.type === "pair" && previousCombo.mainRank === 15 &&
      combo.type === "pairRun" && combo.length >= 4) ||
    (previousCombo.type === "pairRun" && previousCombo.length === 3 &&
      (combo.type === "pairRun" && combo.length >= 4 || combo.type === "fourKind")) ||
    (previousCombo.type === "fourKind" && combo.type === "pairRun" && combo.length >= 4) ||
    (previousCombo.type === "pairRun" && previousCombo.length >= 4 &&
      combo.type === "pairRun" && combo.length >= 4 && combo.mainRank > previousCombo.mainRank)
  );
  if (chops) {
    let chopUnits = combo.type === "pairRun" && combo.length >= 4 ? 12 :
      combo.type === "fourKind" ? 8 : 6;
    if (previousCombo.type === "single" && previousCombo.mainRank === 15) {
      const targetCard = previousCombo.cards?.[0];
      chopUnits = targetCard && (targetCard.suit === "b" || targetCard.suit === "ch") ? 3 : 6;
    } else if (previousCombo.type === "pair" && previousCombo.mainRank === 15) {
      const redCount = (previousCombo.cards || []).filter(card =>
        card.suit === "r" || card.suit === "c").length;
      chopUnits = redCount === 0 ? 6 : redCount === 2 ? 12 : 9;
    }
    room.chopEvents ||= [];
    room.chopEvents.push({
      from: previousLeader, to: actor,
      amount: chopUnits * Math.max(1, Number(room.bet) || 5000),
      reason: "chop-" + combo.type + "-" + (combo.length || 1)
    });
  }

  if (previousCombo?.type === "single" && previousCombo.mainRank === 3 &&
      room.threeSpadesFinisherUid && previousLeader === room.threeSpadesFinisherUid) {
    room.threeSpadesBlockedByUid = actor;
    const participants = [...new Set(room.trickParticipants)];
    room.threeSpadesBlockEvents ||= [];
    for (const uid of participants) {
      if (uid !== room.threeSpadesFinisherUid) room.threeSpadesBlockEvents.push({
        from: room.threeSpadesFinisherUid, to: uid,
        amount: 26 * Math.max(1, Number(room.bet) || 5000)
      });
    }
    room.finishOrder = room.finishOrder.filter(uid => uid !== room.threeSpadesFinisherUid);
    room.forfeitUids ||= [];
    if (!room.forfeitUids.includes(room.threeSpadesFinisherUid)) {
      room.forfeitUids.push(room.threeSpadesFinisherUid);
    }
    room.threeSpadesFinisherUid = null;
  }

  room.hands[actor] = engine.removeCards(hand, combo.cards);
  room.currentCombo = combo;
  room.lastPlayerUid = actor;
  room.lastPlay = {
    uid: actor,
    name: player(room, actor)?.name || actor,
    cards: validation.combo.cards.map(card => ({ ...card }))
  };
  room.playedCount += 1;
  room.passed.clear();

  const handCount = room.hands[actor].length;
  if (handCount === 0) {
    room.finishOrder.push(actor);
    room.activeUids = room.activeUids.filter(value => value !== actor);
    if (combo.cards.some(card => card.id === "3b")) {
      room.threeSpadesFinisherUid = actor;
      room.threeSpadesBlockedByUid = null;
    } else if (!room.threeSpadesFinisherUid) {
      finishRoom(room);
      return { ok: true, finished: true, combo: validation.combo, handCount, results: room.results, room: snapshot(room), state: room };
    }
    if (room.activeUids.length <= 1 && !room.threeSpadesFinisherUid) {
      finishRoom(room);
      return { ok: true, finished: true, combo: validation.combo, handCount, results: room.results, room: snapshot(room), state: room };
    }
    room.turnUid = nextActive(room, actor);
  } else {
    room.turnUid = nextActive(room, actor);
  }
  return {
    ok: true,
    finished: room.status === "finished",
    combo: validation.combo,
    handCount,
    room: snapshot(room),
    state: room
  };
}

function pass(threadId, uid) {
  const room = get(threadId);
  if (!room || room.status !== "playing") return { ok: false, code: "NO_GAME" };
  const actor = String(uid);
  if (!room.activeUids.includes(actor)) return { ok: false, code: "NOT_PLAYER" };
  if (room.turnUid !== actor) return { ok: false, code: "NOT_TURN" };
  if (!room.currentCombo || !room.lastPlayerUid) return { ok: false, code: "CANNOT_PASS_ON_LEAD" };
  if (room.lastPlayerUid === actor) return { ok: false, code: "LEADER_CANNOT_PASS" };

  room.passed.add(actor);
  const leaderStillPlaying = room.activeUids.includes(room.lastPlayerUid);
  const requiredPasses = room.activeUids.length - (leaderStillPlaying ? 1 : 0);
  if (room.passed.size >= requiredPasses) {
    const previousLeader = room.lastPlayerUid;
    if (room.threeSpadesFinisherUid && !room.threeSpadesBlockedByUid) {
      finishRoom(room);
      return { ok: true, roundCleared: true, finished: true, room: snapshot(room), state: room };
    }
    room.currentCombo = null;
    room.trickParticipants = [];
    room.lastPlay = null;
    room.passed.clear();
    room.turnUid = room.activeUids.includes(previousLeader)
      ? previousLeader
      : nextActive(room, previousLeader);
    return { ok: true, roundCleared: true, room: snapshot(room), state: room };
  }

  room.turnUid = nextActive(room, actor);
  return { ok: true, roundCleared: false, room: snapshot(room), state: room };
}

function timeoutTurn(threadId, uid) {
  const result = pass(threadId, uid);
  if (result.ok) return { ...result, action: "pass", timedOut: true };
  if (result.code !== "CANNOT_PASS_ON_LEAD") return result;
  const room = get(threadId);
  if (!room || room.status !== "playing" || room.turnUid !== String(uid)) {
    return { ok: false, code: "NO_GAME" };
  }
  const hand = room.hands?.[String(uid)] || [];
  const card = engine.sortHand(hand)[0];
  if (!card) return { ok: false, code: "NO_VALID_CARD" };
  const played = play(threadId, uid, engine.cardCode(card));
  return played.ok ? { ...played, action: "play", timedOut: true } : played;
}

function leave(threadId, uid) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  const actor = String(uid);
  const item = player(room, actor);
  if (!item) return { ok: false, code: "NOT_PLAYER" };
  if (room.status === "waiting") {
    room.players = room.players.filter(entry => entry.uid !== actor);
    if (room.ownerId === actor) {
      room.ownerId = room.players[0]?.uid || null;
      room.ownerName = room.players[0]?.name || "";
    }
    if (!room.players.length) {
      removeRoom(threadId);
      return { ok: true, empty: true, room: null };
    }
    return { ok: true, room: snapshot(room), state: room };
  }
  if (room.status !== "playing") return { ok: false, code: "NOT_PLAYING" };

  room.activeUids = room.activeUids.filter(value => value !== actor);
  room.passed.delete(actor);
  if (!room.forfeitUids.includes(actor)) room.forfeitUids.push(actor);
  if (room.ownerId === actor && room.activeUids.length) {
    const successor = room.players.find(entry => room.activeUids.includes(entry.uid));
    room.ownerId = successor?.uid || null;
    room.ownerName = successor?.name || "";
  }
  if (room.activeUids.length <= 1) {
    finishRoom(room);
  } else if (room.lastPlayerUid === actor) {
    // The leader left: every remaining player may start a fresh trick.
    room.currentCombo = null;
    room.lastPlay = null;
    room.lastPlayerUid = null;
    room.passed.clear();
    room.turnUid = nextActive(room, actor);
  } else if (room.currentCombo) {
    // If the leaver had already passed, their removal may complete the
    // pass cycle. Do not leave the next player stuck behind a stale combo.
    const leaderStillPlaying = room.activeUids.includes(room.lastPlayerUid);
    const requiredPasses = room.activeUids.length - (leaderStillPlaying ? 1 : 0);
    if (room.passed.size >= requiredPasses) {
      const previousLeader = room.lastPlayerUid;
      room.currentCombo = null;
      room.lastPlay = null;
      room.passed.clear();
      room.turnUid = leaderStillPlaying ? previousLeader : nextActive(room, previousLeader);
    } else if (room.turnUid === actor) {
      room.turnUid = nextActive(room, actor);
    }
  } else if (room.turnUid === actor) {
    room.turnUid = nextActive(room, actor);
  }
  return { ok: true, forfeited: true, room: snapshot(room), state: room, finished: room.status === "finished" };
}

function stop(threadId, uid) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  if (room.ownerId !== String(uid)) return { ok: false, code: "NOT_OWNER" };
  const state = removeRoom(threadId);
  return { ok: true, state };
}

function cancel(threadId) {
  return removeRoom(threadId);
}

function serialize(roomOrThreadId) {
  const room = typeof roomOrThreadId === "object" && roomOrThreadId
    ? roomOrThreadId
    : get(roomOrThreadId);
  if (!room) return null;
  return {
    ...room,
    players: room.players.map(item => ({ ...item })),
    hands: room.hands ? Object.fromEntries(Object.entries(room.hands).map(([uid, hand]) =>
      [uid, Array.isArray(hand) ? hand.map(card => ({ ...card })) : []])) : null,
    activeUids: [...room.activeUids],
    finishOrder: [...room.finishOrder],
    forfeitUids: [...(room.forfeitUids || [])],
    passed: [...room.passed],
    currentCombo: room.currentCombo ? {
      ...room.currentCombo,
      cards: room.currentCombo.cards.map(card => ({ ...card }))
    } : null,
    lastPlay: room.lastPlay ? {
      ...room.lastPlay,
      cards: room.lastPlay.cards.map(card => ({ ...card }))
    } : null,
    trickParticipants: [...(room.trickParticipants || [])],
    threeSpadesFinisherUid: room.threeSpadesFinisherUid || null,
    threeSpadesBlockedByUid: room.threeSpadesBlockedByUid || null,
    threeSpadesBlockEvents: (room.threeSpadesBlockEvents || []).map(item => ({ ...item })),
    chopEvents: (room.chopEvents || []).map(item => ({ ...item })),
    settlement: room.settlement ? JSON.parse(JSON.stringify(room.settlement)) : null,
    reservePerPlayer: Number(room.reservePerPlayer) || 0,
    locked: { ...(room.locked || {}) },
    lockPending: { ...(room.lockPending || {}) },
    messageCards: {
      group: [...(room.messageCards?.group || [])],
      private: Object.fromEntries(Object.entries(room.messageCards?.private || {}).map(([uid, cards]) =>
        [uid, (cards || []).map(card => ({ ...card }))]))
    },
    results: room.results ? room.results.map(row => ({ ...row })) : null
  };
}

function restore(saved) {
  if (!saved || typeof saved !== "object" || !saved.threadId ||
      !/^\d{5}$/.test(String(saved.id || "")) ||
      !Array.isArray(saved.players) ||
      !["waiting", "playing", "finished"].includes(saved.status)) return null;

  const threadId = String(saved.threadId);
  const id = String(saved.id);
  const players = saved.players.map(item => ({
    uid: String(item?.uid || ""),
    name: String(item?.name || "Người chơi").replace(/[\r\n\t]/g, " ").slice(0, 40),
    ai: Boolean(item?.ai)
  })).filter(item => item.uid);

  if (players.length < 1 || players.length > MAX_PLAYERS ||
      new Set(players.map(item => item.uid)).size !== players.length) return null;
  const playerIds = new Set(players.map(item => item.uid));
  const ownerId = String(saved.ownerId || "");
  if (!playerIds.has(ownerId)) return null;

  const bet = Number(saved.bet);
  if (!Number.isSafeInteger(bet) || bet < 1000 || bet > 10000000) return null;
  const mode = String(saved.mode || "");
  if (!["nhatnhi", "demla"].includes(mode)) return null;

  const activeUids = Array.isArray(saved.activeUids) ? saved.activeUids.map(String) : [];
  const finishOrder = Array.isArray(saved.finishOrder) ? saved.finishOrder.map(String) : [];
  const finishSet = new Set(finishOrder);
  // Prior versions also left forfeited IDs in finishOrder at finalization.
  const forfeitUids = Array.isArray(saved.forfeitUids)
    ? [...new Set(saved.forfeitUids.map(String))].filter(uid => !finishSet.has(uid))
    : [];
  const validSubset = list =>
    list.length === new Set(list).size && list.every(uid => playerIds.has(uid));
  if (!validSubset(activeUids) || !validSubset(finishOrder) || !validSubset(forfeitUids)) return null;

  let hands = null;
  const usedCards = new Set();
  if (saved.status === "playing" || saved.status === "finished") {
    if (!saved.hands || typeof saved.hands !== "object" || Array.isArray(saved.hands)) return null;
    hands = {};
    for (const item of players) {
      const rawHand = saved.hands[item.uid];
      if (!Array.isArray(rawHand) || rawHand.length > 13) return null;
      hands[item.uid] = [];
      for (const rawCard of rawHand) {
        const rank = Number(rawCard?.rank);
        const suit = String(rawCard?.suit || "");
        const cardId = String(rawCard?.id || "");
        if (!Number.isInteger(rank) || rank < 3 || rank > 15 ||
            !["b", "ch", "r", "c"].includes(suit) ||
            cardId !== String(rank) + suit || usedCards.has(cardId)) return null;
        usedCards.add(cardId);
        hands[item.uid].push({ rank, suit, id: cardId });
      }
      hands[item.uid] = engine.sortHand(hands[item.uid]);
    }
  } else if (saved.hands != null || activeUids.length || finishOrder.length || forfeitUids.length) {
    return null;
  }

  const currentCombo = saved.currentCombo && Array.isArray(saved.currentCombo.cards)
    ? { ...saved.currentCombo, cards: saved.currentCombo.cards.map(card => ({ ...card })) }
    : null;
  const lastPlay = saved.lastPlay && Array.isArray(saved.lastPlay.cards)
    ? { ...saved.lastPlay, cards: saved.lastPlay.cards.map(card => ({ ...card })) }
    : null;

  const placementPartition = [...activeUids, ...finishOrder, ...forfeitUids];
  if (saved.status === "waiting") {
    if (placementPartition.length) return null;
  } else if (placementPartition.length !== players.length ||
      new Set(placementPartition).size !== players.length) {
    return null;
  }

  if (saved.status === "playing") {
    if (!activeUids.length || !activeUids.includes(String(saved.turnUid))) return null;
    if (Boolean(currentCombo) !== Boolean(lastPlay)) return null;
    if (currentCombo && !engine.analyzeCombo(currentCombo.cards)) return null;
    if (lastPlay) {
      if (!playerIds.has(String(lastPlay.uid || "")) ||
          String(saved.lastPlayerUid || "") !== String(lastPlay.uid) ||
          !engine.analyzeCombo(lastPlay.cards)) return null;
      const lastIds = lastPlay.cards.map(card => String(card?.id || ""));
      if (lastIds.some(cardId => !cardId || usedCards.has(cardId)) ||
          new Set(lastIds).size !== lastIds.length) return null;
      if (currentCombo.cards.map(card => card.id).sort().join(",") !== lastIds.sort().join(",")) return null;
    }
  } else if (saved.status === "finished") {
    if (activeUids.length) return null;
  } else if (saved.turnUid != null || currentCombo || lastPlay) {
    return null;
  }

  const locked = saved.locked && typeof saved.locked === "object" && !Array.isArray(saved.locked)
    ? { ...saved.locked } : {};
  const lockPending = saved.lockPending && typeof saved.lockPending === "object" &&
    !Array.isArray(saved.lockPending) ? { ...saved.lockPending } : {};
  for (const [uid, amount] of Object.entries(locked)) {
    if (!playerIds.has(uid) || !Number.isSafeInteger(Number(amount)) || Number(amount) < 0) return null;
  }
  for (const [uid, pending] of Object.entries(lockPending)) {
    if (!playerIds.has(uid) || !pending ||
        !Number.isSafeInteger(Number(pending.amount)) || Number(pending.amount) <= 0 ||
        typeof pending.transactionId !== "string" || !pending.transactionId) return null;
  }

  const passed = Array.isArray(saved.passed) ? [...new Set(saved.passed.map(String))] : [];
  if (passed.some(uid => !activeUids.includes(uid))) return null;

  const messageCards = { group: [], private: {} };
  const normalizeTargets = targets => Array.isArray(targets) ? targets.filter(item =>
    (typeof item?.msgId === "string" || typeof item?.msgId === "number") &&
    (typeof item?.cliMsgId === "string" || typeof item?.cliMsgId === "number")
  ).map(item => ({ msgId: item.msgId, cliMsgId: item.cliMsgId })) : [];
  messageCards.group = normalizeTargets(saved.messageCards?.group);
  if (saved.messageCards?.private && typeof saved.messageCards.private === "object") {
    for (const [uid, targets] of Object.entries(saved.messageCards.private)) {
      if (!playerIds.has(uid)) continue;
      const safeTargets = normalizeTargets(targets);
      if (safeTargets.length) messageCards.private[uid] = safeTargets;
    }
  }

  const results = Array.isArray(saved.results) ? saved.results.map(row => ({ ...row })) : null;
  if (results && (new Set(results.map(row => String(row?.uid || ""))).size !== results.length ||
      results.some((row, index) => !playerIds.has(String(row?.uid || "")) ||
        Number(row?.place) !== index + 1))) return null;
  if (saved.status === "finished" && results && results.length !== players.length) return null;

  const createdAt = Number(saved.createdAt);
  const startedAt = saved.startedAt == null ? null : Number(saved.startedAt);
  const room = {
    ...saved,
    id,
    practiceWinnerUid: saved.practice === true &&
      String(saved.practiceWinnerUid || "") === ownerId && playerIds.has(ownerId)
      ? ownerId : null,
    whiteHand: saved.whiteHand && playerIds.has(String(saved.whiteHand.uid || "")) &&
      engine.WHITE_HAND_PRIORITY.includes(saved.whiteHand.type)
      ? { uid: String(saved.whiteHand.uid), type: saved.whiteHand.type } : null,
    gameToken: String(saved.gameToken || crypto.randomUUID()),
    threadId,
    ownerId,
    ownerName: String(saved.ownerName || players.find(item => item.uid === ownerId)?.name || "Chủ phòng").slice(0, 40),
    bet,
    mode,
    players,
    hands,
    activeUids,
    finishOrder,
    forfeitUids,
    passed: new Set(passed),
    currentCombo,
    lastPlay,
    locked,
    lockPending,
    messageCards,
    results,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    startedAt: Number.isFinite(startedAt) ? startedAt : null
  };

  const codeOwner = getByCode(id);
  if (codeOwner && codeOwner.threadId !== threadId) return null;
  const old = get(threadId);
  if (old) removeRoom(threadId);
  roomsByGroup.set(threadId, room);
  roomsByCode.set(id, room);
  return room;
}

function listActive() {
  return [...roomsByGroup.values()].filter(room => room.status === "playing").map(snapshot);
}

module.exports = {
  MIN_PLAYERS, MAX_PLAYERS, LOBBY_TIMEOUT_MS, MOVE_TIMEOUT_MS,
  roomsByGroup, roomsByCode, timers,
  get, getByCode, isBusy, snapshot, create, join, joinWaiting,
  updateBet, updateMode, watchLobby, watchTurn, timeoutTurn, resetToWaiting,
  removeRoom, start, play, pass, leave, stop, cancel, finishRoom, listActive, serialize, restore,
  _test: { resolveWhiteHand }
};
