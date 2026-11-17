"use strict";

const crypto = require("node:crypto");
const engine = require("../../../games/tlmnEngine");

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const LOBBY_TIMEOUT_MS = 60 * 1000;
const roomsByGroup = new Map();
const roomsByCode = new Map();
const timers = new Map();

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
    status: room.status,
    players: room.players.map(player => ({
      uid: player.uid,
      name: player.name,
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
  const room = {
    id: String(options.code || makeCode()),
    threadId: groupId,
    ownerId: String(owner.uid),
    ownerName: String(owner.name || "Chủ phòng").slice(0, 40),
    bet,
    mode: options.mode === "demla" ? "demla" : "nhatnhi",
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
    createdAt: Number(options.now) || Date.now(),
    startedAt: null,
    finishedAt: null,
    results: null,
    locked: {},
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
  const item = { uid, name: String(player.name || "Người chơi").slice(0, 40) };
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

function removeRoom(threadId) {
  const room = get(threadId);
  if (!room) return null;
  clearTimer(threadId);
  room.status = "finished";
  roomsByGroup.delete(String(threadId));
  roomsByCode.delete(room.id);
  return room;
}

function start(threadId, uid, random = Math.random) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  if (room.status !== "waiting") return { ok: false, code: "ALREADY_STARTED" };
  if (room.ownerId !== String(uid)) return { ok: false, code: "NOT_OWNER" };
  if (room.players.length < MIN_PLAYERS) return { ok: false, code: "NEED_TWO_PLAYERS" };
  if (room.players.length > MAX_PLAYERS) return { ok: false, code: "FULL" };

  const dealt = engine.dealCards(room.players.map(player => player.uid), random);
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
  clearTimer(threadId);
  return { ok: true, room: snapshot(room), state: room, firstPlayerId: dealt.firstPlayerId };
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
    return {
      uid,
      name: item?.name || uid,
      place: index + 1,
      cardsLeft: room.hands?.[uid]?.length || 0
    };
  });
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
  const validation = engine.validatePlay(hand, parsed.cards, room.currentCombo, {
    mustContainThreeOfSpades: room.playedCount === 0
  });
  if (!validation.ok) return validation;

  room.hands[actor] = engine.removeCards(hand, validation.combo.cards);
  room.currentCombo = validation.combo;
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
    if (room.mode === "demla" || room.activeUids.length <= 1) {
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
    room.currentCombo = null;
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
  if (!room.forfeitUids.includes(actor)) room.forfeitUids.push(actor);
  if (room.ownerId === actor && room.activeUids.length) {
    const successor = room.players.find(entry => room.activeUids.includes(entry.uid));
    room.ownerId = successor?.uid || null;
    room.ownerName = successor?.name || "";
  }
  if (room.lastPlayerUid === actor) {
    room.currentCombo = null;
    room.lastPlay = null;
    room.passed.clear();
  }
  if (room.activeUids.length <= 1) finishRoom(room);
  else if (room.turnUid === actor) room.turnUid = nextActive(room, actor);
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
    locked: { ...(room.locked || {}) },
    messageCards: {
      group: [...(room.messageCards?.group || [])],
      private: Object.fromEntries(Object.entries(room.messageCards?.private || {}).map(([uid, cards]) =>
        [uid, (cards || []).map(card => ({ ...card }))]))
    },
    results: room.results ? room.results.map(row => ({ ...row })) : null
  };
}

function restore(saved) {
  if (!saved || typeof saved !== "object" || !saved.threadId || !saved.id ||
      !Array.isArray(saved.players) || !["waiting", "playing", "finished"].includes(saved.status)) {
    return null;
  }
  const threadId = String(saved.threadId);
  const id = String(saved.id);
  const players = saved.players.map(item => ({
    uid: String(item.uid || ""),
    name: String(item.name || "Người chơi").slice(0, 40)
  })).filter(item => item.uid);
  if (players.length < 1 || players.length > MAX_PLAYERS ||
      new Set(players.map(item => item.uid)).size !== players.length) return null;

  const room = {
    ...saved,
    id,
    threadId,
    players,
    hands: saved.hands && typeof saved.hands === "object"
      ? Object.fromEntries(Object.entries(saved.hands).map(([uid, hand]) =>
          [String(uid), Array.isArray(hand) ? hand.map(card => ({ ...card })) : []]))
      : null,
    activeUids: Array.isArray(saved.activeUids) ? saved.activeUids.map(String) : [],
    finishOrder: Array.isArray(saved.finishOrder) ? saved.finishOrder.map(String) : [],
    forfeitUids: Array.isArray(saved.forfeitUids) ? saved.forfeitUids.map(String) : [],
    passed: new Set(Array.isArray(saved.passed) ? saved.passed.map(String) : []),
    currentCombo: saved.currentCombo && Array.isArray(saved.currentCombo.cards)
      ? { ...saved.currentCombo, cards: saved.currentCombo.cards.map(card => ({ ...card })) }
      : null,
    lastPlay: saved.lastPlay && Array.isArray(saved.lastPlay.cards)
      ? { ...saved.lastPlay, cards: saved.lastPlay.cards.map(card => ({ ...card })) }
      : null,
    locked: saved.locked && typeof saved.locked === "object" ? { ...saved.locked } : {},
    messageCards: {
      group: Array.isArray(saved.messageCards?.group) ? saved.messageCards.group : [],
      private: saved.messageCards?.private && typeof saved.messageCards.private === "object"
        ? saved.messageCards.private : {}
    },
    results: Array.isArray(saved.results) ? saved.results.map(row => ({ ...row })) : null
  };

  const old = get(threadId);
  if (old) removeRoom(threadId);
  const codeOwner = getByCode(id);
  if (codeOwner && codeOwner.threadId !== threadId) return null;
  roomsByGroup.set(threadId, room);
  roomsByCode.set(id, room);
  return room;
}

function listActive() {
  return [...roomsByGroup.values()].filter(room => room.status === "playing").map(snapshot);
}

module.exports = {
  MIN_PLAYERS, MAX_PLAYERS, LOBBY_TIMEOUT_MS,
  roomsByGroup, roomsByCode, timers,
  get, getByCode, isBusy, snapshot, create, join, joinWaiting,
  updateBet, updateMode, watchLobby, removeRoom, start, play, pass,
  leave, stop, cancel, finishRoom, listActive, serialize, restore
};
