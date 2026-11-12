"use strict";

const engine = require("../../../games/noituEngine");
const sessions = new Map();

function get(threadId) {
  return sessions.get(String(threadId)) || null;
}
function start(threadId, uid, name) {
  const key = String(threadId);
  const current = sessions.get(key);
  if (current?.status === "active") return { ok: false, code: "RUNNING", session: current };
  const session = engine.createSession(key, uid, name);
  sessions.set(key, session);
  return { ok: true, session };
}
function join(threadId, uid, name) {
  return engine.join(get(threadId), uid, name);
}
function leave(threadId, uid) {
  const result = engine.leave(get(threadId), uid);
  if (result.empty) sessions.delete(String(threadId));
  return result;
}
function play(threadId, uid, value) {
  return engine.play(get(threadId), uid, value);
}
function pass(threadId, uid) {
  return engine.pass(get(threadId), uid);
}
function stop(threadId) {
  const session = get(threadId);
  if (!session) return null;
  session.status = "stopped";
  sessions.delete(String(threadId));
  return session;
}
module.exports = { get, start, join, leave, play, pass, stop, sessions };
