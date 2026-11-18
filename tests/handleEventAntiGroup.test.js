"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const handleEvent = require("../core/handle/handleEvent");

test("group undo payload without type is still guarded as a group event", () => {
  assert.equal(handleEvent._test.isGroupEventPayload("undo", {
    threadId:"group", isGroup:true, data:{}
  }), true);
  assert.equal(handleEvent._test.isGroupEventPayload("undo", {
    threadId:"private", isGroup:false, data:{}
  }), false);
  assert.equal(handleEvent._test.isGroupEventPayload("message", {
    threadId:"group", type:ThreadType.Group, data:{}
  }), true);
});


test("handleEvent reuses the listener group snapshot for group state and event plugin context", async () => {
  const previousClient = global.client;
  const Threads = require("../core/runtime/services/threadService");
  const originalGetCachedData = Threads.getCachedData;
  let cacheReads = 0;
  let receivedSnapshot = null;
  const snapshot = {
    threadId: "handle-event-listener-snapshot",
    data: { bot_enabled: true, event_rank: true }
  };
  let topchatCalls = 0;
  const eventModule = {
    config: { event_type: ["message"] },
    async run({ threadData }) {
      receivedSnapshot = threadData;
    }
  };
  const topchatModule = {
    config: { name: "topchatCounter", event_type: ["message"] },
    async run() { topchatCalls++; }
  };

  Threads.getCachedData = () => {
    cacheReads++;
    throw new Error("group snapshot should be reused");
  };
  global.client = {
    events: new Map([["snapshot-test", eventModule], ["topchatCounter", topchatModule]]),
    commands: new Map()
  };

  try {
    await handleEvent("message", {
      threadId: snapshot.threadId,
      type: ThreadType.Group,
      data: { uidFrom: "member-1", content: "hello" }
    }, {}, false, { threadData: snapshot, skipTopchatCounter: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(receivedSnapshot, snapshot);
    assert.equal(topchatCalls, 0, "Top Chat is already counted by the listener's direct fast path");
    assert.equal(cacheReads, 0);
  } finally {
    global.client = previousClient;
    Threads.getCachedData = originalGetCachedData;
  }
});


test("Nối Từ group setting check reuses a supplied thread snapshot", () => {
  const noitu = require("../plugins/commands/noitu");
  let cacheReads = 0;
  const Threads = {
    getCachedData() {
      cacheReads++;
      throw new Error("should not need the cache when a snapshot is supplied");
    }
  };
  assert.equal(noitu._test.isNoituEnabled(Threads, "noitu-snapshot", {
    data: { noitu_enabled: false }
  }), false);
  assert.equal(cacheReads, 0);
});


test("handleEvent skips duplicate noitu/tlmn event wrappers after listener game dispatch", async () => {
  const previousClient = global.client;
  const Threads = require("../core/runtime/services/threadService");
  const originalGetCachedData = Threads.getCachedData;
  const snapshot = {
    threadId: "handle-event-skip-games",
    data: { bot_enabled: true }
  };
  const called = [];
  const moduleFor = name => ({
    config: { event_type: ["message"] },
    async run() { called.push(name); }
  });

  Threads.getCachedData = () => {
    throw new Error("listener snapshot should be reused");
  };
  global.client = {
    events: new Map([
      ["noitu", moduleFor("noitu")],
      ["tlmn", moduleFor("tlmn")],
      ["caro", moduleFor("caro")],
      ["sam", moduleFor("sam")]
    ]),
    commands: new Map()
  };

  try {
    await handleEvent("message", {
      threadId: snapshot.threadId,
      type: ThreadType.Group,
      data: { uidFrom: "member-1", content: "hello" }
    }, {}, false, { threadData: snapshot, skipGameConsumers: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(called, ["caro", "sam"]);
  } finally {
    global.client = previousClient;
    Threads.getCachedData = originalGetCachedData;
  }
});
