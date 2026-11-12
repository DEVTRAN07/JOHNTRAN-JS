"use strict";

/**
 * Consumes a per-command/per-user cooldown slot.
 * Returns the remaining milliseconds when blocked, otherwise zero.
 *
 * Cooldown entries are ephemeral. Expired users are pruned periodically and
 * each command map is bounded so a large group cannot grow it indefinitely.
 */
const MAX_COOLDOWN_USERS = 5000;
const PRUNE_EVERY = 256;
let operations = 0;

function pruneExpired(commandCooldowns, now, cooldownMs) {
  for (const [userId, lastUsed] of commandCooldowns) {
    if (!Number.isFinite(lastUsed) || now - lastUsed >= cooldownMs) {
      commandCooldowns.delete(userId);
    }
  }
}

function consumeCooldown({ cooldowns, commandName, userId, cooldownMs, now = Date.now() } = {}) {
  if (!(cooldownMs > 0)) return 0;
  if (!(cooldowns instanceof Map)) throw new TypeError("cooldowns must be a Map");

  if (!cooldowns.has(commandName)) cooldowns.set(commandName, new Map());
  const commandCooldowns = cooldowns.get(commandName);
  const lastUsed = commandCooldowns.get(userId);

  if (lastUsed !== undefined && now - lastUsed < cooldownMs) {
    if ((++operations % PRUNE_EVERY) === 0) {
      pruneExpired(commandCooldowns, now, cooldownMs);
    }
    return cooldownMs - (now - lastUsed);
  }

  commandCooldowns.set(userId, now);
  if (commandCooldowns.size > MAX_COOLDOWN_USERS) {
    pruneExpired(commandCooldowns, now, cooldownMs);
    while (commandCooldowns.size > MAX_COOLDOWN_USERS) {
      const oldestUserId = commandCooldowns.keys().next().value;
      if (oldestUserId === undefined) break;
      commandCooldowns.delete(oldestUserId);
    }
  } else if ((++operations % PRUNE_EVERY) === 0) {
    pruneExpired(commandCooldowns, now, cooldownMs);
  }

  return 0;
}

module.exports = {
  consumeCooldown,
  pruneExpired,
  MAX_COOLDOWN_USERS,
  PRUNE_EVERY
};
