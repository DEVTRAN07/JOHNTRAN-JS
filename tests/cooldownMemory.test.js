"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  consumeCooldown,
  pruneExpired,
  MAX_COOLDOWN_USERS
} = require("../core/runtime/middleware/cooldown");

test("cooldown blocks repeat use and allows use after expiration", () => {
  const cooldowns = new Map();
  assert.equal(consumeCooldown({
    cooldowns, commandName: "ping", userId: "u1", cooldownMs: 1000, now: 100
  }), 0);
  assert.equal(consumeCooldown({
    cooldowns, commandName: "ping", userId: "u1", cooldownMs: 1000, now: 400
  }), 700);
  assert.equal(consumeCooldown({
    cooldowns, commandName: "ping", userId: "u1", cooldownMs: 1000, now: 1100
  }), 0);
});

test("expired cooldown users are removed", () => {
  const commandCooldowns = new Map([
    ["expired", 100],
    ["active", 950]
  ]);
  assert.equal(pruneExpired(commandCooldowns, 1000, 200), undefined);
  assert.equal(commandCooldowns.has("expired"), false);
  assert.equal(commandCooldowns.has("active"), true);
});

test("cooldown map never grows beyond its configured user limit", () => {
  const cooldowns = new Map();
  for (let index = 0; index < MAX_COOLDOWN_USERS + 25; index++) {
    consumeCooldown({
      cooldowns,
      commandName: "limited",
      userId: `user-${index}`,
      cooldownMs: 60000,
      now: 1000
    });
  }
  assert.ok(cooldowns.get("limited").size <= MAX_COOLDOWN_USERS);
});
