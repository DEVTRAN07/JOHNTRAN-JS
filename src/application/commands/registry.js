"use strict";

const indexes = new WeakMap();

function buildIndex(commands) {
  const aliases = new Map();
  const conflicts = new Map();

  for (const [, command] of commands) {
    const list = command?.config?.aliases;
    if (!Array.isArray(list)) continue;

    for (const alias of list) {
      if (typeof alias !== "string") continue;
      const key = alias.trim().toLowerCase();
      if (!key) continue;

      if (conflicts.has(key)) {
        conflicts.get(key).add(command);
        continue;
      }

      if (!aliases.has(key)) {
        aliases.set(key, command);
        continue;
      }

      const existing = aliases.get(key);
      if (existing !== command) {
        aliases.delete(key);
        conflicts.set(key, new Set([existing, command]));
      }
    }
  }

  const index = { aliases, conflicts, size: commands.size };
  indexes.set(commands, index);
  return index;
}

function invalidate(commands) {
  if (commands && typeof commands === "object") indexes.delete(commands);
}

function getIndex(commands) {
  let index = indexes.get(commands);
  if (!index || index.size !== commands.size) index = buildIndex(commands);
  return index;
}

function resolve(commands, name) {
  if (!(commands instanceof Map) || !name) return null;
  const key = String(name).toLowerCase();
  const direct = commands.get(key);
  if (direct) return direct;

  const index = getIndex(commands);
  if (index.conflicts.has(key)) return null;
  return index.aliases.get(key) || null;
}

function getAliasConflicts(commands) {
  if (!(commands instanceof Map)) return [];
  const index = getIndex(commands);
  return [...index.conflicts.entries()].map(([alias, owners]) => ({
    alias,
    commands: [...owners]
      .map(command => command?.config?.name)
      .filter(name => typeof name === "string")
  }));
}

module.exports = { resolve, invalidate, buildIndex, getAliasConflicts };
