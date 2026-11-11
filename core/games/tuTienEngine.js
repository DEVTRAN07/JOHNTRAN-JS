"use strict";

const REALMS = [
  { name: "Phàm Nhân", stages: ["Nhập môn"] },
  { name: "Luyện Khí", stages: ["Nhất tầng", "Nhị tầng", "Tam tầng", "Tứ tầng", "Ngũ tầng", "Lục tầng", "Thất tầng", "Bát tầng", "Cửu tầng"] },
  { name: "Trúc Cơ", stages: ["Sơ kỳ", "Trung kỳ", "Hậu kỳ", "Đại viên mãn"] },
  { name: "Kim Đan", stages: ["Sơ kỳ", "Trung kỳ", "Hậu kỳ", "Đại viên mãn"] },
  { name: "Nguyên Anh", stages: ["Sơ kỳ", "Trung kỳ", "Hậu kỳ", "Đại viên mãn"] },
  { name: "Hóa Thần", stages: ["Sơ kỳ", "Trung kỳ", "Hậu kỳ", "Đại viên mãn"] },
  { name: "Luyện Hư", stages: ["Sơ kỳ", "Trung kỳ", "Hậu kỳ", "Đại viên mãn"] },
  { name: "Hợp Thể", stages: ["Sơ kỳ", "Trung kỳ", "Hậu kỳ", "Đại viên mãn"] },
  { name: "Đại Thừa", stages: ["Sơ kỳ", "Trung kỳ", "Hậu kỳ", "Đại viên mãn"] },
  { name: "Độ Kiếp", stages: ["Nhất trọng", "Nhị trọng", "Tam trọng", "Tứ trọng", "Ngũ trọng", "Lục trọng", "Thất trọng", "Bát trọng", "Cửu trọng"] },
  { name: "Chân Tiên", stages: ["Sơ cảnh", "Trung cảnh", "Hậu cảnh", "Viên mãn"] },
  { name: "Tiên Đế", stages: ["Nhất phẩm", "Nhị phẩm", "Tam phẩm", "Tứ phẩm", "Ngũ phẩm", "Lục phẩm", "Thất phẩm", "Bát phẩm", "Cửu phẩm"] }
];

const DEFAULT_PLAYER = Object.freeze({
  version: 3,
  realmIndex: 0,
  stageIndex: 0,
  cultivation: 0,
  spiritStones: 100,
  hp: 100,
  maxHp: 100,
  attack: 10,
  defense: 5,
  wins: 0,
  losses: 0,
  lastCultivateAt: 0,
  lastBreakthroughAt: 0,
  createdAt: 0
});

function createPlayer(now = Date.now()) {
  return { ...DEFAULT_PLAYER, createdAt: now };
}

function normalizePlayer(input, now = Date.now()) {
  const player = { ...createPlayer(now), ...(input && typeof input === "object" ? input : {}) };

  // V2 stored pets/secret-realm loot. Those systems are intentionally removed in V3.
  for (const key of ["pets", "activePetId", "lastExploreAt", "discoveries", "inventory"]) {
    delete player[key];
  }

  player.realmIndex = Math.max(0, Math.min(REALMS.length - 1, Number(player.realmIndex) || 0));
  player.stageIndex = Math.max(0, Math.min(REALMS[player.realmIndex].stages.length - 1, Number(player.stageIndex) || 0));
  for (const key of ["cultivation", "spiritStones", "hp", "maxHp", "attack", "defense", "wins", "losses", "lastCultivateAt", "lastBreakthroughAt"]) {
    player[key] = Math.max(0, Number(player[key]) || 0);
  }
  player.version = 3;
  return player;
}

function realmLabel(playerInput) {
  const player = normalizePlayer(playerInput);
  const realm = REALMS[player.realmIndex];
  return realm ? `${realm.name} · ${realm.stages[player.stageIndex]}` : "Phàm Nhân";
}

function requiredCultivation(playerInput) {
  const player = normalizePlayer(playerInput);
  return 100 + player.realmIndex * 65 + player.stageIndex * 35;
}

function effectiveStats(playerInput) {
  const player = normalizePlayer(playerInput);
  return { attack: player.attack, defense: player.defense };
}

function cultivate(playerInput, now = Date.now(), random = Math.random) {
  const player = normalizePlayer(playerInput, now);
  const remaining = 30_000 - (now - player.lastCultivateAt);
  if (player.lastCultivateAt > 0 && remaining > 0) return { ok: false, code: "COOLDOWN", remainingMs: remaining, player };

  const gain = 18 + Math.floor(player.realmIndex * 2) + Math.floor(random() * 13);
  player.cultivation += gain;
  player.spiritStones += 3;
  player.lastCultivateAt = now;
  return { ok: true, gain, player, required: requiredCultivation(player) };
}

function breakthrough(playerInput, now = Date.now(), random = Math.random) {
  const player = normalizePlayer(playerInput, now);
  const required = requiredCultivation(player);
  if (player.realmIndex === 9 && player.stageIndex === REALMS[9].stages.length - 1) {
    return { ok: false, code: "TRIBULATION_REQUIRED", player };
  }
  if (player.cultivation < required) return { ok: false, code: "NOT_READY", missing: required - player.cultivation, required, player };
  if (player.spiritStones < 20) return { ok: false, code: "NEED_STONES", player };
  const remaining = 60_000 - (now - player.lastBreakthroughAt);
  if (player.lastBreakthroughAt > 0 && remaining > 0) return { ok: false, code: "COOLDOWN", remainingMs: remaining, player };

  player.spiritStones -= 20;
  player.lastBreakthroughAt = now;
  const success = random() < Math.max(0.55, 0.88 - player.realmIndex * 0.025);
  if (!success) {
    player.cultivation = Math.floor(player.cultivation * 0.8);
    player.hp = Math.max(1, player.hp - Math.ceil(player.maxHp * 0.15));
    return { ok: true, success: false, player, required };
  }

  player.cultivation -= required;
  const currentRealm = REALMS[player.realmIndex];
  if (player.stageIndex + 1 < currentRealm.stages.length) {
    player.stageIndex += 1;
  } else if (player.realmIndex + 1 < REALMS.length) {
    player.realmIndex += 1;
    player.stageIndex = 0;
    player.maxHp += 25;
    player.attack += 5;
    player.defense += 3;
    player.hp = player.maxHp;
  } else {
    player.cultivation = required;
    return { ok: true, success: false, maxRealm: true, player, required };
  }
  return { ok: true, success: true, player, required };
}

function tribulation(playerInput, now = Date.now(), random = Math.random) {
  const player = normalizePlayer(playerInput, now);
  const finalStage = REALMS[9].stages.length - 1;
  if (player.realmIndex !== 9 || player.stageIndex !== finalStage) return { ok: false, code: "WRONG_REALM", player };

  const required = requiredCultivation(player);
  if (player.cultivation < required) return { ok: false, code: "NOT_READY", missing: required - player.cultivation, required, player };
  if (player.spiritStones < 80) return { ok: false, code: "NEED_STONES", player };
  const remaining = 120_000 - (now - player.lastBreakthroughAt);
  if (player.lastBreakthroughAt > 0 && remaining > 0) return { ok: false, code: "COOLDOWN", remainingMs: remaining, player };

  player.spiritStones -= 80;
  player.lastBreakthroughAt = now;
  const success = random() < 0.72;
  if (!success) {
    player.cultivation = Math.floor(player.cultivation * 0.65);
    const damage = Math.ceil(player.maxHp * 0.35);
    player.hp = Math.max(1, player.hp - damage);
    return { ok: true, success: false, player, required, damage };
  }

  player.cultivation -= required;
  player.realmIndex = 10;
  player.stageIndex = 0;
  player.maxHp += 100;
  player.attack += 20;
  player.defense += 15;
  player.hp = player.maxHp;
  return { ok: true, success: true, player, required };
}

module.exports = {
  REALMS, createPlayer, normalizePlayer, realmLabel, requiredCultivation,
  effectiveStats, cultivate, breakthrough, tribulation
};
