"use strict";

const engine = require("../../../domain/games/engines/noituEngine");
const sessions = new Map();

const DURATION_MS = 60_000;
const CORRECT_BONUS_MS = 1_000;
const WRONG_PENALTY_MS = 5_000;

function snapshot(session) {
  return {
    threadId: session.threadId,
    playerId: session.playerId,
    playerName: session.playerName,
    status: session.status,
    game: session.game,
    score: session.score,
    correct: session.correct,
    wrong: session.wrong,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt
  };
}

function remainingMs(session, now = Date.now()) {
  return Math.max(0, session.expiresAt - now);
}

function get(threadId) {
  return sessions.get(String(threadId)) || null;
}

function start(threadId, uid, name = "Người chơi", options = {}) {
  const key = String(threadId);
  const current = sessions.get(key);
  if (current?.status === "active" && remainingMs(current, options.now) > 0) {
    return { ok: false, code: "RUNNING", session: snapshot(current) };
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const game = engine.createSession(key, String(uid), name, options.random, now);
  const session = {
    threadId: key,
    playerId: String(uid),
    playerName: String(name || "Người chơi"),
    status: "active",
    game,
    score: 0,
    correct: 0,
    wrong: 0,
    startedAt: now,
    expiresAt: now + DURATION_MS
  };
  sessions.set(key, session);
  return { ok: true, session: snapshot(session) };
}

function submit(threadId, uid, value, now = Date.now()) {
  const key = String(threadId);
  const session = sessions.get(key);
  if (!session || session.status !== "active") return { ok: false, code: "NO_GAME" };
  if (session.playerId !== String(uid)) return { ok: false, code: "NOT_PLAYER" };
  if (remainingMs(session, now) <= 0) {
    const ended = finish(key);
    return { ok: false, code: "TIME_UP", session: ended };
  }

  const result = engine.play(session.game, uid, value, now);
  if (result.ok) {
    session.score += 1;
    session.correct += 1;
    session.expiresAt += CORRECT_BONUS_MS;
    return {
      ok: true,
      code: "CORRECT",
      phrase: result.phrase,
      score: session.score,
      remainingMs: remainingMs(session, now),
      session: snapshot(session)
    };
  }

  if (["WRONG_LINK", "INVALID_PHRASE", "DUPLICATE"].includes(result.code)) {
    session.wrong += 1;
    session.expiresAt -= WRONG_PENALTY_MS;
    if (remainingMs(session, now) <= 0) {
      const ended = finish(key);
      return { ok: false, code: "TIME_UP", reason: result.code, session: ended };
    }
    return {
      ok: false,
      code: result.code,
      expected: result.expected,
      remainingMs: remainingMs(session, now),
      session: snapshot(session)
    };
  }

  return { ...result, remainingMs: remainingMs(session, now), session: snapshot(session) };
}

function finish(threadId) {
  const key = String(threadId);
  const session = sessions.get(key);
  if (!session) return null;
  session.status = "finished";
  session.game.status = "finished";
  sessions.delete(key);
  return snapshot(session);
}

function stop(threadId, uid) {
  const session = sessions.get(String(threadId));
  if (!session) return { ok: false, code: "NO_GAME" };
  if (session.playerId !== String(uid)) return { ok: false, code: "NOT_PLAYER" };
  return { ok: true, session: finish(threadId) };
}

module.exports = {
  DURATION_MS,
  CORRECT_BONUS_MS,
  WRONG_PENALTY_MS,
  get,
  start,
  submit,
  finish,
  stop,
  remainingMs,
  sessions
};
