"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabaseFacade } = require("../utils/db");

test("database hot path returns cached-mirror reads synchronously", () => {
  const rows = new Map();
  const backend = {
    get(table, _field, id) { return rows.get(`${table}:${id}`) || null; },
    set(table, field, id, data) {
      const row = { [field]: String(id), data };
      rows.set(`${table}:${id}`, row);
      return row;
    },
    has(table, _field, id) { return rows.has(`${table}:${id}`); },
    delete(table, _field, id) { return rows.delete(`${table}:${id}`); },
    all(table) { return [...rows.entries()].filter(([key]) => key.startsWith(`${table}:`)).map(([, row]) => row); },
    flushSync() { return true; }
  };
  const store = createDatabaseFacade(backend);

  const saved = store.saveData("Users", "userId", "u1", { ban: false });
  assert.equal(saved.userId, "u1");
  assert.equal(store.hasData("Users", "userId", "u1"), true);

  const loaded = store.getData("Users", "userId", "u1");
  assert.equal(loaded.data.ban, false);
  assert.equal(typeof loaded.then, "undefined", "hot-path reads must not return queued Promises");

  assert.equal(store.allData("Users").length, 1);
  assert.equal(store.delData("Users", "userId", "u1"), true);
  assert.equal(store.getData("Users", "userId", "u1"), null);
  assert.equal(store.flush(), true);
});

test("database facade preserves immediate mirror writes without waiting for disk/network", () => {
  let flushes = 0;
  const backend = {
    get: () => null,
    set: (_table, _field, id, data) => ({ id, data }),
    has: () => false,
    delete: () => true,
    all: () => [],
    flushSync: () => { flushes += 1; return true; }
  };
  const store = createDatabaseFacade(backend);
  const started = Date.now();
  const result = store.saveData("Threads", "threadId", "g1", { prefix: "!" });
  assert.equal(result.id, "g1");
  assert.ok(Date.now() - started < 50);
  assert.equal(flushes, 0, "disk flush remains the storage engine's scheduled background work");
});
