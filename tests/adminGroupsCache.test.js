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

test("admin-group reads reuse the short-lived in-memory cache", () => {
  let clock = 1000;
  fs.writeFileSync(filePath, JSON.stringify(["group-a"]), "utf8");
  const store = createAdminGroupsStore({
    filePath,
    cacheTtlMs: 500,
    now: () => clock
  });

  assert.deepEqual(store.read(), ["group-a"]);
  assert.equal(store.getStats().diskReads, 1);
  assert.deepEqual(store.read(), ["group-a"]);
  assert.equal(store.getStats().diskReads, 1, "hot reads must not read the JSON file again");

  clock += 501;
  assert.deepEqual(store.read(), ["group-a"]);
  assert.equal(store.getStats().diskReads, 1,
    "an unchanged file should be verified by metadata without parsing JSON again");
});

test("admin-group writes update the cache immediately and preserve the array format", () => {
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

test("admin-group cache invalidation reloads external changes and corrupt data fails closed", () => {
  fs.writeFileSync(filePath, JSON.stringify(["before"]), "utf8");
  const store = createAdminGroupsStore({ filePath, cacheTtlMs: 10000 });
  assert.deepEqual(store.read(), ["before"]);

  fs.writeFileSync(filePath, JSON.stringify(["after"]), "utf8");
  store.invalidate();
  assert.deepEqual(store.read(), ["after"]);

  fs.writeFileSync(filePath, "{invalid", "utf8");
  store.invalidate();
  assert.deepEqual(store.read(), [],
    "a corrupt allow-list must not continue authorizing previously cached groups");
});
