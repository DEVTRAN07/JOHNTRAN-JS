"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/tuTienEngine");

test("new cultivator starts with a fixed sect and no retired game systems", () => {
  const player = engine.createPlayer(123, { displayName: "Quang", avatarUrl: "https://example.test/avatar.jpg" });
  assert.equal(engine.realmLabel(player), "Phàm Nhân · Nhập môn");
  assert.equal(player.spiritStones, 100);
  assert.equal(player.sectStones, 0);
  assert.equal(player.sectId, engine.SECT.id);
  assert.equal(player.displayName, "Quang");
  assert.equal(player.avatarUrl, "https://example.test/avatar.jpg");
  assert.equal(player.createdAt, 123);
  assert.equal(player.version, 4);
  assert.equal(typeof engine.breakthrough, "undefined");
  for (const key of ["pets", "inventory", "lastExploreAt"]) assert.equal(key in player, false);
});

test("normal cultivation adds experience, normal stones and daily mission progress", () => {
  const result = engine.cultivate(engine.createPlayer(1000), 1000, () => 0.5);
  assert.equal(result.ok, true);
  assert.equal(result.gain, 24);
  assert.equal(result.player.spiritStones, 103);
  assert.equal(result.player.missions.cultivationCount, 1);
  assert.equal(result.player.lastCultivateAt, 1000);
});

test("normal cultivation cooldown prevents repeated farming", () => {
  const first = engine.cultivate(engine.createPlayer(1000), 1000, () => 0.5);
  const second = engine.cultivate(first.player, 2000, () => 0.5);
  assert.equal(second.ok, false);
  assert.equal(second.code, "COOLDOWN");
});

test("a successful small tribulation advances one stage without a separate breakthrough command", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = 1;
  player.stageIndex = 0;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.tribulation(player, 1000, () => 0);
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.isRealmAdvance, false);
  assert.equal(result.player.stageIndex, 1);
  assert.equal(result.player.realmIndex, 1);
  assert.equal(result.player.spiritStones, 80);
  assert.equal(result.player.attack, 11);
  assert.equal(result.player.maxHp, 105);
});

test("major tribulation advances to the next realm and increases core stats", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = 1;
  player.stageIndex = engine.REALMS[1].stages.length - 1;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.tribulation(player, 1000, () => 0);
  assert.equal(result.success, true);
  assert.equal(result.isRealmAdvance, true);
  assert.equal(result.player.realmIndex, 2);
  assert.equal(result.player.stageIndex, 0);
  assert.equal(result.player.spiritStones, 50);
  assert.equal(result.player.attack, 15);
  assert.equal(result.player.defense, 8);
  assert.equal(result.player.maxHp, 125);
});

test("failed tribulation consumes stones and causes a setback", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = 1;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.tribulation(player, 1000, () => 0.99);
  assert.equal(result.ok, true);
  assert.equal(result.success, false);
  assert.equal(result.player.spiritStones, 80);
  assert.equal(result.player.cultivation, Math.floor(result.required * 0.8));
  assert.equal(result.player.hp, 85);
});

test("insufficient cultivation and insufficient stones block tribulation without spending", () => {
  const underLevel = engine.tribulation(engine.createPlayer(1000), 1000, () => 0);
  assert.equal(underLevel.ok, false);
  assert.equal(underLevel.code, "NOT_READY");

  const underFunded = engine.createPlayer(1000);
  underFunded.cultivation = engine.requiredCultivation(underFunded);
  underFunded.spiritStones = 0;
  const result = engine.tribulation(underFunded, 1000, () => 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "NEED_STONES");
  assert.equal(result.player.spiritStones, 0);
});

test("tribulation cooldown is enforced after an attempt", () => {
  const player = engine.createPlayer(1000);
  player.cultivation = engine.requiredCultivation(player);
  const first = engine.tribulation(player, 1000, () => 0);
  // After ascending, accumulate enough progress for the next threshold so the
  // cooldown branch is tested before the next NOT_READY branch.
  first.player.cultivation = engine.requiredCultivation(first.player);
  const second = engine.tribulation(first.player, 2000, () => 0);
  assert.equal(second.ok, false);
  assert.equal(second.code, "COOLDOWN");
});

test("Cửu Trọng Thiên Kiếp opens the True Immortal realm", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = 9;
  player.stageIndex = engine.REALMS[9].stages.length - 1;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.tribulation(player, 1000, () => 0);
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.isFinalTribulation, true);
  assert.equal(result.player.realmIndex, 10);
  assert.equal(result.player.stageIndex, 0);
  assert.equal(result.player.spiritStones, 20);
  assert.equal(result.player.maxHp, 200);
  assert.equal(result.player.attack, 30);
});

test("daily check-in is claimable once per Vietnam calendar day", () => {
  const player = engine.createPlayer(1_000_000);
  const first = engine.dailyCheckIn(player, 1_000_000);
  assert.equal(first.ok, true);
  assert.equal(engine.missionStatus(first.player, 1_000_000)[0].claimable, true);
  const second = engine.dailyCheckIn(first.player, 1_000_000 + 1000);
  assert.equal(second.ok, false);
  assert.equal(second.code, "ALREADY_CHECKED_IN");
});

test("daily practice missions award sect stones once and cannot be claimed twice", () => {
  let player = engine.createPlayer(1000);
  player = engine.dailyCheckIn(player, 1000).player;
  for (let i = 0; i < 6; i++) {
    const now = 1000 + i * 30_001;
    player = engine.cultivate(player, now, () => 0.5).player;
  }
  const status = engine.missionStatus(player, 1000 + 6 * 30_001);
  assert.deepEqual(status.filter((m) => m.claimable).map((m) => m.id), ["checkin", "cultivate_3", "cultivate_6"]);
  const claim = engine.claimMissions(player, 1000 + 6 * 30_001);
  assert.equal(claim.ok, true);
  assert.equal(claim.reward, 125);
  assert.equal(claim.player.sectStones, 125);
  const repeat = engine.claimMissions(claim.player, 1000 + 6 * 30_001);
  assert.equal(repeat.ok, false);
  assert.equal(repeat.code, "NO_REWARD");
});

test("fast cultivation spends sect stones for a separate cultivation bonus", () => {
  const player = engine.createPlayer(1000);
  player.sectStones = 60;
  const result = engine.fastCultivate(player, 1000);
  assert.equal(result.ok, true);
  assert.equal(result.cost, 30);
  assert.equal(result.gain, 100);
  assert.equal(result.player.sectStones, 30);
  assert.equal(result.player.cultivation, 100);
  const cooldown = engine.fastCultivate(result.player, 2000);
  assert.equal(cooldown.ok, false);
  assert.equal(cooldown.code, "COOLDOWN");
});

test("fast cultivation requires sect mission currency", () => {
  const result = engine.fastCultivate(engine.createPlayer(1000), 1000);
  assert.equal(result.ok, false);
  assert.equal(result.code, "NEED_SECT_STONES");
  assert.equal(result.missing, 30);
});

test("missions reset at the next UTC+7 day while lifetime cultivation is preserved", () => {
  const beforeMidnight = Date.parse("2026-11-11T16:59:00.000Z");
  const player = engine.createPlayer(beforeMidnight);
  player.missions.checkedIn = true;
  player.missions.cultivationCount = 5;
  player.missions.claimed = ["checkin"];
  const afterMidnight = Date.parse("2026-11-11T17:01:00.000Z");
  const normalized = engine.normalizePlayer(player, afterMidnight);
  assert.equal(normalized.missions.checkedIn, false);
  assert.equal(normalized.missions.cultivationCount, 0);
  assert.deepEqual(normalized.missions.claimed, []);
});

test("V3/V2 data migrates and legacy breakthrough cooldown is preserved as tribulation cooldown", () => {
  const player = engine.normalizePlayer({
    version: 3,
    realmIndex: 3,
    stageIndex: 2,
    cultivation: 321,
    spiritStones: 456,
    lastBreakthroughAt: 123456,
    sectStones: 7,
    pets: [{ id: "old-pet" }],
    activePetId: "old-pet",
    lastExploreAt: 123,
    discoveries: 4,
    inventory: { spiritFruit: 2, ancientShard: 1 }
  }, 200000);
  assert.equal(player.version, 4);
  assert.equal(player.realmIndex, 3);
  assert.equal(player.stageIndex, 2);
  assert.equal(player.cultivation, 321);
  assert.equal(player.spiritStones, 456);
  assert.equal(player.sectStones, 7);
  assert.equal(player.lastTribulationAt, 123456);
  assert.equal(player.sectId, engine.SECT.id);
  for (const key of ["pets", "activePetId", "lastExploreAt", "discoveries", "inventory", "lastBreakthroughAt"]) {
    assert.equal(key in player, false, key + " should be removed from V4 game state");
  }
});

test("maximum realm cannot advance beyond Tiên Đế Cửu Phẩm", () => {
  const player = engine.createPlayer(1000);
  player.realmIndex = engine.REALMS.length - 1;
  player.stageIndex = engine.REALMS[player.realmIndex].stages.length - 1;
  player.cultivation = engine.requiredCultivation(player);
  const result = engine.tribulation(player, 1000, () => 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "MAX_REALM");
  assert.equal(result.player.spiritStones, 100);
});
