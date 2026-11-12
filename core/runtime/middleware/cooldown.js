"use strict";

/**
 * Consumes a per-command/per-user cooldown slot.
 * Returns the remaining milliseconds when blocked, otherwise zero.
 */
function consumeCooldown({ cooldowns, commandName, userId, cooldownMs, now = Date.now() } = {}) {
  if (!(cooldownMs > 0)) return 0;
  if (!(cooldowns instanceof Map)) throw new TypeError("cooldowns must be a Map");

  if (!cooldowns.has(commandName)) cooldowns.set(commandName, new Map());
  const commandCooldowns = cooldowns.get(commandName);
  const lastUsed = commandCooldowns.get(userId);

  if (lastUsed && now - lastUsed < cooldownMs) {
    return cooldownMs - (now - lastUsed);
  }

  commandCooldowns.set(userId, now);
  return 0;
}

module.exports = { consumeCooldown };
