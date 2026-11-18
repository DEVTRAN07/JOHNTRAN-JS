"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const anti = require("../plugins/commands/anti");
const listener = require("../core/listen");

const previousClient = global.client;

test("listener skips Anti wrapper creation when the group has no active message protections", async () => {
  global.client = { commands: new Map([["anti", anti]]) };
  const api = new Proxy({}, {
    get() {
      throw new Error("Zalo API wrapper should not be touched for inactive Anti");
    }
  });
  const record = {
    threadId: "listener-anti-off",
    data: { bot_enabled: true, anti_link: false, anti_spam: false }
  };
  let cacheReads = 0;

  const result = await listener.dispatchAntiMessageBeforeGame({
    api,
    event: { threadId: record.threadId, type: ThreadType.Group, data: { content: "hello" } },
    Threads: { getCachedData() { cacheReads++; return record; } },
    threadData: record
  });

  assert.equal(result.dispatched, false);
  assert.equal(result.skipped, true);
  assert.equal(cacheReads, 0, "the listener should reuse its already-loaded group snapshot");
});

test("listener reuses active Anti group snapshot instead of reading it again", async () => {
  global.client = { commands: new Map([["anti", anti]]) };
  const record = {
    threadId: "listener-anti-on",
    data: { bot_enabled: true, anti_word: true }
  };
  let cacheReads = 0;
  const api = {
    async sendMessage() { return {}; },
    async addReaction() { return {}; },
    async getGroupInfo() { return { gridInfoMap: {} }; },
    async getOwnId() { return "bot-id"; }
  };

  const result = await listener.dispatchAntiMessageBeforeGame({
    api,
    event: {
      threadId: record.threadId,
      type: ThreadType.Group,
      data: { uidFrom: "member-1", dName: "Member", content: "hello" }
    },
    Threads: { getCachedData() { cacheReads++; return record; } },
    threadData: record
  });

  assert.equal(result.dispatched, true);
  assert.equal(cacheReads, 0, "Anti should use the listener's snapshot instead of another cache lookup");
});

test.after(() => {
  global.client = previousClient;
});
