"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDatabaseAdapter } = require("../core/runtime/adapters/database");

test("database adapter forwards legacy operations and preserves return values", async () => {
  const calls = [];
  const db = { get: () => "record" };
  const backend = {
    db,
    getData: (...args) => { calls.push(["getData", args]); return Promise.resolve({ data: 1 }); },
    saveData: (...args) => { calls.push(["saveData", args]); return "saved"; },
    hasData: (...args) => { calls.push(["hasData", args]); return true; },
    delData: (...args) => { calls.push(["delData", args]); return "deleted"; },
    allData: (...args) => { calls.push(["allData", args]); return [{ userId: "u1" }]; },
    flush: (...args) => { calls.push(["flush", args]); return Promise.resolve("flushed"); }
  };
  const adapter = createDatabaseAdapter(backend);

  assert.deepEqual(await adapter.getData("Users", "userId", "u1"), { data: 1 });
  assert.equal(adapter.saveData("Users", "userId", "u1", { name: "A" }), "saved");
  assert.equal(adapter.hasData("Users", "userId", "u1"), true);
  assert.equal(adapter.delData("Users", "userId", "u1"), "deleted");
  assert.deepEqual(adapter.allData("Users"), [{ userId: "u1" }]);
  assert.equal(await adapter.flush(), "flushed");
  assert.equal(adapter.db, db);
  assert.deepEqual(calls, [
    ["getData", ["Users", "userId", "u1"]],
    ["saveData", ["Users", "userId", "u1", { name: "A" }]],
    ["hasData", ["Users", "userId", "u1"]],
    ["delData", ["Users", "userId", "u1"]],
    ["allData", ["Users"]],
    ["flush", []]
  ]);
});

test("database adapter treats optional flush as a no-op", () => {
  const backend = {
    getData() {}, saveData() {}, hasData() {}, delData() {}, allData() {}
  };
  assert.equal(createDatabaseAdapter(backend).flush(), undefined);
});

test("database adapter rejects incomplete storage backends", () => {
  assert.throws(() => createDatabaseAdapter(null), /backend is required/);
  assert.throws(() => createDatabaseAdapter({}), /missing getData/);
});
