const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const { JsonStore } = require("../core/storage");
const { SupabaseStore } = require("../core/storage/supabase");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";
const PERSISTENT_DIR = process.env.JT_PERSISTENT_DIR || "";

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
  if (process.env.RENDER) {
    logger.log("CẢNH BÁO: JSON store trên Render chỉ bền vững khi JT_DB_FILE nằm trong Persistent Disk đã gắn. Cấu hình JT_PERSISTENT_DIR đúng mount path để kiểm tra.", "warn");
  }
}

function isPathInside(filePath, directoryPath) {
  if (!filePath || !directoryPath) return false;
  const relative = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function decodeMountInfoPath(value) {
  return String(value || "").replace(/\\([0-7]{3})/g, (_match, octal) =>
    String.fromCharCode(parseInt(octal, 8))
  );
}

/**
 * Render does not expose a standard environment variable containing a disk
 * mount path. The owner must provide the exact Dashboard mount path through
 * JT_PERSISTENT_DIR. On Linux, /proc/self/mountinfo verifies the exact mount;
 * device IDs are used only as a fallback on other platforms.
 */
function inspectPersistentDisk({ render = Boolean(process.env.RENDER), mountPath = PERSISTENT_DIR, databaseFile = dbFile } = {}) {
  if (!render) {
    return { applicable: false, status: "not_applicable", mounted: null, databaseFileOnDisk: null, mountPath: null };
  }

  if (!mountPath) {
    return {
      applicable: true, status: "unknown", mounted: null, databaseFileOnDisk: null,
      mountPath: null, message: "Chưa cấu hình JT_PERSISTENT_DIR nên chưa thể xác minh Persistent Disk."
    };
  }

  const absoluteMount = path.resolve(mountPath);
  const absoluteDatabaseFile = databaseFile ? path.resolve(databaseFile) : "";
  const databaseFileOnDisk = isPathInside(absoluteDatabaseFile, absoluteMount);
  let mounted = null;

  try {
    const mountStat = fs.statSync(absoluteMount);
    if (!mountStat.isDirectory()) {
      mounted = false;
    } else if (process.platform === "linux" && fs.existsSync("/proc/self/mountinfo")) {
      const entries = fs.readFileSync("/proc/self/mountinfo", "utf8").split("\n");
      mounted = entries.some(line => {
        const separator = line.indexOf(" - ");
        if (separator < 0) return false;
        const fields = line.slice(0, separator).split(" ");
        return decodeMountInfoPath(fields[4]) === absoluteMount;
      });
    } else {
      const parent = fs.statSync(path.dirname(absoluteMount));
      mounted = String(mountStat.dev) !== String(parent.dev);
    }
  } catch {
    mounted = false;
  }

  const status = mounted
    ? (databaseFileOnDisk ? "mounted_and_used" : "mounted_but_unused")
    : "not_mounted";

  return {
    applicable: true,
    status,
    mounted,
    databaseFileOnDisk,
    mountPath: absoluteMount,
    message: status === "mounted_and_used"
      ? "Database JSON nằm bên trong Persistent Disk đã gắn."
      : status === "mounted_but_unused"
        ? "Có Persistent Disk nhưng JT_DB_FILE đang nằm ngoài mount path."
        : "Không phát hiện Persistent Disk tại JT_PERSISTENT_DIR đã cấu hình."
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

  const filePath = options.databaseFile || backend.file || dbFile;
  let file = { exists: false, sizeBytes: 0, modifiedAt: null };
  if (filePath) {
    try {
      const stat = fs.statSync(path.resolve(filePath));
      file = { exists: stat.isFile(), sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
    } catch { /* file chưa được tạo trước lần ghi đầu tiên */ }
  }

  const render = options.render !== undefined ? Boolean(options.render) : Boolean(process.env.RENDER);
  const persistentDisk = inspectPersistentDisk({
    render,
    mountPath: options.persistentDir !== undefined ? options.persistentDir : PERSISTENT_DIR,
    databaseFile: filePath
  });
  let durability = "local";
  if (render) {
    durability = persistentDisk.status === "mounted_and_used"
      ? "persistent"
      : persistentDisk.status === "mounted_but_unused"
        ? "disk_not_used"
        : persistentDisk.status === "not_mounted"
          ? "ephemeral"
          : "unknown";
  }

  return {
    driver: "json",
    ok: !backend.lastFlushError && !backend.lastLoadError,
    ready: true,
    filePath: filePath ? path.resolve(filePath) : null,
    file,
    lastFlushAt: backend.lastFlushAt || null,
    lastFlushError: backend.lastFlushError || backend.lastLoadError || null,
    persistentDisk,
    storage: {
      kind: "local_json",
      durability,
      persistent: durability === "persistent",
      message: render
        ? (durability === "persistent"
          ? "File JSON đang nằm trên Persistent Disk."
          : durability === "disk_not_used"
            ? "Persistent Disk đã gắn nhưng file database chưa nằm trong mount path."
            : durability === "ephemeral"
              ? "Không phát hiện Persistent Disk tại mount path đã cấu hình; dữ liệu có nguy cơ mất khi redeploy/restart."
              : "Chưa đủ thông tin để xác minh độ bền dữ liệu trên Render.")
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
  render: Boolean(process.env.RENDER)
});

module.exports = facade;
module.exports.createDatabaseFacade = createDatabaseFacade;
module.exports.getDatabaseStatus = getDatabaseStatus;
module.exports.inspectPersistentDisk = inspectPersistentDisk;
module.exports.isPathInside = isPathInside;
