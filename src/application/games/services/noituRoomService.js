"use strict";

const crypto = require("node:crypto");
const engine = require("../../../domain/games/engines/noituEngine");

const rooms = new Map();
const groupRooms = new Map();
const MAX_PLAYERS = 8;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  let code;
  do {
    const bytes = crypto.randomBytes(4);
    code = Array.from(bytes, byte => CODE_CHARS[byte % CODE_CHARS.length]).join("");
  } while (rooms.has(code));
  return code;
}

function get(threadId) {
  const code = groupRooms.get(String(threadId));
  return code ? rooms.get(code) || null : null;
}

function snapshot(room) {
  if (!room) return null;
  return {
    code: room.code,
    threadId: room.threadId,
    ownerId: room.ownerId,
    ownerName: room.ownerName,
    status: room.status,
    players: [...room.players.values()].map(player => ({ ...player })),
    game: room.game || null,
    createdAt: room.createdAt,
    startedAt: room.startedAt || null,
    maxPlayers: MAX_PLAYERS
  };
}

function create(threadId, uid, name = "Người chơi", options = {}) {
  const groupId = String(threadId);
  const ownerId = String(uid);
  if (!groupId || !ownerId) return { ok: false, code: "INVALID_INPUT" };
  const existing = get(groupId);
  if (existing && existing.status !== "finished") {
    return { ok: false, code: "ROOM_EXISTS", room: snapshot(existing) };
  }

  const code = String(options.code || makeCode()).toUpperCase();
  if (rooms.has(code)) return { ok: false, code: "CODE_COLLISION" };
  const owner = { uid: ownerId, name: String(name || "Người chơi"), points: 0 };
  const room = {
    code,
    threadId: groupId,
    ownerId,
    ownerName: owner.name,
    status: "waiting",
    players: new Map([[ownerId, owner]]),
    game: null,
    createdAt: Number.isFinite(options.now) ? options.now : Date.now(),
    startedAt: null
  };
  rooms.set(code, room);
  groupRooms.set(groupId, code);
  return { ok: true, room: snapshot(room) };
}

function join(threadId, code, uid, name = "Người chơi") {
  const room = rooms.get(String(code || "").trim().toUpperCase());
  if (!room) return { ok: false, code: "ROOM_NOT_FOUND" };
  if (room.threadId !== String(threadId)) return { ok: false, code: "WRONG_GROUP" };
  if (room.status !== "waiting") return { ok: false, code: "NOT_WAITING" };
  const playerId = String(uid);
  if (room.players.has(playerId)) return { ok: false, code: "ALREADY_JOINED", room: snapshot(room) };
  if (room.players.size >= MAX_PLAYERS) return { ok: false, code: "FULL" };
  const player = { uid: playerId, name: String(name || "Người chơi"), points: 0 };
  room.players.set(playerId, player);
  return { ok: true, player: { ...player }, room: snapshot(room) };
}

function start(threadId, uid, options = {}) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  if (room.status !== "waiting") return { ok: false, code: "NOT_WAITING", room: snapshot(room) };
  if (room.ownerId !== String(uid)) return { ok: false, code: "NOT_OWNER" };
  if (room.players.size < 2) return { ok: false, code: "NEED_TWO_PLAYERS", room: snapshot(room) };

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const game = engine.createSession(room.threadId, room.ownerId, room.ownerName, options.random, now);
  for (const player of room.players.values()) {
    if (player.uid !== room.ownerId) engine.join(game, player.uid, player.name);
  }
  room.game = game;
  room.players = game.players;
  room.status = "active";
  room.startedAt = now;
  return { ok: true, room: snapshot(room), game };
}

function play(threadId, uid, value, now = Date.now()) {
  const room = get(threadId);
  if (!room || room.status !== "active" || !room.game) return { ok: false, code: "NO_GAME" };
  const result = engine.play(room.game, String(uid), value, now);
  return { ...result, room: snapshot(room) };
}

function pass(threadId, uid) {
  const room = get(threadId);
  if (!room || room.status !== "active" || !room.game) return { ok: false, code: "NO_GAME" };
  const result = engine.pass(room.game, String(uid));
  return { ...result, room: snapshot(room) };
}

function leave(threadId, uid) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  const playerId = String(uid);
  if (room.status === "waiting") {
    const player = room.players.get(playerId);
    if (!player) return { ok: false, code: "NOT_PLAYER" };
    room.players.delete(playerId);
    if (room.ownerId === playerId) {
      const successor = room.players.values().next().value;
      room.ownerId = successor?.uid || null;
      room.ownerName = successor?.name || "";
    }
    if (!room.players.size) {
      finish(threadId);
      return { ok: true, player, empty: true, room: null };
    }
    return { ok: true, player, room: snapshot(room) };
  }

  if (room.status === "active") {
    const result = engine.leave(room.game, playerId);
    if (!result.ok) return result;
    if (result.empty || room.game.players.size < 2) {
      const ended = snapshot(room);
      finish(threadId);
      return { ok: true, player: result.player, gameOver: true, room: ended };
    }
    room.ownerId = room.game.ownerId;
    room.ownerName = room.game.ownerName;
    return { ok: true, player: result.player, room: snapshot(room) };
  }
  return { ok: false, code: "NOT_WAITING" };
}

function finish(threadId) {
  const room = get(threadId);
  if (!room) return null;
  room.status = "finished";
  if (room.game) room.game.status = "finished";
  rooms.delete(room.code);
  groupRooms.delete(room.threadId);
  return snapshot(room);
}

function stop(threadId, uid) {
  const room = get(threadId);
  if (!room) return { ok: false, code: "NO_ROOM" };
  if (room.ownerId !== String(uid)) return { ok: false, code: "NOT_OWNER" };
  return { ok: true, room: finish(threadId) };
}

module.exports = {
  MAX_PLAYERS,
  get,
  snapshot,
  create,
  join,
  start,
  play,
  pass,
  leave,
  finish,
  stop,
  rooms,
  groupRooms
};
