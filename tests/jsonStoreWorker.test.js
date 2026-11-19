"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { JsonStore } = require("../core/storage");
const { createDatabaseFacade } = require("../utils/db");

const writerTestsEnabled = process.env.JT_JSON_WRITER_WORKER === "1";

async function temporaryDatabase() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "johntran-json-worker-"));
  return { dir, file: path.join(dir, "store.json") };
}

test("JSON persistence serializes and writes in a dedicated worker", { skip: !writerTestsEnabled }, async () => {
  const { file } = await temporaryDatabase();
  const store = new JsonStore(file, ["Users", "Threads"]);
  const facade = createDatabaseFacade(store);

  assert.ok(store.writerWorker, "the JSON store should start its dedicated writer");
  assert.notEqual(store.writerWorker.threadId, -1);

  const originalStringify = JSON.stringify;
  let mainThreadStringifyCalls = 0;
  JSON.stringify = function (...args) {
    mainThreadStringifyCalls++;
    return originalStringify.apply(this, args);
  };

  try {
    facade.saveData("Users", "userId", "worker-user", {
      name: "Worker persistence",
      balance: 123
    });

    assert.equal(store.getOperationalStatus().pendingFlush, true);
    assert.equal(await store.flushAndWait(), true);
    assert.equal(mainThreadStringifyCalls, 0,
      "database serialization must happen in the writer thread, not the Zalo event loop");
  } finally {
    JSON.stringify = originalStringify;
  }

  const persisted = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(persisted.Users["worker-user"].data.name, "Worker persistence");
  assert.equal(persisted.Users["worker-user"].data.balance, 123);
  assert.equal(store.getOperationalStatus().pendingFlush, false);
});

test("worker flush barriers preserve mutation order and the newest row wins", { skip: !writerTestsEnabled }, async () => {
  const { file } = await temporaryDatabase();
  const store = new JsonStore(file, ["Users"]);

  for (let index = 0; index < 300; index++) {
    store.set("Users", "userId", "user-" + index, {
      displayName: "User " + index,
      balance: index
    });
  }

  // This write is sent after the first barrier. The second barrier must include it.
  const firstFlush = store.flushAndWait();
  store.set("Users", "userId", "user-299", {
    displayName: "Latest version",
    balance: 999999
  });

  assert.equal(await firstFlush, true);
  assert.equal(await store.flushAndWait(), true);

  const persisted = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(Object.keys(persisted.Users).length, 300);
  assert.equal(persisted.Users["user-299"].data.displayName, "Latest version");
  assert.equal(persisted.Users["user-299"].data.balance, 999999);
});

test("durable database writes await the worker instead of using synchronous flush", { skip: !writerTestsEnabled }, async () => {
  const { file } = await temporaryDatabase();
  const store = new JsonStore(file, ["Threads"]);
  const facade = createDatabaseFacade(store);

  await facade.saveDataAndWait("Threads", "threadId", "durable-group", {
    bot_enabled: true,
    prefix: "!"
  });

  const persisted = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(persisted.Threads["durable-group"].data.bot_enabled, true);
  assert.equal(persisted.Threads["durable-group"].data.prefix, "!");
  assert.equal(store.getOperationalStatus().pendingFlush, false);
});
