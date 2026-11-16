"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.JT_DB_DRIVER = "json";
process.env.JT_DB_FILE = path.join(os.tmpdir(), "johntran-supabase-config-test-" + process.pid + ".json");
const { resolveDatabaseConfig } = require("../utils/db");
const { TABLE_MAP } = require("../core/storage/supabase");

test("database selects JSON when no Supabase credentials or driver are configured", () => {
  assert.deepEqual(resolveDatabaseConfig({}), {
    driver: "json", url: "", serviceKey: "", forced: false
  });
});

test("database selects Supabase only with URL and service-role key", () => {
  const config = resolveDatabaseConfig({
    SUPABASE_URL: "https://unit-test.supabase.co",
    SUPABASE_SERVICE_KEY: "unit-test-service-role"
  });
  assert.equal(config.driver, "supabase");
  assert.equal(config.url, "https://unit-test.supabase.co");
  assert.equal(config.serviceKey, "unit-test-service-role");
  assert.equal(config.keyName, "SUPABASE_SERVICE_KEY");
});

test("modern Supabase Secret API key is preferred over the legacy service_role key", () => {
  const config = resolveDatabaseConfig({
    SUPABASE_URL: "https://unit-test.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_unit_test",
    SUPABASE_SERVICE_KEY: "legacy-key-must-not-win"
  });
  assert.equal(config.driver, "supabase");
  assert.equal(config.serviceKey, "sb_secret_unit_test");
  assert.equal(config.keyName, "SUPABASE_SECRET_KEY");
});

test("explicit Supabase driver fails fast when either credential is missing", () => {
  assert.throws(
    () => resolveDatabaseConfig({ JT_DB_DRIVER: "supabase", SUPABASE_URL: "https://unit-test.supabase.co" }),
    /SUPABASE_SERVICE_KEY/
  );
  assert.throws(
    () => resolveDatabaseConfig({ JT_DB_DRIVER: "supabase", SUPABASE_SERVICE_KEY: "secret" }),
    /SUPABASE_URL/
  );
});

test("partial Supabase configuration never silently falls back to JSON", () => {
  assert.throws(
    () => resolveDatabaseConfig({ SUPABASE_URL: "https://unit-test.supabase.co" }),
    /cần SUPABASE_URL và SUPABASE_SECRET_KEY/
  );
  assert.throws(
    () => resolveDatabaseConfig({
      SUPABASE_URL: "https://unit-test.supabase.co",
      SUPABASE_ANON_KEY: "publishable-or-anon-only"
    }),
    /SUPABASE_SERVICE_KEY/
  );
});

test("explicit JSON mode remains available and overrides configured Supabase credentials", () => {
  const config = resolveDatabaseConfig({
    JT_DB_DRIVER: "json",
    SUPABASE_URL: "https://unit-test.supabase.co",
    SUPABASE_SERVICE_KEY: "unit-test-service-role"
  });
  assert.equal(config.driver, "json");
  assert.equal(config.forced, true);
  assert.equal(config.serviceKey, "");
});

test("conflicting or unknown database driver settings are rejected", () => {
  assert.throws(
    () => resolveDatabaseConfig({ JT_DB_DRIVER: "supabase", SUPABASE_DISABLE: "true" }),
    /xung đột/
  );
  assert.throws(
    () => resolveDatabaseConfig({ JT_DB_DRIVER: "postgres" }),
    /chỉ nhận json hoặc supabase/
  );
});

test("Supabase table map is fully represented in the SQL schema", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "supabase", "schema.sql"), "utf8");
  for (const table of Object.values(TABLE_MAP)) {
    assert.match(schema, new RegExp("create table if not exists " + table + "\\s*\\("),
      "schema missing table " + table);
    assert.match(schema, new RegExp("alter table " + table + " enable row level security"),
      "RLS missing for " + table);
  }
  assert.match(schema, /grant all privileges on table[\s\S]*to service_role/);
});
