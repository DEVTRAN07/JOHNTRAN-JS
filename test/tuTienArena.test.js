"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const arena = require("../core/games/tuTienArena");

function player(name, realm = "Luyện Khí") {
  return {
    displayName: name, realm, cultivation: 100,
    attack: 20, defense: 10, maxHp: 300, hp: 300,
    spiritStones: 50, arena: {}
  };
}

test("PvP challenge rejects self and creates a balanced invitation", () => {
  assert.equal(arena.createChallenge("1", "1", player("A"), player("A")).code, "INVALID_TARGET");
  const result = arena.createChallenge("1", "2", player("A"), player("B"));
  assert.equal(result.ok, true);
  assert.equal(result.challenge.status, "pending");
  assert.equal(result.challenge.fighters.length, 2);
});

test("battle enforces turn order and resolves a skill hit", () => {
  const challenge = arena.createChallenge("1", "2", player("A"), player("B")).challenge;
  const battle = arena.startBattle(challenge).battle;
  assert.equal(arena.takeTurn(battle, "2", "normal").code, "NOT_YOUR_TURN");
  const turn = arena.takeTurn(battle, "1", "skill", 0.5);
  assert.equal(turn.ok, true);
  assert.equal(turn.entry.skill, "Thiên Lôi Chưởng");
  assert.ok(turn.entry.damage > 0);
  assert.equal(battle.turnUid, "2");
});

test("battle handles insufficient qi and defensive recovery", () => {
  const challenge = arena.createChallenge("1", "2", player("A"), player("B")).challenge;
  const battle = arena.startBattle(challenge).battle;
  battle.fighters[0].qi = 5;
  assert.equal(arena.takeTurn(battle, "1", "ultimate").code, "LOW_QI");
  const defend = arena.takeTurn(battle, "1", "defend");
  assert.equal(defend.ok, true);
  assert.equal(defend.entry.action, "defend");
  assert.equal(battle.turnUid, "2");
});

test("winner rating and seasonal points are awarded only to enrolled users", () => {
  const winner = player("Winner"), loser = player("Loser");
  arena.ensureArena(winner).joinedSeason = arena.seasonId();
  const result = arena.settleRating(winner, loser);
  assert.equal(result.reward, 30);
  assert.equal(winner.arena.wins, 1);
  assert.equal(winner.arena.rating, 1025);
  assert.equal(winner.arena.seasonPoints, 30);
  assert.equal(loser.arena.losses, 1);
  assert.equal(loser.arena.rating, 985);
});

test("leaderboard sorts by rating and exposes PvP stats", () => {
  const rows = [
    { userId: "1", data: { tuTien: { ...player("Low"), arena: { rating: 900 } } } },
    { userId: "2", data: { tuTien: { ...player("High"), arena: { rating: 1300 } } } }
  ];
  assert.equal(arena.leaderboard(rows, "rating", 10)[0].uid, "2");
});

test("completed season is retained for a one-time reward claim", () => {
  const p = player("Season Winner");
  p.arena = { rating: 1100, seasonId: "2000-S01", joinedSeason: "2000-S01", seasonPoints: 90 };
  arena.ensureArena(p);
  assert.equal(p.arena.previousSeason.id, "2000-S01");
  assert.equal(p.arena.previousSeason.points, 90);
  assert.equal(p.arena.seasonPoints, 0);
});
