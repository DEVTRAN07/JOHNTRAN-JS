"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Reactions } = require("zalo-client");
const { FOLDER_REACTIONS, getFolderReaction } = require("../core/runtime/folderReaction");

test("each menu folder maps to a supported Zalo reaction", () => {
  assert.equal(getFolderReaction("game"), Reactions.COOL);
  assert.equal(getFolderReaction("music"), Reactions.LOVE);
  assert.equal(getFolderReaction("tools"), Reactions.OK);
  for (const [folder, reaction] of Object.entries(FOLDER_REACTIONS)) {
    assert.ok(Object.values(Reactions).includes(reaction), folder + " reaction is supported");
  }
});

test("unknown folder shortcuts use the normal like reaction", () => {
  assert.equal(getFolderReaction("unknown"), Reactions.LIKE);
});
