"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { createErrorJournal, readJournalFile, readJournalFiles, normalizeContext } = require("../core/runtime/errorJournal");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-error-journal-"));
const files = [];

after(() => {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

function makeJournal(name, options = {}) {
  const filePath = path.join(tempDir, name + ".errors.jsonl");
  files.push(filePath);
  return createErrorJournal({ filePath, ...options });
}

test("error journal stores structured bot, command, group and source context", async () => {
  const journal = makeJournal("context");
  journal.recordError("stk failed", {
    bot: "main",
    source: "command",
    commandName: "stk",
    isGroup: true,
    groupId: "group-123"
  });
  await journal.flush();

  const snapshot = journal.snapshot();
  assert.equal(snapshot.summary.errors, 1);
  assert.equal(snapshot.events[0].bot, "main");
  assert.equal(snapshot.events[0].source, "command");
  assert.equal(snapshot.events[0].command, "stk");
  assert.equal(snapshot.events[0].groupId, "group-123");
  assert.equal(fs.existsSync(journal.filePath), true);
});

test("error journal redacts credentials before retaining or persisting a message", async () => {
  const journal = makeJournal("redaction");
  journal.recordError("request failed: Bearer abc.def.ghi https://host/path?token=super-secret SUPABASE_SERVICE_KEY=service-secret Cookie=session-cookie", {
    source: "external-api"
  });
  await journal.flush();

  const snapshotText = JSON.stringify(journal.snapshot());
  const diskText = fs.readFileSync(journal.filePath, "utf8");
  assert.doesNotMatch(snapshotText, /abc\.def\.ghi|super-secret|service-secret|session-cookie/);
  assert.doesNotMatch(diskText, /abc\.def\.ghi|super-secret|service-secret|session-cookie/);
  assert.match(snapshotText, /\*\*\*/);
});

test("identical warnings and errors are deduplicated within the configured window", async () => {
  let clock = 1000;
  const journal = makeJournal("dedupe", { now: () => clock, dedupeWindowMs: 60000 });
  journal.recordError("same failure", { source: "command", commandName: "stk" });
  clock += 1000;
  const duplicate = journal.recordError("same failure", { source: "command", commandName: "stk" });

  assert.equal(duplicate.deduplicated, true);
  assert.equal(journal.snapshot().summary.unique, 1);
  assert.equal(journal.snapshot().summary.errors, 2);
  assert.equal(journal.snapshot().events[0].count, 2);

  clock += 61000;
  journal.recordError("same failure", { source: "command", commandName: "stk" });
  assert.equal(journal.snapshot().summary.unique, 2);
  await journal.flush();

  const persisted = readJournalFiles(journal.filePath, 10);
  assert.equal(persisted.length, 2, "persistent reader merges repeated snapshots under the same event ID");
  assert.equal(persisted.find(item => item.count === 2)?.count, 2);
});

test("error journal rotates bounded JSONL files and reads the latest entries", async () => {
  const journal = makeJournal("rotation", { maxFileBytes: 65536, maxRecent: 150 });
  for (let i = 0; i < 100; i++) {
    journal.recordError("failure-" + i + " " + "x".repeat(900), {
      source: "test",
      commandName: "command-" + i
    });
  }
  await journal.flush();

  assert.equal(fs.existsSync(journal.filePath), true);
  assert.equal(fs.existsSync(journal.filePath + ".1"), true);
  assert.ok(fs.statSync(journal.filePath).size <= 65536);
  const latest = readJournalFile(journal.filePath, 20);
  const rotated = readJournalFile(journal.filePath + ".1", 100);
  const history = readJournalFiles(journal.filePath, 100);
  assert.ok(latest.length > 0);
  assert.ok(rotated.length > 0);
  assert.equal(history.length, 100, "Panel can read events from the active file and rotated archives");
  assert.equal(journal.snapshot().summary.unique, 100);
});

test("error journal bounds its in-memory recent ring", async () => {
  const journal = makeJournal("bounded", { maxRecent: 10 });
  for (let i = 0; i < 25; i++) journal.recordWarning("warning-" + i);
  const snapshot = journal.snapshot(100);

  assert.equal(snapshot.events.length, 10);
  assert.equal(snapshot.summary.unique, 10);
  assert.equal(snapshot.summary.warnings, 10);
  await journal.flush();
});


test("private user conversations never store sender IDs as group IDs", () => {
  const normalized = normalizeContext({
    source: "command",
    isGroup: false,
    groupId: "private-user-uid-123"
  });
  assert.equal(normalized.groupId, "");
});


test("fatal process errors are synchronously persisted without waiting for the event loop", () => {
  const journal = makeJournal("fatal-sync");
  const entry = journal.recordFatalSync("fatal sample", {
    source: "process-crash",
    eventName: "uncaughtException",
    code: "ERR_TEST"
  });
  assert.equal(entry.source, "process-crash");
  const persisted = readJournalFile(journal.filePath, 10);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].message, "fatal sample");
  assert.equal(persisted[0].code, "ERR_TEST");
});
