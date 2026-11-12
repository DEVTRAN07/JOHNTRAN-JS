const path = require("path");
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
    if (process.env.RENDER) {
      logger.log("CẢNH BÁO: JSON store trên Render là ephemeral — dữ liệu mất khi redeploy/restart.", "warn");
    }
  }
  const dbFile = process.env.JT_DB_FILE || path.join(__dirname, "..", "data", "store.json");
  db = new JsonStore(dbFile, ["Users", "Threads", "Metrics", "BotStats"]);
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
