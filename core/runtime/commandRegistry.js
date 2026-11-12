"use strict";
const indexes = new WeakMap();
function buildIndex(commands) {
  const aliases = new Map();
  for (const [, command] of commands) {
    const list = command?.config?.aliases;
    if (!Array.isArray(list)) continue;
    for (const alias of list) {
      if (typeof alias !== "string") continue;
      const key = alias.trim().toLowerCase();
      if (key && !aliases.has(key)) aliases.set(key, command);
    }
  }
  const index = { aliases, size: commands.size };
  indexes.set(commands, index);
  return index;
}
function invalidate(commands) {
  if (commands && typeof commands === "object") indexes.delete(commands);
}
function resolve(commands, name) {
  if (!(commands instanceof Map) || !name) return null;
  const key = String(name).toLowerCase();
  const direct = commands.get(key);
  if (direct) return direct;
  let index = indexes.get(commands);
  if (!index || index.size !== commands.size) index = buildIndex(commands);
  return index.aliases.get(key) || null;
}
module.exports = { resolve, invalidate, buildIndex };
