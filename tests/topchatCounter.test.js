"use strict";

const { test, after } = require("node:test");
const workerPool = require("../core/workerPool");

after(async () => {
  await workerPool.shutdown();
});
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const counter = require("../plugins/events/topchatCounter");
const topchat = require("../plugins/commands/topchat");
const { vietnamDateKey } = require("../core/topchat/stats");

function makeGroupMessage(threadId, uid, id, content, extra = {}) {
  return {
    type: ThreadType.Group,
    threadId,
    isSelf: false,
    data: {
      idTo: threadId,
      uidFrom: uid,
      dName: uid,
      cliMsgId: id,
      content,
      msgType: extra.msgType || "text",
      ts: String(extra.ts ?? Date.now()),
      ...extra.data
    }
  };
}

function fakeThreads(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([key, data]) => [key, { threadId: key, data }]));
  return {
    rows,
    async getData(threadId) {
      return rows.get(String(threadId)) || { threadId: String(threadId), data: {} };
    },
    getCachedData(threadId) {
      return rows.get(String(threadId)) || null;
    },
    async setData(threadId, data) {
      this.writeCount = (this.writeCount || 0) + 1;
      rows.set(String(threadId), { threadId: String(threadId), data: { ...data } });
    }
  };
}

test("topchat counter records group text/media and ignores commands and duplicates", async () => {
  global.config = { prefix: "/" };
  const Threads = fakeThreads();
  const threadId = "topchat-counter-regression";

  const textEvent = makeGroupMessage(threadId, "member-1", "msg-text-1", "hello");
  await counter.run({ event: textEvent, Threads, isSelf: false });
  await counter.run({ event: textEvent, Threads, isSelf: false });

  const commandEvent = makeGroupMessage(threadId, "member-1", "msg-command-1", "/menu");
  await counter.run({ event: commandEvent, Threads, isSelf: false });

  const mediaEvent = makeGroupMessage(threadId, "member-2", "msg-media-1", "", { msgType: "photo" });
  await counter.run({ event: mediaEvent, Threads, isSelf: false });
  await counter.flushAll(Threads);

  const saved = Threads.rows.get(threadId).data;
  assert.equal(saved.topchatCounts["member-1"].count, 1);
  assert.equal(saved.topchatCounts["member-1"].name, "member-1");
  assert.equal(saved.topchatCounts["member-2"].count, 1);
  assert.ok(saved.topchatSeenMessageIds.includes("msg-text-1"));
  assert.ok(saved.topchatSeenMessageIds.includes("msg-media-1"));
});

test("topchat imports all today's old group messages from WebSocket in one batch", async () => {
  global.config = { prefix: "/" };
  const Threads = fakeThreads();
  const threadId = "topchat-ws-history-regression";
  const today = vietnamDateKey();
  const now = Date.now();

  const messages = [
    makeGroupMessage(threadId, "u1", "old-1", "xin chao", { ts: now - 60000 }),
    makeGroupMessage(threadId, "u1", "old-2", "tin thu hai", { ts: now - 50000 }),
    makeGroupMessage(threadId, "u2", "old-3", "", { msgType: "photo", ts: now - 40000 }),
    makeGroupMessage(threadId, "u3", "yesterday", "hom qua", {
      ts: now - 86400000
    }),
    makeGroupMessage(threadId, "u3", "command", "/menu", { ts: now - 30000 }),
    {
      ...makeGroupMessage(threadId, "bot", "self-msg", "bot noi", { ts: now - 20000 }),
      isSelf: true
    }
  ];

  const result = await counter.recordHistoryMessages(messages, Threads);
  await counter.flushAll(Threads);
  assert.deepEqual(result, { groups: 1, messages: 3 });

  const saved = Threads.rows.get(threadId).data;
  assert.equal(saved.topchatDate, today);
  assert.equal(saved.topchatCounts.u1.count, 2);
  assert.equal(saved.topchatCounts.u2.count, 1);
  assert.equal(saved.topchatCounts.u3, undefined);
  assert.equal(saved.topchatSeenMessageIds.length, 3);
});

test("topchat merges historical and realtime messages without counting overlap twice", async () => {
  global.config = { prefix: "/" };
  const Threads = fakeThreads();
  const threadId = "topchat-history-live-dedupe";
  const oldMessage = makeGroupMessage(threadId, "u1", "overlap-1", "history message");
  await counter.recordHistoryMessages([oldMessage], Threads);

  // Same message may be seen again by the realtime event when WebSocket
  // backfill overlaps with the live subscription.
  await counter.run({ event: oldMessage, Threads, isSelf: false });
  const newLive = makeGroupMessage(threadId, "u1", "live-2", "new live message");
  await counter.run({ event: newLive, Threads, isSelf: false });
  await counter.flushAll(Threads);

  const saved = Threads.rows.get(threadId).data;
  assert.equal(saved.topchatCounts.u1.count, 2);
  assert.ok(saved.topchatSeenMessageIds.includes("overlap-1"));
  assert.ok(saved.topchatSeenMessageIds.includes("live-2"));
});

test("topchat sends the daily ranking from persisted counters without REST history calls", async () => {
  const { performance } = require("node:perf_hooks");
  const command = require("../plugins/commands/topchat");
  const date = vietnamDateKey();
  const threadId = "topchat-fast-command-regression";
  const sent = [];
  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      return { ok: true };
    }
  };
  const Threads = fakeThreads({
    [threadId]: {
      prefix: "/",
      topchatDate: date,
      topchatSeenMessageIds: [],
      topchatCounts: {
        "fast-u1": { name: "One", count: 120, avatar: "" },
        "fast-u2": { name: "Two", count: 80, avatar: "" }
      }
    }
  });
  const event = { threadId, type: ThreadType.Group, data: { uidFrom: "requester" } };

  const started = performance.now();
  await command.run({ api, event, Threads, reply: {} });
  const elapsed = performance.now() - started;

  assert.equal(sent.length, 1);
  assert.ok(Array.isArray(sent[0].attachments));
  assert.ok(elapsed < 1000, `topchat took ${elapsed.toFixed(1)}ms`);
});

test("topchat ignores daily counters left over from a previous date", () => {
  const today = vietnamDateKey();
  const result = topchat._test.readDailyCounts({
    topchatDate: "2000-01-01",
    topchatCounts: { old: { name: "Old", count: 999 } }
  });
  assert.equal(result.today, today);
  assert.deepEqual(result.counts, {});
});

test("topchat stores more than 500 message IDs to deduplicate full-day history", () => {
  assert.equal(counter._test.MAX_STORED_IDS, 10000);
});


test("topchat marks whether the WebSocket backfill reached the start of the day", async () => {
  global.config = { prefix: "/" };
  const Threads = fakeThreads({
    "topchat-coverage-regression": {
      topchatDate: vietnamDateKey(),
      topchatCounts: { u1: { name: "One", count: 14, avatar: "" } },
      topchatSeenMessageIds: ["id-1"]
    }
  });

  await counter.markHistoryCoverage(
    ["topchat-coverage-regression"],
    Threads,
    vietnamDateKey(),
    true,
    3,
    "day-boundary-reached"
  );

  const saved = Threads.rows.get("topchat-coverage-regression").data;
  assert.equal(saved.topchatCounts.u1.count, 14);
  assert.deepEqual(saved.topchatSeenMessageIds, ["id-1"]);
  assert.equal(saved.topchatHistoryDate, vietnamDateKey());
  assert.equal(saved.topchatHistoryComplete, true);
  assert.equal(saved.topchatHistoryPages, 3);
});

test("topchat history respects each group's custom prefix", async () => {
  const threadId = "topchat-custom-prefix-regression";
  const Threads = fakeThreads({
    [threadId]: { prefix: "!" }
  });

  await counter.recordHistoryMessages([
    makeGroupMessage(threadId, "u1", "custom-1", "/not-a-command"),
    makeGroupMessage(threadId, "u1", "custom-2", "!menu")
  ], Threads);
  await counter.flushAll(Threads);

  const saved = Threads.rows.get(threadId).data;
  assert.equal(saved.topchatCounts.u1.count, 1);
});


test("topchat batches high-volume realtime counters into one group write", async () => {
  global.config = { prefix: "/" };
  const Threads = fakeThreads();
  const threadId = "topchat-batched-write-regression";
  for (let index = 0; index < 25; index++) {
    await counter.run({
      event: makeGroupMessage(threadId, "member-1", "batch-" + index, "hello " + index),
      Threads,
      isSelf: false
    });
  }
  assert.equal(Threads.writeCount || 0, 0, "live messages should be accumulated before DB write");
  await counter.flushAll(Threads);
  const saved = Threads.rows.get(threadId).data;
  assert.equal(saved.topchatCounts["member-1"].count, 25);
  assert.equal(saved.topchatSeenMessageIds.length, 25);
  assert.equal(Threads.writeCount, 1, "one batch should persist only once per group");
});


test("topchat automatically retries a failed batched storage write", async () => {
  global.config = { prefix: "/" };
  const Threads = fakeThreads();
  const threadId = "topchat-retry-write-regression";
  const setData = Threads.setData.bind(Threads);
  let attempts = 0;
  Threads.setData = async (id, data) => {
    attempts++;
    if (attempts === 1) throw new Error("temporary database failure");
    return setData(id, data);
  };

  await counter.run({
    event: makeGroupMessage(threadId, "member-1", "retry-write-1", "hello"),
    Threads,
    isSelf: false
  });
  await assert.rejects(counter.flushGroup(threadId, Threads), /temporary database failure/);
  await new Promise(resolve => setTimeout(resolve, counter._test.FLUSH_DELAY_MS + 150));

  const saved = Threads.rows.get(threadId)?.data;
  assert.ok(saved, "retry should eventually persist the batch");
  assert.equal(saved.topchatCounts["member-1"].count, 1);
  assert.ok(attempts >= 2);
});

test("topchat accepts the official Zalo GroupMessage model and missing live timestamps", async () => {
  global.config = { prefix: "/" };
  const { GroupMessage } = require("zalo-client");
  const Threads = fakeThreads();
  const threadId = "topchat-real-zalo-message-shape";
  const model = new GroupMessage("bot-self", {
    idTo: threadId,
    uidFrom: "member-model",
    dName: "Member Model",
    cliMsgId: "model-message-1",
    content: "tin nhắn không có timestamp",
    msgType: "text"
  });

  assert.equal(model.type, ThreadType.Group);
  assert.equal(model.threadId, threadId);
  await counter.run({ event: model, Threads, isSelf: false });
  await counter.flushAll(Threads);

  const saved = Threads.rows.get(threadId).data;
  assert.equal(saved.topchatCounts["member-model"].count, 1);
  assert.equal(saved.topchatCounts["member-model"].name, "Member Model");
});

test("topchat normalizes serialized group ThreadType values", async () => {
  global.config = { prefix: "/" };
  const Threads = fakeThreads();
  const threadId = "topchat-string-group-type";
  const event = makeGroupMessage(threadId, "member-string-type", "string-type-1", "hello");
  event.type = "1";
  await counter.run({ event, Threads, isSelf: false });
  await counter.flushAll(Threads);
  assert.equal(Threads.rows.get(threadId).data.topchatCounts["member-string-type"].count, 1);
});


test("topchat counts official Zalo GroupMessage events when the live frame omits ts", async () => {
  global.config = { prefix: "/" };
  const { GroupMessage } = require("zalo-client");
  const Threads = fakeThreads();
  const threadId = "topchat-zalo-model-without-ts";
  const event = new GroupMessage("bot-self", {
    idTo: threadId,
    uidFrom: "member-model",
    dName: "Member Model",
    cliMsgId: "model-live-1",
    content: "tin nhắn mới",
    msgType: "text"
  });

  assert.equal(event.type, ThreadType.Group);
  await counter.run({ event, Threads, isSelf: false });
  await counter.flushAll(Threads);

  const saved = Threads.rows.get(threadId).data;
  assert.equal(saved.topchatCounts["member-model"].count, 1);
  assert.equal(saved.topchatCounts["member-model"].name, "Member Model");
});

test("topchat accepts serialized group thread type values", async () => {
  global.config = { prefix: "/" };
  const Threads = fakeThreads();
  const threadId = "topchat-string-group-type";
  const event = makeGroupMessage(threadId, "member-string", "string-type-1", "hello");
  event.type = "1";
  await counter.run({ event, Threads, isSelf: false });
  await counter.flushAll(Threads);
  assert.equal(Threads.rows.get(threadId).data.topchatCounts["member-string"].count, 1);
});

test("topchat falls back to the official per-group history API when local counts are empty", async () => {
  global.config = { prefix: "/" };
  const threadId = "topchat-group-history-api-fallback";
  const Threads = fakeThreads({ [threadId]: { prefix: "/" } });
  const message = makeGroupMessage(threadId, "api-member", "api-history-1", "lấy từ lịch sử nhóm");
  const api = {
    async getGroupChatHistory(requestedThreadId, count) {
      assert.equal(requestedThreadId, threadId);
      assert.equal(count, 50);
      return { groupMsgs: [message] };
    }
  };

  const result = await topchat._test.backfillCurrentGroupHistory(api, threadId, Threads);
  assert.equal(result.available, true);
  assert.equal(result.received, 1);
  assert.equal(result.added, 1);

  const saved = Threads.rows.get(threadId).data;
  assert.equal(saved.topchatCounts["api-member"].count, 1);
  assert.equal(saved.topchatHistoryComplete, false);
  assert.equal(saved.topchatHistoryReason, "group-api-fallback");
});
