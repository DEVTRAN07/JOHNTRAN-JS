const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const dbFile = path.join(os.tmpdir(), `johntran-thread-cache-${process.pid}.json`);
process.env.JT_DB_DRIVER = "json";
process.env.JT_DB_FILE = dbFile;
global.config = { prefix: "/" };

const Threads = require("../core/controller/controllerThreads");
const { threadCache, durableThreadCache } = require("../core/cache");
const db = require("../utils/db");

// JsonStore schedules its disk flush timer as unref(); keep this isolated test
// process alive while awaiting persistence operations.
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

test("setData keeps the database record envelope in the LRU cache", async () => {
  const threadId = "thread-cache-set-" + process.pid;
  await Threads.setData(threadId, { anti_link: true, prefix: "!" });

  const cached = await Threads.getData(threadId);
  assert.equal(cached.threadId, threadId);
  assert.equal(cached.data.anti_link, true);
  assert.equal(cached.data.prefix, "!");

  threadCache.invalidate(threadId);
  const persisted = await Threads.getData(threadId);
  assert.equal(persisted.threadId, threadId);
  assert.equal(persisted.data.anti_link, true);
});

test("setDataAndWait preserves the enabled group flag on disk after an ordinary settings write", async () => {
  const threadId = "thread-cache-group-durable-" + process.pid;
  await Threads.setBotEnabled(threadId, true);
  await Threads.setDataAndWait(threadId, { bot_enabled: false, prefix: "!" });

  const disk = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  assert.equal(disk.Threads[threadId].data.bot_enabled, true);

  threadCache.invalidate(threadId);
  const persisted = await Threads.getData(threadId);
  assert.equal(persisted.data.bot_enabled, true);
});

test("partial group settings updates preserve bot_enabled until an explicit OFF write", async () => {
  const threadId = "thread-cache-group-preserve-" + process.pid;

  await Threads.setBotEnabled(threadId, true);
  await Threads.setData(threadId, { anti_link: true });
  let current = await Threads.getData(threadId);

  assert.equal(current.data.anti_link, true);
  assert.equal(current.data.bot_enabled, true,
    "an older command saving only anti settings must not turn the bot OFF");

  // A stale full settings snapshot may still carry bot_enabled=false; it is
  // not an intentional OFF operation and must not disable this group.
  await Threads.setData(threadId, { bot_enabled: false, anti_link: true });
  current = await Threads.getData(threadId);
  assert.equal(current.data.bot_enabled, true,
    "ordinary stale OFF settings must not turn an enabled group OFF");

  await Threads.setBotEnabled(threadId, false);
  await Threads.setData(threadId, { bot_enabled: true, anti_link: true });
  current = await Threads.getData(threadId);
  assert.equal(current.data.bot_enabled, false,
    "ordinary stale ON settings must not re-enable a manually disabled group");
  await Threads.setBotEnabled(threadId, false);
  current = await Threads.getData(threadId);
  assert.equal(current.data.bot_enabled, false,
    "only the dedicated explicit switch may turn the bot OFF");

  await db.flush();
  threadCache.invalidate(threadId);
  const persisted = await Threads.getData(threadId);
  assert.equal(persisted.data.bot_enabled, false);
});

test("createData initializes the same record shape as persisted rows", async () => {
  const threadId = "thread-cache-create-" + process.pid;
  const created = await Threads.createData(threadId, { anti_link: false, anti_spam: true });
  assert.equal(created.threadId, threadId);
  assert.equal(created.data.anti_spam, true);

  await db.flush();
  threadCache.invalidate(threadId);
  const persisted = await Threads.getData(threadId);
  assert.equal(persisted.threadId, threadId);
  assert.equal(persisted.data.anti_link, false);
  assert.equal(persisted.data.anti_spam, true);
});

test("a cold Supabase mirror never creates default-OFF rows before the initial sync is ready", async () => {
  const backend = db.db;
  const originalReady = backend.ready;
  const originalGetStatus = backend.getStatus;
  const threadId = "thread-cache-db-not-ready-" + process.pid;

  backend.getStatus = () => ({ ok:false, syncError:"initial snapshot pending" });
  backend.ready = async () => backend.getStatus();

  try {
    assert.equal(Threads.getCachedData(threadId), null,
      "the synchronous hot path must not synthesize a default-OFF record");
    await assert.rejects(Threads.getData(threadId), /initial snapshot pending/);
    await assert.rejects(Threads.setData(threadId, { bot_enabled:false }), /initial snapshot pending/);
    assert.equal(db.hasData("Threads", "threadId", threadId), false,
      "no local row may be written until the initial Supabase snapshot is ready");
  } finally {
    if (originalReady === undefined) delete backend.ready;
    else backend.ready = originalReady;
    if (originalGetStatus === undefined) delete backend.getStatus;
    else backend.getStatus = originalGetStatus;
  }
});

test("cold getData reads also warm the long-lived group-state cache", async () => {
  const backend = db.db;
  const originalGetStatus = backend.getStatus;
  const threadId = "thread-cache-cold-read-warm-" + process.pid;

  await Threads.setBotEnabled(threadId, true);
  threadCache.invalidate(threadId);
  durableThreadCache.invalidate(threadId);

  try {
    const cold = await Threads.getData(threadId);
    assert.equal(cold.data.bot_enabled, true);

    // A later transient database outage must not lose a record that was
    // loaded through getData before the listener's synchronous hot path.
    threadCache.set(threadId, cold, -1);
    backend.getStatus = () => ({ ok:false, syncError:"temporary read outage" });
    const restored = Threads.getCachedData(threadId);
    assert.equal(restored?.data?.bot_enabled, true);
  } finally {
    backend.getStatus = originalGetStatus;
    threadCache.invalidate(threadId);
    durableThreadCache.invalidate(threadId);
  }
});

test("startup getAll rehydrates enabled groups after both caches are empty", async () => {
  const backend = db.db;
  const originalGetStatus = backend.getStatus;
  const threadId = "thread-cache-startup-rehydrate-" + process.pid;

  await Threads.setBotEnabled(threadId, true);
  // Simulate a process restart: in-memory caches are empty, storage remains.
  threadCache.invalidate(threadId);
  durableThreadCache.invalidate(threadId);

  try {
    const loaded = Threads.getAll().find(row => row.threadId === threadId);
    assert.equal(loaded?.data?.bot_enabled, true, "startup must read the persisted ON row");

    threadCache.set(threadId, loaded, -1);
    backend.getStatus = () => ({ ok:false, syncError:"temporary post-start outage" });
    const restored = Threads.getCachedData(threadId);
    assert.equal(restored?.data?.bot_enabled, true,
      "the startup snapshot must survive hot-cache expiry");
  } finally {
    backend.getStatus = originalGetStatus;
    threadCache.invalidate(threadId);
    durableThreadCache.invalidate(threadId);
  }
});

test("new thread records persist bot_enabled=false by default", async () => {
  const threadId = "thread-cache-group-default-off-" + process.pid;
  const created = await Threads.getData(threadId);
  assert.equal(created.data.bot_enabled, false);

  threadCache.invalidate(threadId);
  const cached = Threads.getCachedData(threadId);
  assert.equal(cached.data.bot_enabled, false);
});


test("an enabled group remains ON from the last-known mirror when a later DB sync is degraded", async () => {
  const backend = db.db;
  const originalGetStatus = backend.getStatus;
  const threadId = "thread-cache-retain-on-" + process.pid;
  const unknownThreadId = "thread-cache-no-default-while-degraded-" + process.pid;

  await Threads.setBotEnabled(threadId, true);
  // Simulate the five-minute thread LRU expiry without waiting in the test.
  threadCache.set(threadId, {
    id: threadId,
    threadId,
    data: { bot_enabled: true, prefix: "/" }
  }, -1);

  backend.getStatus = () => ({
    ok: false,
    lastSyncAt: Date.now() - 60000,
    syncError: "temporary Supabase network timeout"
  });

  try {
    const lastKnown = Threads.getCachedData(threadId);
    assert.equal(lastKnown?.data?.bot_enabled, true,
      "cache expiry and a later network error must not make an existing enabled group OFF");

    assert.equal(Threads.getCachedData(unknownThreadId), null,
      "an unknown group must remain fail-closed while storage is degraded");
    assert.equal(db.hasData("Threads", "threadId", unknownThreadId), false,
      "do not synthesize a default-OFF row while storage cannot confirm it");

    await assert.rejects(
      Threads.setDataAndWait(threadId, { bot_enabled: false }),
      /temporary Supabase network timeout/,
      "configuration writes must still fail instead of pretending the DB accepted them"
    );
    assert.equal(db.getData("Threads", "threadId", threadId).data.bot_enabled, true,
      "a rejected OFF write must not change the last-known enabled state");
  } finally {
    backend.getStatus = originalGetStatus;
    threadCache.invalidate(threadId);
    threadCache.invalidate(unknownThreadId);
  }
});
