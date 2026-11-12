"use strict";

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "thread-recall.json");
const DEFAULT_MS = 60 * 1000;
let settings = Object.create(null);

try {
  const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed;
} catch {}

function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temp = FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
  fs.renameSync(temp, FILE);
}

function get(threadId) {
  const value = Number(settings[String(threadId)]);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MS;
}

function set(threadId, delayMs) {
  const key = String(threadId || "");
  if (!key) throw new Error("Thiếu threadId");
  if (delayMs === null) delete settings[key];
  else settings[key] = Math.max(0, Math.floor(Number(delayMs)));
  persist();
  return get(key);
}

module.exports = { get, set, DEFAULT_MS };
