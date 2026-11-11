const path = require("path");
const logger = require("./logger");
const { JsonStore } = require("../core/storage");
const { SupabaseStore } = require("../core/storage/supabase");
const { createBatchDb } = require("./batchDb");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

const forceJson =
  String(process.env.JT_DB_DRIVER || "").toLowerCase() === "json" ||
  String(process.env.SUPABASE_DISABLE || "").toLowerCase() === "true";

let db;

if (!forceJson && SUPABASE_URL && SUPABASE_KEY) {
  // Deploy (Koyeb): database bền vững trên Supabase — container restart không mất dữ liệu
  db = new SupabaseStore(SUPABASE_URL, SUPABASE_KEY);
  logger.log("Database: Supabase (bot_threads / bot_users / bot_metrics)", "info");
} else {
  if (forceJson && (SUPABASE_URL || SUPABASE_KEY)) {
    logger.log("Database: forced JSON store (JT_DB_DRIVER/SUPABASE_DISABLE) mặc dù Supabase env có sẵn", "warn");
    if (process.env.RENDER) {
      logger.log("CẢNH BÁO: JSON store trên Render là ephemeral — dữ liệu mất khi redeploy/restart.", "warn");
    }
  }
  // Local/dev: JSON store atomic trên đĩa
  const dbFile = process.env.JT_DB_FILE || path.join(__dirname, "..", "data", "store.json");
  db = new JsonStore(dbFile, ["Users", "Threads", "Metrics", "BotStats"]);
  logger.log(`Database: JSON store (${path.basename(dbFile)})`, "info");
}

const batchDb = createBatchDb(db);

module.exports = {
  getData: batchDb.getData,
  saveData: batchDb.saveData,
  hasData: batchDb.hasData,
  delData: batchDb.delData,
  allData: batchDb.allData,
  db,
  flush: batchDb.flush
};
