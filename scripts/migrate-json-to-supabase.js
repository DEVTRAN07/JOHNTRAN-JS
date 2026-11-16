#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TABLE_MAP = Object.freeze({
  Users: "bot_users",
  Threads: "bot_threads",
  Metrics: "bot_metrics",
  BotStats: "bot_stats",
  MediaCache: "bot_media_cache"
});

function parseJsonDatabase(sourceFile) {
  const resolved = path.resolve(sourceFile);
  if (!fs.existsSync(resolved)) throw new Error("Không tìm thấy JSON database: " + resolved);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("Đường dẫn JSON database không phải file.");
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Cấu trúc JSON database không hợp lệ.");
  }
  return parsed;
}

function toSupabaseRows(tableData, tableName) {
  if (tableData == null) return [];
  if (typeof tableData !== "object" || Array.isArray(tableData)) {
    throw new Error("Bảng JSON " + tableName + " không phải object.");
  }

  return Object.entries(tableData).map(([key, record]) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("Bản ghi " + tableName + "/" + key + " không hợp lệ.");
    }
    const data = record.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Bản ghi " + tableName + "/" + key + " thiếu data object; dừng để tránh nhập sai.");
    }

    const rawUpdatedAt = record.updated_at || record.updatedAt;
    const parsedTime = rawUpdatedAt == null ? NaN
      : (typeof rawUpdatedAt === "number" ? rawUpdatedAt : Date.parse(rawUpdatedAt));
    return {
      id: String(key),
      data,
      updated_at: Number.isFinite(parsedTime)
        ? new Date(parsedTime).toISOString()
        : new Date(0).toISOString()
    };
  });
}

function createMigrationBackup(sourceFile, now = Date.now()) {
  const resolved = path.resolve(sourceFile);
  const backupFile = resolved + ".pre-supabase-" + now + ".bak";
  fs.copyFileSync(resolved, backupFile, fs.constants.COPYFILE_EXCL);
  const sourceSize = fs.statSync(resolved).size;
  const backupSize = fs.statSync(backupFile).size;
  if (sourceSize !== backupSize) {
    try { fs.unlinkSync(backupFile); } catch {}
    throw new Error("Backup JSON không khớp dung lượng nguồn; dừng import.");
  }
  return backupFile;
}

function chunk(items, size) {
  const output = [];
  for (let offset = 0; offset < items.length; offset += size) {
    output.push(items.slice(offset, offset + size));
  }
  return output;
}

/**
 * Imports legacy JSON records without overwriting rows already present in
 * Supabase. Source JSON is read-only and is never renamed or deleted.
 *
 * dryRun defaults to true. Actual import must be explicitly requested.
 */
async function migrateJsonToSupabase({
  sourceFile = process.env.JT_DB_FILE || path.join(process.cwd(), "data", "store.json"),
  client = null,
  supabaseUrl = process.env.SUPABASE_URL || "",
  serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || "",
  dryRun = true,
  batchSize = 100,
  log = () => {}
} = {}) {
  const database = parseJsonDatabase(sourceFile);
  const size = Math.min(500, Math.max(1, Number(batchSize) || 100));
  const summary = {
    sourceFile: path.resolve(sourceFile),
    dryRun: Boolean(dryRun),
    tables: {},
    total: 0,
    planned: 0,
    inserted: 0,
    skippedExisting: 0,
    backupFile: null
  };

  if (!dryRun && !client) {
    if (!supabaseUrl || !serviceKey) {
      throw new Error("Cần SUPABASE_URL và SUPABASE_SECRET_KEY (hoặc SUPABASE_SERVICE_KEY cũ) để import. Không dùng anon/publishable key.");
    }
    const { createClient } = require("@supabase/supabase-js");
    client = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  // Verify access to every destination table before the first write. This
  // prevents a partially imported database when one table is missing from
  // schema.sql or the server key lacks its required grants.
  if (!dryRun) {
    for (const supabaseTable of Object.values(TABLE_MAP)) {
      const { error } = await client.from(supabaseTable).select("id").limit(1);
      if (error) {
        throw new Error(
          "Supabase chưa sẵn sàng tại bảng " + supabaseTable +
          ": " + error.message + ". Hãy chạy đầy đủ supabase/schema.sql và kiểm tra server key/grants."
        );
      }
    }
  }

  if (!dryRun) {
    summary.backupFile = createMigrationBackup(sourceFile);
  }

  for (const [jsonTable, supabaseTable] of Object.entries(TABLE_MAP)) {
    const rows = toSupabaseRows(database[jsonTable] || {}, jsonTable);
    const tableSummary = {
      sourceRows: rows.length,
      planned: dryRun ? rows.length : 0,
      inserted: 0,
      skippedExisting: 0
    };
    summary.tables[supabaseTable] = tableSummary;
    summary.total += rows.length;

    if (dryRun || rows.length === 0) {
      summary.planned += rows.length;
      continue;
    }

    for (const batch of chunk(rows, size)) {
      const ids = batch.map(row => row.id);
      const { data: existingRows, error: readError } = await client
        .from(supabaseTable)
        .select("id")
        .in("id", ids);
      if (readError) {
        throw new Error("Không đọc được " + supabaseTable + " trước khi import: " + readError.message);
      }

      const existingIds = new Set((existingRows || []).map(row => String(row.id)));
      const missing = batch.filter(row => !existingIds.has(row.id));
      tableSummary.skippedExisting += batch.length - missing.length;
      summary.skippedExisting += batch.length - missing.length;
      if (!missing.length) continue;

      const { data: insertedRows, error: writeError } = await client
        .from(supabaseTable)
        .upsert(missing, { onConflict: "id", ignoreDuplicates: true })
        .select("id");
      if (writeError) {
        throw new Error("Import thất bại tại " + supabaseTable + ": " + writeError.message);
      }

      // Supabase returns the actually inserted rows because the query selects id.
      const insertedCount = Array.isArray(insertedRows) ? insertedRows.length : missing.length;
      tableSummary.inserted += insertedCount;
      summary.inserted += insertedCount;
      // If a concurrent writer inserted the same id, ignoreDuplicates protects
      // that row and the database's returned count can be lower than missing.
      const raced = missing.length - insertedCount;
      tableSummary.skippedExisting += raced;
      summary.skippedExisting += raced;
    }
  }

  log(summary);
  return summary;
}

function printHelp() {
  console.log("Usage:");
  console.log("  node scripts/migrate-json-to-supabase.js [jsonFile] --dry-run");
  console.log("  node scripts/migrate-json-to-supabase.js [jsonFile] --import-missing");
  console.log("");
  console.log("Default mode is dry-run. Import inserts only IDs absent from Supabase.");
  console.log("Existing Supabase rows are never overwritten; source JSON is never changed.");
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  const importRequested = argv.includes("--import-missing");
  const dryRun = !importRequested;
  const sourceFile = argv.find(arg => !arg.startsWith("--")) ||
    process.env.JT_DB_FILE || path.join(process.cwd(), "data", "store.json");

  if (!dryRun) {
    console.log("Chế độ IMPORT MISSING: chỉ chèn ID chưa tồn tại; không ghi đè bản ghi Supabase hiện có.");
  } else {
    console.log("Chế độ DRY-RUN: chỉ đọc JSON và đếm bản ghi; chưa kết nối/ghi Supabase.");
  }

  const summary = await migrateJsonToSupabase({
    sourceFile,
    dryRun,
    log: value => {
      for (const [table, stats] of Object.entries(value.tables)) {
        console.log(table + ": source=" + stats.sourceRows +
          ", inserted=" + stats.inserted +
          ", skippedExisting=" + stats.skippedExisting +
          ", planned=" + stats.planned);
      }
      console.log("TOTAL: source=" + value.total +
        ", inserted=" + value.inserted +
        ", skippedExisting=" + value.skippedExisting +
        ", planned=" + value.planned);
    }
  });

  if (dryRun) console.log("Chưa có dữ liệu nào được ghi. Thêm --import-missing để thực hiện import.");
  return summary ? 0 : 1;
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error("Supabase migration failed: " + (error.message || error));
    process.exitCode = 1;
  });
}

module.exports = { TABLE_MAP, parseJsonDatabase, toSupabaseRows, createMigrationBackup, migrateJsonToSupabase, main };
