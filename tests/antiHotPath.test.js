"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const anti = require("../plugins/commands/anti");

test("Anti skips disabled message protection before queueing or checking the bot key", async () => {
  const previousConfig = global.config;
  const previousUsers = global.users;
  global.config = { prefix: "/", allow_self_anti: false };
  global.users = { admin: [], support: [] };

  let groupInfoCalls = 0;
  let databaseReads = 0;
  const Threads = {
    getCachedData() {
      return {
        data: {
          anti_nude: false,
          anti_danger_link: false,
          anti_sticker_spam: false,
          anti_link: false,
          anti_spam: false,
          anti_card: false,
          anti_doodle: false,
          anti_file: false,
          anti_gif: false,
          anti_location: false,
          anti_other: false,
          anti_photo: false,
          anti_qr: false,
          anti_sticker: false,
          anti_taghide: false,
          anti_video: false,
          anti_voice: false,
          anti_word: false,
          anti_join: true,
          anti_reaction: true,
          anti_undo: true
        }
      };
    },
    async getData() { databaseReads++; return { data: {} }; }
  };
  const api = {
    async getGroupInfo() {
      groupInfoCalls++;
      return { gridInfoMap: { "anti-hot-path": { creatorId: "bot", adminIds: [] } } };
    },
    async getOwnId() { return "bot"; }
  };

  try {
    await anti.handleEvent({
      api,
      Threads,
      eventType: "message",
      isSelf: false,
      event: {
        threadId: "anti-hot-path",
        type: ThreadType.Group,
        data: { uidFrom: "member", content: "hello" }
      }
    });
    assert.equal(databaseReads, 0, "cached settings are sufficient for the inactive message path");
    assert.equal(groupInfoCalls, 0, "Anti-Join/Reaction/Undo switches must not trigger a message bot-key lookup");
  } finally {
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});
