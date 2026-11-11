"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/tuTienEngine");

test("new cultivator starts as mortal with starter resources", () => {
  const player = engine.createPlayer(123);
  assert.equal(engine.realmLabel(player), "Phàm Nhân · Nhập môn");
  assert.equal(player.spiritStones, 100);
  assert.equal(player.createdAt, 123);
});

test("cultivation grants progress and spirit stones", () => {
  const player = engine.createPlayer(1000);
  const result = engine.cultivate(player, 1000);
  assert.equal(result.ok, true);
  assert.ok(result.gain >= 18 && result.gain <= 30);
  assert.equal(result.player.spiritStones, 103);
  assert.equal(result.player.lastCultivateAt, 1000);
});

test("cultivation cooldown prevents repeated farming", () => {
  const player = engine.createPlayer(1000);
  const first = engine.cultivate(player, 1000);
  const second = engine.cultivate(first.player, 2000);
  assert.equal(second.ok, false);
  assert.equal(second.code, "COOLDOWN");
});

test("breakthrough advances stage and improves stats on realm transition", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = 1;
  player.stageIndex = 8;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.breakthrough(player, 1000, () => 0);
  assert.equal(result.success, true);
  assert.equal(result.player.realmIndex, 2);
  assert.equal(result.player.stageIndex, 0);
  assert.equal(result.player.attack, 15);
  assert.equal(result.player.maxHp, 125);
});

test("failed breakthrough consumes resources and reduces progress", () => {
  const player = engine.createPlayer(1000);
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.breakthrough(player, 1000, () => 0.99);
  assert.equal(result.success, false);
  assert.equal(result.player.spiritStones, 80);
  assert.equal(result.player.cultivation, 80);
});

test("insufficient cultivation cannot trigger breakthrough", () => {
  const player = engine.createPlayer(1000);
  const result = engine.breakthrough(player, 1000, () => 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "NOT_READY");
});
