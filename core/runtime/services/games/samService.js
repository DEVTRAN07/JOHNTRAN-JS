"use strict";

const crypto = require("node:crypto");
const engine = require("../../../games/samEngine");

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const MOVE_TIMEOUT_MS = 60 * 1000;
const LOBBY_TIMEOUT_MS = 5 * 60 * 1000;
const roomsByThread = new Map();
const roomsByCode = new Map();
const timers = new Map();
const previousWinners = new Map();

function makeCode() {
  let code;
  do { code = String(crypto.randomInt(10000, 100000)); }
  while (roomsByCode.has(code));
  return code;
}
function clearTimer(threadId) {
  const key = String(threadId);
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}
function get(threadId) { return roomsByThread.get(String(threadId)) || null; }
function getByCode(code) { return roomsByCode.get(String(code)) || null; }
function isBusy(threadId) {
  const room = get(threadId);
  return Boolean(room && room.status !== "finished" && room.status !== "cancelled");
}
function makePlayer(player) {
  return {
    uid: String(player?.uid || ""),
    name: String(player?.name || "Người chơi").replace(/[\r\n\t]/g, " ").slice(0, 40)
  };
}
function snapshot(room) {
  if (!room) return null;
  return {
    id: room.id, threadId: room.threadId, ownerId: room.ownerId,
    ownerName: room.ownerName, status: room.status,
    startCountdownAt: Number(room.startCountdownAt) || null,
    startCountdownBy: room.startCountdownBy || null,
    previousWinnerUid: room.previousWinnerUid || null,
    bet: Number(room.stake || 300),
    players: room.players.map(item => ({
      ...item,
      handCount: room.hands?.[item.uid]?.length ?? (room.status === "waiting" ? null : 10),
      place: room.finishOrder.indexOf(item.uid) + 1
    })),
    playerCount: room.players.length, turnUid: room.turnUid,
    lastPlayerUid: room.lastPlayerUid,
    lastPlay: room.lastPlay ? {
      uid: room.lastPlay.uid, name: room.lastPlay.name,
      cards: room.lastPlay.cards.map(card => ({ ...card }))
    } : null,
    currentCombo: room.currentCombo ? {
      type: room.currentCombo.type, length: room.currentCombo.length,
      mainRank: room.currentCombo.mainRank,
      cards: room.currentCombo.cards.map(card => ({ ...card }))
    } : null,
    playedCount: room.playedCount,
    samStatus: room.samStatus,
    samCallerUid: room.samCallerUid,
    samCallerHasPlayed: Boolean(room.samCallerHasPlayed),
    samBlockedByUid: room.samBlockedByUid,
    whiteHand: room.whiteHand,
    winnerUid: room.winnerUid,
    results: room.results ? room.results.map(row => ({ ...row })) : null
  };
}
function create(threadId, owner, options = {}) {
  const key = String(threadId || "");
  if (!key || !owner?.uid) return { ok: false, code: "INVALID_INPUT" };
  if (isBusy(key)) return { ok: false, code: "ROOM_EXISTS", room: snapshot(get(key)) };
  if (get(key)) removeRoom(key);
  const id = String(options.id || makeCode());
  if (!/^\d{5}$/.test(id) || roomsByCode.has(id)) return { ok: false, code: "CODE_COLLISION" };
  const host = makePlayer(owner);
  const room = {
    id, gameToken: String(options.gameToken || crypto.randomUUID()),
    threadId: key, ownerId: host.uid, ownerName: host.name,
    previousWinnerUid: String(options.previousWinnerUid || previousWinners.get(key) || ""),
    status: "waiting", players: [host], hands: null, turnUid: null,
    firstPlayerUid: null, lastPlayerUid: null, lastPlay: null,
    currentCombo: null, passed: new Set(), playedCount: 0,
    finishOrder: [], results: null, winnerUid: null, whiteHand: null,
    samCallerUid: null, samCallerHasPlayed: false, samStatus: null, samBlockedByUid: null,
    stake: Math.max(100, Math.floor(Number(options.stake) || 300)),
    startCountdownAt: null,
    startCountdownBy: null,
    startCountdownMessage: null,
    playedByUid: {},
    chopEvents: [],
    activeChopChain: null,
    baoOneViolations: [],
    settlement: null, settled: false,
    createdAt: Number(options.now) || Date.now(), startedAt: null, finishedAt: null
  };
  roomsByThread.set(key, room);
  roomsByCode.set(id, room);
  return { ok: true, room: snapshot(room), state: room };
}
function join(threadId, code, player) {
  const room = getByCode(code);
  if (!room) return { ok: false, code: "ROOM_NOT_FOUND" };
  if (room.threadId !== String(threadId)) return { ok: false, code: "WRONG_GROUP" };
  if (room.status !== "waiting") return { ok: false, code: "NOT_WAITING" };
  if (Number(room.startCountdownAt) > 0) return { ok: false, code: "STARTING" };
  const next = makePlayer(player);
  if (!next.uid) return { ok: false, code: "INVALID_INPUT" };
  const existing = room.players.find(item => item.uid === next.uid);
  if (existing) return { ok: true, alreadyJoined: true, player: existing, room: snapshot(room), state: room };
  if (room.players.length >= MAX_PLAYERS) return { ok: false, code: "FULL" };
  room.players.push(next);
  return { ok: true, player: next, room: snapshot(room), state: room };
}
function joinWaiting(threadId, player) {
  const room = get(threadId);
  return room ? join(threadId, room.id, player) : { ok: false, code: "NO_ROOM" };
}
function finish(room, winnerUid, reason = "normal") {
  if (room.status === "finished") return room.results || [];
  room.winnerUid = String(winnerUid || "");
  if (room.winnerUid) previousWinners.set(String(room.threadId), room.winnerUid);
  room.status = "finished";
  room.finishedAt = Date.now();
  room.turnUid = null;
  room.finishOrder = [
    room.winnerUid,
    ...room.players.map(item => item.uid).filter(id => id !== room.winnerUid)
  ];
  room.results = room.finishOrder.map((uid, index) => ({
    uid,
    name: room.players.find(item => item.uid === uid)?.name || uid,
    place: index + 1,
    cardsLeft: room.hands?.[uid]?.length || 0
  }));
  room.finishReason = reason;
  if (room.samCallerUid) {
    room.samStatus = room.samStatus === "failed"
      ? "failed"
      : room.winnerUid === room.samCallerUid && room.samCallerHasPlayed
        ? "success" : "failed";
    if (room.samStatus === "failed" && room.winnerUid !== room.samCallerUid &&
        !room.samBlockedByUid) room.samBlockedByUid = room.winnerUid;
  }
  room.settlement = calculateSettlement(room);
  clearTimer(room.threadId);
  return room.results;
}
function start(threadId, uid, random = Math.random) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  if (room.status !== "waiting") return { ok: false, code: "ALREADY_STARTED" };
  if (Number(room.startCountdownAt) > 0) return { ok: false, code: "STARTING" };
  if (room.ownerId !== String(uid)) return { ok: false, code: "NOT_OWNER" };
  if (room.players.length < MIN_PLAYERS) return { ok: false, code: "NEED_TWO_PLAYERS" };
  if (room.players.length > MAX_PLAYERS) return { ok: false, code: "FULL" };
  const dealt = engine.dealCards(room.players.map(item => item.uid), random);
  room.hands = dealt.hands;
  const previousWinner = String(room.previousWinnerUid || previousWinners.get(String(threadId)) || "");
  room.firstPlayerUid = previousWinner && room.players.some(item => item.uid === previousWinner)
    ? previousWinner : dealt.firstPlayerId;
  room.turnUid = room.firstPlayerUid;
  room.previousWinnerUid = previousWinner && room.players.some(item => item.uid === previousWinner)
    ? previousWinner : null;
  room.lastPlayerUid = null;
  room.lastPlay = null;
  room.currentCombo = null;
  room.passed = new Set();
  room.playedCount = 0;
  room.finishOrder = [];
  room.startedAt = Date.now();
  room.status = "playing";
  room.startCountdownAt = null;
  room.startCountdownBy = null;
  room.startCountdownMessage = null;

  const whiteHands = room.players.map(item => ({
    uid: item.uid, type: engine.detectWhiteHand(room.hands[item.uid])
  })).filter(item => item.type);
  if (whiteHands.length) {
    whiteHands.sort((a, b) =>
      engine.compareWhiteHands(room.hands[a.uid], a.type, room.hands[b.uid], b.type) ||
      room.players.findIndex(item => item.uid === a.uid) - room.players.findIndex(item => item.uid === b.uid)
    );
    const winner = whiteHands[0];
    room.whiteHand = { uid: winner.uid, type: winner.type };
    finish(room, winner.uid, "white-hand");
    return { ok: true, finished: true, whiteHand: room.whiteHand, room: snapshot(room), state: room };
  }
  return { ok: true, finished: false, room: snapshot(room), state: room, firstPlayerId: room.firstPlayerUid };
}
function calculateSettlement(room) {
  if (!room || !Array.isArray(room.players) || !room.hands) return null;
  const stake = Math.max(1, Math.floor(Number(room.stake) || 5000));
  const winnerUid = String(room.winnerUid || "");
  const transfers = [];
  const add = (from, to, amount, reason) => {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (from && to && from !== to && value) transfers.push({ from, to, amount: value, reason });
  };

  // Chặt chồng: người có hàng bị chặt cuối cùng trả toàn bộ số lần chặt cho người chặt cuối.
  for (const chop of Array.isArray(room.chopEvents) ? room.chopEvents : []) {
    add(chop.from, chop.to, chop.amount, chop.reason || "chop");
  }
  for (const violation of Array.isArray(room.baoOneViolations) ? room.baoOneViolations : []) {
    if (String(violation.to) === winnerUid) {
      add(violation.from, violation.to, violation.amount, "bao-one-penalty");
    }
  }

  if (room.whiteHand || room.samStatus === "success") {
    for (const player of room.players) {
      if (player.uid !== winnerUid) {
        add(player.uid, winnerUid, 20 * stake,
          room.whiteHand ? "white-hand-20x" : "bao-sam-success-20x");
      }
    }
  } else {
    for (const player of room.players) {
      const uid = String(player.uid);
      if (uid === winnerUid) continue;
      const hand = room.hands[uid] || [];
      const counts = new Map();
      for (const card of hand) counts.set(Number(card.rank), (counts.get(Number(card.rank)) || 0) + 1);
      const cong = !(Number(room.playedByUid?.[uid]) > 0);
      let amount = cong ? 15 * stake : 0; // Cóng: 15 cược, không tính rác thường
      for (const [rank, count] of counts) {
        if (rank === 15) {
          amount += count * 15 * stake; // Thối từng lá 2
          if (count === 4) amount += 15 * stake; // Tứ quý 2 cũng là một bộ hàng
        } else if (count === 4) amount += 15 * stake; // Thối tứ quý
        else if (!cong) amount += count * stake; // Mỗi lá rác còn lại
      }
      add(uid, winnerUid, amount, "leftover-heo-quad-cong");
    }
    if (room.samStatus === "failed" && room.samCallerUid && room.samBlockedByUid) {
      add(room.samCallerUid, room.samBlockedByUid,
        20 * stake * Math.max(1, room.players.length - 1), "den-sam-20x-per-opponent");
    }
  }

  const net = Object.fromEntries(room.players.map(player => [String(player.uid), 0]));
  for (const transfer of transfers) {
    net[transfer.from] -= transfer.amount;
    net[transfer.to] += transfer.amount;
  }
  return { stake, winnerUid, transfers, net, calculatedAt: Date.now() };
}

function nextPlayer(room, uid) {
  const index = room.players.findIndex(item => item.uid === String(uid));
  for (let step = 1; step <= room.players.length; step += 1) {
    const candidate = room.players[(Math.max(0, index) + step) % room.players.length];
    if (candidate && room.finishOrder.indexOf(candidate.uid) < 0) return candidate.uid;
  }
  return null;
}
function play(threadId, uid, input) {
  const room = get(threadId);
  if (!room || room.status !== "playing") return { ok: false, code: "NO_GAME" };
  if (room.cancelPending) return { ok: false, code: "CANCEL_PENDING" };
  const actor = String(uid);
  if (!room.hands?.[actor]) return { ok: false, code: "NOT_PLAYER" };
  if (room.turnUid !== actor) return { ok: false, code: "NOT_TURN" };
  const hand = room.hands[actor];
  const parsed = Array.isArray(input) ? { ok: true, cards: input } : engine.parsePlayText(hand, input);
  if (!parsed.ok) return parsed;
  const oneCardOpponents = room.players.filter(item =>
    item.uid !== actor && room.hands[item.uid]?.length === 1
  );
  const highestRank = hand.reduce((highest, card) =>
    Math.max(highest, Number(card.rank) || 0), 0);
  const ignoresHighest = oneCardOpponents.length && highestRank > 0 &&
    !parsed.cards.some(card => Number(card.rank) === highestRank);
  const validation = engine.validatePlay(hand, parsed.cards, room.currentCombo);
  if (!validation.ok) return validation;

  const combo = validation.combo;
  const remainingHand = engine.removeCards(hand, combo.cards);
  if (remainingHand.length === 1 && Number(remainingHand[0]?.rank) === 15) {
    return { ok: false, code: "CANNOT_LEAVE_TWO_LAST" };
  }
  if (remainingHand.length === 0 &&
      combo.cards.some(card => Number(card.rank) === 15)) {
    return { ok: false, code: "CANNOT_FINISH_WITH_TWO" };
  }
  if (ignoresHighest) {
    room.baoOneViolations ||= [];
    const totalCards = room.players.reduce((sum, item) =>
      sum + (room.hands[item.uid]?.length || 0), 0);
    for (const target of oneCardOpponents) {
      room.baoOneViolations.push({
        from: actor, to: target.uid,
        amount: totalCards * Math.max(1, Math.floor(Number(room.stake) || 5000))
      });
    }
  }
  if (room.currentCombo && room.lastPlayerUid && combo.type === "fourKind" &&
      ((room.currentCombo.type === "single" && room.currentCombo.mainRank === 15) ||
       room.currentCombo.type === "fourKind")) {
    room.chopEvents ||= [];
    const stake = Math.max(1, Math.floor(Number(room.stake) || 5000));
    const isChain = room.currentCombo.type === "fourKind" &&
      room.activeChopChain &&
      room.activeChopChain.eventIndex === room.chopEvents.length - 1 &&
      room.chopEvents[room.activeChopChain.eventIndex]?.to === room.lastPlayerUid;
    if (isChain) {
      const chain = room.activeChopChain;
      chain.count += 1;
      const event = room.chopEvents[chain.eventIndex];
      event.from = room.lastPlayerUid;
      event.to = actor;
      event.amount = 15 * stake * chain.count;
      event.reason = "chop-chain";
      chain.from = room.lastPlayerUid;
    } else {
      const event = {
        from: room.lastPlayerUid,
        to: actor,
        amount: 15 * stake,
        reason: room.currentCombo.type === "fourKind" ? "chop-four-kind" : "chop-two"
      };
      room.chopEvents.push(event);
      room.activeChopChain = {
        eventIndex: room.chopEvents.length - 1,
        from: room.lastPlayerUid,
        count: 1
      };
    }
  } else {
    room.activeChopChain = null;
  }
  room.hands[actor] = engine.removeCards(hand, combo.cards);
  room.currentCombo = combo;
  room.lastPlayerUid = actor;
  const player = room.players.find(item => item.uid === actor);
  room.lastPlay = { uid: actor, name: player?.name || actor, cards: combo.cards.map(card => ({ ...card })) };
  room.playedCount += 1;
  room.playedByUid[actor] = (Number(room.playedByUid[actor]) || 0) + combo.cards.length;
  room.passed.clear();

  let samLung = false;
  if (room.samStatus === "called" && room.samCallerHasPlayed && actor !== room.samCallerUid) {
    room.samStatus = "failed";
    room.samBlockedByUid = actor;
    samLung = true;
  }
  if (room.samStatus === "called" && actor === room.samCallerUid) {
    room.samCallerHasPlayed = true;
  }
  if (!room.hands[actor].length) {
    finish(room, actor, "normal");
    return {
      ok: true, finished: true, samLung,
      samSuccess: room.samCallerUid === actor && room.samStatus === "success",
      combo, room: snapshot(room), state: room
    };
  }
  room.turnUid = nextPlayer(room, actor);
  return { ok: true, finished: false, samLung, combo, room: snapshot(room), state: room };
}
function pass(threadId, uid) {
  const room = get(threadId);
  if (!room || room.status !== "playing") return { ok: false, code: "NO_GAME" };
  if (room.cancelPending) return { ok: false, code: "CANCEL_PENDING" };
  const actor = String(uid);
  if (!room.hands?.[actor]) return { ok: false, code: "NOT_PLAYER" };
  if (room.turnUid !== actor) return { ok: false, code: "NOT_TURN" };
  if (!room.currentCombo || !room.lastPlayerUid) return { ok: false, code: "CANNOT_PASS_ON_LEAD" };
  if (room.lastPlayerUid === actor) return { ok: false, code: "LEADER_CANNOT_PASS" };
  room.passed.add(actor);
  const activeCount = room.players.filter(item => !room.finishOrder.includes(item.uid)).length;
  const requiredPasses = Math.max(0, activeCount - 1);
  if (room.passed.size >= requiredPasses) {
    const leader = room.lastPlayerUid;
    room.currentCombo = null;
    room.lastPlay = null;
    room.activeChopChain = null;
    room.passed.clear();
    room.turnUid = leader;
    return { ok: true, roundCleared: true, room: snapshot(room), state: room };
  }
  room.turnUid = nextPlayer(room, actor);
  return { ok: true, roundCleared: false, room: snapshot(room), state: room };
}
function callSam(threadId, uid) {
  const room = get(threadId);
  if (!room || room.status !== "playing") return { ok: false, code: "NO_GAME" };
  if (room.cancelPending) return { ok: false, code: "CANCEL_PENDING" };
  if (!room.hands?.[String(uid)]) return { ok: false, code: "NOT_PLAYER" };
  if (room.playedCount !== 0 || room.samStatus) return { ok: false, code: "TOO_LATE" };
  room.samCallerUid = String(uid);
  room.samCallerHasPlayed = false;
  room.samStatus = "called";
  room.turnUid = String(uid);
  room.currentCombo = null;
  room.lastPlayerUid = null;
  room.lastPlay = null;
  room.passed.clear();
  return { ok: true, room: snapshot(room), state: room };
}
function timeoutTurn(threadId, uid) {
  const room = get(threadId);
  if (!room || room.status !== "playing" || room.turnUid !== String(uid)) {
    return { ok: false, code: "NO_TURN" };
  }
  if (room.currentCombo && room.lastPlayerUid !== String(uid)) {
    return { ...pass(threadId, uid), timedOut: true, action: "pass" };
  }
  const hand = room.hands[String(uid)] || [];
  const first = engine.sortHand(hand)[0];
  if (!first) return { ok: false, code: "NO_CARD" };
  return { ...play(threadId, uid, [first]), timedOut: true, action: "play" };
}
function leave(threadId, uid) {
  const room = get(threadId);
  if (!room || room.status === "finished") return { ok: false, code: "NO_GAME" };
  const actor = String(uid);
  if (!room.players.some(item => item.uid === actor)) return { ok: false, code: "NOT_PLAYER" };
  if (room.status === "waiting") {
    if (room.ownerId !== actor) {
      room.players = room.players.filter(item => item.uid !== actor);
      return { ok: true, room: snapshot(room), state: room };
    }
    room.status = "cancelled";
    clearTimer(threadId);
    return { ok: true, cancelled: true, room: snapshot(room), state: room };
  }
  room.hands[actor] = [];
  room.passed.delete(actor);
  const remaining = room.players.map(item => item.uid).filter(id =>
    id !== actor && !room.finishOrder.includes(id)
  );
  if (remaining.length === 1) finish(room, remaining[0], "forfeit");
  else {
    room.finishOrder.push(actor);
    room.turnUid = room.turnUid === actor ? nextPlayer(room, actor) : room.turnUid;
    if (room.samStatus === "called" && room.samCallerUid === actor) room.samStatus = "failed";
  }
  return { ok: true, room: snapshot(room), state: room, forfeited: true };
}
function stop(threadId, uid) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  if (room.ownerId !== String(uid)) return { ok: false, code: "NOT_OWNER" };
  room.status = "cancelled";
  clearTimer(threadId);
  return { ok: true, room: snapshot(room), state: room };
}
function removeRoom(threadId) {
  const key = String(threadId);
  const room = get(key);
  clearTimer(key);
  if (!room) return false;
  roomsByThread.delete(key);
  roomsByCode.delete(room.id);
  return true;
}
function serialize(roomOrThreadId) {
  const room = typeof roomOrThreadId === "object" && roomOrThreadId ? roomOrThreadId : get(roomOrThreadId);
  if (!room) return null;
  return {
    ...room,
    players: room.players.map(item => ({ ...item })),
    hands: room.hands ? Object.fromEntries(Object.entries(room.hands).map(([uid, hand]) =>
      [uid, hand.map(card => ({ ...card }))])) : null,
    passed: [...room.passed],
    finishOrder: [...room.finishOrder],
    currentCombo: room.currentCombo ? { ...room.currentCombo, cards: room.currentCombo.cards.map(card => ({ ...card })) } : null,
    lastPlay: room.lastPlay ? { ...room.lastPlay, cards: room.lastPlay.cards.map(card => ({ ...card })) } : null,
    results: room.results ? room.results.map(row => ({ ...row })) : null,
    whiteHand: room.whiteHand ? { ...room.whiteHand } : null
  };
}
function restore(saved) {
  if (!saved || typeof saved !== "object" || !saved.threadId || !/^\d{5}$/.test(String(saved.id || "")) ||
      !Array.isArray(saved.players) || saved.players.length < 1 || saved.players.length > MAX_PLAYERS ||
      !["waiting", "playing", "finished", "cancelled"].includes(saved.status)) return null;
  const players = saved.players.map(makePlayer).filter(item => item.uid);
  if (players.length !== saved.players.length || new Set(players.map(item => item.uid)).size !== players.length) return null;
  const ids = new Set(players.map(item => item.uid));
  if (!ids.has(String(saved.ownerId || ""))) return null;
  const room = {
    ...saved,
    settled: saved.settled === true,
    gameToken: String(saved.gameToken || saved.lockTransactionId || saved.id),
    threadId: String(saved.threadId), id: String(saved.id),
    ownerId: String(saved.ownerId), ownerName: String(saved.ownerName || ""),
    players, hands: saved.hands && typeof saved.hands === "object" ? saved.hands : null,
    passed: new Set(Array.isArray(saved.passed) ? saved.passed.map(String).filter(uid => ids.has(uid)) : []),
    finishOrder: Array.isArray(saved.finishOrder) ? saved.finishOrder.map(String).filter(uid => ids.has(uid)) : [],
    currentCombo: saved.currentCombo || null, lastPlay: saved.lastPlay || null,
    results: Array.isArray(saved.results) ? saved.results : null,
    whiteHand: saved.whiteHand || null,
    samCallerHasPlayed: Boolean(saved.samCallerHasPlayed),
    playedByUid: saved.playedByUid && typeof saved.playedByUid === "object" ? saved.playedByUid : {},
    chopEvents: Array.isArray(saved.chopEvents) ? saved.chopEvents.filter(item =>
      ids.has(String(item?.from || "")) && ids.has(String(item?.to || "")) &&
      Number.isSafeInteger(Number(item?.amount)) && Number(item.amount) > 0
    ).map(item => ({ ...item })) : [],
    activeChopChain: saved.activeChopChain &&
      saved.currentCombo?.type === "fourKind" &&
      String(saved.lastPlayerUid || "") === String(saved.chopEvents?.[saved.activeChopChain.eventIndex]?.to || "") &&
      Number.isInteger(saved.activeChopChain.eventIndex) &&
      saved.activeChopChain.eventIndex >= 0 &&
      saved.activeChopChain.eventIndex < (Array.isArray(saved.chopEvents) ? saved.chopEvents.length : 0) &&
      ids.has(String(saved.activeChopChain.from || "")) &&
      Number.isInteger(saved.activeChopChain.count) && saved.activeChopChain.count > 0
        ? { ...saved.activeChopChain } : null,
    baoOneViolations: Array.isArray(saved.baoOneViolations) ? saved.baoOneViolations.filter(item =>
      ids.has(String(item?.from || "")) && ids.has(String(item?.to || "")) &&
      Number.isSafeInteger(Number(item?.amount)) && Number(item.amount) > 0
    ).map(item => ({ ...item })) : []
  };
  if (room.status === "playing" && (!room.hands || !ids.has(String(room.turnUid || "")))) return null;
  const old = get(room.threadId);
  if (old) removeRoom(room.threadId);
  const codeOwner = getByCode(room.id);
  if (codeOwner && codeOwner.threadId !== room.threadId) return null;
  roomsByThread.set(room.threadId, room);
  roomsByCode.set(room.id, room);
  return room;
}
function watchTurn(threadId, callback, timeoutMs = MOVE_TIMEOUT_MS) {
  const key = String(threadId);
  clearTimer(key);
  const room = get(key);
  if (!room || room.status !== "playing" || !room.turnUid) return false;
  const uid = String(room.turnUid);
  const playedCount = room.playedCount;
  const timer = setTimeout(() => {
    if (timers.get(key) !== timer) return;
    timers.delete(key);
    const current = get(key);
    if (current !== room || current.status !== "playing" ||
        current.turnUid !== uid || current.playedCount !== playedCount) return;
    Promise.resolve(callback?.({ room: current, uid })).catch(() => {});
  }, timeoutMs);
  timer.unref?.();
  timers.set(key, timer);
  return true;
}
function watchLobby(threadId, callback, timeoutMs = LOBBY_TIMEOUT_MS) {
  const key = String(threadId);
  clearTimer(key);
  const room = get(key);
  if (!room || room.status !== "waiting") return false;
  const timer = setTimeout(() => {
    if (timers.get(key) !== timer) return;
    timers.delete(key);
    const current = get(key);
    if (current !== room || current.status !== "waiting") return;
    Promise.resolve(callback?.({ room: current })).catch(() => {});
  }, timeoutMs);
  timer.unref?.();
  timers.set(key, timer);
  return true;
}
module.exports = {
  MIN_PLAYERS, MAX_PLAYERS, MOVE_TIMEOUT_MS, LOBBY_TIMEOUT_MS, timers,
  get, getByCode, isBusy, snapshot, create, join, joinWaiting, start,
  play, pass, callSam, timeoutTurn, leave, stop, removeRoom, serialize,
  restore, watchTurn, watchLobby, clearTimer, finish, calculateSettlement
};
