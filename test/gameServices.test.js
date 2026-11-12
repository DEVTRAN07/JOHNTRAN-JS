"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const economy = require("../core/runtime/services/games/economyService");
const tuTien = require("../core/runtime/services/games/tuTienService");
const pvp = require("../core/runtime/services/games/pvpService");
const leaderboard = require("../core/runtime/services/games/leaderboardService");

test("Tu Tien service preserves the legacy engine API and single sect", () => {
  assert.equal(typeof tuTien.cultivate, "function");
  assert.equal(tuTien.SECT.id, "devtran-tien-tong");
});
test("economy service safely debits and credits existing player currencies", () => {
  const original = { spiritStones: 50, sectStones: 10 };
  const spent = economy.debit(original, "spiritStones", 20);
  assert.equal(spent.ok, true);
  assert.equal(spent.player.spiritStones, 30);
  assert.equal(original.spiritStones, 50);
  assert.equal(economy.debit(original, "spiritStones", 100).code, "INSUFFICIENT_FUNDS");
  assert.equal(economy.credit(original, "sectStones", 5).player.sectStones, 15);
  assert.equal(economy.debit(original, "unknown", 1).code, "INVALID_CURRENCY");
});
test("PvP and leaderboard services expose the established arena operations", () => {
  assert.equal(typeof pvp.createChallenge, "function");
  assert.equal(typeof pvp.takeTurn, "function");
  assert.equal(typeof leaderboard.leaderboard, "function");
  assert.equal(typeof leaderboard.previousSeasonLeaderboard, "function");
});
