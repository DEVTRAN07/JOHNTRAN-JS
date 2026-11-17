"use strict";

const engine = require("../../../games/caroEngine");

const MOVE_TIMEOUT_MS = 60 * 1000;
const LOBBY_TIMEOUT_MS = 5 * 60 * 1000;
const sessions = new Map();
const timers = new Map();

function opposite(symbol) {
  return symbol === "X" ? "O" : "X";
}

function clearTimer(threadId) {
  const key = String(threadId);
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

function get(threadId) {
  return sessions.get(String(threadId)) || null;
}

// A waiting PvP lobby and an active match both occupy the group.
function isBusy(threadId) {
  const session = get(threadId);
  return Boolean(session && session.status !== "ended");
}

function isPlaying(threadId) {
  return get(threadId)?.status === "active";
}

function makePlayer(uid, name, kind = "human") {
  return {
    uid: String(uid),
    name: String(name || (kind === "bot" ? "Bot AI" : "Người chơi")).slice(0, 40),
    kind
  };
}

function canStart(threadId) {
  return !isBusy(threadId);
}

function startSolo(threadId, options = {}) {
  const key = String(threadId);
  if (!canStart(key)) return { ok: false, code: "RUNNING", session: get(key) };

  const humanSymbol = String(options.symbol || "X").toUpperCase() === "O" ? "O" : "X";
  const botSymbol = opposite(humanSymbol);
  const human = makePlayer(options.uid, options.name);
  const bot = makePlayer("BOT", options.botName || "Bot AI", "bot");
  const players = { X: humanSymbol === "X" ? human : bot, O: humanSymbol === "O" ? human : bot };
  const humanFirst = options.humanFirst !== false;
  const turnSymbol = humanFirst ? humanSymbol : botSymbol;

  const session = {
    threadId: key,
    mode: "solo",
    status: "active",
    ownerId: String(options.uid),
    players,
    board: engine.createBoard(),
    turnSymbol,
    turnUid: players[turnSymbol].uid,
    moves: 0,
    createdAt: Date.now(),
    startedAt: Date.now(),
    updatedAt: Date.now()
  };
  sessions.set(key, session);
  return { ok: true, session };
}

function startPvp(threadId, options = {}) {
  const key = String(threadId);
  if (!canStart(key)) return { ok: false, code: "RUNNING", session: get(key) };

  const hostSymbol = String(options.symbol || "X").toUpperCase() === "O" ? "O" : "X";
  const guestSymbol = opposite(hostSymbol);
  const host = makePlayer(options.uid, options.name);
  const session = {
    threadId: key,
    mode: "pvp",
    status: "waiting",
    ownerId: String(options.uid),
    hostSymbol,
    players: { X: null, O: null, [hostSymbol]: host, [guestSymbol]: null },
    board: engine.createBoard(),
    turnSymbol: "X",
    turnUid: null,
    moves: 0,
    createdAt: Date.now(),
    startedAt: null,
    updatedAt: Date.now()
  };
  sessions.set(key, session);
  return { ok: true, session };
}

function join(threadId, uid, name) {
  const session = get(threadId);
  if (!session) return { ok: false, code: "NO_GAME" };
  if (session.mode !== "pvp" || session.status !== "waiting") {
    return { ok: false, code: "NOT_WAITING" };
  }
  if (String(uid) === session.ownerId) return { ok: false, code: "OWNER_CANNOT_JOIN" };

  const symbol = opposite(session.hostSymbol);
  if (session.players[symbol]) return { ok: false, code: "FULL" };
  session.players[symbol] = makePlayer(uid, name);
  session.status = "active";
  session.turnSymbol = "X";
  session.turnUid = session.players.X.uid;
  session.startedAt = Date.now();
  session.updatedAt = Date.now();
  clearTimer(threadId);
  return { ok: true, session, player: session.players[symbol], count: 2 };
}

function applyCell(session, cellNumber, symbol) {
  const placed = engine.placeMove(session.board, cellNumber, symbol);
  if (!placed.ok) return placed;

  session.moves += 1;
  session.updatedAt = Date.now();
  if (placed.won) {
    session.status = "ended";
    clearTimer(session.threadId);
    return { ok: true, ...placed, finished: true, winnerSymbol: symbol, draw: false, session };
  }
  if (placed.draw) {
    session.status = "ended";
    clearTimer(session.threadId);
    return { ok: true, ...placed, finished: true, winnerSymbol: null, draw: true, session };
  }

  session.turnSymbol = opposite(symbol);
  session.turnUid = session.players[session.turnSymbol]?.uid || null;
  return { ok: true, ...placed, finished: false, winnerSymbol: null, draw: false, session };
}

function move(threadId, uid, cellNumber) {
  const session = get(threadId);
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  const symbol = session.turnSymbol;
  const player = session.players[symbol];
  const playerSymbol = ["X", "O"].find(value =>
    session.players[value]?.kind === "human" && session.players[value]?.uid === String(uid)
  );
  if (!playerSymbol) return { ok: false, code: "NOT_PLAYER", session };
  if (playerSymbol !== symbol || !player || player.kind !== "human" || player.uid !== String(uid)) {
    return { ok: false, code: "NOT_TURN", session };
  }
  return applyCell(session, cellNumber, symbol);
}

function botMove(threadId) {
  const session = get(threadId);
  if (!session || session.status !== "active" || session.mode !== "solo") {
    return { ok: false, code: "NO_BOT_TURN" };
  }
  const player = session.players[session.turnSymbol];
  if (!player || player.kind !== "bot") return { ok: false, code: "NO_BOT_TURN" };
  const cell = engine.chooseAiMove(session.board, session.turnSymbol);
  if (cell === null) return { ok: false, code: "BOARD_FULL" };
  return applyCell(session, cell, session.turnSymbol);
}

function resign(threadId, uid) {
  const session = get(threadId);
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  const symbol = ["X", "O"].find(value => session.players[value]?.uid === String(uid));
  if (!symbol || session.players[symbol]?.kind !== "human") {
    return { ok: false, code: "NOT_PLAYER" };
  }
  const winnerSymbol = opposite(symbol);
  session.status = "ended";
  session.updatedAt = Date.now();
  clearTimer(threadId);
  return {
    ok: true,
    finished: true,
    session,
    loserSymbol: symbol,
    winnerSymbol,
    reason: "resign",
    draw: false
  };
}

function leave(threadId, uid) {
  const session = get(threadId);
  if (!session) return { ok: false, code: "NO_GAME" };
  if (session.status === "waiting") {
    if (session.ownerId !== String(uid)) return { ok: false, code: "NOT_PLAYER" };
    session.status = "ended";
    clearTimer(threadId);
    return { ok: true, cancelled: true, session };
  }
  if (session.mode === "solo") {
    if (session.ownerId !== String(uid)) return { ok: false, code: "NOT_PLAYER" };
    session.status = "ended";
    clearTimer(threadId);
    return { ok: true, cancelled: true, session };
  }
  return resign(threadId, uid);
}

function stop(threadId) {
  const session = get(threadId);
  if (!session) return null;
  session.status = "ended";
  session.updatedAt = Date.now();
  clearTimer(threadId);
  return session;
}

function finish(threadId) {
  clearTimer(threadId);
  return sessions.delete(String(threadId));
}

function watchTurn(threadId, onTimeout) {
  const key = String(threadId);
  clearTimer(key);
  const session = get(key);
  if (!session || session.status !== "active") return false;

  const symbol = session.turnSymbol;
  const player = session.players[symbol];
  if (!player || player.kind !== "human" || !player.uid) return false;
  const expectedMoves = session.moves;

  const timer = setTimeout(() => {
    timers.delete(key);
    const current = get(key);
    if (current !== session || current.status !== "active" ||
        current.moves !== expectedMoves ||
        current.turnSymbol !== symbol ||
        current.turnUid !== player.uid) return;
    Promise.resolve(onTimeout?.({ session: current, player, symbol }))
      .catch(() => {});
  }, MOVE_TIMEOUT_MS);
  timer.unref?.();
  timers.set(key, timer);
  return true;
}

function watchLobby(threadId, onTimeout) {
  const key = String(threadId);
  clearTimer(key);
  const session = get(key);
  if (!session || session.status !== "waiting") return false;

  const timer = setTimeout(() => {
    timers.delete(key);
    const current = get(key);
    if (current !== session || current.status !== "waiting") return;
    current.status = "ended";
    Promise.resolve(onTimeout?.({ session: current }))
      .catch(() => {});
  }, LOBBY_TIMEOUT_MS);
  timer.unref?.();
  timers.set(key, timer);
  return true;
}

module.exports = {
  MOVE_TIMEOUT_MS,
  LOBBY_TIMEOUT_MS,
  sessions,
  get,
  isBusy,
  isPlaying,
  startSolo,
  startPvp,
  join,
  move,
  botMove,
  resign,
  leave,
  stop,
  finish,
  watchTurn,
  watchLobby
};
