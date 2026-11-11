"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/tuTienEngine");

test("new cultivator starts as mortal with starter resources", () => {
  const player = engine.createPlayer(123);
  assert.equal(engine.realmLabel(player), "Phàm Nhân · Nhập môn");
  assert.equal(player.spiritStones, 100);
  assert.equal(player.createdAt, 123);
  assert.equal(player.version, 3);
  assert.equal("pets" in player, false);
  assert.equal("inventory" in player, false);
});

test("cultivation grants progress and spirit stones", () => {
  const result = engine.cultivate(engine.createPlayer(1000), 1000, () => 0.5);
  assert.equal(result.ok, true);
  assert.equal(result.gain, 24);
  assert.equal(result.player.spiritStones, 103);
  assert.equal(result.player.lastCultivateAt, 1000);
});

test("cultivation cooldown prevents repeated farming", () => {
  const first = engine.cultivate(engine.createPlayer(1000), 1000, () => 0.5);
  const second = engine.cultivate(first.player, 2000, () => 0.5);
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
  const result = engine.breakthrough(engine.createPlayer(1000), 1000, () => 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "NOT_READY");
});

test("final Great Tribulation stage must use dedicated tribulation action", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = 9;
  player.stageIndex = engine.REALMS[9].stages.length - 1;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.breakthrough(player, 1000, () => 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "TRIBULATION_REQUIRED");
});

test("ninefold tribulation opens the True Immortal realm", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = 9;
  player.stageIndex = engine.REALMS[9].stages.length - 1;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.tribulation(player, 1000, () => 0);
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.player.realmIndex, 10);
  assert.equal(result.player.stageIndex, 0);
  assert.equal(result.player.maxHp, 200);
  assert.equal(result.player.attack, 30);
});

test("failed tribulation applies a severe but survivable setback", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = 9;
  player.stageIndex = engine.REALMS[9].stages.length - 1;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.tribulation(player, 1000, () => 0.99);
  assert.equal(result.ok, true);
  assert.equal(result.success, false);
  assert.equal(result.player.spiritStones, 20);
  assert.equal(result.player.hp, 65);
});

test("V1/V2 player data migrates while removed systems are discarded", () => {
  const player = engine.normalizePlayer({
    version: 2,
    realmIndex: 3,
    stageIndex: 2,
    cultivation: 321,
    spiritStones: 456,
    pets: [{ id: "old-pet" }],
    activePetId: "old-pet",
    lastExploreAt: 123,
    discoveries: 4,
    inventory: { spiritFruit: 2, ancientShard: 1 }
  });
  assert.equal(player.version, 3);
  assert.equal(player.realmIndex, 3);
  assert.equal(player.stageIndex, 2);
  assert.equal(player.cultivation, 321);
  assert.equal(player.spiritStones, 456);
  for (const key of ["pets", "activePetId", "lastExploreAt", "discoveries", "inventory"]) {
    assert.equal(key in player, false, key + " should be removed from V3 game state");
  }
});
