/**
 * Database optimization script for Supabase (PostgreSQL)
 * - Creates necessary indexes
 * - Provides PgBouncer connection pooling configuration
 * - Exposes migration SQL runnable against Supabase
 * - Health check for database connectivity
 */

"use strict";

const { createClient } = require("@supabase/supabase-js");

const TABLES = {
  bot_threads: { idField: "threadId", uniqueId: true, updatedAt: true },
  bot_users: { idField: "userId", uniqueId: true, updatedAt: true },
  bot_metrics: { idField: "day", uniqueId: true, updatedAt: false },
  bot_stats: { idField: "name", uniqueId: true, updatedAt: true }
};

const INDEX_DEFINITIONS = [
  { table: "bot_threads", name: "bot_threads_thread_id_uidx", columns: ["(data->>'threadId')"], unique: true, note: "Unique index on bot_threads.threadId (jsonb data key)" },
  { table: "bot_threads", name: "bot_threads_updated_at_idx", columns: ["updated_at DESC"], unique: false, note: "Index on bot_threads.updatedAt (updated_at)" },
  { table: "bot_users", name: "bot_users_user_id_uidx", columns: ["(data->>'userId')"], unique: true, note: "Unique index on bot_users.userId (jsonb data key)" },
  { table: "bot_users", name: "bot_users_updated_at_idx", columns: ["updated_at DESC"], unique: false, note: "Index on bot_users.updatedAt (updated_at)" },
  { table: "bot_metrics", name: "bot_metrics_day_uidx", columns: ["(data->>'day')"], unique: true, note: "Unique index on bot_metrics.day (jsonb data key)" },
  { table: "bot_stats", name: "bot_stats_name_uidx", columns: ["(data->>'name')"], unique: true, note: "Unique index on bot_stats.name (jsonb data key)" },
  { table: "bot_stats", name: "bot_stats_updated_at_idx", columns: ["updated_at DESC"], unique: false, note: "Index on bot_stats.updatedAt (updated_at)" }
];

function getPgBouncerConfig(env = process.env) {
  let projectRef = env.SUPABASE_PROJECT_REF || "<project-ref>";
  try { if (!env.SUPABASE_PROJECT_REF && env.SUPABASE_URL) projectRef = new URL(env.SUPABASE_URL).host.split(".")[0] || projectRef; } catch {}
  const region = env.SUPABASE_REGION || "<region>";
  const dbName = env.SUPABASE_DB_NAME || "postgres";
  const dbUser = env.SUPABASE_DB_USER || `postgres.${projectRef}`;
  const poolPort = Number(env.PGBOUNCER_PORT || 6543);
  const directPort = Number(env.POSTGRES_PORT || 5432);
  return {
    mode: "transaction",
    description: "Use Supabase PgBouncer (transaction pooler) for serverless/high-churn workloads; use direct for migrations/DDL.",
    pooler: { host: env.PGBOUNCER_HOST || `aws-0-${region}.pooler.supabase.com`, port: poolPort, database: dbName, user: dbUser, sslmode: "require", pgbouncer: true, preparedStatements: false, statementCacheSize: 0 },
    direct: { host: env.POSTGRES_HOST || `db.${projectRef}.supabase.co`, port: directPort, database: dbName, user: "postgres", sslmode: "require", preparedStatements: true },
    connectionStringTemplates: {
      pooled: env.DATABASE_POOL_URL || `postgresql://${dbUser}:<db-password>@aws-0-${region}.pooler.supabase.com:${poolPort}/${dbName}?sslmode=require&pgbouncer=true&connection_limit=1`,
      direct: env.DATABASE_URL || `postgresql://postgres:<db-password>@db.${projectRef}.supabase.co:${directPort}/${dbName}?sslmode=require`
    },
    recommendedPool: { max: Number(env.DB_POOL_MAX || 10), min: Number(env.DB_POOL_MIN || 0), idleTimeoutMillis: Number(env.DB_POOL_IDLE_MS || 30000), connectionTimeoutMillis: Number(env.DB_POOL_CONNECT_TIMEOUT_MS || 10000), allowExitOnIdle: true },
    supabaseJs: { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "x-client-info": "johntran-bot/optimizeDb" } }, db: { schema: "public" } },
    notes: [
      "PostgREST/Supabase JS is HTTP-based; reuse a single client instance for connection reuse.",
      "For direct Postgres drivers on port 6543, disable prepared statements in transaction mode.",
      "For migrations and DDL, prefer the direct connection (port 5432)."
    ]
  };
}

function buildMigrationSql() {
  const lines = [];
  lines.push("-- JOHNTRAN Bot - Supabase/PostgreSQL optimization migration");
  lines.push("-- Safe to re-run (idempotent). Run in Supabase SQL Editor or via psql (direct connection).");
  lines.push("");
  lines.push("begin;");
  lines.push("");
  for (const idx of INDEX_DEFINITIONS) {
    const unique = idx.unique ? "unique " : "";
    lines.push(`-- ${idx.note}`);
    lines.push(`create ${unique}index if not exists ${idx.name} on public.${idx.table} (${idx.columns.join(", ")});`);
    lines.push("");
  }
  lines.push("-- Ensure updated_at defaults exist (no-op if already set)");
  for (const t of ["bot_threads", "bot_users", "bot_metrics", "bot_stats"]) {
    lines.push(`alter table if exists public.${t} alter column updated_at set default now();`);
  }
  lines.push("");
  lines.push("-- Refresh planner statistics");
  lines.push("analyze public.bot_threads;");
  lines.push("analyze public.bot_users;");
  lines.push("analyze public.bot_metrics;");
  lines.push("analyze public.bot_stats;");
  lines.push("");
  lines.push("commit;");
  lines.push("");
  lines.push("-- Verification (optional):");
  lines.push("-- select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ('bot_threads','bot_users','bot_metrics','bot_stats') order by tablename, indexname;");
  return lines.join("\n");
}

function getSupabaseClient(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "x-client-info": "johntran-bot/optimizeDb-health" } } });
}

async function checkDatabaseHealth(options = {}) {
  const env = options.env || process.env;
  const client = options.client || getSupabaseClient(env);
  const started = Date.now();
  const result = { ok: false, latencyMs: null, checkedAt: new Date().toISOString(), tables: {}, error: null, details: {} };
  if (!client) { result.error = "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY"; result.latencyMs = Date.now() - started; return result; }
  const tables = ["bot_threads", "bot_users", "bot_metrics", "bot_stats"];
  try {
    const probe = await client.from("bot_threads").select("id", { head: true, count: "exact" }).limit(1);
    result.latencyMs = Date.now() - started;
    if (probe.error) throw probe.error;
    for (const table of tables) {
      const t0 = Date.now();
      const res = await client.from(table).select("id", { head: true, count: "exact" }).limit(1);
      result.tables[table] = { ok: !res.error, latencyMs: Date.now() - t0, count: typeof res.count === "number" ? res.count : null, error: res.error ? res.error.message : null };
    }
    result.ok = Object.values(result.tables).every((t) => t.ok);
    try { result.details.projectHost = new URL(env.SUPABASE_URL).host; } catch { result.details.projectHost = null; }
    return result;
  } catch (error) {
    result.latencyMs = Date.now() - started;
    result.error = error && error.message ? error.message : String(error);
    result.ok = false;
    return result;
  }
}

function printHelp() {
  console.log(`optimizeDb.js\n  --sql       Print migration SQL\n  --pgbouncer Print PgBouncer/connection pooling config (JSON)\n  --health    Run database connectivity health check (requires SUPABASE_URL + SUPABASE_SERVICE_KEY)\n  --json      Output machine-readable JSON\n  (no flags)  Print migration SQL and PgBouncer config`);
}

async function main(argv = process.argv.slice(2)) {
  const flags = new Set(argv);
  const jsonOut = flags.has("--json");
  const sql = buildMigrationSql();
  const pgbouncer = getPgBouncerConfig();
  if (flags.has("--help") || flags.has("-h")) { printHelp(); return; }
  if (flags.has("--health")) { const health = await checkDatabaseHealth(); console.log(JSON.stringify(health, null, 2)); process.exitCode = health.ok ? 0 : 1; return; }
  if (flags.has("--sql")) { console.log(sql); return; }
  if (flags.has("--pgbouncer")) { console.log(JSON.stringify(pgbouncer, null, 2)); return; }
  if (jsonOut) { console.log(JSON.stringify({ migrationSql: sql, pgbouncer }, null, 2)); return; }
  console.log(sql);
  console.log("\n/* PgBouncer / connection pooling configuration */");
  console.log(JSON.stringify(pgbouncer, null, 2));
}

if (require.main === module) {
  main().catch((err) => { console.error("[optimizeDb] failed:", err && err.stack ? err.stack : err); process.exitCode = 1; });
}

module.exports = { TABLES, INDEX_DEFINITIONS, getPgBouncerConfig, buildMigrationSql, checkDatabaseHealth };
