"use strict";
const fs = require("fs");
const path = require("path");
const CONFIG_FILE = path.join(__dirname, "../../../../data/dhbc.json");
const engine = require("../../../games/dhbcEngine");\nconst questionBank = require("../../../games/dhbcBank");
const sessions = new Map();
let configCache;
function readConfig() {
  if (configCache) return configCache;
  try { configCache = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
  catch { configCache = {}; }
  if (typeof configCache.enabled !== "boolean") configCache.enabled = true;
  return configCache;
}
function writeConfig() {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(readConfig(), null, 2) + "\n");
}
function isEnabled() { return readConfig().enabled !== false; }
function setEnabled(value) {
  readConfig().enabled = Boolean(value);
  writeConfig();
  return configCache.enabled;
}
async function cleanupLegacyData(Users) {
  const config = readConfig();
  if (config.legacyTuTienRemoved) return 0;
  let removed = 0;
  for (const row of Users.getAll()) {
    const data = row?.data && typeof row.data === "object" ? { ...row.data } : {};
    if (!Object.prototype.hasOwnProperty.call(data, "tuTien")) continue;
    delete data.tuTien;
    await Users.setData(String(row.userId), data);
    removed += 1;
  }
  config.legacyTuTienRemoved = true;
  writeConfig();
  return removed;
}
function get(threadId) { return sessions.get(String(threadId)) || null; }
function start(threadId, uid, name) {
  const key = String(threadId);
  const current = sessions.get(key);
  if (current?.status === "active") return { ok: false, code: "RUNNING", session: current };
  engine.setQuestionBank(questionBank.getAll());\n  const session = engine.createSession(key, uid, name);
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
module.exports = { get, start, join, leave, stop, answer, advance, revealHint, sessions, isEnabled, setEnabled, cleanupLegacyData, questionBank };
