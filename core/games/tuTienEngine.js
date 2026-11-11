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

const SECT = Object.freeze({
  id: "devtran-tien-tong",
  name: "DEVTRAN TIÊN TÔNG",
  title: "Đệ Nhất Tiên Môn",
  description: "Tông môn duy nhất của thế giới Tiên Đạo Vô Hạn."
});

const DAILY_MISSIONS = Object.freeze([
  { id: "checkin", name: "Điểm danh tiên môn", target: 1, reward: 20, description: "Điểm danh một lần trong ngày." },
  { id: "cultivate_3", name: "Tĩnh tâm tu hành", target: 3, reward: 35, description: "Hoàn thành 3 lần tu luyện thường." },
  { id: "cultivate_6", name: "Bền chí cầu đạo", target: 6, reward: 70, description: "Hoàn thành 6 lần tu luyện thường." }
]);

const DEFAULT_PLAYER = Object.freeze({
  version: 4,
  displayName: "",
  avatarUrl: "",
  sectId: SECT.id,
  realmIndex: 0,
  stageIndex: 0,
  cultivation: 0,
  spiritStones: 100,
  sectStones: 0,
  hp: 100,
  maxHp: 100,
  attack: 10,
  defense: 5,
  wins: 0,
  losses: 0,
  lastCultivateAt: 0,
  lastTribulationAt: 0,
  lastFastCultivateAt: 0,
  missions: { dayKey: "", cultivationCount: 0, checkedIn: false, claimed: [] },
  createdAt: 0
});

const FAST_CULTIVATION_COST = 30;
const FAST_CULTIVATION_GAIN = 100;
const FAST_CULTIVATION_COOLDOWN_MS = 60_000;

function dayKeyAt(now = Date.now()) {
  // Daily reset uses Vietnam/Indochina time (UTC+7).
  return new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function createPlayer(now = Date.now(), identity = {}) {
  return {
    ...DEFAULT_PLAYER,
    displayName: String(identity.displayName || ""),
    avatarUrl: String(identity.avatarUrl || ""),
    missions: { dayKey: dayKeyAt(now), cultivationCount: 0, checkedIn: false, claimed: [] },
    createdAt: now
  };
}

function normalizePlayer(input, now = Date.now()) {
  const player = { ...createPlayer(now), ...(input && typeof input === "object" ? input : {}) };

  // Remove retired V2 features and V3 breakthrough cooldown fields.
  for (const key of ["pets", "activePetId", "lastExploreAt", "discoveries", "inventory", "lastBreakthroughAt"]) {
    delete player[key];
  }

  player.displayName = String(player.displayName || "");
  player.avatarUrl = String(player.avatarUrl || "");
  player.sectId = SECT.id;
  player.realmIndex = Math.max(0, Math.min(REALMS.length - 1, Number(player.realmIndex) || 0));
  player.stageIndex = Math.max(0, Math.min(REALMS[player.realmIndex].stages.length - 1, Number(player.stageIndex) || 0));

  for (const key of [
    "cultivation", "spiritStones", "sectStones", "hp", "maxHp", "attack",
    "defense", "wins", "losses", "lastCultivateAt", "lastTribulationAt",
    "lastFastCultivateAt"
  ]) {
    const legacy = key === "lastTribulationAt" ? player.lastBreakthroughAt : undefined;
    player[key] = Math.max(0, Number(player[key] ?? legacy) || 0);
  }

  const savedMissions = player.missions && typeof player.missions === "object" ? player.missions : {};
  const currentDay = dayKeyAt(now);
  if (savedMissions.dayKey !== currentDay) {
    player.missions = { dayKey: currentDay, cultivationCount: 0, checkedIn: false, claimed: [] };
  } else {
    player.missions = {
      dayKey: currentDay,
      cultivationCount: Math.max(0, Number(savedMissions.cultivationCount) || 0),
      checkedIn: Boolean(savedMissions.checkedIn),
      claimed: Array.isArray(savedMissions.claimed) ? [...new Set(savedMissions.claimed.map(String))] : []
    };
  }
  player.version = 4;
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
  if (player.lastCultivateAt > 0 && remaining > 0) {
    return { ok: false, code: "COOLDOWN", remainingMs: remaining, player };
  }

  const gain = 18 + Math.floor(player.realmIndex * 2) + Math.floor(random() * 13);
  player.cultivation += gain;
  player.spiritStones += 3;
  player.missions.cultivationCount += 1;
  player.lastCultivateAt = now;
  return { ok: true, gain, player, required: requiredCultivation(player) };
}

function fastCultivate(playerInput, now = Date.now()) {
  const player = normalizePlayer(playerInput, now);
  const remaining = FAST_CULTIVATION_COOLDOWN_MS - (now - player.lastFastCultivateAt);
  if (player.lastFastCultivateAt > 0 && remaining > 0) {
    return { ok: false, code: "COOLDOWN", remainingMs: remaining, player };
  }
  if (player.sectStones < FAST_CULTIVATION_COST) {
    return { ok: false, code: "NEED_SECT_STONES", missing: FAST_CULTIVATION_COST - player.sectStones, player };
  }

  const gain = FAST_CULTIVATION_GAIN + player.realmIndex * 5;
  player.sectStones -= FAST_CULTIVATION_COST;
  player.cultivation += gain;
  player.lastFastCultivateAt = now;
  return { ok: true, gain, cost: FAST_CULTIVATION_COST, player, required: requiredCultivation(player) };
}

function missionStatus(playerInput, now = Date.now()) {
  const player = normalizePlayer(playerInput, now);
  return DAILY_MISSIONS.map((mission) => {
    const progress = mission.id === "checkin"
      ? (player.missions.checkedIn ? 1 : 0)
      : Math.min(mission.target, player.missions.cultivationCount);
    const complete = progress >= mission.target;
    const claimed = player.missions.claimed.includes(mission.id);
    return { ...mission, progress, complete, claimed, claimable: complete && !claimed };
  });
}

function dailyCheckIn(playerInput, now = Date.now()) {
  const player = normalizePlayer(playerInput, now);
  if (player.missions.checkedIn) return { ok: false, code: "ALREADY_CHECKED_IN", player };
  player.missions.checkedIn = true;
  return { ok: true, player, mission: missionStatus(player, now)[0] };
}

function claimMissions(playerInput, now = Date.now()) {
  const player = normalizePlayer(playerInput, now);
  const claimable = missionStatus(player, now).filter((mission) => mission.claimable);
  if (!claimable.length) return { ok: false, code: "NO_REWARD", player };

  const reward = claimable.reduce((sum, mission) => sum + mission.reward, 0);
  player.missions.claimed.push(...claimable.map((mission) => mission.id));
  player.sectStones += reward;
  return { ok: true, player, claimed: claimable, reward };
}

function tribulation(playerInput, now = Date.now(), random = Math.random) {
  const player = normalizePlayer(playerInput, now);
  const required = requiredCultivation(player);
  if (player.cultivation < required) {
    return { ok: false, code: "NOT_READY", missing: required - player.cultivation, required, player };
  }

  const currentRealm = REALMS[player.realmIndex];
  const isRealmAdvance = player.stageIndex === currentRealm.stages.length - 1;
  const isFinalTribulation = player.realmIndex === 9 && isRealmAdvance;
  const isAtMaxRealm = player.realmIndex === REALMS.length - 1 && isRealmAdvance;
  if (isAtMaxRealm) return { ok: false, code: "MAX_REALM", player };

  const cost = isFinalTribulation ? 80 : isRealmAdvance ? 50 : 20;
  if (player.spiritStones < cost) {
    return { ok: false, code: "NEED_STONES", missing: cost - player.spiritStones, cost, player };
  }

  const cooldownMs = isFinalTribulation ? 120_000 : isRealmAdvance ? 90_000 : 60_000;
  const remaining = cooldownMs - (now - player.lastTribulationAt);
  if (player.lastTribulationAt > 0 && remaining > 0) {
    return { ok: false, code: "COOLDOWN", remainingMs: remaining, player };
  }

  player.spiritStones -= cost;
  player.lastTribulationAt = now;

  const chance = isFinalTribulation
    ? 0.72
    : Math.max(0.62, 0.92 - player.realmIndex * 0.025 - (isRealmAdvance ? 0.08 : 0));
  const success = random() < chance;

  if (!success) {
    const cultivationLoss = isFinalTribulation ? 0.35 : 0.2;
    const hpLoss = isFinalTribulation ? 0.35 : 0.15;
    player.cultivation = Math.floor(player.cultivation * (1 - cultivationLoss));
    const damage = Math.ceil(player.maxHp * hpLoss);
    player.hp = Math.max(1, player.hp - damage);
    return { ok: true, success: false, player, required, cost, damage, isRealmAdvance, isFinalTribulation };
  }

  const previousRealm = realmLabel(player);
  player.cultivation -= required;
  if (isRealmAdvance) {
    player.realmIndex += 1;
    player.stageIndex = 0;
    player.maxHp += isFinalTribulation ? 100 : 25;
    player.attack += isFinalTribulation ? 20 : 5;
    player.defense += isFinalTribulation ? 15 : 3;
    player.hp = player.maxHp;
  } else {
    player.stageIndex += 1;
    player.maxHp += 5;
    player.attack += 1;
    player.defense += 1;
    player.hp = Math.min(player.maxHp, player.hp + 10);
  }

  return {
    ok: true,
    success: true,
    player,
    required,
    cost,
    previousRealm,
    newRealm: realmLabel(player),
    isRealmAdvance,
    isFinalTribulation
  };
}

module.exports = {
  REALMS,
  SECT,
  DAILY_MISSIONS,
  DEFAULT_PLAYER,
  FAST_CULTIVATION_COST,
  FAST_CULTIVATION_GAIN,
  createPlayer,
  normalizePlayer,
  realmLabel,
  requiredCultivation,
  effectiveStats,
  cultivate,
  fastCultivate,
  missionStatus,
  dailyCheckIn,
  claimMissions,
  tribulation,
  dayKeyAt
};
