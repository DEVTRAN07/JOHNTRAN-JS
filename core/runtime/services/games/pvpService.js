"use strict";
const arena = require("../../../games/tuTienArena");
module.exports = {
  SKILLS: arena.SKILLS,
  power: arena.power,
  ensureArena: arena.ensureArena,
  buildFighter: arena.buildFighter,
  createChallenge: arena.createChallenge,
  startBattle: arena.startBattle,
  takeTurn: arena.takeTurn,
  settleRating: arena.settleRating
};
