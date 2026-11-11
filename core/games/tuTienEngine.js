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

const PET_SPECIES = [
  { speciesId: "cloud_fox", name: "Vân Hồ", rarity: "Linh", attack: 3, defense: 5, description: "Linh hồ hấp thu linh khí mây núi." },
  { speciesId: "thunder_bird", name: "Lôi Điểu", rarity: "Địa", attack: 8, defense: 2, description: "Lôi điểu mang sức mạnh sấm sét." },
  { speciesId: "jade_turtle", name: "Huyền Quy", rarity: "Địa", attack: 2, defense: 10, description: "Linh thú hộ thể với mai ngọc." },
  { speciesId: "white_tiger", name: "Bạch Hổ", rarity: "Thiên", attack: 11, defense: 5, description: "Bạch hổ uy mãnh trấn giữ sơn lâm." },
  { speciesId: "phoenix", name: "Chu Tước", rarity: "Tiên", attack: 13, defense: 8, description: "Thần điểu tái sinh trong chân hỏa." }
];

const DEFAULT_PLAYER = Object.freeze({
  version: 2,
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
  lastExploreAt: 0,
  pets: [],
  activePetId: null,
  discoveries: 0,
  inventory: { spiritFruit: 0, ancientShard: 0 },
  createdAt: 0
});

function createPlayer(now = Date.now()) {
  return { ...DEFAULT_PLAYER, inventory: { ...DEFAULT_PLAYER.inventory }, pets: [], createdAt: now };
}

function normalizePlayer(input, now = Date.now()) {
  const player = { ...createPlayer(now), ...(input && typeof input === "object" ? input : {}) };
  player.realmIndex = Math.max(0, Math.min(REALMS.length - 1, Number(player.realmIndex) || 0));
  player.stageIndex = Math.max(0, Math.min(REALMS[player.realmIndex].stages.length - 1, Number(player.stageIndex) || 0));
  for (const key of ["cultivation", "spiritStones", "hp", "maxHp", "attack", "defense", "wins", "losses", "lastCultivateAt", "lastBreakthroughAt", "lastExploreAt", "discoveries"]) {
    player[key] = Math.max(0, Number(player[key]) || 0);
  }
  player.pets = Array.isArray(player.pets) ? player.pets.filter((pet) => pet && typeof pet === "object").slice(0, 12).map((pet) => ({
    id: String(pet.id || ""),
    speciesId: String(pet.speciesId || "cloud_fox"),
    name: String(pet.name || "Linh thú"),
    rarity: String(pet.rarity || "Linh"),
    level: Math.max(1, Number(pet.level) || 1),
    exp: Math.max(0, Number(pet.exp) || 0),
    attack: Math.max(0, Number(pet.attack) || 0),
    defense: Math.max(0, Number(pet.defense) || 0)
  })) : [];
  player.activePetId = player.pets.some((pet) => pet.id === String(player.activePetId)) ? String(player.activePetId) : (player.pets[0]?.id || null);
  const inventory = player.inventory && typeof player.inventory === "object" ? player.inventory : {};
  player.inventory = {
    spiritFruit: Math.max(0, Number(inventory.spiritFruit) || 0),
    ancientShard: Math.max(0, Number(inventory.ancientShard) || 0)
  };
  player.version = 2;
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

function activePet(playerInput) {
  const player = normalizePlayer(playerInput);
  return player.pets.find((pet) => pet.id === player.activePetId) || null;
}

function effectiveStats(playerInput) {
  const player = normalizePlayer(playerInput);
  const pet = activePet(player);
  return {
    attack: player.attack + (pet ? pet.attack + (pet.level - 1) * 2 : 0),
    defense: player.defense + (pet ? pet.defense + (pet.level - 1) : 0),
    pet
  };
}

function cultivate(playerInput, now = Date.now(), random = Math.random) {
  const player = normalizePlayer(playerInput, now);
  const cooldownMs = 30_000;
  const remaining = cooldownMs - (now - player.lastCultivateAt);
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
  if (player.stageIndex + 1 < currentRealm.stages.length) player.stageIndex += 1;
  else if (player.realmIndex + 1 < REALMS.length) {
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

function explore(playerInput, now = Date.now(), random = Math.random) {
  const player = normalizePlayer(playerInput, now);
  const remaining = 60_000 - (now - player.lastExploreAt);
  if (player.lastExploreAt > 0 && remaining > 0) return { ok: false, code: "COOLDOWN", remainingMs: remaining, player };
  player.lastExploreAt = now;
  player.discoveries += 1;
  const roll = random();

  if (roll < 0.25) {
    const gain = 20 + Math.floor(random() * 21);
    player.cultivation += gain;
    player.inventory.spiritFruit += 1;
    return { ok: true, event: "spirit_spring", player, cultivationGain: gain, fruitGain: 1 };
  }
  if (roll < 0.52) {
    const stats = effectiveStats(player);
    const enemyPower = 18 + player.realmIndex * 7 + Math.floor(random() * 12);
    const power = stats.attack + stats.defense;
    if (power >= enemyPower) {
      const stones = 15 + player.realmIndex * 3;
      player.spiritStones += stones;
      player.wins += 1;
      return { ok: true, event: "monster_win", player, enemyPower, power, stoneGain: stones };
    }
    const damage = Math.max(5, enemyPower - power);
    player.hp = Math.max(1, player.hp - damage);
    player.losses += 1;
    return { ok: true, event: "monster_loss", player, enemyPower, power, damage };
  }
  if (roll < 0.78) {
    const species = PET_SPECIES[Math.min(PET_SPECIES.length - 1, Math.floor(random() * PET_SPECIES.length))];
    const captured = player.pets.length < 12 && random() < 0.62;
    if (captured) {
      const id = `pet-${now}-${Math.floor(random() * 1_000_000)}`;
      const pet = { id, ...species, level: 1, exp: 0 };
      player.pets.push(pet);
      if (!player.activePetId) player.activePetId = id;
      return { ok: true, event: "pet_captured", player, pet };
    }
    return { ok: true, event: "pet_escaped", player, species };
  }

  const stones = 25 + player.realmIndex * 5;
  player.spiritStones += stones;
  player.inventory.ancientShard += 1;
  return { ok: true, event: "ancient_chest", player, stoneGain: stones, shardGain: 1 };
}

function feedPet(playerInput, petId = null) {
  const player = normalizePlayer(playerInput);
  const pet = player.pets.find((item) => item.id === String(petId || player.activePetId));
  if (!pet) return { ok: false, code: "NO_PET", player };
  if (player.spiritStones < 15) return { ok: false, code: "NEED_STONES", player };
  player.spiritStones -= 15;
  pet.exp += 30;
  const needed = pet.level * 30;
  let leveledUp = false;
  while (pet.exp >= needed && pet.level < 50) {
    pet.exp -= pet.level * 30;
    pet.level += 1;
    pet.attack += 2;
    pet.defense += 1;
    leveledUp = true;
  }
  return { ok: true, player, pet, leveledUp };
}

function activatePet(playerInput, petId) {
  const player = normalizePlayer(playerInput);
  const pet = player.pets.find((item) => item.id === String(petId || ""));
  if (!pet) return { ok: false, code: "NO_PET", player };
  player.activePetId = pet.id;
  return { ok: true, player, pet };
}

function tribulation(playerInput, now = Date.now(), random = Math.random) {
  const player = normalizePlayer(playerInput, now);
  const finalStage = REALMS[9].stages.length - 1;
  if (player.realmIndex !== 9 || player.stageIndex !== finalStage) {
    return { ok: false, code: "WRONG_REALM", player };
  }
  const required = requiredCultivation(player);
  if (player.cultivation < required) return { ok: false, code: "NOT_READY", missing: required - player.cultivation, required, player };
  const cost = 80;
  if (player.spiritStones < cost) return { ok: false, code: "NEED_STONES", player };
  const remaining = 120_000 - (now - player.lastBreakthroughAt);
  if (player.lastBreakthroughAt > 0 && remaining > 0) return { ok: false, code: "COOLDOWN", remainingMs: remaining, player };

  player.spiritStones -= cost;
  player.lastBreakthroughAt = now;
  const success = random() < 0.72;
  if (!success) {
    player.cultivation = Math.floor(player.cultivation * 0.65);
    player.hp = Math.max(1, player.hp - Math.ceil(player.maxHp * 0.35));
    return { ok: true, success: false, player, required, damage: Math.ceil(player.maxHp * 0.35) };
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
  REALMS, PET_SPECIES, createPlayer, normalizePlayer, realmLabel,
  requiredCultivation, activePet, effectiveStats, cultivate, breakthrough,
  explore, feedPet, activatePet, tribulation
};
