"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SupabaseStore } = require("../core/storage/supabase");

function makeStore(executePrepared) {
  const store = Object.create(SupabaseStore.prototype);
  store.retryQueue = new Map();
  store.writeVersions = new Map();
  store.writeChains = new Map();
  store.writeSequence = 0;
  store.retryFlush = null;
  store.metrics = { reads: 0, writes: 0, retries: 0, healthChecks: 0 };
  store.syncError = null;
  store.lastSyncAt = 0;
  store.consecutiveFailures = 0;
  store.classified = null;
  store.clientOptions = {};
  store.executePrepared = executePrepared;
  store.classifyError = () => "network";
  store.logFailure = () => {};
  return store;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test("Supabase retry queue coalesces failed writes to the latest mutation per row", async () => {
  let online = false;
  const calls = [];
  const store = makeStore(async (name, table, params) => {
    calls.push({ name, table, params });
    if (!online) throw new Error("fetch failed");
    return { error: null };
  });

  store.push("bot_threads", "upsert", { id: "g1", data: { prefix: "!" } });
  await tick();
  store.push("bot_threads", "upsert", { id: "g1", data: { prefix: "#" } });
  await tick();

  assert.equal(store.retryQueue.size, 1);
  const queued = store.retryQueue.get("bot_threads:g1");
  assert.equal(queued.payload.data.prefix, "#");

  online = true;
  await store.flushRetry();

  assert.equal(store.retryQueue.size, 0);
  assert.equal(store.writeVersions.size, 0);
  assert.equal(calls.at(-1).params.payload.data.prefix, "#");
});

test("Supabase serializes writes to one row so an old slow upsert cannot overwrite a newer delete", async () => {
  let finishOld;
  const completed = [];
  const store = makeStore(async (name, table, params) => {
    if (name === "upsert") {
      await new Promise(resolve => { finishOld = resolve; });
      completed.push("upsert");
      return { error: null };
    }
    completed.push("delete");
    return { error: null };
  });

  store.push("bot_threads", "upsert", { id: "g2", data: { prefix: "old" } });
  await tick();
  store.push("bot_threads", "delete", { id: "g2" });
  await tick();

  assert.deepEqual(completed, [], "delete waits for the prior row write");
  finishOld();
  await tick();
  await tick();

  assert.deepEqual(completed, ["upsert", "delete"]);
  assert.equal(store.writeChains.size, 0);
  assert.equal(store.writeVersions.size, 0);
});

test("Supabase ignores a stale failed write when a newer write for that row is queued", async () => {
  let rejectOld;
  const calls = [];
  const store = makeStore(async (name, table, params) => {
    const value = params.payload.data.value;
    calls.push(value);
    if (value === "old") {
      await new Promise((resolve, reject) => { rejectOld = reject; });
      return { error: null };
    }
    return { error: null };
  });

  store.push("bot_users", "upsert", { id: "u1", data: { value: "old" } });
  await tick();
  store.push("bot_users", "upsert", { id: "u1", data: { value: "new" } });
  rejectOld(new Error("fetch failed"));
  await tick();
  await tick();

  assert.deepEqual(calls, ["old", "new"]);
  assert.equal(store.retryQueue.size, 0);
  assert.equal(store.writeVersions.size, 0);
});
