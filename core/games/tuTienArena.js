"use strict";

const REALM_POWER = {
  "Phàm Nhân": 1, "Luyện Khí": 2, "Trúc Cơ": 3, "Kim Đan": 4,
  "Nguyên Anh": 5, "Hóa Thần": 6, "Luyện Hư": 7, "Hợp Thể": 8,
  "Đại Thừa": 9, "Độ Kiếp": 10, "Chân Tiên": 11, "Tiên Đế": 12
};
const SKILLS = {
  normal: { name: "Phá Không Quyền", cost: 0, multiplier: 1 },
  skill: { name: "Thiên Lôi Chưởng", cost: 20, multiplier: 1.65 },
  ultimate: { name: "Cửu Trọng Kiếm Quyết", cost: 45, multiplier: 2.35 }
};
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const clone = (value) => JSON.parse(JSON.stringify(value));

function power(player = {}) {
  const realm = REALM_POWER[player.realm] || 1;
  const stats = player.stats || {};
  return Math.max(1, Math.floor(realm * 100 + (Number(player.attack) || Number(stats.attack) || 10) * 4 +
    (Number(player.defense) || Number(stats.defense) || 5) * 2 + Math.sqrt(Math.max(0, Number(player.cultivation) || 0))));
}
function ensureArena(player) {
  if (!player.arena || typeof player.arena !== "object") player.arena = {};
  const a = player.arena;
  a.rating = Math.max(0, Number(a.rating) || 1000);
  a.wins = Math.max(0, Number(a.wins) || 0);
  a.losses = Math.max(0, Number(a.losses) || 0);
  a.draws = Math.max(0, Number(a.draws) || 0);
  a.streak = Math.max(0, Number(a.streak) || 0);
  a.bestStreak = Math.max(a.streak, Number(a.bestStreak) || 0);
  a.seasonPoints = Math.max(0, Number(a.seasonPoints) || 0);
  return a;
}
function buildFighter(uid, player) {
  const stats = player.stats || {};
  const maxHp = Math.max(100, Number(player.maxHp) || 100 + (Number(stats.defense) || Number(player.defense) || 5) * 8);
  return {
    uid: String(uid),
    name: String(player.displayName || "Đạo hữu").slice(0, 40),
    avatarUrl: String(player.avatarUrl || ""),
    realm: String(player.realm || "Phàm Nhân"),
    power: power(player),
    attack: Math.max(1, Number(stats.attack) || Number(player.attack) || 10),
    defense: Math.max(0, Number(stats.defense) || Number(player.defense) || 5),
    maxHp, hp: maxHp, qi: 100, wins: ensureArena(player).wins
  };
}
function createChallenge(fromUid, toUid, fromPlayer, toPlayer, now = Date.now()) {
  if (!fromUid || !toUid || String(fromUid) === String(toUid)) return { ok: false, code: "INVALID_TARGET" };
  const a = buildFighter(fromUid, fromPlayer), b = buildFighter(toUid, toPlayer);
  const gap = Math.abs(a.power - b.power) / Math.max(a.power, b.power);
  if (gap > 0.65) return { ok: false, code: "POWER_GAP", gap };
  return {
    ok: true,
    challenge: {
      id: `pvp-${String(fromUid)}-${String(toUid)}-${now}`,
      fromUid: String(fromUid), toUid: String(toUid), createdAt: now,
      expiresAt: now + 120000, status: "pending", fighters: [a, b]
    }
  };
}
function startBattle(challenge, now = Date.now()) {
  if (!challenge || challenge.status !== "pending") return { ok: false, code: "INVALID_CHALLENGE" };
  if (now > challenge.expiresAt) return { ok: false, code: "EXPIRED" };
  const battle = {
    id: challenge.id, status: "active", round: 1, turnUid: challenge.fromUid,
    startedAt: now, expiresAt: now + 10 * 60 * 1000,
    fighters: clone(challenge.fighters), log: []
  };
  return { ok: true, battle };
}
function takeTurn(battle, uid, action = "attack", random = Math.random()) {
  if (!battle || battle.status !== "active") return { ok: false, code: "NO_BATTLE" };
  if (Date.now() > battle.expiresAt) return { ok: false, code: "EXPIRED" };
  if (String(uid) !== battle.turnUid) return { ok: false, code: "NOT_YOUR_TURN" };
  const fighters = battle.fighters;
  const index = fighters.findIndex((f) => f.uid === String(uid));
  const enemyIndex = index === 0 ? 1 : 0;
  const self = fighters[index], enemy = fighters[enemyIndex];
  const skill = SKILLS[action] || SKILLS.normal;
  if (self.qi < skill.cost) return { ok: false, code: "LOW_QI", required: skill.cost };
  self.qi -= skill.cost;
  let damage = 0, critical = false, dodged = false;
  if (action === "defend") {
    self.hp = clamp(self.hp + Math.floor(self.defense * 1.5), 0, self.maxHp);
    self.qi = clamp(self.qi + 12, 0, 100);
  } else {
    dodged = random < 0.12;
    critical = !dodged && random > 0.78;
    if (!dodged) {
      damage = Math.max(5, Math.floor((self.attack * skill.multiplier - enemy.defense * 0.35) * (critical ? 1.8 : 1)));
      enemy.hp = clamp(enemy.hp - damage, 0, enemy.maxHp);
    } else self.qi = clamp(self.qi + 8, 0, 100);
  }
  const entry = {
    round: battle.round, uid: self.uid, actor: self.name, target: enemy.name,
    action, skill: action === "defend" ? "Hộ Thể Cương Khí" : skill.name,
    damage, critical, dodged, hp: self.hp, enemyHp: enemy.hp, at: Date.now()
  };
  battle.log.push(entry);
  if (battle.log.length > 30) battle.log.shift();
  if (enemy.hp <= 0) {
    battle.status = "finished";
    battle.winnerUid = self.uid;
    battle.loserUid = enemy.uid;
    battle.finishedAt = Date.now();
    return { ok: true, battle, entry, finished: true, winner: self, loser: enemy };
  }
  battle.round += index === 1 ? 1 : 0;
  battle.turnUid = enemy.uid;
  return { ok: true, battle, entry, finished: false };
}
function settleRating(winner, loser) {
  const wa = ensureArena(winner), la = ensureArena(loser);
  wa.wins++; wa.streak++; wa.bestStreak = Math.max(wa.bestStreak, wa.streak);
  wa.rating += 25; wa.seasonPoints += 30;
  la.losses++; la.streak = 0; la.rating = Math.max(500, la.rating - 15);
  return { winnerRating: wa.rating, loserRating: la.rating, reward: 30 };
}
function leaderboard(players, metric = "rating", limit = 10) {
  const allowed = new Set(["rating", "wins", "power", "seasonPoints", "bestStreak"]);
  const key = allowed.has(metric) ? metric : "rating";
  return (players || []).filter((row) => row?.data?.tuTien).map((row) => {
    const p = row.data.tuTien, a = ensureArena(p);
    return {
      uid: String(row.userId), name: String(p.displayName || "Đạo hữu"),
      realm: String(p.realm || "Phàm Nhân"), avatarUrl: String(p.avatarUrl || ""),
      rating: a.rating, wins: a.wins, losses: a.losses,
      power: power(p), seasonPoints: a.seasonPoints, bestStreak: a.bestStreak,
      score: key === "power" ? power(p) : a[key]
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "vi")).slice(0, clamp(Number(limit) || 10, 1, 50));
}
function seasonId(date = new Date()) {
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const day = Math.floor((Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - start.getTime()) / 86400000);
  return `${year}-S${String(Math.floor(day / 7) + 1).padStart(2, "0")}`;
}
function contestStatus(players, now = new Date()) {
  const id = seasonId(now);
  const rows = leaderboard(players, "seasonPoints", 50).filter((row) => row.seasonPoints > 0);
  return { id, endsAt: new Date(now.getTime() + (7 - ((now.getUTCDay() + 1) % 7)) * 86400000), rows };
}
module.exports = {
  SKILLS, REALM_POWER, power, ensureArena, buildFighter, createChallenge,
  startBattle, takeTurn, settleRating, leaderboard, seasonId, contestStatus
};
