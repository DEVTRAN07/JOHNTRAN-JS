"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/tuTienEngine");

test("new cultivator starts as mortal with starter resources", () => {
  const player = engine.createPlayer(123);
  assert.equal(engine.realmLabel(player), "Phàm Nhân · Nhập môn");
  assert.equal(player.spiritStones, 100);
  assert.equal(player.createdAt, 123);
  assert.equal(player.version, 2);
});

test("cultivation grants progress and spirit stones", () => {
  const player = engine.createPlayer(1000);
  const result = engine.cultivate(player, 1000, () => 0.5);
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

test("final Great Tribulation stage must use the dedicated tribulation action", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = 9;
  player.stageIndex = engine.REALMS[9].stages.length - 1;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.breakthrough(player, 1000, () => 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "TRIBULATION_REQUIRED");
});

test("secret realm can yield a spirit spring and cultivation resources", () => {
  const result = engine.explore(engine.createPlayer(1000), 1000, () => 0.1);
  assert.equal(result.ok, true);
  assert.equal(result.event, "spirit_spring");
  assert.equal(result.cultivationGain, 22);
  assert.equal(result.player.inventory.spiritFruit, 1);
  assert.equal(result.player.discoveries, 1);
});

test("secret realm combat rewards a sufficiently strong cultivator", () => {
  const player = engine.createPlayer(1000);
  player.attack = 100;
  player.defense = 50;
  const rolls = [0.3, 0.5];
  const result = engine.explore(player, 1000, () => rolls.shift() ?? 0.5);
  assert.equal(result.event, "monster_win");
  assert.equal(result.player.wins, 1);
  assert.ok(result.stoneGain >= 15);
});

test("secret realm can capture a spirit pet", () => {
  const rolls = [0.6, 0.99, 0.1];
  const result = engine.explore(engine.createPlayer(1000), 1000, () => rolls.shift() ?? 0.1);
  assert.equal(result.event, "pet_captured");
  assert.equal(result.pet.speciesId, "phoenix");
  assert.equal(result.player.pets.length, 1);
  assert.equal(result.player.activePetId, result.pet.id);
});

test("pet feeding levels up the companion and improves combat stats", () => {
  const player = engine.createPlayer(1000);
  player.pets = [{ id: "pet-1", speciesId: "cloud_fox", name: "Vân Hồ", rarity: "Linh", level: 1, exp: 0, attack: 3, defense: 5 }];
  player.activePetId = "pet-1";
  const result = engine.feedPet(player, "pet-1");
  assert.equal(result.ok, true);
  assert.equal(result.pet.level, 2);
  assert.equal(result.pet.attack, 5);
  assert.equal(result.player.spiritStones, 85);
  assert.equal(engine.effectiveStats(result.player).attack, 7);
});

test("pet activation rejects unknown ids and switches active companion", () => {
  const player = engine.createPlayer(1000);
  player.pets = [
    { id: "one", speciesId: "cloud_fox", name: "Vân Hồ", level: 1, attack: 3, defense: 5 },
    { id: "two", speciesId: "phoenix", name: "Chu Tước", level: 1, attack: 13, defense: 8 }
  ];
  player.activePetId = "one";
  assert.equal(engine.activatePet(player, "missing").ok, false);
  const result = engine.activatePet(player, "two");
  assert.equal(result.ok, true);
  assert.equal(engine.effectiveStats(result.player).attack, 23);
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
  assert.equal(result.player.hp, 165);
});

test("normalization migrates existing V1 cultivation data without losing progress", () => {
  const player = engine.normalizePlayer({ realmIndex: 3, stageIndex: 2, cultivation: 321, spiritStones: 456 });
  assert.equal(player.realmIndex, 3);
  assert.equal(player.stageIndex, 2);
  assert.equal(player.cultivation, 321);
  assert.equal(player.spiritStones, 456);
  assert.deepEqual(player.inventory, { spiritFruit: 0, ancientShard: 0 });
});
