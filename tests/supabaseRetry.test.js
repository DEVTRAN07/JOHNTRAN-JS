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

test("Supabase sync preserves a pending bot_enabled write when the remote snapshot is stale", async () => {
  const store = makeStore(async (name, table) => ({
    data: table === "bot_threads"
      ? [{ id: "group-1", data: { bot_enabled: false } }, { id: "group-deleted", data: { bot_enabled: true } }]
      : [],
    error: null
  }));
  store.mirror = {
    Users: {},
    Threads: {
      "group-1": { id: "group-1", data: { bot_enabled: true } }
    },
    Metrics: {}
  };
  store.writeVersions.set("bot_threads:group-1", 1);
  store.writeVersions.set("bot_threads:group-deleted", 2);
  store.scheduleInterval = () => {};

  await store.sync();

  assert.equal(store.mirror.Threads["group-1"].data.bot_enabled, true,
    "an older Supabase snapshot must not turn a locally enabled group OFF");
  assert.equal(store.mirror.Threads["group-deleted"], undefined,
    "a pending local delete must not be resurrected by an older snapshot");
});

test("Supabase reports missing bot_threads as unhealthy instead of silently defaulting every group OFF", async () => {
  const store = makeStore(async (_name, table) => ({
    data: table === "bot_threads" ? null : [],
    error: table === "bot_threads" ? { message: 'Could not find the table "public.bot_threads" in the schema cache' } : null
  }));
  store.mirror = { Users: {}, Threads: {}, Metrics: {} };
  store.scheduleInterval = () => {};

  await store.sync();

  const status = store.getStatus();
  assert.equal(status.ok, false);
  assert.equal(status.classified, "config");
  assert.match(status.syncError, /bot_threads/);
});

test("critical group-setting writes wait for Supabase acknowledgement", async () => {
  let finishWrite;
  const store = makeStore(async (name) => {
    if (name === "upsert") {
      await new Promise(resolve => { finishWrite = resolve; });
      return { error: null };
    }
    return { data: [], error: null };
  });
  store.mirror = { Users: {}, Threads: {}, Metrics: {} };

  const pending = store.setAndWait("Threads", "threadId", "group-persist", { bot_enabled: true });
  await tick();
  assert.equal(typeof finishWrite, "function", "the remote write should have started");
  assert.equal(store.mirror.Threads["group-persist"].data.bot_enabled, true);
  assert.equal(store.writeVersions.has("bot_threads:group-persist"), true,
    "the row remains protected from stale sync until the write commits");

  finishWrite();
  await pending;

  assert.equal(store.writeVersions.has("bot_threads:group-persist"), false);
  assert.equal(store.retryQueue.has("bot_threads:group-persist"), false);
});

test("failed critical group-setting writes report failure and remain queued for retry", async () => {
  const store = makeStore(async (name) => {
    if (name === "upsert") throw new Error("fetch failed");
    return { data: [], error: null };
  });
  store.mirror = { Users: {}, Threads: {}, Metrics: {} };

  await assert.rejects(
    store.setAndWait("Threads", "threadId", "group-retry", { bot_enabled: true }),
    /fetch failed/
  );
  assert.equal(store.mirror.Threads["group-retry"].data.bot_enabled, true);
  assert.equal(store.retryQueue.has("bot_threads:group-retry"), true);
  assert.equal(store.writeVersions.has("bot_threads:group-retry"), true);
});


test("Supabase row retries respect nextRetryAt and increase backoff after repeated failures", async () => {
  let online = false;
  let attempts = 0;
  const store = makeStore(async (name) => {
    if (name === "upsert") {
      attempts++;
      if (!online) throw new Error("fetch failed");
      return { error: null };
    }
    return { data: [], error: null };
  });

  store.push("bot_threads", "upsert", { id: "retry-backoff", data: { bot_enabled: true } });
  await tick();
  const first = store.retryQueue.get("bot_threads:retry-backoff");
  assert.equal(first.retryAttempt, 0);
  assert.ok(first.nextRetryAt > Date.now());

  const firstAttemptCount = attempts;
  await store.flushRetry({ force: false });
  assert.equal(attempts, firstAttemptCount, "scheduled retry must not run before nextRetryAt");

  await store.flushRetry();
  const second = store.retryQueue.get("bot_threads:retry-backoff");
  assert.equal(second.retryAttempt, 1);
  assert.ok(second.nextRetryAt - Date.now() > 5000,
    "second retry must use a longer delay than the initial retry");

  online = true;
  await store.flushRetry();
  assert.equal(store.retryQueue.size, 0);
  assert.equal(store.writeVersions.size, 0);
});


test("Supabase partial table failures increase the next sync interval", async () => {
  const scheduled = [];
  const store = makeStore(async (_name, table) => {
    if (table === "bot_threads") return { data: [], error: null };
    return { data: null, error: new Error("fetch failed") };
  });
  store.mirror = { Users: {}, Threads: {}, Metrics: {}, BotStats: {}, MediaCache: {} };
  store.scheduleInterval = delay => scheduled.push(delay);

  await store.sync();

  assert.equal(store.consecutiveFailures, 1);
  assert.ok(store.nextSyncDelay > 30000);
  assert.equal(scheduled.at(-1), store.nextSyncDelay);
  assert.equal(store.getStatus().nextSyncDelayMs, store.nextSyncDelay);
  assert.match(store.getStatus().syncError, /fetch failed/);
});
