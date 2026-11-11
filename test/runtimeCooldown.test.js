"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { consumeCooldown } = require("../core/runtime/middleware/cooldown");

test("cooldown allows first use and blocks repeated use until expiry", () => {
  const cooldowns = new Map();
  assert.equal(consumeCooldown({ cooldowns, commandName: "stk", userId: "u1", cooldownMs: 5000, now: 10000 }), 0);
  assert.equal(consumeCooldown({ cooldowns, commandName: "stk", userId: "u1", cooldownMs: 5000, now: 12000 }), 3000);
  assert.equal(consumeCooldown({ cooldowns, commandName: "stk", userId: "u1", cooldownMs: 5000, now: 15000 }), 0);
});

test("cooldowns are isolated by command and user", () => {
  const cooldowns = new Map();
  consumeCooldown({ cooldowns, commandName: "stk", userId: "u1", cooldownMs: 5000, now: 10000 });
  assert.equal(consumeCooldown({ cooldowns, commandName: "scl", userId: "u1", cooldownMs: 5000, now: 11000 }), 0);
  assert.equal(consumeCooldown({ cooldowns, commandName: "stk", userId: "u2", cooldownMs: 5000, now: 11000 }), 0);
});

test("zero cooldown does not allocate state", () => {
  const cooldowns = new Map();
  assert.equal(consumeCooldown({ cooldowns, commandName: "help", userId: "u1", cooldownMs: 0 }), 0);
  assert.equal(cooldowns.size, 0);
});
