"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const listener = require("../core/listen");

test("private message keeps an existing cached thread override", () => {
  const record = {
    threadId: "private-cache-hit",
    data: { prefix: "!", allow_private_command: true }
  };
  let cacheReads = 0;
  let storageReads = 0;
  const result = listener.getThreadDataForMessage({
    threadId: record.threadId,
    type: ThreadType.User
  }, {
    getCachedData(id) {
      cacheReads++;
      assert.equal(id, record.threadId);
      return record;
    },
    async getData() {
      storageReads++;
      throw new Error("private cold read must not hit group storage");
    }
  });

  assert.equal(result, record);
  assert.equal(cacheReads, 1);
  assert.equal(storageReads, 0);
});

test("private message with a cold cache skips Threads database read", () => {
  let cacheReads = 0;
  let storageReads = 0;
  const result = listener.getThreadDataForMessage({
    threadId: "private-cold-cache",
    type: ThreadType.User
  }, {
    getCachedData() {
      cacheReads++;
      return null;
    },
    async getData() {
      storageReads++;
      return { data: {} };
    }
  });

  assert.equal(result, null);
  assert.equal(cacheReads, 1);
  assert.equal(storageReads, 0);
});

test("cold group cache misses fail closed without waiting for database readiness", () => {
  let cacheReads = 0;
  let storageReads = 0;
  const threadId = "group-cold-cache";
  const result = listener.getThreadDataForMessage({
    threadId,
    type: ThreadType.Group
  }, {
    getCachedData(id) {
      cacheReads++;
      assert.equal(id, threadId);
      return null;
    },
    async getData() {
      storageReads++;
      throw new Error("listener must not await a cold group database read");
    }
  });

  assert.equal(result, null);
  assert.equal(typeof result?.then, "undefined");
  assert.equal(cacheReads, 1);
  assert.equal(storageReads, 0);
});

test("a failed or asynchronous group cache lookup never blocks the listener", () => {
  let storageReads = 0;
  const event = { threadId: "group-unavailable-cache", type: ThreadType.Group };
  const failed = listener.getThreadDataForMessage(event, {
    getCachedData() { throw new Error("cache unavailable"); },
    async getData() { storageReads++; return { data: { bot_enabled: true } }; }
  });
  const asynchronous = listener.getThreadDataForMessage(event, {
    getCachedData() { return Promise.resolve({ data: { bot_enabled: true } }); },
    async getData() { storageReads++; return { data: { bot_enabled: true } }; }
  });

  assert.equal(failed, null);
  assert.equal(asynchronous, null);
  assert.equal(storageReads, 0);
});

test("legacy adapters without a synchronous cache retain the group read contract", async () => {
  const record = {
    threadId: "legacy-group-cache",
    data: { prefix: "/", bot_enabled: true }
  };
  let storageReads = 0;
  const result = listener.getThreadDataForMessage({
    threadId: record.threadId,
    type: ThreadType.Group
  }, {
    async getData(id) {
      storageReads++;
      assert.equal(id, record.threadId);
      return record;
    }
  });

  assert.equal(typeof result?.then, "function");
  assert.equal(await result, record);
  assert.equal(storageReads, 1);
});

test("cached group records remain synchronous", () => {
  const record = {
    threadId: "group-hot-cache",
    data: { prefix: "/", bot_enabled: true }
  };
  const result = listener.getThreadDataForMessage({
    threadId: record.threadId,
    type: ThreadType.Group
  }, {
    getCachedData() { return record; },
    async getData() {
      throw new Error("hot cache hits must not call async storage");
    }
  });

  assert.equal(result, record);
  assert.equal(typeof result?.then, "undefined");
});
