"use strict";

const START_PHRASES = Object.freeze([
  "học sinh", "bông hoa", "bầu trời", "máy tính", "mặt trời",
  "đường phố", "trường học", "sách vở", "bóng đá", "điện thoại",
  "nước biển", "cây xanh", "cá voi", "mưa rào", "bàn học"
]);

function normalizeSyllable(value) {
  return String(value || "").toLocaleLowerCase("vi-VN").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

function normalizePhrase(value) {
  return String(value || "").toLocaleLowerCase("vi-VN").normalize("NFC")
    .replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter(Boolean).map(normalizeSyllable).join(" ");
}

function parsePhrase(value) {
  const display = String(value || "").normalize("NFC").toLocaleLowerCase("vi-VN")
    .replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!display) return null;
  const words = display.split(" ");
  if (words.length < 2 || words.length > 4) return null;
  const syllables = words.map(normalizeSyllable);
  if (syllables.some(word => !word || !/^[a-z]+$/.test(word))) return null;
  return {
    display,
    normalized: syllables.join(" "),
    first: syllables[0],
    last: syllables[syllables.length - 1],
    syllables
  };
}

function nextPlayer(session) {
  const players = [...session.players.values()];
  if (!players.length) {
    session.turnUid = null;
    return null;
  }
  const currentIndex = players.findIndex(player => player.uid === session.turnUid);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % players.length;
  const player = players[nextIndex];
  session.turnUid = player.uid;
  return player;
}

function createSession(threadId, ownerId, ownerName = "Player", random = Math.random, now = Date.now()) {
  const index = Math.min(START_PHRASES.length - 1, Math.max(0, Math.floor(random() * START_PHRASES.length)));
  const currentPhrase = parsePhrase(START_PHRASES[index]);
  const uid = String(ownerId);
  const name = String(ownerName || "Player");
  return {
    threadId: String(threadId),
    ownerId: uid,
    ownerName: name,
    players: new Map([[uid, { uid, name, points: 0 }]]),
    turnUid: uid,
    currentPhrase,
    used: new Set([currentPhrase.normalized]),
    history: [currentPhrase.display],
    moves: 0,
    startedAt: now,
    lastMoveAt: now,
    status: "active"
  };
}

function join(session, uid, name = "Player") {
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  const key = String(uid);
  if (session.players.has(key)) return { ok: false, code: "ALREADY_JOINED" };
  const player = { uid: key, name: String(name || "Player"), points: 0 };
  session.players.set(key, player);
  return { ok: true, count: session.players.size, player };
}

function leave(session, uid) {
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  const key = String(uid);
  const player = session.players.get(key);
  if (!player) return { ok: false, code: "NOT_JOINED" };
  const ordered = [...session.players.keys()];
  const currentIndex = ordered.indexOf(key);
  session.players.delete(key);
  if (session.ownerId === key) {
    const successor = ordered.slice(currentIndex + 1).find(id => session.players.has(id));
    session.ownerId = successor || session.players.keys().next().value || null;
    session.ownerName = session.players.get(session.ownerId)?.name || "";
  }
  if (session.turnUid === key) {
    const successor = ordered.slice(currentIndex + 1).find(id => session.players.has(id));
    session.turnUid = successor || session.players.keys().next().value || null;
  }
  return { ok: true, empty: session.players.size === 0, player, nextPlayer: session.players.get(session.turnUid) || null };
}

function play(session, uid, value, now = Date.now()) {
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  const key = String(uid);
  if (!session.players.has(key)) return { ok: false, code: "NOT_JOINED" };
  if (session.turnUid !== key) return { ok: false, code: "NOT_TURN", currentUid: session.turnUid };
  const phrase = parsePhrase(value);
  if (!phrase) return { ok: false, code: "INVALID_PHRASE" };
  const expected = session.currentPhrase.last;
  if (phrase.first !== expected) return { ok: false, code: "WRONG_LINK", expected };
  if (session.used.has(phrase.normalized)) return { ok: false, code: "DUPLICATE" };
  session.currentPhrase = phrase;
  session.used.add(phrase.normalized);
  session.history.push(phrase.display);
  if (session.history.length > 100) session.history.shift();
  session.moves += 1;
  session.lastMoveAt = now;
  const player = session.players.get(key);
  player.points += 1;
  const next = nextPlayer(session);
  return { ok: true, phrase, points: player.points, moves: session.moves, nextPlayer: next };
}

function pass(session, uid) {
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  const key = String(uid);
  if (!session.players.has(key)) return { ok: false, code: "NOT_JOINED" };
  if (session.turnUid !== key) return { ok: false, code: "NOT_TURN", currentUid: session.turnUid };
  return { ok: true, nextPlayer: nextPlayer(session) };
}

module.exports = { START_PHRASES, normalizeSyllable, normalizePhrase, parsePhrase, createSession, join, leave, play, pass };
