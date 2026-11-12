"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dbFile = path.join(os.tmpdir(), `johntran-hot-cache-${process.pid}.json`);
process.env.JT_DB_DRIVER = "json";
process.env.JT_DB_FILE = dbFile;
global.config = { prefix: "/" };

const Threads = require("../core/controller/controllerThreads");
const Users = require("../core/controller/controllerUsers");
const { threadCache, userCache } = require("../core/cache");

test("thread hot cache returns warm and cold mirror records synchronously", () => {
  const id = "hot-thread-" + process.pid;
  const cold = Threads.getCachedData(id);
  assert.equal(typeof cold?.then, "undefined");
  assert.equal(cold.threadId, id);
  assert.equal(cold.data.prefix, "/");
  const warm = Threads.getCachedData(id);
  assert.equal(typeof warm?.then, "undefined");
  assert.equal(warm.threadId, id);
  threadCache.invalidate(id);
});

test("user hot cache returns mirror records synchronously without changing getData Promise API", async () => {
  const id = "hot-user-" + process.pid;
  const cold = Users.getCachedData(id);
  assert.equal(typeof cold?.then, "undefined");
  assert.equal(cold.userId, id);
  assert.equal(cold.data.ban, false);
  const warm = Users.getCachedData(id);
  assert.equal(warm.userId, id);
  assert.equal(typeof Users.getData(id)?.then, "function");
  userCache.invalidate(id);
  const reloaded = Users.getCachedData(id);
  assert.equal(reloaded.userId, id);
  assert.equal(reloaded.data.ban, false);
});

test("legacy thread and user service contracts remain Promise-compatible", async () => {
  assert.equal((await Threads.getData("hot-thread-" + process.pid)).threadId, "hot-thread-" + process.pid);
  assert.equal((await Users.getData("hot-user-" + process.pid)).userId, "hot-user-" + process.pid);
});
