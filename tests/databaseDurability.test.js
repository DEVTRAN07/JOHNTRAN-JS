"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { JsonStore } = require("../core/storage");
const {
  parseMountInfo,
  getJsonPersistenceStatus
} = require("../core/storage/diagnostics");
const {
  PERSISTENT_ROOT,
  botPaths,
  getStorageLayout,
  _test: botManagerTest
} = require("../panel/botManager");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-db-durability-"));
const dbFile = path.join(tempDir, "store.json");

// Isolate the module-level production database singleton in this test process.
process.env.JT_DB_DRIVER = "json";
process.env.JT_DB_FILE = path.join(tempDir, "module-store.json");
process.env.JT_PERSISTENT_DIR = tempDir;
process.env.RENDER = "true";

const {
  createDatabaseFacade,
  inspectPersistentDisk,
  isPathInside
} = require("../utils/db");

test("persistent disk status stays UNKNOWN when Render mount path is not configured", () => {
  const report = inspectPersistentDisk({
    render: true,
    mountPath: "",
    databaseFile: dbFile
  });

  assert.equal(report.applicable, true);
  assert.equal(report.status, "unknown");
  assert.equal(report.mounted, null);
  assert.equal(report.databaseFileOnDisk, null);
});

test("JSON status reports a disk mount separately from whether the DB file uses it", () => {
  const store = new JsonStore(dbFile, ["Threads"]);
  const facade = createDatabaseFacade(store, {
    render: true,
    persistentDir: tempDir,
    databaseFile: dbFile
  });

  const status = facade.getStatus();
  assert.equal(status.driver, "json");
  assert.equal(status.filePath, dbFile);
  assert.equal(status.persistentDisk.databaseFileOnDisk, true);
  // The test directory is not a mounted volume; the app must not call it persistent.
  assert.equal(status.persistentDisk.mounted, false);
  assert.equal(status.storage.durability, "unknown");
  assert.equal(status.storage.persistent, false);
});

test("JSON durability status warns when JT_DB_FILE is outside the configured disk", () => {
  const store = new JsonStore(dbFile, ["Threads"]);
  const outsideFile = path.join(os.tmpdir(), "johntran-outside-store.json");
  const status = createDatabaseFacade(store, {
    render: true,
    persistentDir: tempDir,
    databaseFile: outsideFile
  }).getStatus();

  assert.equal(status.persistentDisk.databaseFileOnDisk, false);
  assert.equal(isPathInside(outsideFile, tempDir), false);
  assert.notEqual(status.storage.durability, "persistent");
});

test("JSON saveDataAndWait performs a synchronous flush and reports file metadata", async () => {
  const store = new JsonStore(dbFile, ["Threads"]);
  const facade = createDatabaseFacade(store, {
    render: false,
    databaseFile: dbFile
  });

  await facade.saveDataAndWait("Threads", "threadId", "group-durable-test", { bot_enabled: true });
  const persisted = JSON.parse(fs.readFileSync(dbFile, "utf8"));
  assert.equal(persisted.Threads["group-durable-test"].data.bot_enabled, true);

  const status = facade.getStatus();
  assert.equal(status.ok, true);
  assert.equal(status.file.exists, true);
  assert.ok(status.lastFlushAt > 0);
  assert.equal(status.storage.durability, "local");
});

test("Supabase health check probes only the required bot_threads table and omits credentials", async () => {
  let requestedTables = null;
  const backend = {
    getStatus: () => ({
      ok: true,
      lastSyncAt: 123,
      syncError: null,
      consecutiveFailures: 0,
      classified: null,
      metrics: { healthChecks: 1 },
      serviceKey: "must-not-leak",
      url: "https://example.invalid"
    }),
    healthCheck: async ({ tables }) => {
      requestedTables = tables;
      return {
        ok: true,
        checkedAt: new Date().toISOString(),
        latencyMs: 7,
        tables: { bot_threads: { ok: true, latencyMs: 7, count: 3, error: null } }
      };
    }
  };

  const report = await createDatabaseFacade(backend).healthCheck();
  assert.deepEqual(requestedTables, ["bot_threads"]);
  assert.equal(report.driver, "supabase");
  assert.equal(report.ok, true);
  assert.equal(report.probe.tables.bot_threads.ok, true);
  assert.equal(Object.hasOwn(report, "serviceKey"), false);
  assert.equal(Object.hasOwn(report, "url"), false);
});


test("mountinfo parser verifies only a database path beneath a separate configured mount", () => {
  const mountInfo = [
    "29 20 0:26 / / rw,relatime - overlay overlay rw",
    "61 29 8:1 / /var/data rw,relatime - ext4 /dev/vda1 rw"
  ].join("\\n");
  const mounts = parseMountInfo(mountInfo);
  assert.equal(mounts.length, 2);
  assert.equal(mounts[1].mountPoint, "/var/data");
  const status = getJsonPersistenceStatus("/var/data/bots/main/store.json", {
    RENDER:"true",
    JT_PERSISTENT_DIR:"/var/data"
  }, mountInfo);
  assert.equal(status.status, "verified-mount");
  assert.equal(status.confirmed, true);
  assert.equal(status.mountPoint, "/var/data");
});

test("database outside JT_PERSISTENT_DIR is never reported as disk-backed", () => {
  const mountInfo = "61 29 8:1 / /var/data rw,relatime - ext4 /dev/vda1 rw";
  const status = getJsonPersistenceStatus("/opt/render/project/src/data/store.json", {
    RENDER:"true",
    JT_PERSISTENT_DIR:"/var/data"
  }, mountInfo);
  assert.equal(status.status, "database-outside-disk");
  assert.equal(status.confirmed, false);
});

test("bot registry and child database paths follow JT_PERSISTENT_DIR", () => {
  assert.equal(PERSISTENT_ROOT, path.resolve(tempDir));
  assert.equal(botPaths("child-one").dbFile, path.join(tempDir, "bots", "child-one", "store.json"));
  assert.equal(getStorageLayout().registryFile, path.join(tempDir, "data", "bots.json"));
});

test("legacy file migration copies without deleting or overwriting either source or destination", () => {
  const source = path.join(tempDir, "legacy", "store.json");
  const destination = path.join(tempDir, "persistent", "bots", "main", "store.json");
  fs.mkdirSync(path.dirname(source), { recursive:true });
  fs.writeFileSync(source, "{\"keep\":true}", "utf8");

  assert.equal(botManagerTest.migrateFileIfMissing(source, destination), true);
  assert.equal(fs.existsSync(source), true, "legacy source must remain intact");
  assert.equal(fs.readFileSync(destination, "utf8"), "{\"keep\":true}");

  fs.writeFileSync(source, "{\"keep\":false}", "utf8");
  assert.equal(botManagerTest.migrateFileIfMissing(source, destination), false);
  assert.equal(fs.readFileSync(destination, "utf8"), "{\"keep\":true}",
    "an existing destination must never be overwritten");
});

test("corrupt JSON store fails closed and preserves the original file", () => {
  const corruptFile = path.join(tempDir, "corrupt-store.json");
  const original = "{ this is not valid JSON";
  fs.writeFileSync(corruptFile, original, "utf8");
  const store = new JsonStore(corruptFile, ["Threads"]);

  assert.equal(store.getStatus().ok, false);
  assert.match(store.getStatus().lastLoadError, /JSON|Unexpected|Expected/i);
  assert.throws(
    () => store.set("Threads", "threadId", "group-1", { bot_enabled:true }),
    /từ chối ghi đè/
  );
  assert.equal(fs.readFileSync(corruptFile, "utf8"), original,
    "a failed JSON parse must not be replaced by an empty store");
});
