const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dbFile = path.join(os.tmpdir(), `johntran-thread-cache-${process.pid}.json`);
process.env.JT_DB_DRIVER = "json";
process.env.JT_DB_FILE = dbFile;
global.config = { prefix: "/" };

const Threads = require("../core/controller/controllerThreads");
const { threadCache } = require("../core/cache");
const db = require("../utils/db");

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

test("createData initializes the same record shape as persisted rows", async () => {
  const threadId = "thread-cache-create-" + process.pid;
  const created = Threads.createData(threadId, { anti_link: false, anti_spam: true });
  assert.equal(created.threadId, threadId);
  assert.equal(created.data.anti_spam, true);

  await db.flush();
  threadCache.invalidate(threadId);
  const persisted = await Threads.getData(threadId);
  assert.equal(persisted.threadId, threadId);
  assert.equal(persisted.data.anti_link, false);
  assert.equal(persisted.data.anti_spam, true);
});
