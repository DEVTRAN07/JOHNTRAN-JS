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


test("message cache periodic flush writes asynchronously and reports flush statistics", async () => {
  const cacheModule = require("../utils/messageCache");
  const cache = getMessageCache();
  const cliMsgId = "message-cache-async-flush-" + process.pid;
  updateMessageCache({
    threadId: "cache-async-flush-group",
    type: ThreadType.Group,
    data: {
      msgId: "cache-async-flush-message",
      cliMsgId,
      uidFrom: "cache-async-flush-user",
      idTo: "cache-async-flush-group",
      ts: Date.now()
    }
  });

  try {
    const before = cacheModule.getMessageCacheStats().asyncFlushCount;
    const pending = cacheModule.flushMessageCache();
    assert.equal(typeof pending?.then, "function", "flush should return an awaitable async write");
    assert.equal(await pending, true);
    const after = cacheModule.getMessageCacheStats();
    assert.equal(after.asyncFlushCount, before + 1);
    assert.equal(after.asyncFlushFailures >= 0, true);
    assert.ok(after.asyncFlushLastMs >= 0);
  } finally {
    delete cache[cliMsgId];
    await cacheModule.flushMessageCache();
  }
});

test("Rust message-cache sidecar persists updates outside the Node process", async t => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const cacheModule = require("../utils/messageCache");
  const binary = cacheModule.resolveNativeCacheBinary();
  if (!fs.existsSync(binary)) {
    t.skip("Rust sidecar is built in CI/production images only");
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-rust-cache-test-"));
  const file = path.join(dir, "message_cache.json");
  fs.writeFileSync(file, JSON.stringify({
    existing: { msgId: "old-message", cliMsgId: "existing" },
    removed: { msgId: "delete-me", cliMsgId: "removed" }
  }));

  const writer = cacheModule.createNativeCacheWriter(binary, file);
  assert.ok(writer, "native writer should start");
  try {
    writer.upsert("existing", { msgId: "new-message", cliMsgId: "existing" });
    writer.upsert("inserted", { msgId: "inserted-message", cliMsgId: "inserted" });
    writer.delete("removed");

    const result = await writer.flush();
    assert.equal(result.ok, true, result.error);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.existing.msgId, "new-message");
    assert.equal(saved.inserted.msgId, "inserted-message");
    assert.equal(Object.hasOwn(saved, "removed"), false);
    assert.equal(result.entries, 2);
  } finally {
    await writer.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
