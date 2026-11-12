"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const counter = require("../plugins/events/topchatCounter");
const topchat = require("../plugins/commands/topchat");

test("topchat counter records group text/media and ignores commands and duplicates", async () => {
  global.config = { prefix: "/" };
  const rows = new Map();
  const Threads = {
    async getData(threadId) {
      return { threadId, data: rows.get(threadId) || {} };
    },
    async setData(threadId, data) {
      rows.set(threadId, { ...data });
    }
  };
  const threadId = "topchat-counter-regression";
  const ts = Date.now();

  const textEvent = {
    threadId,
    type: ThreadType.Group,
    isSelf: false,
    data: {
      uidFrom: "member-1",
      dName: "Member One",
      cliMsgId: "msg-text-1",
      content: "hello",
      msgType: "text",
      ts: String(ts)
    }
  };

  await counter.run({ event: textEvent, Threads, isSelf: false });
  await counter.run({ event: textEvent, Threads, isSelf: false });

  const commandEvent = {
    ...textEvent,
    data: { ...textEvent.data, cliMsgId: "msg-command-1", content: "/menu" }
  };
  await counter.run({ event: commandEvent, Threads, isSelf: false });

  const mediaEvent = {
    ...textEvent,
    data: {
      uidFrom: "member-2",
      dName: "Member Two",
      cliMsgId: "msg-media-1",
      content: "",
      msgType: "photo",
      ts: String(ts)
    }
  };
  await counter.run({ event: mediaEvent, Threads, isSelf: false });

  const saved = rows.get(threadId);
  assert.equal(saved.topchatCounts["member-1"].count, 1);
  assert.equal(saved.topchatCounts["member-1"].name, "Member One");
  assert.equal(saved.topchatCounts["member-2"].count, 1);
  assert.equal(saved.topchatCounts["member-2"].name, "Member Two");
  assert.ok(saved.topchatSeenMessageIds.includes("msg-text-1"));
  assert.ok(saved.topchatSeenMessageIds.includes("msg-media-1"));
});

test("topchat history cache applies the latest seen IDs to cached raw messages", async () => {
  const { historyCache, getCachedHistoryCounts } = topchat._test;
  historyCache.clear();
  let apiCalls = 0;
  const api = {
    async getGroupChatHistory() {
      apiCalls++;
      return {
        groupMsgs: [
          { data: { uidFrom: "u1", cliMsgId: "old-1", dName: "A", content: "hello", msgType: "text", ts: String(Date.now()) } },
          { data: { uidFrom: "u1", cliMsgId: "old-2", dName: "A", content: "world", msgType: "text", ts: String(Date.now()) } }
        ]
      };
    }
  };
  const date = require("../core/topchat/stats").vietnamDateKey();
  const first = await getCachedHistoryCounts(api, "topchat-cache-regression", date, "/", []);
  const second = await getCachedHistoryCounts(api, "topchat-cache-regression", date, "/", ["old-1"]);

  assert.equal(apiCalls, 1);
  assert.equal(first.counts.u1.count, 2);
  assert.equal(second.counts.u1.count, 1);
});

test("topchat history timeout returns control to the command without waiting for Zalo", async () => {
  const { historyCache, historyFlights, readHistoryWithinBudget } = topchat._test;
  historyCache.clear();
  historyFlights.clear();

  const result = await readHistoryWithinBudget(
    { getGroupChatHistory: () => new Promise(() => {}) },
    "topchat-timeout-regression",
    "2026-11-12",
    "/",
    [],
    25
  );
  assert.equal(result, null);
});
