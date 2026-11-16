const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const { JsonStore } = require("../core/storage");
const { SupabaseStore } = require("../core/storage/supabase");
const { getJsonPersistenceStatus } = require("../core/storage/diagnostics");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const PERSISTENT_DIR = process.env.JT_PERSISTENT_DIR || process.env.JT_DB_PERSISTENT_PATH || "";

const forceJson =
  String(process.env.JT_DB_DRIVER || "").toLowerCase() === "json" ||
  String(process.env.SUPABASE_DISABLE || "").toLowerCase() === "true";

let db;
let dbFile = null;

if (!forceJson && SUPABASE_URL && SUPABASE_KEY) {
  db = new SupabaseStore(SUPABASE_URL, SUPABASE_KEY);
  logger.log("Database: Supabase (bot_threads / bot_users / bot_metrics)", "info");
} else {
  if (forceJson && (SUPABASE_URL || SUPABASE_KEY)) {
    logger.log("Database: forced JSON store (JT_DB_DRIVER/SUPABASE_DISABLE) mặc dù Supabase env có sẵn", "warn");
  }
  // Khi có Persistent Disk nhưng không chỉ định JT_DB_FILE, đặt file JSON
  // trực tiếp trong mount path để tránh ghi nhầm vào filesystem tạm của Render.
  dbFile = process.env.JT_DB_FILE ||
    (PERSISTENT_DIR ? path.join(PERSISTENT_DIR, "store.json") : path.join(__dirname, "..", "data", "store.json"));

  // Copy the old master JSON database into the configured disk on first use.
  // The source is retained, and an existing destination is never overwritten.
  const legacyDbFile = path.join(__dirname, "..", "data", "store.json");
  if (PERSISTENT_DIR && !process.env.JT_DB_FILE &&
      path.resolve(legacyDbFile) !== path.resolve(dbFile) &&
      fs.existsSync(legacyDbFile) && !fs.existsSync(dbFile)) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    fs.copyFileSync(legacyDbFile, dbFile, fs.constants.COPYFILE_EXCL);
    logger.log("Đã sao chép master store.json sang JT_PERSISTENT_DIR; giữ nguyên file nguồn.", "info");
  }

  db = new JsonStore(dbFile, ["Users", "Threads", "Metrics", "BotStats"]);
  logger.log(`Database: JSON store (${dbFile})`, "info");
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) {
    logger.log("CẢNH BÁO: JSON store trên Render chỉ bền vững khi JT_DB_FILE nằm trong Persistent Disk đã gắn. Cấu hình JT_PERSISTENT_DIR đúng mount path để kiểm tra.", "warn");
  }
}

function isPathInside(filePath, directoryPath) {
  if (!filePath || !directoryPath) return false;
  const relative = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Use the shared filesystem inspector so the storage adapter and Panel agree
 * on what counts as a verified Render disk mount.
 */
function inspectPersistentDisk({ render = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID), mountPath = PERSISTENT_DIR, databaseFile = dbFile } = {}) {
  if (!render) {
    return { applicable: false, status: "not_applicable", mounted: null, databaseFileOnDisk: null, mountPath: null };
  }

  const report = getJsonPersistenceStatus(databaseFile || path.join(process.cwd(), "data", "store.json"), {
    RENDER: "true",
    RENDER_SERVICE_ID: "render",
    JT_DB_PERSISTENT_PATH: mountPath || ""
  });
  const rawStatus = report.status;
  const status = rawStatus === "verified-mount" ? "mounted_and_used"
    : rawStatus === "database-outside-disk" ? "database_outside_disk"
      : rawStatus === "mount-not-verified" ? "mount_not_verified"
        : rawStatus === "mount-detected-unverified" ? "mount_detected_unverified"
          : "unknown";

  return {
    applicable: true,
    status,
    rawStatus,
    mounted: rawStatus === "verified-mount" ? true : rawStatus === "mount-not-verified" ? false : null,
    databaseFileOnDisk: mountPath ? rawStatus !== "database-outside-disk" : null,
    mountPath: report.configuredRoot || report.mountPoint || null,
    fsType: report.fsType || null,
    message: report.message
  };
}

function getDatabaseStatus(backend = db, options = {}) {
  if (!backend) {
    return { driver: "unknown", ok: false, message: "Database backend chưa khởi tạo." };
  }

  if (typeof backend.getStatus === "function" && typeof backend.healthCheck === "function") {
    const source = backend.getStatus() || {};
    return {
      driver: "supabase",
      ok: source.ok === true,
      lastSyncAt: source.lastSyncAt || null,
      syncError: source.syncError || null,
      consecutiveFailures: source.consecutiveFailures || 0,
      classified: source.classified || null,
      metrics: source.metrics || null,
      storage: {
        kind: "remote_database",
        persistent: true,
        message: "Dữ liệu được lưu trên Supabase, không phụ thuộc filesystem của Render."
      }
    };
  }

  const source = typeof backend.getStatus === "function" ? (backend.getStatus() || {}) : {};
  const filePath = options.databaseFile || source.filePath || backend.file || dbFile;
  let stat = null;
  if (filePath) {
    try { stat = fs.statSync(path.resolve(filePath)); } catch { /* file chưa được tạo trước lần ghi đầu tiên */ }
  }
  const file = {
    exists: source.fileExists !== undefined ? source.fileExists : Boolean(stat?.isFile()),
    sizeBytes: source.fileSizeBytes != null ? source.fileSizeBytes : (stat?.size || 0),
    modifiedAt: stat?.mtime?.toISOString?.() || null
  };

  const render = options.render !== undefined
    ? Boolean(options.render)
    : Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
  const persistentDisk = inspectPersistentDisk({
    render,
    mountPath: options.persistentDir !== undefined ? options.persistentDir : PERSISTENT_DIR,
    databaseFile: filePath
  });
  const durability = persistentDisk.status === "mounted_and_used" ? "persistent"
    : persistentDisk.status === "database_outside_disk" ? "disk_not_used"
      : persistentDisk.status === "not_applicable" ? "local"
        : "unknown";
  const lastFlushError = source.lastFlushError || source.loadError ||
    backend.lastFlushError || backend.loadError || null;
  const healthy = source.ok !== undefined ? source.ok === true : !lastFlushError;

  return {
    driver: "json",
    ok: healthy,
    ready: source.ready !== undefined ? source.ready : true,
    filePath: filePath ? path.resolve(filePath) : null,
    file,
    lastWriteAt: source.lastWriteAt || null,
    lastFlushAt: source.lastFlushAt || backend.lastFlushAt || null,
    pendingFlush: Boolean(source.pendingFlush),
    tableCounts: source.tableCounts || null,
    lastFlushError,
    persistentDisk,
    storage: {
      kind: "local_json",
      durability,
      persistent: durability === "persistent",
      message: render
        ? (durability === "persistent"
          ? "File JSON nằm trong Persistent Disk đã được xác minh."
          : durability === "disk_not_used"
            ? "JT_DB_FILE nằm ngoài JT_DB_PERSISTENT_PATH."
            : "Chưa xác minh được Persistent Disk; không được coi JSON store là lưu trữ bền vững.")
        : "JSON được lưu trên filesystem của máy chủ hiện tại."
    }
  };
}

/**
 * The storage engines already provide safe write behavior:
 * - JsonStore mutates its in-memory mirror and schedules an atomic disk flush.
 * - SupabaseStore updates its in-memory mirror and queues the remote write.
 *
 * Do not put reads or writes behind a timer queue here. The old 500ms batch
 * queue delayed cold-cache command reads and made controller contracts
 * inconsistent (some callers received Promises while expecting records).
 */
function createDatabaseFacade(backend, options = {}) {
  if (!backend) throw new TypeError("Database backend is required");

  return {
    getData(table, idField, id) {
      return backend.get(table, idField, id);
    },
    saveData(table, idField, id, data) {
      return backend.set(table, idField, id, data);
    },
    async saveDataAndWait(table, idField, id, data) {
      if (typeof backend.setAndWait === "function") {
        return backend.setAndWait(table, idField, id, data);
      }
      const result = await backend.set(table, idField, id, data);
      // JSON storage is local and synchronous; flush now so a successful
      // group toggle is already on disk before the bridge acknowledges it.
      if (typeof backend.flushSync === "function" && backend.flushSync() === false) {
        throw new Error("Không thể ghi cấu hình nhóm xuống file database");
      }
      return result;
    },
    hasData(table, idField, id) {
      return backend.has(table, idField, id);
    },
    delData(table, idField, id) {
      return backend.delete(table, idField, id);
    },
    allData(table) {
      return backend.all(table);
    },
    flush() {
      if (typeof backend.flushSync === "function") return backend.flushSync();
      if (typeof backend.flush === "function") return backend.flush();
      return undefined;
    },
    getStatus() {
      return getDatabaseStatus(backend, options);
    },
    async healthCheck() {
      const status = getDatabaseStatus(backend, options);
      if (typeof backend.healthCheck === "function") {
        try {
          const probe = await backend.healthCheck({ tables: ["bot_threads"] });
          return { ...status, ok: status.ok && probe.ok, probe };
        } catch (error) {
          return { ...status, ok: false, probe: { ok: false, error: error.message || String(error), checkedAt: new Date().toISOString() } };
        }
      }
      return {
        ...status,
        probe: {
          ok: status.ok,
          type: "local_file",
          checkedAt: new Date().toISOString(),
          fileExists: status.file?.exists || false,
          error: status.lastFlushError || null
        }
      };
    },
    db: backend
  };
}

const facade = createDatabaseFacade(db, {
  driver: typeof db?.healthCheck === "function" ? "supabase" : "json",
  databaseFile: dbFile,
  persistentDir: PERSISTENT_DIR,
  render: Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID)
});

module.exports = facade;
module.exports.createDatabaseFacade = createDatabaseFacade;
module.exports.getDatabaseStatus = getDatabaseStatus;
module.exports.inspectPersistentDisk = inspectPersistentDisk;
module.exports.isPathInside = isPathInside;
