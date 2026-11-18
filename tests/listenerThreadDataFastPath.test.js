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

test("group message preserves the durable fallback when its cache is cold", async () => {
  let cacheReads = 0;
  let storageReads = 0;
  const record = {
    threadId: "group-cold-cache",
    data: { prefix: "/", bot_enabled: true }
  };
  const result = listener.getThreadDataForMessage({
    threadId: record.threadId,
    type: ThreadType.Group
  }, {
    getCachedData() {
      cacheReads++;
      return null;
    },
    async getData(id) {
      storageReads++;
      assert.equal(id, record.threadId);
      return record;
    }
  });

  assert.equal(typeof result?.then, "function");
  assert.equal(await result, record);
  assert.equal(cacheReads, 1);
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
