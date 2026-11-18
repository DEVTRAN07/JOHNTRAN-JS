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
  const eventModule = {
    config: { event_type: ["message"] },
    async run({ threadData }) {
      receivedSnapshot = threadData;
    }
  };

  Threads.getCachedData = () => {
    cacheReads++;
    throw new Error("group snapshot should be reused");
  };
  global.client = {
    events: new Map([["snapshot-test", eventModule]]),
    commands: new Map()
  };

  try {
    await handleEvent("message", {
      threadId: snapshot.threadId,
      type: ThreadType.Group,
      data: { uidFrom: "member-1", content: "hello" }
    }, {}, false, { threadData: snapshot });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(receivedSnapshot, snapshot);
    assert.equal(cacheReads, 0);
  } finally {
    global.client = previousClient;
    Threads.getCachedData = originalGetCachedData;
  }
});
