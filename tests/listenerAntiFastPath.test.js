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


test("command moderation skips disabled Guard and Anti but preserves enabled protections", () => {
  const resolveSkips = listener.resolveMessageModerationSkips;
  const noProtections = {
    threadId: "moderation-off",
    data: { anti_link: false, anti_word: false, anti_spam: false, event_guard: false }
  };
  assert.deepEqual(resolveSkips({
    isGroupThread: true,
    threadData: noProtections,
    threadInfo: noProtections.data,
    antiCommand: anti
  }), { skipAnti: true, skipGuard: true });

  const antiOnly = {
    threadId: "moderation-anti-on",
    data: { anti_link: true, event_guard: false }
  };
  assert.deepEqual(resolveSkips({
    isGroupThread: true,
    threadData: antiOnly,
    threadInfo: antiOnly.data,
    antiCommand: anti
  }), { skipAnti: false, skipGuard: true });

  const guardOnly = {
    threadId: "moderation-guard-on",
    data: { anti_link: false, event_guard: true }
  };
  assert.deepEqual(resolveSkips({
    isGroupThread: true,
    threadData: guardOnly,
    threadInfo: guardOnly.data,
    antiCommand: anti
  }), { skipAnti: true, skipGuard: false });
});

test("command moderation fails open for groups without a trusted settings snapshot", () => {
  assert.deepEqual(listener.resolveMessageModerationSkips({
    isGroupThread: true,
    threadData: null,
    antiCommand: anti
  }), { skipAnti: false, skipGuard: false });
  assert.deepEqual(listener.resolveMessageModerationSkips({
    isGroupThread: false,
    threadData: null,
    antiCommand: anti
  }), { skipAnti: true, skipGuard: true });
});

test.after(() => {
  global.client = previousClient;
});


test("inactive Anti is marked checked so passive dispatch does not invoke it a second time", async () => {
  global.client = { commands: new Map([["anti", anti]]) };
  const record = {
    threadId: "listener-anti-checked-off",
    data: { bot_enabled: true, anti_link: false, anti_spam: false }
  };
  let cacheReads = 0;
  let gameCalls = 0;

  const result = await listener.dispatchGroupMessageBeforeGame({
    api: {},
    event: {
      threadId: record.threadId,
      type: ThreadType.Group,
      data: { uidFrom: "member-1", content: "ordinary message" }
    },
    Threads: {
      getCachedData() { cacheReads++; return record; },
      async getData() { throw new Error("snapshot is already available"); }
    },
    threadData: record,
    async gameDispatcher() {
      gameCalls++;
      return false;
    }
  });

  assert.equal(result.antiDispatched, false);
  assert.equal(result.antiChecked, true);
  assert.equal(result.consumed, false);
  assert.equal(gameCalls, 1);
  assert.equal(cacheReads, 0);
});


test("listener records separate Anti and active-game dispatch latency", async () => {
  const metrics = require("../core/metrics");
  const before = new Map(
    metrics.getListenerStageLatencyStats(100).map(item => [item.command, item.count])
  );
  const result = await listener.dispatchGroupMessageBeforeGame({
    api: {},
    event: {
      threadId: "listener-stage-latency",
      type: ThreadType.Group,
      data: { uidFrom: "member-1", content: "ordinary chat" }
    },
    Threads: {},
    threadData: { data: {} },
    async antiDispatcher() {
      await Promise.resolve();
      return { checked: true, dispatched: false, consumed: false };
    },
    async gameDispatcher() {
      await Promise.resolve();
      return false;
    }
  });

  assert.equal(result.consumed, false);
  const after = new Map(
    metrics.getListenerStageLatencyStats(100).map(item => [item.command, item.count])
  );
  assert.ok((after.get("anti-before-game") || 0) > (before.get("anti-before-game") || 0));
  assert.ok((after.get("active-game-dispatch") || 0) > (before.get("active-game-dispatch") || 0));
});
