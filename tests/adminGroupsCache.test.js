"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { createAdminGroupsStore } = require("../core/runtime/adminGroups");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-admin-groups-"));
const filePath = path.join(tempDir, "bot_admin_groups.json");

after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

test("admin-group reads are async and unchanged files reuse the in-memory snapshot", async () => {
  let clock = 1000;
  fs.writeFileSync(filePath, JSON.stringify(["group-a"]), "utf8");
  const store = createAdminGroupsStore({
    filePath,
    cacheTtlMs: 500,
    now: () => clock
  });

  assert.deepEqual(await store.readFresh(), ["group-a"]);
  assert.equal(store.getStats().diskReads, 1);
  assert.deepEqual(store.read(), ["group-a"]);
  assert.equal(store.getStats().diskReads, 1, "hot reads must not access disk");

  clock += 501;
  // Memory-only sync reads fail closed while a fresh disk snapshot is loaded.
  assert.deepEqual(store.read(), []);
  assert.deepEqual(await store.readFresh(), ["group-a"]);
  assert.equal(store.getStats().diskReads, 1,
    "an unchanged file should be verified by async metadata without parsing JSON again");
  assert.equal(store.getStats().metadataChecks, 2);
});

test("admin-group write updates the cache immediately and preserves the array format", () => {
  const store = createAdminGroupsStore({
    filePath,
    cacheTtlMs: 500,
    now: () => 2000
  });

  const result = store.write(["group-a", "group-b"]);
  assert.deepEqual(result, ["group-a", "group-b"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), ["group-a", "group-b"]);
  assert.deepEqual(store.read(), ["group-a", "group-b"]);
  assert.equal(store.getStats().diskReads, 0, "a successful write should seed the read cache");
});

test("admin-group invalidation refreshes external changes and corrupt data fails closed", async () => {
  fs.writeFileSync(filePath, JSON.stringify(["before"]), "utf8");
  const store = createAdminGroupsStore({ filePath, cacheTtlMs: 10000 });
  assert.deepEqual(await store.readFresh(), ["before"]);

  fs.writeFileSync(filePath, JSON.stringify(["after"]), "utf8");
  store.invalidate();
  assert.deepEqual(await store.readFresh(), ["after"]);

  fs.writeFileSync(filePath, "{invalid", "utf8");
  store.invalidate();
  assert.deepEqual(await store.readFresh(), [],
    "a corrupt allow-list must not continue authorizing previously cached groups");
});

test("a stalled admin-group file read does not block the event loop", async () => {
  const store = createAdminGroupsStore({
    filePath: path.join(tempDir, "missing-admin-groups.json"),
    cacheTtlMs: 500
  });

  let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; }, 0);
  try {
    await store.readFresh();
  } finally {
    clearTimeout(timer);
  }

  assert.equal(timerFired, true, "the timer must run while the async file read is pending");
});
