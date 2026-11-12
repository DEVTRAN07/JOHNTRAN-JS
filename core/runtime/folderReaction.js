"use strict";

const { Reactions } = require("zalo-client");

// Zalo has no dedicated game-pad reaction; COOL is the closest built-in icon.
const FOLDER_REACTIONS = Object.freeze({
  info: Reactions.WOW,
  public: Reactions.LIKE,
  music: Reactions.LOVE,
  game: Reactions.COOL,
  tools: Reactions.OK,
  test: Reactions.NERD,
  anti: Reactions.ANGRY,
  manager: Reactions.HANDCLAP,
  admin: Reactions.RICH,
  mybot: Reactions.NERD,
  hidden: Reactions.SURPRISE
});

function getFolderReaction(slug) {
  return FOLDER_REACTIONS[String(slug || "").trim().toLowerCase()] || Reactions.LIKE;
}

module.exports = { FOLDER_REACTIONS, getFolderReaction };
