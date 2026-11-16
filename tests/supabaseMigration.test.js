"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  migrateJsonToSupabase,
  toSupabaseRows
} = require("../scripts/migrate-json-to-supabase");

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-supabase-import-"));
  const sourceFile = path.join(directory, "store.json");
  const original = {
    Threads: {
      "group-on": { threadId: "group-on", data: { bot_enabled: true, prefix: "/" }, updatedAt: 1700000000000 },
      "group-off": { threadId: "group-off", data: { bot_enabled: false, prefix: "/" }, updatedAt: 1700000000000 }
    },
    Users: {
      "user-1": { userId: "user-1", data: { ban: false, name: "User One" } }
    },
    Metrics: {},
    BotStats: {
      "bot-main": { id: "bot-main", data: { commands: 5 } }
    },
    MediaCache: {
      "media-1": { id: "media-1", data: { type: "image", url: "https://example.invalid/image" } }
    }
  };
  fs.writeFileSync(sourceFile, JSON.stringify(original, null, 2));
  return { directory, sourceFile, original };
}

function fakeSupabase(existingByTable = {}) {
  const rowsByTable = new Map();
  for (const [table, ids] of Object.entries(existingByTable)) rowsByTable.set(table, new Set(ids));
  const upserts = [];

  return {
    upserts,
    from(table) {
      if (!rowsByTable.has(table)) rowsByTable.set(table, new Set());
      const existing = rowsByTable.get(table);
      return {
        select() {
          return {
            in: async (_column, ids) => ({
              data: ids.filter(id => existing.has(id)).map(id => ({ id })),
              error: null
            })
          };
        },
        upsert(rows, options) {
          return {
            select: async () => {
              upserts.push({ table, rows, options });
              const inserted = [];
              for (const row of rows) {
                if (existing.has(row.id)) continue;
                existing.add(row.id);
                inserted.push({ id: row.id });
              }
              return { data: inserted, error: null };
            }
          };
        }
      };
    }
  };
}

test("Supabase migration dry-run only counts JSON rows and does not require credentials", async () => {
  const fixture = createFixture();
  try {
    const summary = await migrateJsonToSupabase({ sourceFile: fixture.sourceFile, dryRun: true });
    assert.equal(summary.total, 5);
    assert.equal(summary.planned, 5);
    assert.equal(summary.inserted, 0);
    assert.equal(summary.skippedExisting, 0);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("Supabase migration imports missing rows across every table without overwriting existing rows", async () => {
  const fixture = createFixture();
  const client = fakeSupabase({
    bot_threads: ["group-on"]
  });
  try {
    const summary = await migrateJsonToSupabase({
      sourceFile: fixture.sourceFile,
      client,
      dryRun: false,
      batchSize: 2
    });

    assert.equal(summary.total, 5);
    assert.equal(summary.inserted, 4);
    assert.equal(summary.skippedExisting, 1);
    assert.ok(client.upserts.every(item => item.options.ignoreDuplicates === true));
    assert.ok(client.upserts.every(item => item.rows.every(row => row.id !== "group-on")));
    const threadImport = client.upserts.find(item => item.table === "bot_threads");
    assert.ok(threadImport);
    assert.equal(threadImport.rows.find(row => row.id === "group-off").data.bot_enabled, false);
    assert.equal(fixture.original.Threads["group-on"].data.bot_enabled, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.sourceFile, "utf8")), fixture.original,
      "the source JSON backup must remain byte-for-byte logically unchanged");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("Supabase migration rejects missing credentials before attempting a real import", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(
      migrateJsonToSupabase({
        sourceFile: fixture.sourceFile,
        dryRun: false,
        supabaseUrl: "",
        serviceKey: ""
      }),
      /SUPABASE_URL và SUPABASE_SECRET_KEY/
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("Supabase migration stops on invalid record data instead of silently dropping settings", () => {
  assert.throws(
    () => toSupabaseRows({ "bad-group": { threadId: "bad-group" } }, "Threads"),
    /thiếu data object/
  );
});
