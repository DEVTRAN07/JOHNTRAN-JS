const path = require("path");
const fs = require("fs");
const logger = require("./logger");
const { JsonStore } = require("../core/storage");
const { SupabaseStore } = require("../core/storage/supabase");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

const forceJson =
  String(process.env.JT_DB_DRIVER || "").toLowerCase() === "json" ||
  String(process.env.SUPABASE_DISABLE || "").toLowerCase() === "true";

let db;

if (!forceJson && SUPABASE_URL && SUPABASE_KEY) {
  db = new SupabaseStore(SUPABASE_URL, SUPABASE_KEY);
  logger.log("Database: Supabase (bot_threads / bot_users / bot_metrics)", "info");
} else {
  if (forceJson && (SUPABASE_URL || SUPABASE_KEY)) {
    logger.log("Database: forced JSON store (JT_DB_DRIVER/SUPABASE_DISABLE) mặc dù Supabase env có sẵn", "warn");
  }
  const persistentRoot = String(process.env.JT_DB_PERSISTENT_PATH || "").trim();
  const defaultDbFile = persistentRoot
    ? path.join(path.resolve(persistentRoot), "store.json")
    : path.join(__dirname, "..", "data", "store.json");
  const dbFile = process.env.JT_DB_FILE || defaultDbFile;
  const legacyDbFile = path.join(__dirname, "..", "data", "store.json");

  // One-time, non-destructive migration when a Render disk is configured.
  // Never overwrite an existing destination or remove the legacy copy.
  if (persistentRoot && !process.env.JT_DB_FILE && path.resolve(legacyDbFile) !== path.resolve(dbFile) &&
      fs.existsSync(legacyDbFile) && !fs.existsSync(dbFile)) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    fs.copyFileSync(legacyDbFile, dbFile, fs.constants.COPYFILE_EXCL);
    logger.log("Đã sao chép database JSON cũ sang JT_DB_PERSISTENT_PATH (giữ nguyên file nguồn).", "info");
  }

  db = new JsonStore(dbFile, ["Users", "Threads", "Metrics", "BotStats"]);
  logger.log(`Database: JSON store (${dbFile})`, "info");
  if (process.env.RENDER) {
    logger.log("CẢNH BÁO: JSON store trên Render có thể mất dữ liệu khi redeploy/restart nếu không gắn Persistent Disk. Dùng Supabase hoặc Persistent Disk để giữ cấu hình bot_enabled.", "warn");
  }
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
function createDatabaseFacade(backend) {
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
    db: backend
  };
}

module.exports = createDatabaseFacade(db);
module.exports.createDatabaseFacade = createDatabaseFacade;
