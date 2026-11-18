const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ThreadType } = require("zalo-client");
const { getMessageCache, updateMessageCache } = require("../utils");

test("message cache stores deletable group message identifiers and falls back to receive time", () => {
  const cliMsgId = `message-cache-test-${Date.now()}`;
  const event = {
    threadId: "cache-test-group",
    type: ThreadType.Group,
    data: {
      msgId: "cache-test-message",
      cliMsgId,
      uidFrom: "cache-test-user",
      idTo: "cache-test-group",
      ts: 0
    }
  };

  updateMessageCache(event);
  const cached = getMessageCache()[cliMsgId];

  try {
    assert.equal(cached.msgId, event.data.msgId);
    assert.equal(cached.cliMsgId, cliMsgId);
    assert.equal(cached.uidFrom, event.data.uidFrom);
    assert.equal(cached.threadId, event.threadId);
    assert.equal(cached.type, ThreadType.Group);
    assert.ok(cached.timestamp >= Date.now() - 1000, "missing source timestamp should use receive time");
  } finally {
    delete getMessageCache()[cliMsgId];
  }
});


test("message cache evicts oldest entries when its configured bound is exceeded", () => {
  const { enforceMessageCacheLimit } = require("../utils/messageCache");
  const cache = { oldest: { timestamp: 1 }, middle: { timestamp: 2 }, newest: { timestamp: 3 } };
  const removed = enforceMessageCacheLimit(cache, 2);
  assert.equal(removed, 1);
  assert.equal(Object.hasOwn(cache, "oldest"), false);
  assert.equal(Object.hasOwn(cache, "middle"), true);
  assert.equal(Object.hasOwn(cache, "newest"), true);
});

test("message cache remains unchanged while under its configured bound", () => {
  const { enforceMessageCacheLimit } = require("../utils/messageCache");
  const cache = { a: {}, b: {} };
  assert.equal(enforceMessageCacheLimit(cache, 2), 0);
  assert.deepEqual(Object.keys(cache), ["a", "b"]);
});


test("message cache hot updates do not scan all retained keys on every message", () => {
  const cacheModule = require("../utils/messageCache");
  const before = cacheModule.getMessageCacheStats().fullScans;
  const ids = [];

  try {
    for (let index = 0; index < 100; index++) {
      const cliMsgId = "message-cache-hotpath-" + process.pid + "-" + index;
      ids.push(cliMsgId);
      updateMessageCache({
        threadId: "cache-hotpath-group",
        type: ThreadType.Group,
        data: {
          msgId: "cache-hotpath-msg-" + index,
          cliMsgId,
          uidFrom: "cache-hotpath-user",
          idTo: "cache-hotpath-group",
          ts: Date.now()
        }
      });
    }

    const after = cacheModule.getMessageCacheStats();
    assert.equal(after.fullScans, before, "ordinary inserts under the cap must be O(1) and skip Object.keys()");
    assert.ok(after.entries >= 100);
  } finally {
    const cache = getMessageCache();
    for (const id of ids) delete cache[id];
  }
});
