"use strict";
const fs = require("fs");
const path = require("path");
const CONFIG_FILE = path.join(__dirname, "../../../../data/dhbc.json");
const engine = require("../../../games/dhbcEngine");
const sessions = new Map();
let enabledCache;
function isEnabled() {
  if (typeof enabledCache === "boolean") return enabledCache;
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    enabledCache = config.enabled !== false;
  } catch { enabledCache = true; }
  return enabledCache;
}
function setEnabled(value) {
  enabledCache = Boolean(value);
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ enabled: enabledCache }, null, 2) + "\n");
  return enabledCache;
}
function get(threadId) { return sessions.get(String(threadId)) || null; }
function start(threadId, uid, name) {
  const key = String(threadId);
  const current = sessions.get(key);
  if (current?.status === "active") return { ok: false, code: "RUNNING", session: current };
  const session = engine.createSession(key, uid, name);
  sessions.set(key, session);
  return { ok: true, session };
}
function join(threadId, uid, name) {
  const session = get(threadId);
  return engine.join(session, uid, name);
}
function leave(threadId, uid) {
  const session = get(threadId);
  const result = engine.leave(session, uid);
  if (result.empty) sessions.delete(String(threadId));
  return result;
}
function stop(threadId) {
  const session = get(threadId);
  if (!session) return null;
  session.status = "stopped";
  sessions.delete(String(threadId));
  return session;
}
function answer(threadId, value) {
  const session = get(threadId);
  const result = engine.checkAnswer(session, value);
  if (result.correct) engine.nextQuestion(session);
  return { ...result, session };
}
function advance(threadId) {
  const session = get(threadId);
  return session ? engine.nextQuestion(session) : null;
}
function revealHint(threadId) {
  const session = get(threadId);
  return session ? engine.hint(session) : null;
}
module.exports = { get, start, join, leave, stop, answer, advance, revealHint, sessions, isEnabled, setEnabled };
